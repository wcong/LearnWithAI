"""学习计划（代办事项）CRUD 路由"""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Area, StudyPlan, User

router = APIRouter(prefix="/api/plans", tags=["Study Plans"])


class CreatePlanRequest(BaseModel):
    title: str
    description: str = ""
    planned_at: str  # ISO format "2026-07-25T14:00"
    area_id: int | None = None
    parent_id: int | None = None


class UpdatePlanRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    planned_at: str | None = None
    area_id: int | None = None
    is_completed: bool | None = None


def _assert_owner(plan: StudyPlan, user: User):
    if plan.user_id != user.id:
        raise HTTPException(403, "无权操作此计划")


def _plan_to_dict(plan: StudyPlan, db: Session) -> dict:
    d = plan.to_dict()
    # 查询关联领域名称
    if plan.area_id:
        area = db.query(Area).get(plan.area_id)
        d["area_name"] = area.name if area else None
    else:
        d["area_name"] = None
    # 附加子计划
    children = db.query(StudyPlan).filter(
        StudyPlan.parent_id == plan.id
    ).order_by(StudyPlan.planned_at).all()
    d["children"] = [_plan_to_dict(c, db) for c in children]
    return d


# ── 列表 ──────────────────────────────────────────────
@router.get("")
def list_plans(db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    """获取当前用户的所有未完成计划（含子计划，按 planned_at 升序）"""
    parents = db.query(StudyPlan).filter(
        StudyPlan.user_id == user.id,
        StudyPlan.parent_id.is_(None),
        StudyPlan.is_completed == 0,
    ).order_by(StudyPlan.planned_at).all()
    return [_plan_to_dict(p, db) for p in parents]


# ── 创建 ──────────────────────────────────────────────
@router.post("")
def create_plan(body: CreatePlanRequest, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    try:
        planned_at = datetime.fromisoformat(body.planned_at)
    except ValueError:
        raise HTTPException(400, "planned_at 格式无效，请使用 ISO 格式")

    plan = StudyPlan(
        user_id=user.id,
        title=body.title,
        description=body.description,
        planned_at=planned_at,
        area_id=body.area_id,
        parent_id=body.parent_id,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return _plan_to_dict(plan, db)


# ── 更新 ──────────────────────────────────────────────
@router.patch("/{plan_id}")
def update_plan(plan_id: int, body: UpdatePlanRequest,
                db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    plan = db.query(StudyPlan).get(plan_id)
    if not plan:
        raise HTTPException(404, "计划不存在")
    _assert_owner(plan, user)

    if body.title is not None:
        plan.title = body.title
    if body.description is not None:
        plan.description = body.description
    if body.planned_at is not None:
        try:
            plan.planned_at = datetime.fromisoformat(body.planned_at)
        except ValueError:
            raise HTTPException(400, "planned_at 格式无效")
    if body.area_id is not None:
        plan.area_id = body.area_id
    if body.is_completed is not None:
        plan.is_completed = 1 if body.is_completed else 0
        plan.completed_at = datetime.utcnow() if body.is_completed else None
        # 如果是父计划标记完成，同时标记所有子计划完成
        if body.is_completed:
            db.query(StudyPlan).filter(
                StudyPlan.parent_id == plan.id,
                StudyPlan.is_completed == 0,
            ).update({
                StudyPlan.is_completed: 1,
                StudyPlan.completed_at: datetime.utcnow(),
            })

    db.commit()
    db.refresh(plan)
    return _plan_to_dict(plan, db)


# ── 删除 ──────────────────────────────────────────────
@router.delete("/{plan_id}")
def delete_plan(plan_id: int, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    plan = db.query(StudyPlan).get(plan_id)
    if not plan:
        raise HTTPException(404, "计划不存在")
    _assert_owner(plan, user)

    # 删除子计划
    db.query(StudyPlan).filter(StudyPlan.parent_id == plan.id).delete()
    db.delete(plan)
    db.commit()
    return {"ok": True}


# ── 统计 ──────────────────────────────────────────────
@router.get("/stats")
def get_stats(db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)

    # 今日要学：今日范围内未完成的计划
    today_count = db.query(func.count(StudyPlan.id)).filter(
        StudyPlan.user_id == user.id,
        StudyPlan.parent_id.is_(None),
        StudyPlan.is_completed == 0,
        StudyPlan.planned_at >= today_start,
        StudyPlan.planned_at < today_end,
    ).scalar() or 0

    # 逾期：计划时间 < now 且未完成的计划
    overdue_count = db.query(func.count(StudyPlan.id)).filter(
        StudyPlan.user_id == user.id,
        StudyPlan.parent_id.is_(None),
        StudyPlan.is_completed == 0,
        StudyPlan.planned_at < now,
    ).scalar() or 0

    # 总计（未完成的顶级计划）
    total_count = db.query(func.count(StudyPlan.id)).filter(
        StudyPlan.user_id == user.id,
        StudyPlan.parent_id.is_(None),
        StudyPlan.is_completed == 0,
    ).scalar() or 0

    return {
        "today": today_count,
        "overdue": overdue_count,
        "total": total_count,
    }


# ── 已完成计划（按天分组） ─────────────────────────────
@router.get("/completed")
def get_completed(db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    """获取已完成计划列表，按完成日期分组"""
    plans = db.query(StudyPlan).filter(
        StudyPlan.user_id == user.id,
        StudyPlan.is_completed == 1,
    ).order_by(StudyPlan.completed_at.desc()).all()

    groups: dict[str, list[dict]] = {}
    for p in plans:
        day_key = p.completed_at.strftime("%Y-%m-%d") if p.completed_at else "未知"
        d = p.to_dict()
        if p.area_id:
            area = db.query(Area).get(p.area_id)
            d["area_name"] = area.name if area else None
        else:
            d["area_name"] = None
        groups.setdefault(day_key, []).append(d)

    # 按日期降序排列
    result = sorted(groups.items(), key=lambda x: x[0], reverse=True)
    return [{"date": k, "plans": v} for k, v in result]
