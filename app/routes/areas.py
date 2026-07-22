"""学习领域管理路由"""
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Area, AreaAnalysis, User
from app.agents.learning_agent import (
    run_examine_agent,
    run_examine_agent_stream,
    run_generate_subareas_stream,
    run_polish_subareas,
)
from app.agents.streaming_handler import StreamingCallbackHandler

router = APIRouter(prefix="/api/areas", tags=["Learning Areas"])


class CreateAreaRequest(BaseModel):
    name: str
    description: str = ""
    parent_id: int | None = None
    order: int = 0


class UpdateAreaRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    order: int | None = None


def _assert_owner(area: Area, user: User):
    if area.user_id != user.id:
        raise HTTPException(403, "无权访问此领域")


def _build_area_tree(area: Area, db: Session) -> dict:
    """递归构建 Area 树（纯 Python 手动查询）"""
    node = area.to_dict()
    children = db.query(Area).filter(Area.parent_id == area.id).order_by(Area.order).all()
    node["children"] = [_build_area_tree(c, db) for c in children]
    return node


@router.get("/tree")
def get_tree(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    roots = db.query(Area).filter(
        Area.parent_id.is_(None), Area.user_id == user.id
    ).order_by(Area.order).all()
    return [_build_area_tree(r, db) for r in roots]


@router.get("")
def list_areas(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    areas = db.query(Area).filter(
        Area.parent_id.is_(None), Area.user_id == user.id
    ).order_by(Area.order).all()
    return [_build_area_tree(a, db) for a in areas]


@router.post("")
def create_area(body: CreateAreaRequest, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    if body.parent_id:
        parent = db.query(Area).get(body.parent_id)
        if not parent:
            raise HTTPException(404, "父节点不存在")
        _assert_owner(parent, user)

    area = Area(
        user_id=user.id,
        name=body.name,
        description=body.description,
        parent_id=body.parent_id,
        order=body.order,
    )
    db.add(area)
    db.commit()
    db.refresh(area)
    return area.to_dict()


@router.get("/{area_id}")
def get_area(area_id: int, db: Session = Depends(get_db),
             user: User = Depends(get_current_user)):
    area = db.query(Area).get(area_id)
    if not area:
        raise HTTPException(404, "学习领域不存在")
    _assert_owner(area, user)
    return area.to_dict()


@router.patch("/{area_id}")
def update_area(area_id: int, body: UpdateAreaRequest,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    area = db.query(Area).get(area_id)
    if not area:
        raise HTTPException(404, "学习领域不存在")
    _assert_owner(area, user)
    if body.name is not None:
        area.name = body.name
    if body.description is not None:
        area.description = body.description
    if body.order is not None:
        area.order = body.order
    db.commit()
    db.refresh(area)
    return area.to_dict()


@router.delete("/{area_id}")
def delete_area(area_id: int, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    area = db.query(Area).get(area_id)
    if not area:
        raise HTTPException(404, "学习领域不存在")
    _assert_owner(area, user)
    _delete_area_recursive(area, db)
    db.commit()
    return {"ok": True}


def _delete_area_recursive(area: Area, db: Session):
    children = db.query(Area).filter(Area.parent_id == area.id).all()
    for child in children:
        _delete_area_recursive(child, db)
    db.delete(area)


@router.get("/{area_id}/siblings")
def get_siblings(area_id: int, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    area = db.query(Area).get(area_id)
    if not area:
        raise HTTPException(404, "学习领域不存在")
    _assert_owner(area, user)
    siblings = db.query(Area).filter(
        Area.parent_id == area.parent_id,
        Area.id != area.id
    ).order_by(Area.order).all()
    return [s.to_dict() for s in siblings]


@router.post("/{area_id}/examine")
async def examine_area(area_id: int, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """AI 审查当前领域：agent 使用 Tools 遍历子领域并生成分析"""
    area = db.query(Area).get(area_id)
    if not area:
        raise HTTPException(404, "学习领域不存在")
    _assert_owner(area, user)

    # 检查是否有子领域
    children = db.query(Area).filter(Area.parent_id == area_id).count()
    if not children:
        raise HTTPException(400, "该领域没有子领域可审查")

    # 交给 agent 驱动审查流程
    result = await run_examine_agent(area_id, area.name)

    if not result.get("analysis"):
        raise HTTPException(500, f"审查失败：{result.get('agent_reply', '未知错误')}")

    return result["analysis"]


@router.post("/{area_id}/examine/stream")
async def examine_area_stream(area_id: int, db: Session = Depends(get_db),
                               user: User = Depends(get_current_user)):
    """流式审查子领域 - 通过 SSE 实时推送 AI 的 thinking tokens"""
    area = db.query(Area).get(area_id)
    if not area:
        raise HTTPException(404, "学习领域不存在")
    _assert_owner(area, user)

    children = db.query(Area).filter(Area.parent_id == area_id).count()
    if not children:
        raise HTTPException(400, "该领域没有子领域可审查")

    queue: asyncio.Queue = asyncio.Queue()
    callback_handler = StreamingCallbackHandler(queue)

    async def event_generator():
        agent_task = asyncio.create_task(
            _run_streaming_examine(area_id, area.name, callback_handler, queue)
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
            if event_type == "error":
                yield f"event: error\ndata: {json.dumps({'detail': data})}\n\n"
                break
            elif event_type == "thinking":
                yield f"event: thinking\ndata: {json.dumps({'chunk': data})}\n\n"
            elif event_type == "tool_call":
                yield f"event: tool_call\ndata: {json.dumps({'chunk': data})}\n\n"

        # 消费队列中可能残留的 tokens
        while not queue.empty():
            try:
                event_type, data = queue.get_nowait()
                if event_type == "thinking":
                    yield f"event: thinking\ndata: {json.dumps({'chunk': data})}\n\n"
                elif event_type == "tool_call":
                    yield f"event: tool_call\ndata: {json.dumps({'chunk': data})}\n\n"
                elif event_type == "error":
                    yield f"event: error\ndata: {json.dumps({'detail': data})}\n\n"
            except asyncio.QueueEmpty:
                break

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


async def _run_streaming_examine(area_id: int, area_name: str,
                                  callback_handler: StreamingCallbackHandler,
                                  queue: asyncio.Queue) -> dict:
    """执行流式审查，返回 analysis dict"""
    result = await run_examine_agent_stream(area_id, area_name, callback_handler)
    return result.get("analysis", {}) or {"error": "审查失败"}


# -----------------------------------------------------------
#  生成子领域建议 (流式)
# -----------------------------------------------------------
class PolishSubareasRequest(BaseModel):
    sub_areas: list[dict]


@router.post("/{area_id}/generate-subareas/stream")
async def generate_subareas_stream(area_id: int, db: Session = Depends(get_db),
                                    user: User = Depends(get_current_user)):
    """基于聊天记录生成子领域建议 - SSE 流式"""
    area = db.query(Area).get(area_id)
    if not area:
        raise HTTPException(404, "学习领域不存在")
    _assert_owner(area, user)

    queue: asyncio.Queue = asyncio.Queue()
    callback_handler = StreamingCallbackHandler(queue)

    async def event_generator():
        agent_task = asyncio.create_task(
            _run_streaming_generate(area_id, area.name, area.description,
                                     callback_handler, queue)
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
            if event_type == "error":
                yield f"event: error\ndata: {json.dumps({'detail': data})}\n\n"
                break
            elif event_type == "thinking":
                yield f"event: thinking\ndata: {json.dumps({'chunk': data})}\n\n"
            elif event_type == "tool_call":
                yield f"event: tool_call\ndata: {json.dumps({'chunk': data})}\n\n"

        while not queue.empty():
            try:
                event_type, data = queue.get_nowait()
                if event_type == "thinking":
                    yield f"event: thinking\ndata: {json.dumps({'chunk': data})}\n\n"
                elif event_type == "tool_call":
                    yield f"event: tool_call\ndata: {json.dumps({'chunk': data})}\n\n"
                elif event_type == "error":
                    yield f"event: error\ndata: {json.dumps({'detail': data})}\n\n"
            except asyncio.QueueEmpty:
                break

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


async def _run_streaming_generate(area_id: int, area_name: str, area_description: str,
                                   callback_handler: StreamingCallbackHandler,
                                   queue: asyncio.Queue) -> dict:
    """执行流式生成子领域建议"""
    result = await run_generate_subareas_stream(
        area_id, area_name, area_description, callback_handler
    )
    return result if result else {"error": "生成失败"}


# -----------------------------------------------------------
#  润色子领域描述
# -----------------------------------------------------------
@router.post("/{area_id}/polish-subareas")
async def polish_subareas(area_id: int, body: PolishSubareasRequest,
                          db: Session = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """润色子领域描述：不改变标题和数量，只优化描述"""
    area = db.query(Area).get(area_id)
    if not area:
        raise HTTPException(404, "学习领域不存在")
    _assert_owner(area, user)

    if not body.sub_areas:
        raise HTTPException(400, "子领域列表不能为空")

    polished = await run_polish_subareas(body.sub_areas)
    return {"sub_areas": polished}
