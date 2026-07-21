"""测试 app/routes/admin.py — 管理员统计面板"""


class TestAdminStats:
    def test_no_auth(self, test_client):
        """未认证返回 401"""
        resp = test_client.get("/api/admin/stats")
        assert resp.status_code == 401

    def test_not_admin(self, test_client, auth_headers):
        """非管理员返回 403"""
        resp = test_client.get("/api/admin/stats", headers=auth_headers)
        assert resp.status_code == 403

    def test_admin_stats(self, test_client, admin_headers, admin_user):
        """管理员查看统计（admin_user fixture 已在 DB 中）"""
        resp = test_client.get("/api/admin/stats", headers=admin_headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "summary" in data
        assert "users" in data
        # admin_user fixture 创建了 admin 用户，应出现在统计中
        assert data["summary"]["total_users"] >= 1

    def test_admin_stats_with_data(
        self, test_client, admin_headers, test_area, db_session
    ):
        """有数据时统计正确"""
        resp = test_client.get("/api/admin/stats", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["summary"]["total_users"] >= 1
