"""基于 LangChain v1 的 AI 学习助手 Agent

使用 Agent + SummarizationMiddleware 替代旧的 chain + memory 模式。
支持不同 LLM 后端：OpenAI / Anthropic / Ollama。
"""
from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.tools import Tool

from app.config import settings


def _build_llm(streaming: bool = False, callbacks: list | None = None):
    """根据配置构建 LLM 实例

    Args:
        streaming: 是否启用流式输出
        callbacks: LangChain 回调处理器列表
    """
    provider = settings.LLM_PROVIDER.lower()

    if provider == "openai":
        from langchain_openai import ChatOpenAI
        kwargs = {"model": settings.LLM_MODEL, "temperature": settings.LLM_TEMPERATURE}
        if settings.LLM_API_KEY:
            kwargs["api_key"] = settings.LLM_API_KEY
        if settings.LLM_API_BASE:
            kwargs["base_url"] = settings.LLM_API_BASE
        if streaming:
            kwargs["streaming"] = True
        if callbacks:
            kwargs["callbacks"] = callbacks
        return ChatOpenAI(**kwargs)

    elif provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        kwargs = {"model": settings.LLM_MODEL, "temperature": settings.LLM_TEMPERATURE}
        if settings.LLM_API_KEY:
            kwargs["api_key"] = settings.LLM_API_KEY
        if streaming:
            kwargs["streaming"] = True
        if callbacks:
            kwargs["callbacks"] = callbacks
        return ChatAnthropic(**kwargs)

    elif provider == "ollama":
        from langchain_ollama import ChatOllama
        kwargs = {
            "model": settings.LLM_MODEL,
            "temperature": settings.LLM_TEMPERATURE,
        }
        if streaming:
            kwargs["streaming"] = True
        if callbacks:
            kwargs["callbacks"] = callbacks
        return ChatOllama(**kwargs)

    else:
        raise ValueError(f"不支持的 LLM 提供商: {provider}")


def extract_usage(last_msg, llm, duration_ms: int) -> dict:
    """从 AIMessage 中提取 token 用量和模型信息"""
    usage = {
        "model": getattr(llm, "model_name", "") or getattr(llm, "model", "") or "",
        "provider": _provider_name(),
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "duration_ms": duration_ms,
    }

    # 方式 1: usage_metadata（LangChain 标准化字段）
    um = getattr(last_msg, "usage_metadata", None)
    if um:
        usage["prompt_tokens"] = getattr(um, "input_tokens", 0) or um.get("input_tokens", 0)
        usage["completion_tokens"] = getattr(um, "output_tokens", 0) or um.get("output_tokens", 0)
        usage["total_tokens"] = getattr(um, "total_tokens", 0) or um.get("total_tokens", 0)
        return usage

    # 方式 2: response_metadata（各提供商原始响应）
    rm = getattr(last_msg, "response_metadata", None) or {}
    if not rm:
        return usage

    # OpenAI
    tu = rm.get("token_usage") or rm.get("usage") or {}
    if tu:
        usage["prompt_tokens"] = tu.get("prompt_tokens", 0)
        usage["completion_tokens"] = tu.get("completion_tokens", 0)
        usage["total_tokens"] = tu.get("total_tokens", 0)

    # Anthropic
    if not usage["total_tokens"]:
        usage["prompt_tokens"] = rm.get("input_tokens", 0)
        usage["completion_tokens"] = rm.get("output_tokens", 0)
        usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]

    return usage


def _provider_name() -> str:
    return settings.LLM_PROVIDER.lower()


SYSTEM_PROMPT_TEMPLATE = """你是一位专业的 AI 学习导师，擅长引导用户进行深度学习。

## 当前学习领域
{area_name}

## 领域简介
{area_description}

## 学习指南
1. 首先了解用户在该领域现有的知识水平。
2. 根据用户的兴趣，引导探索该领域的 **子方向 / 核心知识点**。
3. 每次回答后，可以提供 2-3 个建议的**下一步探索方向**，帮助横向拓展知识树。
4. 回答要清晰、结构化，适当使用标题和列表。
5. 如果用户提到具体问题，请深入解答，并提供相关的前沿信息。
6. 对话结束前，可以建议用户将当前所学总结为一个新的子领域节点。

请开始与用户的学习对话。"""


class LearningAgent:
    """单个学习领域的 AI 助手（v1 Agent + Middleware）"""

    def __init__(self, area_name: str, area_description: str = "", session_id: str = "default"):
        self.area_name = area_name
        self.area_description = area_description
        self.session_id = session_id
        self.llm = _build_llm()

        # 编译 system prompt（字段固定后不再变化）
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
            area_name=area_name,
            area_description=area_description or "暂无简介",
        )

        # 历史消息（启动时从 DB 加载）
        self._history: list = []

        # 使用 v1 Agent + SummarizationMiddleware
        self._agent = create_agent(
            model=self.llm,
            tools=[],
            system_prompt=system_prompt,
            middleware=[
                SummarizationMiddleware(
                    model=self.llm,
                    trigger={"messages": 20},  # 超过 20 条消息时自动总结
                ),
            ],
        )

    def add_history(self, messages: list[dict]):
        """从数据库加载历史消息到内存"""
        for msg in messages:
            if msg["role"] == "user":
                self._history.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                self._history.append(AIMessage(content=msg["content"]))

    async def chat(self, user_input: str, session_id: str | None = None):
        """发送用户消息并获取 AI 回复，返回 (reply, usage_dict)

        usage_dict 结构:
            {"model": str, "provider": str,
             "prompt_tokens": int, "completion_tokens": int, "total_tokens": int}
        """
        import time
        start = time.time()

        result = await self._agent.ainvoke({
            "messages": self._history + [HumanMessage(content=user_input)],
        })

        elapsed = int((time.time() - start) * 1000)

        # create_agent 返回状态 dict，内含 messages 列表
        messages = result.get("messages", [])
        last_msg = messages[-1] if messages else result
        reply = last_msg.content if hasattr(last_msg, "content") else str(last_msg)

        # 用 agent 返回的完整消息列表替换历史（避免重复追加）
        self._history = [m for m in messages if hasattr(m, "content")]

        # 提取用量元数据
        usage = extract_usage(last_msg, self.llm, elapsed)

        return reply, usage

    async def chat_stream(self, user_input: str,
                          callback_handler: 'StreamingCallbackHandler | None' = None,
                          session_id: str | None = None):
        """流式聊天 - 通过 callback_handler 实时推送 tokens

        返回 (reply, usage_dict)
        """
        from app.agents.streaming_handler import StreamingCallbackHandler

        import time
        start = time.time()

        # 创建流式 LLM（带回调）
        streaming_llm = _build_llm(
            streaming=True,
            callbacks=[callback_handler] if callback_handler else [],
        )

        # 创建流式 Agent（共享 system prompt）
        streaming_agent = create_agent(
            model=streaming_llm,
            tools=[],
            system_prompt=SYSTEM_PROMPT_TEMPLATE.format(
                area_name=self.area_name,
                area_description=self.area_description or "暂无简介",
            ),
            middleware=[
                SummarizationMiddleware(
                    model=streaming_llm,
                    trigger={"messages": 20},
                ),
            ],
        )

        # 运行 Agent
        result = await streaming_agent.ainvoke({
            "messages": self._history + [HumanMessage(content=user_input)],
        })

        elapsed = int((time.time() - start) * 1000)

        messages = result.get("messages", [])
        last_msg = messages[-1] if messages else result
        reply = last_msg.content if hasattr(last_msg, "content") else str(last_msg)

        # 更新主 agent 的历史（与原 agent 共享历史，保持一致性）
        self._history = [m for m in messages if hasattr(m, "content")]

        usage = extract_usage(last_msg, streaming_llm, elapsed)

        return reply, usage

# ============================================================
#  AreaAnalysis Tools — agent 通过 Tool 调用来执行分析
# ============================================================

import asyncio
import json
import re
from langchain_core.messages import HumanMessage
from langchain_core.tools import Tool
from app.database import SessionLocal
from app.models import Area, AreaAnalysis, AreaNote, ChatMessage


def _parse_llm_json(text: str) -> dict | None:
    """从 LLM 回复中提取 JSON（兼容代码块包裹）"""
    content = text.strip()
    m = re.search(r'```(?:json)?\s*([\s\S]*?)```', content)
    if m:
        content = m.group(1).strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return None


def _build_children_context(child_analyses: list[dict]) -> str:
    """将子领域的 AreaAnalysis 组装成给 LLM 的上下文"""
    lines = []
    for ca in child_analyses:
        lines.append(f"### {ca.get('name', '?')}")
        lines.append(f"摘要: {ca.get('summary', '暂无')}")
        subs = ca.get('sub_area_summaries', [])
        if subs:
            lines.append("已涵盖的子方向:")
            for s in subs:
                lines.append(f"  - {s.get('name', '?')}: {s.get('summary', '')}")
        missing = ca.get('missing_suggestions', [])
        if missing:
            lines.append("曾建议补充:")
            for m in missing:
                lines.append(f"  - {m.get('name', '?')}: {m.get('reason', '')}")
        lines.append("")
    return "\n".join(lines)


def _get_chat_messages_text(db_session, area_id: int, max_msgs: int = 15) -> str:
    """获取指定 area 的最近聊天消息，格式化为文本"""
    msgs = (
        db_session.query(ChatMessage)
        .filter(ChatMessage.area_id == area_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(max_msgs)
        .all()
    )
    if not msgs:
        return ""
    # 按时间正序排列
    msgs.reverse()
    lines = []
    for m in msgs:
        role_label = "🧑 用户" if m.role == "user" else "🤖 AI"
        content_preview = m.content[:300].replace("\n", " ")
        lines.append(f"[{role_label}] {content_preview}")
    return "\n".join(lines)


async def _generate_area_analysis_async(
    area_name: str,
    area_description: str,
    note_content: str,
    chat_context: str,
    child_analyses: list[dict],
) -> dict:
    """异步核心：为单个领域生成 AreaAnalysis"""
    llm = _build_llm()

    if child_analyses:
        children_text = _build_children_context(child_analyses)
        prompt = f"""你是知识领域分析专家。以下是你收到的**所有子领域**已有的分析记录，请聚合这些信息生成父领域的分析。

## 父领域
名称: {area_name}
简介: {area_description or '暂无简介'}
笔记预览: {(note_content or '')[:800]}
最近对话摘录（用户与 AI 的问答记录）:
{(chat_context or '')[:1500]}

## 子领域分析汇总
{children_text}

请完成：

### 任务 1：总体摘要
基于所有子领域分析，用 2-3 句话概括父领域的整体知识覆盖情况。

### 任务 2：子领域摘要列表
列出每一个子领域及其摘要（直接从子领域分析中提取）。

### 任务 3：完整性检查
基于你对 {area_name} 的理解，判断当前这些子领域是否完整覆盖了该领域应包含的核心方向。
如果缺少重要子领域，请列出缺失名称和理由；如果完整则返回空数组。

请严格按以下 JSON 格式返回（不要包含其他内容）：
{{
    "summary": "总体分析摘要",
    "sub_area_summaries": [
        {{"name": "子领域名称", "summary": "子领域摘要"}}
    ],
    "missing_suggestions": [
        {{"name": "建议补充的子领域", "reason": "补充理由"}}
    ]
}}"""
    else:
        prompt = f"""你是知识领域分析专家。请分析以下学习领域的**自身内容**。

## 领域
名称: {area_name}
简介: {area_description or '暂无简介'}
笔记内容: {(note_content or '')[:1500]}
最近对话摘录（用户与 AI 的问答记录）:
{(chat_context or '')[:1500]}

该领域目前没有定义子领域。请分析：

### 任务 1：领域摘要
基于名称、简介、笔记内容和最近对话，用 1-2 句话概括该领域的核心内容。

### 任务 2：建议的子方向
思考该领域通常应包含哪些重要的子方向/子知识点，列出你认为应该补充的建议。
如果该领域足够原子化不需要拆分，missing_suggestions 返回空数组。

请严格按以下 JSON 格式返回（不要包含其他内容）：
{{
    "summary": "领域核心内容摘要",
    "sub_area_summaries": [],
    "missing_suggestions": [
        {{"name": "建议的子方向名称", "reason": "补充理由"}}
    ]
}}"""

    response = await llm.ainvoke([HumanMessage(content=prompt)])
    result = _parse_llm_json(response.content)

    if result is None:
        result = {
            "summary": f"[解析失败] 原始响应：{response.content[:300]}",
            "sub_area_summaries": [{"name": ca.get("name", ""), "summary": ca.get("summary", "")}
                                   for ca in child_analyses] if child_analyses else [],
            "missing_suggestions": [],
        }
    return result


def _save_analysis(db_session, area_id: int, result: dict) -> AreaAnalysis:
    """将 LLM 结果保存到 area_analyses 表"""
    analysis = AreaAnalysis(
        area_id=area_id,
        summary=result.get("summary", ""),
        sub_area_summaries=json.dumps(result.get("sub_area_summaries", []), ensure_ascii=False),
        missing_suggestions=json.dumps(result.get("missing_suggestions", []), ensure_ascii=False),
    )
    db_session.add(analysis)
    db_session.commit()
    return analysis


# -----------------------------------------------------------
#  Tool 1: 列出子领域及其分析状态
# -----------------------------------------------------------
def _list_sub_areas(area_id_str: str) -> str:
    """列出指定 area_id 的所有直接子领域，标注每个是否已有 AreaAnalysis"""
    db = SessionLocal()
    try:
        area = db.query(Area).get(int(area_id_str))
        if not area:
            return f"错误：area_id={area_id_str} 不存在"
        children = db.query(Area).filter(Area.parent_id == int(area_id_str)).order_by(Area.order).all()
        if not children:
            return f"领域「{area.name}」没有子领域。"
        lines = [f"领域「{area.name}」的子领域列表："]
        for c in children:
            analysis = db.query(AreaAnalysis).filter(
                AreaAnalysis.area_id == c.id
            ).order_by(AreaAnalysis.created_at.desc()).first()
            status = "✅ 已有分析" if analysis else "❌ 未分析"
            lines.append(f"  - ID={c.id} 「{c.name}」{status}")
        return "\n".join(lines)
    finally:
        db.close()


# -----------------------------------------------------------
#  Tool 2: 为指定子领域生成分析（递归确保其下级先有分析）
# -----------------------------------------------------------
def _generate_sub_analysis(area_id_str: str) -> str:
    """为指定 area_id 生成 AreaAnalysis（如果还没有的话）。
    如果是父领域，会先递归确保其子领域都有分析后再生成。"""
    area_id = int(area_id_str)
    db = SessionLocal()
    try:
        area = db.query(Area).get(area_id)
        if not area:
            return f"错误：area_id={area_id} 不存在"

        # 检查是否已有分析
        existing = db.query(AreaAnalysis).filter(
            AreaAnalysis.area_id == area_id
        ).order_by(AreaAnalysis.created_at.desc()).first()
        if existing:
            return f"「{area.name}」已有分析记录 (ID={existing.id})，跳过生成。"

        # 递归确保子领域的子领域都有分析
        children = db.query(Area).filter(Area.parent_id == area_id).order_by(Area.order).all()
        child_analyses = []
        for child in children:
            # 递归调用自身
            _generate_sub_analysis(str(child.id))
            # 读取最新分析
            ca = db.query(AreaAnalysis).filter(
                AreaAnalysis.area_id == child.id
            ).order_by(AreaAnalysis.created_at.desc()).first()
            if ca:
                ca_dict = ca.to_dict()
                ca_dict["name"] = child.name
                child_analyses.append(ca_dict)

        # 读取笔记
        note = db.query(AreaNote).filter(AreaNote.area_id == area_id).first()
        note_content = note.content[:2000] if note and note.content else ""

        # 读取最近聊天记录
        chat_context = _get_chat_messages_text(db, area_id)

        # 异步调用 LLM 生成
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(_generate_area_analysis_async(
                area_name=area.name,
                area_description=area.description or "",
                note_content=note_content,
                chat_context=chat_context,
                child_analyses=child_analyses,
            ))
        finally:
            loop.close()

        # 保存
        _save_analysis(db, area_id, result)

        return (f"✅ 已为「{area.name}」生成分析：\n"
                f"摘要：{result.get('summary', '')[:200]}")
    finally:
        db.close()


# -----------------------------------------------------------
#  Tool 3: 聚合所有子领域分析，生成父领域分析
# -----------------------------------------------------------
def _generate_parent_analysis(area_id_str: str) -> str:
    """聚合指定 area_id 的所有子领域分析，生成该 area 自身的分析。"""
    area_id = int(area_id_str)
    db = SessionLocal()
    try:
        area = db.query(Area).get(area_id)
        if not area:
            return f"错误：area_id={area_id} 不存在"

        children = db.query(Area).filter(Area.parent_id == area_id).order_by(Area.order).all()
        if not children:
            return f"领域「{area.name}」没有子领域，无法聚合分析。"

        # 收集所有子领域的最新分析
        child_analyses = []
        for child in children:
            ca = db.query(AreaAnalysis).filter(
                AreaAnalysis.area_id == child.id
            ).order_by(AreaAnalysis.created_at.desc()).first()
            if ca:
                ca_dict = ca.to_dict()
                ca_dict["name"] = child.name
                child_analyses.append(ca_dict)
            else:
                return f"❌ 子领域「{child.name}」尚未分析，请先调用 generate_sub_analysis 为其生成分析。"

        note = db.query(AreaNote).filter(AreaNote.area_id == area_id).first()
        note_content = note.content[:2000] if note and note.content else ""

        # 读取最近聊天记录
        chat_context = _get_chat_messages_text(db, area_id)

        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(_generate_area_analysis_async(
                area_name=area.name,
                area_description=area.description or "",
                note_content=note_content,
                chat_context=chat_context,
                child_analyses=child_analyses,
            ))
        finally:
            loop.close()

        _save_analysis(db, area_id, result)

        return (f"✅ 已为「{area.name}」生成分析（聚合 {len(child_analyses)} 个子领域）：\n"
                f"摘要：{result.get('summary', '')[:200]}")
    finally:
        db.close()


# -----------------------------------------------------------
#  公开的 Tool 列表 & 工厂函数
# -----------------------------------------------------------
def create_examine_tools() -> list[Tool]:
    """创建审查分析专用的 Tool 列表"""
    return [
        Tool(
            name="list_sub_areas",
            func=_list_sub_areas,
            description="输入 area_id，列出该 area 的所有直接子领域及其分析状态（✅ 已有分析 / ❌ 未分析）。",
        ),
        Tool(
            name="generate_sub_analysis",
            func=_generate_sub_analysis,
            description="输入 area_id，为指定 area 生成 AreaAnalysis。如果该 area 有子领域，会自动递归先确保子领域都有分析。如果已有分析则跳过。",
        ),
        Tool(
            name="generate_parent_analysis",
            func=_generate_parent_analysis,
            description="输入父 area_id，聚合其所有子领域的 AreaAnalysis 来生成该父 area 自身的分析。调用前请确保所有子领域都已通过 generate_sub_analysis 生成分析。",
        ),
    ]


# -----------------------------------------------------------
#  Generate Subareas Tool — 生成子领域建议
# -----------------------------------------------------------
def _list_existing_children_for_generation(area_id_str: str) -> str:
    """查询指定 area 的所有直接子领域，返回 JSON 列表"""
    db = SessionLocal()
    try:
        area_id = int(area_id_str)
        children = db.query(Area).filter(
            Area.parent_id == area_id
        ).order_by(Area.order).all()
        result = [{"id": c.id, "name": c.name, "description": c.description or ""}
                  for c in children]
        return json.dumps({"existing_sub_areas": result}, ensure_ascii=False)
    finally:
        db.close()


def create_generate_tools() -> list[Tool]:
    """创建生成子领域建议专用的 Tool 列表"""
    return [
        Tool(
            name="list_existing_children",
            func=_list_existing_children_for_generation,
            description="输入 area_id，查询该 area 的所有直接子领域（已存在于数据库中的），返回 JSON 格式的列表。",
        ),
    ]


async def run_generate_subareas_stream(area_id: int, area_name: str, area_description: str,
                                        callback_handler) -> dict:
    """流式生成子领域建议 - 通过 callback_handler 实时推送 tokens"""
    llm = _build_llm(streaming=True, callbacks=[callback_handler])
    tools = create_generate_tools()

    agent = create_agent(
        model=llm,
        tools=tools,
        system_prompt="你是一个知识领域分析助手，擅长根据学习内容生成子领域建议。",
    )

    from app.database import SessionLocal as _DB
    db = _DB()
    try:
        # 获取最近聊天消息
        msgs = (
            db.query(ChatMessage)
            .filter(ChatMessage.area_id == area_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(20)
            .all()
        )
        msgs.reverse()
        chat_lines = []
        for m in msgs:
            role_label = "🧑 用户" if m.role == "user" else "🤖 AI"
            chat_lines.append(f"[{role_label}] {m.content[:500]}")
        chat_context = "\n".join(chat_lines) if chat_lines else "暂无对话记录"
    finally:
        db.close()

    task = f"""请对学习领域「{area_name}」(ID={area_id}) 执行以下任务：

## 当前领域信息
名称: {area_name}
简介: {area_description or '暂无简介'}

## 最近聊天记录
{chat_context[:3000]}

请按以下步骤执行：

### 步骤 1：查看现有子领域
调用 list_existing_children({area_id}) 查看该领域下已存在的子领域。

### 步骤 2：生成建议
基于当前领域的名称、简介和最近的聊天记录内容，思考该领域可以深入研究的子方向。
请生成 3-6 个建议的子领域，每个包含 title（标题）和 description（简要描述）。

### 步骤 3：返回结果
返回 JSON 格式（不要包含其他内容）：
{{
    "generated_sub_areas": [
        {{"title": "子领域标题", "description": "子领域简要描述"}}
    ],
    "existing_sub_areas": []
}}
注意：existing_sub_areas 由工具返回填充，你只需生成 generated_sub_areas。

请开始执行。"""
    result = await agent.ainvoke({"messages": [HumanMessage(content=task)]})
    messages = result.get("messages", [])
    last_msg = messages[-1] if messages else result
    reply = last_msg.content if hasattr(last_msg, "content") else str(last_msg)

    # 解析返回的 JSON
    parsed = _parse_llm_json(reply)
    if not parsed:
        # 尝试从完整消息中提取 JSON
        import re
        m = re.search(r'```(?:json)?\s*([\s\S]*?)```', reply)
        if m:
            parsed = _parse_llm_json(m.group(1))

    if parsed:
        return {
            "generated_sub_areas": parsed.get("generated_sub_areas", []),
            "existing_sub_areas": parsed.get("existing_sub_areas", []),
        }
    return {
        "generated_sub_areas": [],
        "existing_sub_areas": [],
        "error": "AI 返回格式解析失败",
    }


async def run_polish_subareas(sub_areas: list[dict]) -> list[dict]:
    """润色子领域描述：不改变 title 和数量，只优化 description"""
    llm = _build_llm()

    items_json = json.dumps(sub_areas, ensure_ascii=False, indent=2)
    prompt = f"""你是一个知识领域专家。请审查以下子领域列表，仅优化每个条目的 description（描述），使其更加准确、清晰和深入。

## 规则
1. 绝对不要修改 title（标题）
2. 绝对不要增加或删除条目
3. 只改进 description 的文字表达

## 输入列表
{items_json}

请严格按以下 JSON 格式返回（不要包含其他内容）：
{{
    "sub_areas": [
        {{"title": "标题（不变）", "description": "优化后的描述"}}
    ]
}}"""
    response = await llm.ainvoke([HumanMessage(content=prompt)])
    result = _parse_llm_json(response.content)
    if result and "sub_areas" in result:
        return result["sub_areas"]
    return sub_areas  # 解析失败则返回原列表


async def run_examine_agent(area_id: int, area_name: str) -> dict:
    """创建 agent 并运行审查流程"""
    llm = _build_llm()
    tools = create_examine_tools()

    agent = create_agent(
        model=llm,
        tools=tools,
        system_prompt="你是一个知识领域分析助手。请使用提供的工具完成分析任务。",
    )

    task = f"""请对学习领域「{area_name}」(ID={area_id}) 执行完整的子领域审查分析。请按以下步骤执行：

## 步骤 1：列出子领域
调用 list_sub_areas({area_id}) 查看所有子领域及其分析状态。

## 步骤 2：确保每个子领域都有分析
遍历步骤 1 返回的结果，如果有 ❌ 未分析 的子领域，调用 generate_sub_analysis(子ID) 为其生成分析。
如果某个子领域本身是父领域，generate_sub_analysis 会自动递归处理。

## 步骤 3：生成当前领域的分析
当所有子领域都完成分析后，调用 generate_parent_analysis({area_id}) 聚合所有子领域分析，生成「{area_name}」的分析。

## 步骤 4：返回最终结果
告诉我分析完成的情况：生成了多少个子领域的分析，以及父领域的分析摘要。

请开始执行。"""
    result = await agent.ainvoke({"messages": [HumanMessage(content=task)]})
    messages = result.get("messages", [])
    last_msg = messages[-1] if messages else result
    reply = last_msg.content if hasattr(last_msg, "content") else str(last_msg)

    # 查询最终保存的分析记录
    db = SessionLocal()
    try:
        analysis = db.query(AreaAnalysis).filter(
            AreaAnalysis.area_id == area_id
        ).order_by(AreaAnalysis.created_at.desc()).first()
        return {
            "agent_reply": reply,
            "analysis": analysis.to_dict() if analysis else None,
        }
    finally:
        db.close()


async def run_examine_agent_stream(area_id: int, area_name: str,
                                    callback_handler) -> dict:
    """流式审查 - 通过 callback_handler 实时推送 tokens"""
    llm = _build_llm(streaming=True, callbacks=[callback_handler])
    tools = create_examine_tools()

    agent = create_agent(
        model=llm,
        tools=tools,
        system_prompt="你是一个知识领域分析助手。请使用提供的工具完成分析任务。",
    )

    task = f"""请对学习领域「{area_name}」(ID={area_id}) 执行完整的子领域审查分析。请按以下步骤执行：

## 步骤 1：列出子领域
调用 list_sub_areas({area_id}) 查看所有子领域及其分析状态。

## 步骤 2：确保每个子领域都有分析
遍历步骤 1 返回的结果，如果有 ❌ 未分析 的子领域，调用 generate_sub_analysis(子ID) 为其生成分析。
如果某个子领域本身是父领域，generate_sub_analysis 会自动递归处理。

## 步骤 3：生成当前领域的分析
当所有子领域都完成分析后，调用 generate_parent_analysis({area_id}) 聚合所有子领域分析，生成「{area_name}」的分析。

## 步骤 4：返回最终结果
告诉我分析完成的情况：生成了多少个子领域的分析，以及父领域的分析摘要。

请开始执行。"""
    result = await agent.ainvoke({"messages": [HumanMessage(content=task)]})
    messages = result.get("messages", [])
    last_msg = messages[-1] if messages else result
    reply = last_msg.content if hasattr(last_msg, "content") else str(last_msg)

    # 查询最终保存的分析记录
    db = SessionLocal()
    try:
        analysis = db.query(AreaAnalysis).filter(
            AreaAnalysis.area_id == area_id
        ).order_by(AreaAnalysis.created_at.desc()).first()
        return {
            "agent_reply": reply,
            "analysis": analysis.to_dict() if analysis else None,
        }
    finally:
        db.close()
