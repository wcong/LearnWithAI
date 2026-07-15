"""用户注册与登录"""
import json

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import hash_password, verify_password, create_token, get_current_user, mask_ip
from app.database import get_db, SessionLocal
from app.models import LoginHistory, User

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user_id: int
    username: str


def _get_client_ip(request: Request) -> str:
    """从请求中提取客户端真实 IP"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    client = request.client
    return client.host if client else "unknown"


async def _fetch_geolocation(history_id: int, ip_address: str, db_maker):
    """后台异步获取 IP 地理位置并更新记录"""
    try:
        # 本地 / 私有 IP 不查询
        if mask_ip(ip_address) == "local":
            return
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(
                f"http://ip-api.com/json/{ip_address}",
                params={"fields": "status,country,regionName,city,lat,lon,isp,org,query"},
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    geo_info = {k: data.get(k) for k in ("country", "regionName", "city", "lat", "lon", "isp", "org")}
                    # 使用独立的 DB 会话更新
                    db = db_maker()
                    try:
                        db.query(LoginHistory).filter(LoginHistory.id == history_id).update(
                            {"location": json.dumps(geo_info, ensure_ascii=False)}
                        )
                        db.commit()
                    finally:
                        db.close()
    except Exception:
        pass  # 地理位置获取失败不影响登录


def _record_login(db: Session, user_id: int, request: Request, success: bool, failure_reason: str = "") -> LoginHistory:
    """记录登录历史"""
    raw_ip = _get_client_ip(request)
    record = LoginHistory(
        user_id=user_id,
        ip_address_masked=mask_ip(raw_ip),
        user_agent=request.headers.get("User-Agent", "")[:500],
        success=1 if success else 0,
        failure_reason=failure_reason,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.post("/register", response_model=AuthResponse)
def register(req: RegisterRequest, request: Request, background_tasks: BackgroundTasks,
             db: Session = Depends(get_db)):
    if len(req.username) < 2:
        raise HTTPException(400, "用户名至少 2 个字符")
    if len(req.password) < 4:
        raise HTTPException(400, "密码至少 4 个字符")

    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(409, "用户名已存在")

    user = User(username=req.username, password_hash=hash_password(req.password))
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_token(user.id)

    # 记录注册后自动登录历史
    record = _record_login(db, user.id, request, success=True)
    raw_ip = _get_client_ip(request)
    background_tasks.add_task(_fetch_geolocation, record.id, raw_ip, SessionLocal)

    return AuthResponse(token=token, user_id=user.id, username=user.username)


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest, request: Request, background_tasks: BackgroundTasks,
          db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "用户名或密码错误")

    token = create_token(user.id)

    # 记录登录历史
    record = _record_login(db, user.id, request, success=True)
    raw_ip = _get_client_ip(request)
    background_tasks.add_task(_fetch_geolocation, record.id, raw_ip, SessionLocal)

    return AuthResponse(token=token, user_id=user.id, username=user.username)


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return current_user.to_dict()
