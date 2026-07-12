"""学习领域管理路由"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Area, User

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


@router.get("/tree")
def get_tree(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    roots = db.query(Area).filter(
        Area.parent_id.is_(None), Area.user_id == user.id
    ).order_by(Area.order).all()
    return [r.to_tree() for r in roots]


@router.get("")
def list_areas(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    areas = db.query(Area).filter(
        Area.parent_id.is_(None), Area.user_id == user.id
    ).order_by(Area.order).all()
    return [a.to_tree() for a in areas]


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
    for child in area.children:
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
