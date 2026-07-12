"""学习笔记路由（每个 Area 一条富文本笔记）"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Area, AreaNote, User

router = APIRouter(prefix="/api/notes", tags=["Notes"])


class NoteBody(BaseModel):
    content: str = ""


@router.get("/{area_id}")
def get_note(area_id: int, db: Session = Depends(get_db),
             user: User = Depends(get_current_user)):
    """获取某个领域的笔记"""
    area = db.query(Area).get(area_id)
    if not area or area.user_id != user.id:
        raise HTTPException(404, "学习领域不存在")
    note = db.query(AreaNote).filter(AreaNote.area_id == area_id).first()
    return note.to_dict() if note else {"area_id": area_id, "content": ""}


@router.put("/{area_id}")
def save_note(area_id: int, body: NoteBody, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    """保存笔记（创建或更新）"""
    area = db.query(Area).get(area_id)
    if not area or area.user_id != user.id:
        raise HTTPException(404, "学习领域不存在")

    note = db.query(AreaNote).filter(AreaNote.area_id == area_id).first()
    if note:
        note.content = body.content
    else:
        note = AreaNote(area_id=area_id, content=body.content)
        db.add(note)
    db.commit()
    db.refresh(note)
    return note.to_dict()
