"""测试 app/auth.py — JWT 认证与密码哈希工具"""

import time
from datetime import datetime, timedelta, timezone

from jose import jwt, JWTError

from app.auth import (
    hash_password,
    verify_password,
    create_token,
    mask_ip,
    get_current_user,
)
from app.config import settings


class TestHashPassword:
    def test_hash_and_verify(self):
        """密码哈希后可验证"""
        pw = hash_password("my_secure_password")
        # 格式：salt$hash
        assert "$" in pw
        salt, h = pw.split("$", 1)
        assert len(salt) == 32  # 16 字节 hex
        assert len(h) == 64  # SHA-256 hex
        assert verify_password("my_secure_password", pw) is True

    def test_wrong_password(self):
        """错误密码验证失败"""
        pw = hash_password("correct")
        assert verify_password("wrong", pw) is False

    def test_invalid_stored_format(self):
        """非法的存储格式返回 False"""
        assert verify_password("pwd", "invalid_format") is False
        assert verify_password("pwd", "") is False


class TestCreateToken:
    def test_create_and_decode(self):
        """创建 JWT Token 后可正常解码"""
        token = create_token(42)
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
        assert payload["sub"] == "42"
        assert "exp" in payload

    def test_expiry(self):
        """Token 有过期时间"""
        token = create_token(1)
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
        exp = payload["exp"]
        # 应该是未来 72 小时内
        expected = datetime.now(timezone.utc) + timedelta(hours=72)
        assert abs(exp - expected.timestamp()) < 5  # 5 秒容差

    def test_invalid_token(self):
        """无效 Token 抛出异常"""
        with pytest.raises(JWTError):
            jwt.decode("invalid.token.here", settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])


class TestMaskIP:
    def test_none_returns_unknown(self):
        assert mask_ip(None) == "unknown"

    def test_empty_returns_unknown(self):
        assert mask_ip("") == "unknown"

    def test_loopback(self):
        assert mask_ip("127.0.0.1") == "local"

    def test_private_ipv4(self):
        assert mask_ip("192.168.1.100") == "local"
        assert mask_ip("10.0.0.5") == "local"

    def test_public_ipv4(self):
        masked = mask_ip("8.8.8.8")
        assert masked == "8.8.8.x"

    def test_ipv6(self):
        """IPv6 保留前 5 组"""
        masked = mask_ip("2001:4860:4860::8888")
        assert "::x" in masked

    def test_invalid_ip(self):
        assert mask_ip("not-an-ip") == "invalid"


class TestGetCurrentUser:
    def test_no_credentials(self):
        """无凭证时抛出 401"""
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            get_current_user(credentials=None, db=None)
        assert exc.value.status_code == 401


import pytest
