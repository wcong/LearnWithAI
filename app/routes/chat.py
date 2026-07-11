"""聊天交互路由"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Area, ChatMessage, LearningSession, UsageLog
from app.agents.learning_agent import LearningAgent

router = APIRouter(prefix="/api/chat", tags=["Chat"])

# 内存中的 Agent 缓存（按 area_id）
_agent_cache: dict[int, LearningAgent] = {}


class ChatRequest(BaseModel):
    area_id: int
    message: str


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


@router.post("", response_model=ChatResponse)
async def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """与某个领域的 AI 导师对话（包含祖先领域的历史作为上下文）"""
    area = db.query(Area).get(req.area_id)
    if not area:
        raise HTTPException(404, "学习领域不存在")

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

    # 保存用户消息
    db.add(ChatMessage(area_id=area.id, role="user", content=req.message))
    db.commit()

    # 调用 AI
    reply, usage = await agent.ask(req.message)

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


@router.get("/usage/{message_id}")
def get_usage(message_id: int, db: Session = Depends(get_db)):
    """获取某条 AI 回复的用量数据"""
    usage = db.query(UsageLog).filter(UsageLog.message_id == message_id).first()
    if not usage:
        return None
    return usage.to_dict()


@router.get("/history/{area_id}")
def get_history(area_id: int, db: Session = Depends(get_db)):
    """获取该领域及其所有祖先领域的对话历史（按时间排序）"""
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
