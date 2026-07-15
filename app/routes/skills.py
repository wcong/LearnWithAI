"""技能模板管理路由 — 全局技能(管理员) & 个人技能"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Skill, User
from app.config import settings

log = logging.getLogger("learnwithai")
router = APIRouter(prefix="/api/skills", tags=["Skills"])


# ── 请求/响应模型 ─────────────────────────────

class SkillCreate(BaseModel):
    name: str
    description: str = ""
    prompt_template: str


class SkillUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    prompt_template: str | None = None


# ── 管理员鉴权 ────────────────────────────────

def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.username != settings.ADMIN_USERNAME:
        raise HTTPException(403, "仅管理员可操作")
    return user


# ── 公共接口：获取当前用户可用的技能列表 ────────

@router.get("")
def list_skills(db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    """返回当前用户可用的技能：全局技能 + 自己的个人技能"""
    skills = db.query(Skill).filter(
        (Skill.is_global == 1) | (Skill.user_id == user.id)
    ).order_by(Skill.is_global.desc(), Skill.id).all()
    return [s.to_dict() for s in skills]


# ── 个人技能 CRUD ────────────────────────────

@router.post("")
def create_skill(body: SkillCreate, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """创建个人技能"""
    skill = Skill(
        name=body.name,
        description=body.description,
        prompt_template=body.prompt_template,
        is_global=0,
        is_default=0,
        user_id=user.id,
        created_by=user.id,
    )
    db.add(skill)
    db.commit()
    db.refresh(skill)
    log.info("用户 %s 创建了个人技能[%d]: %s", user.username, skill.id, skill.name)
    return skill.to_dict()


@router.patch("/{skill_id}")
def update_skill(skill_id: int, body: SkillUpdate,
                 db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """更新个人技能（仅创建者）"""
    skill = db.query(Skill).get(skill_id)
    if not skill:
        raise HTTPException(404, "技能不存在")
    if skill.user_id != user.id:
        raise HTTPException(403, "无权修改此技能")
    if skill.is_default:
        raise HTTPException(400, "默认技能不可修改")

    if body.name is not None:
        skill.name = body.name
    if body.description is not None:
        skill.description = body.description
    if body.prompt_template is not None:
        skill.prompt_template = body.prompt_template
    db.commit()
    db.refresh(skill)
    return skill.to_dict()


@router.delete("/{skill_id}")
def delete_skill(skill_id: int, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """删除个人技能（仅创建者）"""
    skill = db.query(Skill).get(skill_id)
    if not skill:
        raise HTTPException(404, "技能不存在")
    if skill.user_id != user.id:
        raise HTTPException(403, "无权删除此技能")
    if skill.is_default:
        raise HTTPException(400, "默认技能不可删除")

    db.delete(skill)
    db.commit()
    log.info("用户 %s 删除了个人技能[%d]: %s", user.username, skill.id, skill.name)
    return {"ok": True}


# ── 管理员管理全局技能 ─────────────────────────

@router.get("/global/list")
def list_global_skills(db: Session = Depends(get_db),
                       _admin: User = Depends(require_admin)):
    """管理员查看所有全局技能"""
    skills = db.query(Skill).filter(Skill.is_global == 1).order_by(Skill.id).all()
    return [s.to_dict() for s in skills]


@router.post("/global")
def create_global_skill(body: SkillCreate, db: Session = Depends(get_db),
                        admin: User = Depends(require_admin)):
    """管理员创建全局技能"""
    skill = Skill(
        name=body.name,
        description=body.description,
        prompt_template=body.prompt_template,
        is_global=1,
        is_default=0,
        created_by=admin.id,
    )
    db.add(skill)
    db.commit()
    db.refresh(skill)
    log.info("管理员 %s 创建了全局技能[%d]: %s", admin.username, skill.id, skill.name)
    return skill.to_dict()


@router.patch("/global/{skill_id}")
def update_global_skill(skill_id: int, body: SkillUpdate,
                        db: Session = Depends(get_db),
                        admin: User = Depends(require_admin)):
    """管理员更新全局技能"""
    skill = db.query(Skill).get(skill_id)
    if not skill:
        raise HTTPException(404, "技能不存在")
    if not skill.is_global:
        raise HTTPException(400, "该技能不是全局技能")

    if body.name is not None:
        skill.name = body.name
    if body.description is not None:
        skill.description = body.description
    if body.prompt_template is not None:
        skill.prompt_template = body.prompt_template
    db.commit()
    db.refresh(skill)
    return skill.to_dict()


@router.delete("/global/{skill_id}")
def delete_global_skill(skill_id: int, db: Session = Depends(get_db),
                        admin: User = Depends(require_admin)):
    """管理员删除全局技能（默认技能不可删除）"""
    skill = db.query(Skill).get(skill_id)
    if not skill:
        raise HTTPException(404, "技能不存在")
    if not skill.is_global:
        raise HTTPException(400, "该技能不是全局技能")
    if skill.is_default:
        raise HTTPException(400, "系统预置的默认技能不可删除")

    db.delete(skill)
    db.commit()
    log.info("管理员 %s 删除了全局技能[%d]: %s", admin.username, skill.id, skill.name)
    return {"ok": True}
