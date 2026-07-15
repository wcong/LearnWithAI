"""JWT 认证工具（密码哈希用 hashlib，避免 bcrypt 兼容问题）"""
import hashlib
import ipaddress
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User

bearer_scheme = HTTPBearer(auto_error=False)


def mask_ip(ip_str: str | None) -> str:
    """对 IP 地址做脱敏处理，保护用户隐私"""
    if not ip_str:
        return "unknown"
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return "invalid"
    if ip.is_loopback or ip.is_private:
        return "local"
    if isinstance(ip, ipaddress.IPv4Address):
        parts = ip_str.split(".")
        return ".".join(parts[:3]) + ".x"
    # IPv6: 保留前 80 位（前 5 组）
    expanded = ip.exploded
    groups = expanded.split(":")
    masked = ":".join(groups[:5]) + "::x"
    return masked


def hash_password(password: str) -> str:
    """SHA-256 + 随机盐，返回 salt$hash 格式"""
    salt = secrets.token_hex(16)
    h = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}${h}"


def verify_password(plain: str, stored: str) -> bool:
    try:
        salt, h = stored.split("$", 1)
        return hashlib.sha256((salt + plain).encode()).hexdigest() == h
    except (ValueError, AttributeError):
        return False


def create_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRE_HOURS)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """从请求头 Bearer token 中解析当前用户（认证依赖）"""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="请先登录")
    try:
        payload = jwt.decode(credentials.credentials, settings.JWT_SECRET,
                             algorithms=[settings.JWT_ALGORITHM])
        user_id = int(payload.get("sub", 0))
    except (JWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Token 无效或已过期")

    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="用户不存在")
    return user
