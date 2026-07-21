"""测试 app/routes/auth.py — 用户注册 / 登录 API"""

from app.models import User


class TestRegister:
    def test_register_success(self, test_client):
        """注册成功返回 token 和用户信息"""
        resp = test_client.post(
            "/api/auth/register",
            json={"username": "newuser", "password": "pass1234"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "token" in data
        assert data["username"] == "newuser"
        assert data["user_id"] > 0

    def test_register_short_username(self, test_client):
        """用户名少于 2 字符报错"""
        resp = test_client.post(
            "/api/auth/register",
            json={"username": "a", "password": "pass1234"},
        )
        assert resp.status_code == 400

    def test_register_short_password(self, test_client):
        """密码少于 4 字符报错"""
        resp = test_client.post(
            "/api/auth/register",
            json={"username": "validuser", "password": "ab"},
        )
        assert resp.status_code == 400

    def test_register_duplicate(self, test_client, test_user):
        """重复注册返回 409"""
        resp = test_client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "pass1234"},
        )
        assert resp.status_code == 409


class TestLogin:
    def test_login_success(self, test_client, test_user):
        """登录成功返回 token"""
        resp = test_client.post(
            "/api/auth/login",
            json={"username": "testuser", "password": "testpass123"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "token" in data
        assert data["username"] == "testuser"

    def test_login_wrong_password(self, test_client, test_user):
        """错误密码返回 401"""
        resp = test_client.post(
            "/api/auth/login",
            json={"username": "testuser", "password": "wrongpass"},
        )
        assert resp.status_code == 401

    def test_login_nonexistent_user(self, test_client):
        """不存在的用户返回 401"""
        resp = test_client.post(
            "/api/auth/login",
            json={"username": "nobody", "password": "pass1234"},
        )
        assert resp.status_code == 401


class TestGetMe:
    def test_get_me_success(self, test_client, auth_headers, test_user):
        """获取当前用户信息"""
        resp = test_client.get("/api/auth/me", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["username"] == "testuser"

    def test_get_me_no_auth(self, test_client):
        """未认证返回 401"""
        resp = test_client.get("/api/auth/me")
        assert resp.status_code == 401
