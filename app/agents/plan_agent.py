"""Plan Mode — 领域深度学习规划递归探索引擎

工作流程（深度优先 + 同层并发）：
  1. 创建根 Area（用户输入的领域）
  2. AI 生成该领域概况 → 保存 ChatMessage
  3. AI 提取子领域列表 → 创建子 Area 节点
  4. 对每个子领域递归执行 step 2-3（带上父 context）
  5. 最多 10 层，或 AI 返回空子领域列表时停止
"""
import asyncio
import json
import time
import logging

from app.database import SessionLocal
from app.models import Area, ChatMessage, UsageLog
from app.agents.learning_agent import _build_llm, _parse_llm_json, extract_usage
from app.agents.streaming_handler import StreamingCallbackHandler

log = logging.getLogger("learnwithai")

MAX_BRANCHES = 10

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


# ── DB 操作函数 ─────────────────────────────────────────────

def _save_area(user_id: int, name: str, description: str, parent_id: int | None) -> Area:
    """创建 Area 并保存到数据库，返回 Area 对象"""
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
        return area
    finally:
        db.close()


def _save_message(area_id: int, role: str, content: str) -> ChatMessage:
    """保存 ChatMessage 到数据库，返回 ChatMessage 对象"""
    db = SessionLocal()
    try:
        msg = ChatMessage(area_id=area_id, role=role, content=content)
        db.add(msg)
        db.commit()
        db.refresh(msg)
        return msg
    finally:
        db.close()


def _save_usage(area_id: int, message_id: int, usage: dict):
    """记录 UsageLog"""
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


def _get_area_by_id(area_id: int) -> Area | None:
    """根据 ID 获取 Area"""
    db = SessionLocal()
    try:
        return db.query(Area).get(area_id)
    finally:
        db.close()


# ── LLM 调用函数 ────────────────────────────────────────────

async def _call_llm(prompt: str, llm=None, callback_handler=None) -> tuple[str, dict]:
    """调用 LLM 并返回 (response_content, usage_dict)"""
    if llm is None:
        llm = _build_llm()

    start = time.time()
    response = await llm.ainvoke([{"role": "user", "content": prompt}])
    elapsed = int((time.time() - start) * 1000)

    content = response.content if hasattr(response, "content") else str(response)
    usage = extract_usage(response, llm, elapsed)

    return content, usage


async def _call_llm_stream(prompt: str, callback_handler: StreamingCallbackHandler,
                           llm=None) -> tuple[str, dict]:
    """流式调用 LLM，通过 callback_handler 实时推送 tokens，返回 (response_content, usage_dict)"""
    if llm is None:
        llm = _build_llm(streaming=True, callbacks=[callback_handler])

    start = time.time()
    response = await llm.ainvoke([{"role": "user", "content": prompt}])
    elapsed = int((time.time() - start) * 1000)

    content = response.content if hasattr(response, "content") else str(response)
    usage = extract_usage(response, llm, elapsed)

    return content, usage


# ── 核心业务函数 ────────────────────────────────────────────

async def _generate_overview(domain_name: str, parent_context: str = "",
                             callback_handler: StreamingCallbackHandler | None = None) -> str:
    """生成领域概况（流式），返回概况文本"""
    prompt = PROMPT_OVERVIEW.format(
        domain_name=domain_name,
        parent_context=parent_context or "（无，此为根领域）",
    )

    if callback_handler:
        content, _ = await _call_llm_stream(prompt, callback_handler)
    else:
        content, _ = await _call_llm(prompt)

    return content


async def _extract_subdomains(domain_name: str, overview: str, parent_context: str = "",
                              callback_handler: StreamingCallbackHandler | None = None) -> list[dict]:
    """提取子领域列表，返回 [{name, description}, ...]"""
    prompt = PROMPT_EXTRACT_SUBDOMAINS.format(
        domain_name=domain_name,
        overview=overview[:2000],
        parent_context=parent_context or "（无，此为根领域）",
    )

    if callback_handler:
        content, _ = await _call_llm_stream(prompt, callback_handler)
    else:
        content, _ = await _call_llm(prompt)

    parsed = _parse_llm_json(content)
    if parsed and "subdomains" in parsed:
        subdomains = parsed["subdomains"]
        # 限制分支数量
        return subdomains[:MAX_BRANCHES]
    return []


def _build_context_path(area_id: int) -> str:
    """构建从根到当前节点的 context 链文本"""
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


async def _explore_area(
    area_id: int,
    area_name: str,
    parent_context: str,
    depth: int,
    max_depth: int,
    user_id: int,
    queue: asyncio.Queue,
    callback_handler: StreamingCallbackHandler,
) -> dict:
    """递归探索一个领域节点

    1. 生成概况 → 保存 ChatMessage → 推送 SSE
    2. 提取子领域 → 创建子 Area → 推送 SSE
    3. 递归探索每个子领域

    Args:
        max_depth: 最大递归深度（由用户传入，默认 2）
    
    Returns:
        {"area_id": int, "name": str, "depth": int, "children": list, "total_areas": int, "total_messages": int}
    """
    log.info("[Plan] 开始探索 Level %d: %s (area_id=%d)", depth, area_name, area_id)

    # ── Step 1: 生成概况 ──
    await _push_event(queue, "progress", {
        "current_depth": depth,
        "current_area": area_name,
        "status": f"正在探索 Level {depth}: {area_name}",
    })

    overview = await _generate_overview(area_name, parent_context, callback_handler)

    # 保存概况为 AI 消息
    msg = _save_message(area_id, "assistant", overview)
    await _push_event(queue, "message", {
        "area_id": area_id,
        "area_name": area_name,
        "depth": depth,
        "role": "assistant",
        "content": overview,
        "message_id": msg.id,
    })

    # 概况生成完成 → 推送阶段信号
    await _push_event(queue, "progress", {
        "current_depth": depth,
        "current_area": area_name,
        "phase": "overview_complete",
        "status": f"「{area_name}」概况已生成",
    })

    result = {
        "area_id": area_id,
        "name": area_name,
        "depth": depth,
        "children": [],
        "total_areas": 0,
        "total_messages": 1,
    }

    # 到达最大深度，不再继续细分
    if depth >= max_depth:
        log.info("[Plan] Level %d 已达最大深度 %d，停止细分", depth, max_depth)
        return result

    # ── Step 2: 提取子领域 ──
    context_chain = _build_context_path(area_id)
    subdomains = await _extract_subdomains(area_name, overview, parent_context, callback_handler)

    if not subdomains:
        log.info("[Plan] %s 没有可细分的子领域，停止探索", area_name)
        return result

    log.info("[Plan] %s 提取到 %d 个子领域", area_name, len(subdomains))

    # 创建子 Area 节点并推送事件
    child_areas = []
    for sd in subdomains:
        child_area = _save_area(
            user_id=user_id,
            name=sd["name"],
            description=sd.get("description", ""),
            parent_id=area_id,
        )
        child_areas.append(child_area)
        await _push_event(queue, "area_created", {
            "area_id": child_area.id,
            "name": sd["name"],
            "description": sd.get("description", ""),
            "parent_id": area_id,
            "depth": depth + 1,
        })
        result["total_areas"] += 1

    # 子领域就绪 → 推送阶段信号
    await _push_event(queue, "progress", {
        "current_depth": depth,
        "current_area": area_name,
        "phase": "subdomains_ready",
        "total_subdomains": len(child_areas),
        "status": f"发现 {len(child_areas)} 个子领域，正在深入探索",
    })

    # ── Step 3: 递归探索每个子领域（同层并发） ──
    child_context = f"父领域: {area_name}\n父领域 context 链: {context_chain}\n父领域概况概要: {overview[:500]}"

    async def explore_one(child_area):
        return await _explore_area(
            area_id=child_area.id,
            area_name=child_area.name,
            parent_context=child_context,
            depth=depth + 1,
            max_depth=max_depth,
            user_id=user_id,
            queue=queue,
            callback_handler=callback_handler,
        )

    # 并发探索所有子领域
    children_results = await asyncio.gather(
        *[explore_one(ca) for ca in child_areas],
        return_exceptions=True,
    )

    # 处理结果（忽略失败项）
    for cr in children_results:
        if isinstance(cr, Exception):
            log.error("[Plan] 子领域探索异常: %s", cr)
            continue
        result["children"].append(cr)
        result["total_areas"] += cr.get("total_areas", 0)
        result["total_messages"] += cr.get("total_messages", 0)

    # 子领域探索完成 → 推送阶段信号
    await _push_event(queue, "progress", {
        "current_depth": depth,
        "current_area": area_name,
        "phase": "children_done",
        "total_subdomains": len(child_areas),
        "processed_subdomains": len(child_areas),
        "status": f"「{area_name}」及其子领域探索完成",
    })

    return result


async def run_plan_mode(
    domain: str,
    user_id: int,
    queue: asyncio.Queue,
    callback_handler: StreamingCallbackHandler,
    max_depth: int = 2,
) -> dict:
    """Plan Mode 主入口

    Args:
        domain: 用户输入的领域名称
        user_id: 用户 ID
        queue: SSE 事件队列
        callback_handler: 流式回调处理器

    Returns:
        {"root_area_id": int, "name": str, "total_areas": int, "total_messages": int,
         "max_depth": int, "finished": bool}
    """
    log.info("[Plan] 开始 Plan Mode 探索: domain=%s, user_id=%d", domain, user_id)

    try:
        # ── Step 0: 创建根 Area ──
        root_area = _save_area(user_id=user_id, name=domain, description="", parent_id=None)
        await _push_event(queue, "area_created", {
            "area_id": root_area.id,
            "name": domain,
            "description": "",
            "parent_id": None,
            "depth": 0,
        })

        # ── 开始递归探索 ──
        result = await _explore_area(
            area_id=root_area.id,
            area_name=domain,
            parent_context="",
            depth=0,
            max_depth=max_depth,
            user_id=user_id,
            queue=queue,
            callback_handler=callback_handler,
        )

        final_result = {
            "root_area_id": root_area.id,
            "name": domain,
            "total_areas": result.get("total_areas", 0) + 1,  # +1 包含根节点
            "total_messages": result.get("total_messages", 0),
            "max_depth": max_depth if result.get("depth", 0) >= max_depth else result.get("depth", 0),
            "finished": True,
        }

        # 全部探索完成 → 推送阶段信号
        await _push_event(queue, "progress", {
            "phase": "all_complete",
            "total_areas": final_result["total_areas"],
            "total_messages": final_result["total_messages"],
            "max_depth": final_result["max_depth"],
            "status": f"全部探索完成！共探索 {final_result['total_areas']} 个领域，{final_result['total_messages']} 条消息",
        })

        log.info("[Plan] Plan Mode 完成: %s, 总领域数=%d, 总消息数=%d",
                 domain, final_result["total_areas"], final_result["total_messages"])

        return final_result

    except Exception as e:
        log.exception("[Plan] Plan Mode 执行异常")
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
