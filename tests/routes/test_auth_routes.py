"""测试 app/routes/auth.py — 邮箱注册/登录/忘记密码/微信登录 API"""
from datetime import datetime, timedelta, timezone
from unittest.mock import ANY, patch

import pytest

from app.auth import verify_password
from app.models import PasswordReset, User


class TestRegisterSendCode:
    def test_send_code_new_email(self, test_client, db_session):
        """未注册邮箱可以获取验证码"""
        resp = test_client.post(
            "/api/auth/register-send-code",
            json={"email": "newuser@test.com"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["message"] == "验证码已发送到您的邮箱"
        # 验证验证码已存入数据库
        record = db_session.query(PasswordReset).filter(
            PasswordReset.email == "newuser@test.com",
            PasswordReset.used == 0,
        ).first()
        assert record is not None
        assert len(record.code) == 6
        assert record.code.isdigit()

    def test_send_code_existing_email(self, test_client, test_user):
        """已注册邮箱返回 409 提示登录"""
        resp = test_client.post(
            "/api/auth/register-send-code",
            json={"email": "testuser@test.com"},
        )
        assert resp.status_code == 409
        assert "已注册" in resp.json()["detail"]

    def test_send_code_invalid_email(self, test_client):
        """无效邮箱报错"""
        resp = test_client.post(
            "/api/auth/register-send-code",
            json={"email": "notanemail"},
        )
        assert resp.status_code == 400


def _get_code(db_session, email):
    """从数据库获取该邮箱最新的未使用验证码"""
    record = db_session.query(PasswordReset).filter(
        PasswordReset.email == email,
        PasswordReset.used == 0,
    ).order_by(PasswordReset.id.desc()).first()
    return record.code if record else None


class TestEmailRegister:
    def test_register_success(self, test_client, db_session):
        """注册成功返回 token 和用户信息"""
        # 先发验证码
        test_client.post("/api/auth/register-send-code", json={"email": "newuser@test.com"})
        code = _get_code(db_session, "newuser@test.com")
        assert code is not None

        resp = test_client.post(
            "/api/auth/register",
            json={"email": "newuser@test.com", "password": "pass1234", "code": code},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "token" in data
        assert data["email"] == "newuser@test.com"
        assert data["user_id"] > 0
        assert data["username"].startswith("newuser")

    def test_register_with_nickname(self, test_client, db_session):
        """注册时带昵称"""
        test_client.post("/api/auth/register-send-code", json={"email": "nick@test.com"})
        code = _get_code(db_session, "nick@test.com")
        assert code is not None

        resp = test_client.post(
            "/api/auth/register",
            json={"email": "nick@test.com", "password": "pass1234", "code": code, "nickname": "小昵称"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["nickname"] == "小昵称"

    def test_register_invalid_email(self, test_client):
        """无效邮箱报错"""
        resp = test_client.post(
            "/api/auth/register",
            json={"email": "notanemail", "password": "pass1234", "code": "123456"},
        )
        assert resp.status_code == 400

    def test_register_short_password(self, test_client, db_session):
        """密码少于 4 字符报错"""
        test_client.post("/api/auth/register-send-code", json={"email": "shortpw@test.com"})
        code = _get_code(db_session, "shortpw@test.com")
        resp = test_client.post(
            "/api/auth/register",
            json={"email": "shortpw@test.com", "password": "ab", "code": code or "123456"},
        )
        assert resp.status_code == 400

    def test_register_duplicate_email(self, test_client, test_user):
        """重复邮箱返回 409"""
        resp = test_client.post(
            "/api/auth/register",
            json={"email": "testuser@test.com", "password": "pass1234", "code": "123456"},
        )
        assert resp.status_code == 409

    def test_register_wrong_code(self, test_client, db_session):
        """错误验证码返回 400"""
        test_client.post("/api/auth/register-send-code", json={"email": "wrongcode@test.com"})
        resp = test_client.post(
            "/api/auth/register",
            json={"email": "wrongcode@test.com", "password": "pass1234", "code": "000000"},
        )
        assert resp.status_code == 400

    def test_register_expired_code(self, test_client, db_session):
        """过期验证码返回 400"""
        email = "expired@test.com"
        # 直接插入一个过期验证码
        reset = PasswordReset(
            email=email,
            code="123456",
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        db_session.add(reset)
        db_session.commit()

        resp = test_client.post(
            "/api/auth/register",
            json={"email": email, "password": "pass1234", "code": "123456"},
        )
        assert resp.status_code == 400


class TestEmailLogin:
    def test_login_success(self, test_client, test_user):
        """邮箱登录成功返回 token"""
        resp = test_client.post(
            "/api/auth/login",
            json={"email": "testuser@test.com", "password": "testpass123"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "token" in data
        assert data["email"] == "testuser@test.com"
        assert data["username"] == "testuser"

    def test_login_wrong_password(self, test_client, test_user):
        """错误密码返回 401"""
        resp = test_client.post(
            "/api/auth/login",
            json={"email": "testuser@test.com", "password": "wrongpass"},
        )
        assert resp.status_code == 401

    def test_login_nonexistent_email(self, test_client):
        """不存在的邮箱返回 401"""
        resp = test_client.post(
            "/api/auth/login",
            json={"email": "nobody@test.com", "password": "pass1234"},
        )
        assert resp.status_code == 401

    def test_login_with_username_backward_compat(self, test_client, test_user):
        """向后兼容：username 仍然可用于登录"""
        resp = test_client.post(
            "/api/auth/login",
            json={"email": "testuser", "password": "testpass123"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["username"] == "testuser"


class TestForgotPassword:
    def test_forgot_password_existing_email(self, test_client, test_user, db_session):
        """已注册邮箱发送验证码"""
        resp = test_client.post(
            "/api/auth/forgot-password",
            json={"email": "testuser@test.com"},
        )
        assert resp.status_code == 200, resp.text
        # 验证验证码已存入数据库
        record = db_session.query(PasswordReset).filter(
            PasswordReset.email == "testuser@test.com",
            PasswordReset.used == 0,
        ).first()
        assert record is not None
        assert len(record.code) == 6
        assert record.code.isdigit()

    def test_forgot_password_nonexistent_email(self, test_client):
        """不存在的邮箱也返回成功（不暴露邮箱是否存在）"""
        resp = test_client.post(
            "/api/auth/forgot-password",
            json={"email": "nonexistent@test.com"},
        )
        assert resp.status_code == 200


class TestResetPassword:
    def test_reset_password_success(self, test_client, test_user, db_session):
        """正确验证码可重置密码"""
        # 先插入一个有效的验证码
        reset = PasswordReset(
            email="testuser@test.com",
            code="123456",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        )
        db_session.add(reset)
        db_session.commit()

        resp = test_client.post(
            "/api/auth/reset-password",
            json={"email": "testuser@test.com", "code": "123456", "new_password": "newpass123"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["message"] == "密码重置成功"

        # 验证密码已更新
        db_session.refresh(test_user)
        assert verify_password("newpass123", test_user.password_hash)

        # 验证码已标记为已使用
        db_session.refresh(reset)
        assert reset.used == 1

    def test_reset_password_wrong_code(self, test_client, test_user, db_session):
        """错误验证码返回 400"""
        reset = PasswordReset(
            email="testuser@test.com",
            code="123456",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        )
        db_session.add(reset)
        db_session.commit()

        resp = test_client.post(
            "/api/auth/reset-password",
            json={"email": "testuser@test.com", "code": "000000", "new_password": "newpass123"},
        )
        assert resp.status_code == 400

    def test_reset_password_expired_code(self, test_client, test_user, db_session):
        """过期验证码返回 400"""


        reset = PasswordReset(
            email="testuser@test.com",
            code="123456",
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        db_session.add(reset)
        db_session.commit()

        resp = test_client.post(
            "/api/auth/reset-password",
            json={"email": "testuser@test.com", "code": "123456", "new_password": "newpass123"},
        )
        assert resp.status_code == 400


class TestWechatLogin:
    @patch("app.routes.auth._wechat_code2session")
    def test_wechat_login_first_time(self, mock_code2session, test_client, db_session):
        """首次微信登录自动创建用户"""
        mock_code2session.return_value = {"openid": "wx_openid_001", "session_key": "sk_xxx"}
        resp = test_client.post(
            "/api/auth/wechat-login",
            json={"code": "mock_code"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "token" in data
        assert data["user_id"] > 0
        assert data["username"].startswith("wx_")

        # 验证用户已创建
        user = db_session.query(User).filter(User.wechat_openid == "wx_openid_001").first()
        assert user is not None
        assert user.password_hash == ""  # 微信用户无密码

    @patch("app.routes.auth._wechat_code2session")
    def test_wechat_login_again(self, mock_code2session, test_client, db_session):
        """二次微信登录直接返回已有用户"""
        from app.models import User

        # 先创建一个微信用户
        user = User(username="wx_user", wechat_openid="wx_openid_002", password_hash=None)
        db_session.add(user)
        db_session.commit()

        mock_code2session.return_value = {"openid": "wx_openid_002", "session_key": "sk_xxx"}
        resp = test_client.post(
            "/api/auth/wechat-login",
            json={"code": "mock_code"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["user_id"] == user.id


class TestGetMe:
    def test_get_me_success(self, test_client, auth_headers, test_user):
        """获取当前用户信息"""
        resp = test_client.get("/api/auth/me", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["username"] == "testuser"
        assert data["email"] == "testuser@test.com"
        assert "nickname" in data

    def test_get_me_no_auth(self, test_client):
        """未认证返回 401"""
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401
