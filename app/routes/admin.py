"""管理员统计面板 API"""
from fastapi import HTTPException
from sqlalchemy import func
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import User, Area, ChatMessage, UsageLog

router = APIRouter(prefix="/api/admin", tags=["Admin"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    """检查当前用户是否为配置的管理员"""
    if user.username != settings.ADMIN_USERNAME:
        raise HTTPException(403, "仅管理员可访问")
    return user


@router.get("/stats")
def get_admin_stats(db: Session = Depends(get_db),
                    _user: User = Depends(require_admin)):
    """返回全平台统计数据：用户维度和全局汇总"""

    # —— 全局汇总 ——
    total_users = db.query(func.count(User.id)).scalar() or 0
    total_areas = db.query(func.count(Area.id)).scalar() or 0
    total_messages = db.query(func.count(ChatMessage.id)).scalar() or 0

    total_prompt = db.query(func.coalesce(func.sum(UsageLog.prompt_tokens), 0)).scalar() or 0
    total_completion = db.query(func.coalesce(func.sum(UsageLog.completion_tokens), 0)).scalar() or 0
    total_tokens = db.query(func.coalesce(func.sum(UsageLog.total_tokens), 0)).scalar() or 0

    # —— 每个用户维度 ——
    users_rows = (
        db.query(
            User.id,
            User.username,
            func.count(func.distinct(Area.id)).label("area_count"),
            func.count(func.distinct(ChatMessage.id)).label("message_count"),
            func.coalesce(func.sum(UsageLog.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(UsageLog.completion_tokens), 0).label("completion_tokens"),
            func.coalesce(func.sum(UsageLog.total_tokens), 0).label("total_tokens"),
        )
        .outerjoin(Area, Area.user_id == User.id)
        .outerjoin(ChatMessage, ChatMessage.area_id == Area.id)
        .outerjoin(UsageLog, UsageLog.area_id == Area.id)
        .group_by(User.id)
        .order_by(User.id)
        .all()
    )

    users_data = [
        {
            "id": uid,
            "username": uname,
            "area_count": ac,
            "message_count": mc,
            "prompt_tokens": pt,
            "completion_tokens": ct,
            "total_tokens": tt,
        }
        for uid, uname, ac, mc, pt, ct, tt in users_rows
    ]

    return {
        "summary": {
            "total_users": total_users,
            "total_areas": total_areas,
            "total_messages": total_messages,
            "total_prompt_tokens": total_prompt,
            "total_completion_tokens": total_completion,
            "total_tokens": total_tokens,
        },
        "users": users_data,
    }
