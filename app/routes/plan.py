"""Plan Mode 路由 — 领域深度学习规划 SSE 流式端点"""
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User
from app.utils import check_daily_token_limit
from app.agents.plan_agent import run_plan_mode
from app.agents.streaming_handler import StreamingCallbackHandler

router = APIRouter(prefix="/api/plan", tags=["Plan Mode"])


class StartPlanRequest(BaseModel):
    domain: str
    max_depth: int = 2


@router.post("/start")
async def start_plan(req: StartPlanRequest, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """启动 Plan Mode 领域深度学习规划

    接收用户输入的领域名称，启动递归探索流程，通过 SSE 实时推送进展。
    """
    domain = req.domain.strip()
    if not domain:
        raise HTTPException(400, "领域名称不能为空")
    if len(domain) > 100:
        raise HTTPException(400, "领域名称过长（最长 100 字）")

    # 检查每日免费额度
    limit_info = check_daily_token_limit(user.id, db)
    if limit_info:
        raise HTTPException(
            status_code=429,
            detail={
                "message": "您今日的免费 Token 额度已用尽，请明天再来。",
                "used_prompt": limit_info["used_prompt"],
                "used_completion": limit_info["used_completion"],
                "limit_prompt": limit_info["limit_prompt"],
                "limit_output": limit_info["limit_output"],
            }
        )

    queue: asyncio.Queue = asyncio.Queue()
    callback_handler = StreamingCallbackHandler(queue)

    async def event_generator():
        """异步生成器 — 消费队列事件并生成 SSE 流"""
        agent_task = asyncio.create_task(
            _run_plan_async(domain, user.id, req.max_depth, callback_handler, queue)
        )

        while True:
            get_task = asyncio.create_task(queue.get())
            done_set, _ = await asyncio.wait(
                [get_task, agent_task],
                return_when=asyncio.FIRST_COMPLETED,
            )

            if agent_task in done_set:
                get_task.cancel()
                break

            event_type, data = get_task.result()
            yield _format_sse(event_type, data)

        # 消费队列中可能残留的事件
        while not queue.empty():
            try:
                event_type, data = queue.get_nowait()
                yield _format_sse(event_type, data)
            except asyncio.QueueEmpty:
                break

        # 获取最终结果
        try:
            result = await agent_task
            yield f"event: result\ndata: {json.dumps(result)}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'detail': str(e)})}\n\n"

        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _format_sse(event_type: str, data) -> str:
    """将事件格式化为 SSE 字符串

    支持 thinking / area_created / message / progress / error 等事件类型。
    其中 thinking 事件由 StreamingCallbackHandler 以 ("thinking", str) 形式推送；
    其他事件由 plan_agent 以自定义 (event_type, dict) 形式推送。
    """
    if event_type == "thinking":
        return f"event: thinking\ndata: {json.dumps({'chunk': data})}\n\n"
    elif event_type == "tool_call":
        return f"event: tool_call\ndata: {json.dumps({'chunk': data})}\n\n"
    elif event_type == "error":
        return f"event: error\ndata: {json.dumps({'detail': data}) if isinstance(data, str) else json.dumps(data)}\n\n"
    elif event_type == "area_created":
        return f"event: area_created\ndata: {json.dumps(data)}\n\n"
    elif event_type == "message":
        return f"event: message\ndata: {json.dumps(data)}\n\n"
    elif event_type == "progress":
        return f"event: progress\ndata: {json.dumps(data)}\n\n"
    else:
        return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


async def _run_plan_async(domain: str, user_id: int, max_depth: int,
                           callback_handler: StreamingCallbackHandler,
                           queue: asyncio.Queue) -> dict:
    """异步执行 Plan Mode，返回最终结果"""
    return await run_plan_mode(
        domain=domain,
        user_id=user_id,
        queue=queue,
        callback_handler=callback_handler,
        max_depth=max_depth,
    )
