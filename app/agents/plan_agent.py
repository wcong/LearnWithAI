"""Plan Mode — 基于 LangGraph StateGraph 的领域深度学习规划引擎

使用 LangGraph 的 StateGraph + SqliteSaver 替代递归函数实现。
工作流程（BFS 队列）：
  1. 创建根 Area（用户输入的领域）
  2. 从 pending 队列弹出一个领域节点
  3. AI 生成该领域概况 → 保存 ChatMessage
  4. AI 提取子领域列表 → 创建子 Area 节点 → 加入 pending 队列
  5. 重复步骤 2-4 直到 pending 队列为空
  6. 最多 max_depth 层，或 AI 返回空子领域列表时停止
"""
import asyncio
import json
import time
import logging
from typing import TypedDict, Literal, Optional

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.checkpoint.mysql.aio import AIOMySQLSaver
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from app.database import SessionLocal
from app.models import Area, ChatMessage, UsageLog
from app.agents.learning_agent import _build_llm, _parse_llm_json, extract_usage
from app.agents.streaming_handler import StreamingCallbackHandler

log = logging.getLogger("learnwithai")

MAX_BRANCHES = 10


def _log_checkpoint(engine: str, target: str):
    """记录检查点后端信息"""
    log.info("[Plan] 检查点后端: %s → %s", engine, target)


# ── Prompt 模板 ──────────────────────────────────────────────

PROMPT_OVERVIEW = """你是一位知识领域专家。请为以下学习领域生成一份**全面、结构化**的领域概况。

## 领域名称
{domain_name}

## 父领域上下文（该领域所属的更大领域）
{parent_context}

## 要求
1. 概述该领域的核心定义、研究范围和重要意义
2. 介绍该领域的主要分支和关键研究主题
3. 描述该领域当前的前沿方向和热点问题
4. 说明该领域的实践应用价值
5. 请用中文回答，使用 Markdown 格式（标题、列表、加粗等）
6. 内容应当深入、具体、有洞察力，而非泛泛而谈
7. 控制在 800-1500 字

请开始生成概况："""


PROMPT_EXTRACT_SUBDOMAINS = """你是知识领域分析专家。请根据以下领域的概况信息，提取出**可以深入专研的具体子方向**。

## 领域名称
{domain_name}

## 领域概况
{overview}

## 父领域上下文
{parent_context}

## 要求
1. 提取 3-5 个**具体的、可深度专研**的子方向
2. 每个子方向必须是**可深入研究的领域**，而非宽泛的概念
3. 例如：
   - ✅ 好的示例："Transformer 注意力机制优化"、"卷积神经网络在医学影像中的应用"
   - ❌ 差的示例："深度学习"、"人工智能"（太过宽泛）
4. 每个子方向需要包含：
   - name: 子方向名称（具体、可研究）
   - description: 该方向的简要描述（2-3 句话，说明该方向的核心研究内容和特殊性）
5. 如果当前领域已经足够原子化、不具备细分价值，返回空列表
6. 请严格按以下 JSON 格式返回（不要包含其他内容）：

```json
{{
    "subdomains": [
        {{"name": "子方向名称", "description": "子方向详细描述"}}
    ]
}}
```

请开始分析："""


# ── SSE 事件推送辅助 ─────────────────────────────────────

async def _push_event(queue: asyncio.Queue, event_type: str, data: dict):
    """将事件推送到 SSE 队列"""
    await queue.put((event_type, data))


# ── LangChain Tool — 数据库操作 ───────────────────────────


@tool
def save_area(user_id: int, name: str, description: str, parent_id: int | None) -> dict:
    """创建并保存一个学习领域（Area）到数据库。

    Args:
        user_id: 用户 ID
        name: 领域名称
        description: 领域描述
        parent_id: 父领域 ID（根领域设为 None）

    Returns:
        包含 id, name, description, parent_id 的字典
    """
    db = SessionLocal()
    try:
        area = Area(
            user_id=user_id,
            name=name,
            description=description,
            parent_id=parent_id,
        )
        db.add(area)
        db.commit()
        db.refresh(area)
        return {"id": area.id, "name": area.name, "description": area.description, "parent_id": area.parent_id}
    finally:
        db.close()


@tool
def get_area(area_id: int) -> dict | None:
    """根据 ID 获取学习领域（Area）。

    Args:
        area_id: 领域 ID

    Returns:
        包含 id, name, description, parent_id 的字典，不存在时返回 None
    """
    db = SessionLocal()
    try:
        area = db.query(Area).get(area_id)
        if area is None:
            return None
        return {"id": area.id, "name": area.name, "description": area.description, "parent_id": area.parent_id}
    finally:
        db.close()


@tool
def save_message(area_id: int, role: str, content: str) -> dict:
    """保存一条聊天消息（ChatMessage）到数据库。

    Args:
        area_id: 所属领域 ID
        role: 角色，'user' 或 'assistant'
        content: 消息内容

    Returns:
        包含 id, area_id, role 的字典
    """
    db = SessionLocal()
    try:
        msg = ChatMessage(area_id=area_id, role=role, content=content)
        db.add(msg)
        db.commit()
        db.refresh(msg)
        return {"id": msg.id, "area_id": msg.area_id, "role": msg.role}
    finally:
        db.close()


@tool
def get_messages(area_id: int, limit: int = 20) -> list[dict]:
    """获取指定学习领域的最新聊天消息列表。

    Args:
        area_id: 领域 ID
        limit: 返回消息数量上限（默认 20）

    Returns:
        按时间正序排列的消息列表，每条包含 id, role, content, created_at
    """
    db = SessionLocal()
    try:
        msgs = (
            db.query(ChatMessage)
            .filter(ChatMessage.area_id == area_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
            .all()
        )
        msgs.reverse()
        return [
            {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
            for m in msgs
        ]
    finally:
        db.close()


# ── LangGraph State & Types ─────────────────────────────────

class AreaItem(TypedDict):
    """待处理领域节点"""
    area_id: int
    name: str
    depth: int
    parent_context: str


class PlanState(TypedDict):
    """LangGraph State — 在图中流转的共享状态"""
    # 用户输入
    user_id: int
    root_topic: str
    max_depth: int

    # 待处理 BFS 队列
    pending_areas: list[AreaItem]

    # 统计
    total_areas: int
    total_messages: int

    # 当前正在处理的领域
    current_area_id: int | None
    current_area_name: str
    current_depth: int
    current_parent_context: str

    # 当前 LLM 产出（临时，仅在当前循环内有意义）
    overview: str | None
    subdomains: list[dict] | None

    # 结果
    finished: bool
    result: dict | None
    error: str | None


# ── 向后兼容函数（测试依赖） ──────────────────────────────

def _save_area(user_id: int, name: str, description: str, parent_id: int | None) -> Area:
    """创建 Area 并保存到数据库，返回 Area 对象（向后兼容）"""
    result = save_area.invoke({"user_id": user_id, "name": name, "description": description, "parent_id": parent_id})
    db = SessionLocal()
    try:
        area = db.query(Area).get(result["id"])
        return area
    finally:
        db.close()


def _save_message(area_id: int, role: str, content: str) -> ChatMessage:
    """保存 ChatMessage 到数据库，返回 ChatMessage 对象（向后兼容）"""
    result = save_message.invoke({"area_id": area_id, "role": role, "content": content})
    db = SessionLocal()
    try:
        msg = db.query(ChatMessage).get(result["id"])
        return msg
    finally:
        db.close()


def _save_usage(area_id: int, message_id: int, usage: dict):
    """记录 UsageLog（向后兼容）"""
    if not usage:
        return
    db = SessionLocal()
    try:
        ul = UsageLog(
            area_id=area_id,
            message_id=message_id,
            model=usage.get("model", ""),
            provider=usage.get("provider", ""),
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            total_tokens=usage.get("total_tokens", 0),
            duration_ms=usage.get("duration_ms", 0),
        )
        db.add(ul)
        db.commit()
    finally:
        db.close()


def _build_context_path(area_id: int) -> str:
    """构建从根到当前节点的 context 链文本（向后兼容）"""
    pieces = []
    db = SessionLocal()
    try:
        current = db.query(Area).get(area_id)
        while current:
            pieces.insert(0, f"{current.name}")
            if current.parent_id:
                current = db.query(Area).get(current.parent_id)
            else:
                break
    finally:
        db.close()
    return " → ".join(pieces)


# ── LLM 调用辅助 ───────────────────────────────────────────

async def _call_llm(prompt: str, llm=None, callback_handler=None,
                    langfuse_handler=None) -> tuple[str, dict]:
    """调用 LLM 并返回 (response_content, usage_dict)"""
    if llm is None:
        callbacks = [cb for cb in [callback_handler, langfuse_handler] if cb is not None]
        llm = _build_llm(callbacks=callbacks if callbacks else None)

    start = time.time()
    config = None
    if langfuse_handler:
        config = {"callbacks": [langfuse_handler]}
    response = await llm.ainvoke([{"role": "user", "content": prompt}], config=config)
    elapsed = int((time.time() - start) * 1000)

    content = response.content if hasattr(response, "content") else str(response)
    usage = extract_usage(response, llm, elapsed)

    return content, usage


async def _call_llm_stream(prompt: str, callback_handler: StreamingCallbackHandler,
                           llm=None, langfuse_handler=None) -> tuple[str, dict]:
    """流式调用 LLM，通过 callback_handler 实时推送 tokens"""
    if llm is None:
        callbacks = [cb for cb in [callback_handler, langfuse_handler] if cb is not None]
        llm = _build_llm(streaming=True, callbacks=callbacks if callbacks else None)

    start = time.time()
    config = None
    if langfuse_handler:
        config = {"callbacks": [langfuse_handler]}
    response = await llm.ainvoke([{"role": "user", "content": prompt}], config=config)
    elapsed = int((time.time() - start) * 1000)

    content = response.content if hasattr(response, "content") else str(response)
    usage = extract_usage(response, llm, elapsed)

    return content, usage


async def _generate_overview(domain_name: str, parent_context: str = "",
                             callback_handler: StreamingCallbackHandler | None = None,
                             langfuse_handler=None) -> str:
    """生成领域概况（流式）"""
    prompt = PROMPT_OVERVIEW.format(
        domain_name=domain_name,
        parent_context=parent_context or "（无，此为根领域）",
    )

    if callback_handler:
        content, _ = await _call_llm_stream(prompt, callback_handler, langfuse_handler=langfuse_handler)
    else:
        content, _ = await _call_llm(prompt, langfuse_handler=langfuse_handler)

    return content


async def _extract_subdomains(domain_name: str, overview: str, parent_context: str = "",
                              callback_handler: StreamingCallbackHandler | None = None,
                              langfuse_handler=None) -> list[dict]:
    """提取子领域列表，返回 [{name, description}, ...]"""
    prompt = PROMPT_EXTRACT_SUBDOMAINS.format(
        domain_name=domain_name,
        overview=overview[:2000],
        parent_context=parent_context or "（无，此为根领域）",
    )

    if callback_handler:
        content, _ = await _call_llm_stream(prompt, callback_handler, langfuse_handler=langfuse_handler)
    else:
        content, _ = await _call_llm(prompt, langfuse_handler=langfuse_handler)

    parsed = _parse_llm_json(content)
    if parsed and "subdomains" in parsed:
        return parsed["subdomains"][:MAX_BRANCHES]
    return []


# ── LangGraph Node 函数 ─────────────────────────────────────

async def initialize(state: PlanState, config: RunnableConfig) -> dict:
    """Node: 初始化 — 创建根 Area，加入 pending 队列"""
    runtime = config["configurable"].get("runtime_context", {})
    queue = runtime.get("queue")
    cb_handler = runtime.get("callback_handler")
    langfuse_handler = runtime.get("langfuse_handler")

    # 创建根 Area
    result = save_area.invoke({
        "user_id": state["user_id"],
        "name": state["root_topic"],
        "description": "",
        "parent_id": None,
    })

    root_area_id = result["id"]

    if queue:
        await _push_event(queue, "area_created", {
            "area_id": root_area_id,
            "name": state["root_topic"],
            "description": "",
            "parent_id": None,
            "depth": 0,
        })

    # 初始化 pending 队列（BFS）
    pending = [AreaItem(
        area_id=root_area_id,
        name=state["root_topic"],
        depth=0,
        parent_context="",
    )]

    return {
        "pending_areas": pending,
        "total_areas": 1,
        "total_messages": 0,
    }


async def process_area(state: PlanState, config: RunnableConfig) -> dict:
    """Node: 从 pending 队列取出一个领域，生成概况并保存 ChatMessage"""
    runtime = config["configurable"].get("runtime_context", {})
    queue = runtime.get("queue")
    cb_handler = runtime.get("callback_handler")
    langfuse_handler = runtime.get("langfuse_handler")

    pending = list(state.get("pending_areas", []))
    if not pending:
        return {}

    current = pending.pop(0)

    area_id = current["area_id"]
    area_name = current["name"]
    depth = current["depth"]
    parent_context = current["parent_context"]

    if queue:
        await _push_event(queue, "progress", {
            "current_depth": depth,
            "current_area": area_name,
            "status": f"正在探索 Level {depth}: {area_name}",
        })

    # 生成概况
    overview = await _generate_overview(area_name, parent_context, cb_handler, langfuse_handler)

    # 保存概况为 AI 消息
    msg_result = save_message.invoke({
        "area_id": area_id,
        "role": "assistant",
        "content": overview,
    })
    msg_id = msg_result["id"]

    if queue:
        await _push_event(queue, "message", {
            "area_id": area_id,
            "area_name": area_name,
            "depth": depth,
            "role": "assistant",
            "content": overview,
            "message_id": msg_id,
        })
        await _push_event(queue, "progress", {
            "current_depth": depth,
            "current_area": area_name,
            "phase": "overview_complete",
            "status": f"「{area_name}」概况已生成",
        })

    return {
        "current_area_id": area_id,
        "current_area_name": area_name,
        "current_depth": depth,
        "current_parent_context": parent_context,
        "overview": overview,
        "total_messages": state.get("total_messages", 0) + 1,
        "pending_areas": pending,
    }


async def extract_subdomains_node(state: PlanState, config: RunnableConfig) -> dict:
    """Node: 基于当前领域的概况，提取子领域列表"""
    runtime = config["configurable"].get("runtime_context", {})
    cb_handler = runtime.get("callback_handler")
    langfuse_handler = runtime.get("langfuse_handler")

    area_name = state.get("current_area_name", "")
    overview = state.get("overview", "")
    parent_context = state.get("current_parent_context", "")
    current_area_id = state.get("current_area_id")

    if not overview or current_area_id is None:
        return {"subdomains": []}

    # 构建 context 链
    context_chain = _build_context_path(current_area_id)
    parent_context_full = (
        f"父领域: {area_name}\n"
        f"父领域 context 链: {context_chain}\n"
        f"父领域概况概要: {overview[:500]}"
    )

    subdomains = await _extract_subdomains(area_name, overview, parent_context, cb_handler, langfuse_handler)

    return {
        "subdomains": subdomains,
        "current_parent_context": parent_context_full,
    }


async def create_children(state: PlanState, config: RunnableConfig) -> dict:
    """Node: 为当前领域创建子 Area 并加入 pending 队列"""
    runtime = config["configurable"].get("runtime_context", {})
    queue = runtime.get("queue")
    max_depth = state.get("max_depth", 2)
    current_depth = state.get("current_depth", 0)
    parent_id = state.get("current_area_id")
    current_area_name = state.get("current_area_name", "")
    parent_context = state.get("current_parent_context", "")
    subdomains = state.get("subdomains", []) or []

    # 到达最大深度或没有子领域时跳过
    if current_depth >= max_depth or not subdomains:
        if queue:
            await _push_event(queue, "progress", {
                "current_depth": current_depth,
                "current_area": current_area_name,
                "phase": "children_done",
                "total_subdomains": 0,
                "status": f"「{current_area_name}」探索完成（已达最大深度或无子领域）",
            })
        return {}

    pending = list(state.get("pending_areas", []))
    total_areas = state.get("total_areas", 0)

    child_items = []
    for sd in subdomains:
        result = save_area.invoke({
            "user_id": state["user_id"],
            "name": sd["name"],
            "description": sd.get("description", ""),
            "parent_id": parent_id,
        })
        child_id = result["id"]
        total_areas += 1

        child_item = AreaItem(
            area_id=child_id,
            name=sd["name"],
            depth=current_depth + 1,
            parent_context=parent_context,
        )
        child_items.append(child_item)

        if queue:
            await _push_event(queue, "area_created", {
                "area_id": child_id,
                "name": sd["name"],
                "description": sd.get("description", ""),
                "parent_id": parent_id,
                "depth": current_depth + 1,
            })

    # 将子领域加入 pending 队列（BFS 顺序）
    pending.extend(child_items)

    if queue:
        await _push_event(queue, "progress", {
            "current_depth": current_depth,
            "current_area": current_area_name,
            "phase": "subdomains_ready",
            "total_subdomains": len(child_items),
            "status": f"发现 {len(child_items)} 个子领域，正在加入探索队列",
        })

    return {
        "pending_areas": pending,
        "total_areas": total_areas,
    }


def should_continue(state: PlanState) -> Literal["process_area", "finalize"]:
    """条件边: 判断 pending 队列是否还有待处理领域"""
    pending = state.get("pending_areas", [])
    if pending:
        return "process_area"
    return "finalize"


async def finalize(state: PlanState, config: RunnableConfig) -> dict:
    """Node: 生成最终结果并推送完成事件"""
    runtime = config["configurable"].get("runtime_context", {})
    queue = runtime.get("queue")

    max_depth = state.get("max_depth", 2)
    root_topic = state.get("root_topic", "")
    total_areas = state.get("total_areas", 0)

    # 找到根 area_id：遍历 pending/completed 获取第一个创建的 area
    root_area_id = state.get("current_area_id")

    # 如果当前没有 current_area_id，从 pending 的历史中找
    if root_area_id is None and state.get("pending_areas"):
        root_area_id = state["pending_areas"][0]["area_id"]

    result = {
        "root_area_id": root_area_id,
        "name": root_topic,
        "total_areas": total_areas,
        "total_messages": state.get("total_messages", 0),
        "max_depth": max_depth,
        "finished": True,
    }

    if queue:
        await _push_event(queue, "progress", {
            "phase": "all_complete",
            "total_areas": result["total_areas"],
            "total_messages": result["total_messages"],
            "max_depth": result["max_depth"],
            "status": (
                f"全部探索完成！共探索 {result['total_areas']} 个领域，"
                f"{result['total_messages']} 条消息"
            ),
        })

    return {
        "result": result,
        "finished": True,
    }


# ── 构建 LangGraph ─────────────────────────────────────────

def build_plan_graph() -> StateGraph:
    """构建 Plan Mode 的 StateGraph"""
    workflow = StateGraph(PlanState)

    # 注册节点
    workflow.add_node("initialize", initialize)
    workflow.add_node("process_area", process_area)
    workflow.add_node("extract_subdomains", extract_subdomains_node)
    workflow.add_node("create_children", create_children)
    workflow.add_node("finalize", finalize)

    # 入口
    workflow.set_entry_point("initialize")

    # 有向边
    workflow.add_edge("initialize", "process_area")
    workflow.add_edge("process_area", "extract_subdomains")
    workflow.add_edge("extract_subdomains", "create_children")

    # 条件边：循环 or 结束
    workflow.add_conditional_edges(
        "create_children",
        should_continue,
        {
            "process_area": "process_area",
            "finalize": "finalize",
        },
    )

    workflow.add_edge("finalize", END)

    return workflow


# ── 主入口 ──────────────────────────────────────────────────

async def run_plan_mode(
    domain: str,
    user_id: int,
    queue: asyncio.Queue,
    callback_handler: StreamingCallbackHandler,
    max_depth: int = 2,
    langfuse_handler=None,
) -> dict:
    """Plan Mode 主入口 — 基于 LangGraph 执行

    Args:
        domain: 用户输入的领域名称
        user_id: 用户 ID
        queue: SSE 事件队列
        callback_handler: 流式回调处理器
        max_depth: 最大递归深度
        langfuse_handler: Langfuse CallbackHandler（可选）

    Returns:
        {"root_area_id": int, "name": str, "total_areas": int, "total_messages": int,
         "max_depth": int, "finished": bool}
    """
    log.info("[Plan] 开始 Plan Mode (LangGraph): domain=%s, user_id=%d, max_depth=%d",
             domain, user_id, max_depth)

    from pathlib import Path
    from app.config import settings

    # 选择检查点后端：MySQL 或 SQLite
    checkpoint_url = settings.PLAN_CHECKPOINT_DB_URL
    if checkpoint_url:
        _log_checkpoint("MySQL", checkpoint_url)
        saver_factory = AIOMySQLSaver.from_conn_string(checkpoint_url)
    else:
        checkpoint_dir = Path(settings.DB_PATH).parent
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        checkpoint_path = str(checkpoint_dir / "plan_checkpoints.db")
        _log_checkpoint("SQLite", checkpoint_path)
        saver_factory = AsyncSqliteSaver.from_conn_string(checkpoint_path)

    try:
        # 使用检查点持久化图状态
        async with saver_factory as checkpointer:
            # MySQL 需要显式创建表（幂等操作）
            if checkpoint_url:
                await checkpointer.setup()
            graph = build_plan_graph()
            app_graph = graph.compile(checkpointer=checkpointer)

            # 初始状态（不含不可序列化的运行时对象）
            initial_state: PlanState = {
                "user_id": user_id,
                "root_topic": domain,
                "max_depth": max_depth,
                "pending_areas": [],
                "total_areas": 0,
                "total_messages": 0,
                "current_area_id": None,
                "current_area_name": "",
                "current_depth": 0,
                "current_parent_context": "",
                "overview": None,
                "subdomains": None,
                "finished": False,
                "result": None,
                "error": None,
            }

            thread_id = f"plan_{user_id}_{int(time.time())}"

            # 运行时上下文（不序列化，通过 config 传入节点）
            runtime_context = {
                "queue": queue,
                "callback_handler": callback_handler,
                "langfuse_handler": langfuse_handler,
            }

            # 运行图
            final_state = await app_graph.ainvoke(
                initial_state,
                config={
                    "configurable": {
                        "thread_id": thread_id,
                        "runtime_context": runtime_context,
                    }
                },
            )

        result = final_state.get("result")
        if not result:
            result = {
                "root_area_id": final_state.get("current_area_id"),
                "name": domain,
                "total_areas": final_state.get("total_areas", 0),
                "total_messages": final_state.get("total_messages", 0),
                "max_depth": max_depth,
                "finished": True,
            }

        log.info("[Plan] Plan Mode (LangGraph) 完成: %s, 总领域数=%d, 总消息数=%d, thread=%s",
                 domain, result.get("total_areas", 0), result.get("total_messages", 0), thread_id)

        return result

    except Exception as e:
        log.exception("[Plan] Plan Mode (LangGraph) 执行异常")
        if queue:
            await _push_event(queue, "error", {"detail": f"Plan Mode 执行异常: {str(e)}"})
        return {
            "root_area_id": None,
            "name": domain,
            "total_areas": 0,
            "total_messages": 0,
            "max_depth": 0,
            "finished": False,
            "error": str(e),
        }
