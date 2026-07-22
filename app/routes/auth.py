"""用户注册与登录 — 仅支持邮箱注册和微信小程序登录"""
import json
import logging
import random
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.auth import hash_password, verify_password, create_token, get_current_user, mask_ip
from app.config import settings
from app.database import get_db, SessionLocal
from app.models import LoginHistory, PasswordReset, User

log = logging.getLogger("learnwithai")

router = APIRouter(prefix="/api/auth", tags=["Auth"])


# ── Pydantic 请求/响应模型 ──────────────────────────────

class EmailRegisterRequest(BaseModel):
    email: str
    password: str
    code: str
    nickname: str = ""


class RegisterSendCodeRequest(BaseModel):
    email: str


class EmailLoginRequest(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    email: str
    code: str
    new_password: str


class WechatLoginRequest(BaseModel):
    code: str


class AuthResponse(BaseModel):
    token: str
    user_id: int
    username: str
    email: str | None = None
    nickname: str | None = None


# ── 内部工具函数 ────────────────────────────────────────

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
                    db = db_maker()
                    try:
                        db.query(LoginHistory).filter(LoginHistory.id == history_id).update(
                            {"location": json.dumps(geo_info, ensure_ascii=False)}
                        )
                        db.commit()
                    finally:
                        db.close()
    except Exception:
        pass


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


def _make_username_from_email(email: str) -> str:
    """从邮箱前缀生成唯一 username（如冲突则追加随机数字）"""
    prefix = email.split("@")[0][:50]
    # 只保留字母数字下划线
    safe = "".join(c for c in prefix if c.isalnum() or c in "._-")
    if not safe:
        safe = "user"
    return safe


def _make_username_from_openid(openid: str) -> str:
    """从微信 openid 生成唯一 username"""
    return "wx_" + openid[-12:] if len(openid) > 12 else "wx_" + openid


def _send_email(to: str, subject: str, body: str):
    """发送邮件 — 支持 SMTP 和开发模式日志回退"""
    if settings.SMTP_HOST:
        try:
            msg = EmailMessage()
            msg.set_content(body)
            msg["Subject"] = subject
            msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
            msg["To"] = to
            if settings.SMTP_PORT == 465:
                # SSL 直连
                with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
                    if settings.SMTP_USER:
                        server.login(settings.SMTP_USER, settings.SMTP_PASS)
                    server.send_message(msg)
            else:
                # STARTTLS（587）或明文（25）
                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
                    if settings.SMTP_PORT == 587:
                        server.starttls()
                    if settings.SMTP_USER:
                        server.login(settings.SMTP_USER, settings.SMTP_PASS)
                    server.send_message(msg)
            log.info("密码重置邮件已发送至 %s", to)
            return
        except Exception as e:
            log.warning("SMTP 发送邮件失败，回退到日志输出: %s", e)
    # 开发模式：直接打印到日志
    log.info("=" * 50)
    log.info("[密码重置] 收件人: %s", to)
    log.info("[密码重置] 主题: %s", subject)
    log.info("[密码重置] 内容:\n%s", body)
    log.info("=" * 50)


async def _wechat_code2session(code: str) -> dict:
    """微信 code 换取 session_key 和 openid"""
    url = "https://api.weixin.qq.com/sns/jscode2session"
    params = {
        "appid": settings.WECHAT_APPID,
        "secret": settings.WECHAT_SECRET,
        "js_code": code,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(url, params=params)
        data = resp.json()
        if "openid" not in data or "session_key" not in data:
            raise HTTPException(400, f"微信登录失败: {data.get('errmsg', '未知错误')}")
        return data


# ── API 端点 ────────────────────────────────────────────

@router.post("/register-send-code")
def register_send_code(req: RegisterSendCodeRequest, db: Session = Depends(get_db)):
    """注册时发送验证码 — 邮箱已存在则返回提示"""
    email = req.email.strip().lower()
    if "@" not in email or "." not in email:
        raise HTTPException(400, "请输入有效的邮箱地址")

    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(409, "该邮箱已注册，请直接登录")

    # 生成 6 位验证码
    code = f"{random.randint(0, 999999):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    # 使旧验证码失效
    db.query(PasswordReset).filter(
        PasswordReset.email == email,
        PasswordReset.used == 0,
    ).update({"used": 1})
    db.commit()

    reset = PasswordReset(email=email, code=code, expires_at=expires_at)
    db.add(reset)
    db.commit()

    subject = f"{settings.PROJECT_NAME} - 邮箱注册验证码"
    body = f"""您好，

感谢注册 {settings.PROJECT_NAME}！

您的注册验证码：{code}

该验证码有效期 10 分钟，请勿泄露给他人。
如非本人操作，请忽略此邮件。
"""
    _send_email(email, subject, body)

    return {"message": "验证码已发送到您的邮箱"}


@router.post("/register", response_model=AuthResponse)
def register(req: EmailRegisterRequest, request: Request, background_tasks: BackgroundTasks,
             db: Session = Depends(get_db)):
    """邮箱注册 — 需先通过 /register-send-code 获取验证码"""
    email = req.email.strip().lower()
    if "@" not in email or "." not in email:
        raise HTTPException(400, "请输入有效的邮箱地址")
    if len(req.password) < 4:
        raise HTTPException(400, "密码至少 4 个字符")

    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(409, "该邮箱已注册，请直接登录")

    # 验证验证码
    now = datetime.now(timezone.utc)
    record = db.query(PasswordReset).filter(
        PasswordReset.email == email,
        PasswordReset.code == req.code.strip(),
        PasswordReset.used == 0,
        PasswordReset.expires_at > now,
    ).first()
    if not record:
        raise HTTPException(400, "验证码无效或已过期，请重新发送")

    # 标记验证码已使用
    record.used = 1
    db.flush()

    # 生成唯一 username
    base_username = _make_username_from_email(email)
    username = base_username
    suffix = 1
    while db.query(User).filter(User.username == username).first():
        username = f"{base_username}_{suffix}"
        suffix += 1

    user = User(
        username=username,
        email=email,
        nickname=req.nickname or base_username,
        password_hash=hash_password(req.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_token(user.id)

    record = _record_login(db, user.id, request, success=True)
    raw_ip = _get_client_ip(request)
    background_tasks.add_task(_fetch_geolocation, record.id, raw_ip, SessionLocal)

    return AuthResponse(token=token, user_id=user.id, username=user.username,
                        email=user.email, nickname=user.nickname)


@router.post("/login", response_model=AuthResponse)
def login(req: EmailLoginRequest, request: Request, background_tasks: BackgroundTasks,
          db: Session = Depends(get_db)):
    """邮箱登录（同时支持 username 向后兼容）"""
    email = req.email.strip().lower()

    # 优先按邮箱查找，其次按 username（向后兼容）
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = db.query(User).filter(User.username == email).first()
    if not user or not user.password_hash or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "邮箱或密码错误")

    token = create_token(user.id)

    record = _record_login(db, user.id, request, success=True)
    raw_ip = _get_client_ip(request)
    background_tasks.add_task(_fetch_geolocation, record.id, raw_ip, SessionLocal)

    return AuthResponse(token=token, user_id=user.id, username=user.username,
                        email=user.email, nickname=user.nickname)


@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """发送密码重置验证码到邮箱"""
    email = req.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # 不透露邮箱是否存在，统一返回成功
        return {"message": "如果该邮箱已注册，验证码已发送"}

    # 生成 6 位随机数字验证码
    code = f"{random.randint(0, 999999):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    # 使该邮箱旧的未使用验证码失效
    db.query(PasswordReset).filter(
        PasswordReset.email == email,
        PasswordReset.used == 0,
    ).update({"used": 1})
    db.commit()

    reset = PasswordReset(email=email, code=code, expires_at=expires_at)
    db.add(reset)
    db.commit()

    subject = f"{settings.PROJECT_NAME} - 密码重置验证码"
    body = f"""您好，

您的 {settings.PROJECT_NAME} 账户正在进行密码重置。

验证码：{code}

该验证码有效期 10 分钟，请勿泄露给他人。
如非本人操作，请忽略此邮件。
"""
    _send_email(email, subject, body)

    return {"message": "如果该邮箱已注册，验证码已发送"}


@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    """验证重置码并重置密码"""
    email = req.email.strip().lower()
    if len(req.new_password) < 4:
        raise HTTPException(400, "密码至少 4 个字符")

    now = datetime.now(timezone.utc)
    record = db.query(PasswordReset).filter(
        PasswordReset.email == email,
        PasswordReset.code == req.code.strip(),
        PasswordReset.used == 0,
        PasswordReset.expires_at > now,
    ).first()

    if not record:
        raise HTTPException(400, "验证码无效或已过期")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(404, "用户不存在")

    user.password_hash = hash_password(req.new_password)
    record.used = 1
    db.commit()

    return {"message": "密码重置成功"}


@router.post("/wechat-login", response_model=AuthResponse)
async def wechat_login(req: WechatLoginRequest, request: Request,
                        background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """微信小程序一键登录（首次自动注册）"""
    wechat_data = await _wechat_code2session(req.code)
    openid = wechat_data["openid"]

    user = db.query(User).filter(User.wechat_openid == openid).first()

    if not user:
        # 首次登录，自动创建用户
        base_username = _make_username_from_openid(openid)
        username = base_username
        suffix = 1
        while db.query(User).filter(User.username == username).first():
            username = f"{base_username}_{suffix}"
            suffix += 1

        user = User(
            username=username,
            wechat_openid=openid,
            nickname=f"微信用户_{openid[-6:]}",
            password_hash="",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    token = create_token(user.id)

    record = _record_login(db, user.id, request, success=True)
    raw_ip = _get_client_ip(request)
    background_tasks.add_task(_fetch_geolocation, record.id, raw_ip, SessionLocal)

    return AuthResponse(token=token, user_id=user.id, username=user.username,
                        email=user.email, nickname=user.nickname)


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return current_user.to_dict()
