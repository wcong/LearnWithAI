"""聊天交互路由"""
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Area, ChatMessage, LearningSession, Skill, UsageLog, User
from app.agents.learning_agent import LearningAgent
from app.agents.streaming_handler import StreamingCallbackHandler

router = APIRouter(prefix="/api/chat", tags=["Chat"])

# 内存中的 Agent 缓存（按 area_id）
_agent_cache: dict[int, LearningAgent] = {}


class ChatRequest(BaseModel):
    area_id: int
    message: str
    skill_id: int | None = None  # 可选：引用的技能模板 ID


class ChatResponse(BaseModel):
    reply: str
    area_id: int
    message_id: int | None = None


def get_area_chain_ids(db: Session, area_id: int) -> list[int]:
    """获取从根到当前区域的所有 area_id 链（含自身）"""
    ids = []
    current = db.query(Area).get(area_id)
    while current:
        ids.append(current.id)
        current = current.parent
    ids.reverse()  # 根 → 当前
    return ids


def get_chain_messages(db: Session, area_id: int) -> list[dict]:
    """获取整个链条上的所有聊天消息（按时间排序）"""
    chain_ids = get_area_chain_ids(db, area_id)
    messages = db.query(ChatMessage).filter(
        ChatMessage.area_id.in_(chain_ids)
    ).order_by(ChatMessage.created_at).all()
    return [m.to_dict() for m in messages]


def _apply_skill_template(message: str, skill_id: int | None, db: Session) -> str:
    """如果传入了 skill_id，用技能模板包装用户消息"""
    if skill_id is None:
        return message
    skill = db.query(Skill).get(skill_id)
    if not skill:
        return message
    return skill.prompt_template.replace("{topic}", message)


@router.post("", response_model=ChatResponse)
async def chat(req: ChatRequest, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    """与某个领域的 AI 导师对话（包含祖先领域的历史作为上下文）"""
    area = db.query(Area).get(req.area_id)
    if not area or area.user_id != user.id:
        raise HTTPException(404, "学习领域不存在")

    # 应用技能模板（如有）
    final_message = _apply_skill_template(req.message, req.skill_id, db)

    # 获取或创建 agent
    agent = _agent_cache.get(req.area_id)
    if not agent:
        agent = LearningAgent(
            area_name=area.name,
            area_description=area.description,
            session_id=f"area_{area.id}",
        )
        # 加载整条链条的历史消息
        history = get_chain_messages(db, req.area_id)
        agent.add_history(history)
        _agent_cache[req.area_id] = agent

    # 保存用户消息（使用最终消息）
    db.add(ChatMessage(area_id=area.id, role="user", content=final_message))
    db.commit()

    # 调用 AI（使用最终消息）
    reply, usage = await agent.ask(final_message)

    # 保存 AI 回复
    msg = ChatMessage(area_id=area.id, role="assistant", content=reply)
    db.add(msg)
    db.flush()  # 获取 msg.id

    # 保存用量日志
    db.add(UsageLog(
        area_id=area.id,
        message_id=msg.id,
        model=usage["model"],
        provider=usage["provider"],
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        total_tokens=usage["total_tokens"],
        duration_ms=usage["duration_ms"],
    ))
    db.commit()

    return ChatResponse(reply=reply, area_id=area.id, message_id=msg.id)


@router.post("/stream")
async def chat_stream(req: ChatRequest, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """流式聊天 - 通过 SSE 实时推送 AI 的 thinking tokens"""
    area = db.query(Area).get(req.area_id)
    if not area or area.user_id != user.id:
        raise HTTPException(404, "学习领域不存在")

    # 应用技能模板（如有）
    final_message = _apply_skill_template(req.message, req.skill_id, db)

    # 获取或创建 agent
    agent = _agent_cache.get(req.area_id)
    if not agent:
        agent = LearningAgent(
            area_name=area.name,
            area_description=area.description,
            session_id=f"area_{area.id}",
        )
        history = get_chain_messages(db, req.area_id)
        agent.add_history(history)
        _agent_cache[req.area_id] = agent

    # 保存用户消息（使用最终消息）
    db.add(ChatMessage(area_id=area.id, role="user", content=final_message))
    db.commit()

    # 创建流式回调与队列
    queue: asyncio.Queue = asyncio.Queue()
    callback_handler = StreamingCallbackHandler(queue)

    async def event_generator():
        """异步生成器 - 消费队列 tokens 并生成 SSE 事件"""
        # 启动 agent 流式处理（不等待，让生成器与回调并行）
        agent_task = asyncio.create_task(
            _run_streaming_chat(agent, final_message, callback_handler, queue, area.id)
        )

        # 持续消费队列中的 tokens，直到 agent 完成
        while True:
            get_task = asyncio.create_task(queue.get())
            done_set, _ = await asyncio.wait(
                [get_task, agent_task],
                return_when=asyncio.FIRST_COMPLETED,
            )

            if agent_task in done_set:
                # Agent 已完成，不再有新的 tokens
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

        # 等待 agent 完成，获取完整回复
        reply, usage, msg_id = await agent_task

        # 发送 result 事件
        result_data = json.dumps({
            'reply': reply,
            'message_id': msg_id,
            'area_id': area.id,
        })
        yield f"event: result\ndata: {result_data}\n\n"

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


async def _run_streaming_chat(agent: LearningAgent, message: str,
                               callback_handler: StreamingCallbackHandler,
                               queue: asyncio.Queue,
                               area_id: int) -> tuple:
    """执行流式聊天，返回 (reply, usage, message_id)"""
    from app.database import SessionLocal

    reply, usage = await agent.chat_stream(message, callback_handler)

    # 保存 AI 回复和用量到 DB
    db = SessionLocal()
    try:
        msg = ChatMessage(area_id=area_id, role="assistant", content=reply)
        db.add(msg)
        db.flush()

        db.add(UsageLog(
            area_id=area_id,
            message_id=msg.id,
            model=usage["model"],
            provider=usage["provider"],
            prompt_tokens=usage["prompt_tokens"],
            completion_tokens=usage["completion_tokens"],
            total_tokens=usage["total_tokens"],
            duration_ms=usage["duration_ms"],
        ))
        db.commit()
        msg_id = msg.id
    except Exception:
        db.rollback()
        msg_id = None
    finally:
        db.close()

    return reply, usage, msg_id


@router.get("/usage/{message_id}")
def get_usage(message_id: int, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    """获取某条 AI 回复的用量数据"""
    usage = db.query(UsageLog).filter(UsageLog.message_id == message_id).first()
    if not usage:
        return None
    # 验证消息所属 area 属于当前用户
    msg = db.query(ChatMessage).get(message_id)
    if msg:
        area = db.query(Area).get(msg.area_id)
        if area and area.user_id != user.id:
            return None
    return usage.to_dict()


@router.get("/history/{area_id}")
def get_history(area_id: int, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    """获取该领域及其所有祖先领域的对话历史（按时间排序）"""
    area = db.query(Area).get(area_id)
    if not area or area.user_id != user.id:
        raise HTTPException(404, "学习领域不存在")
    return get_chain_messages(db, area_id)


@router.post("/session/{area_id}")
def save_session(area_id: int, summary: str = "", db: Session = Depends(get_db)):
    """保存当前学习会话"""
    area = db.query(Area).get(area_id)
    if not area:
        raise HTTPException(404, "学习领域不存在")
    session = LearningSession(area_id=area_id, summary=summary)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session.to_dict()


@router.get("/sessions/{area_id}")
def list_sessions(area_id: int, db: Session = Depends(get_db)):
    sessions = db.query(LearningSession).filter(
        LearningSession.area_id == area_id
    ).order_by(LearningSession.created_at.desc()).all()
    return [s.to_dict() for s in sessions]


@router.delete("/message/{message_id}")
def delete_message(message_id: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """删除某条聊天消息（及其关联的用量记录）"""
    msg = db.query(ChatMessage).get(message_id)
    if not msg:
        raise HTTPException(404, "消息不存在")
    area = db.query(Area).get(msg.area_id)
    if not area or area.user_id != user.id:
        raise HTTPException(403, "无权删除此消息")

    # 删除关联的用量记录
    db.query(UsageLog).filter(UsageLog.message_id == message_id).delete()
    db.delete(msg)
    db.commit()

    # 清除该领域的 agent 缓存，下次聊天时重新加载历史
    _agent_cache.pop(msg.area_id, None)

    return {"ok": True}
