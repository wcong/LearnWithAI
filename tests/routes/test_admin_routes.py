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


class TestAdminDailyUsage:
    def test_daily_usage_no_auth(self, test_client):
        """未认证返回 401"""
        resp = test_client.get("/api/admin/daily-usage")
        assert resp.status_code == 401

    def test_daily_usage_not_admin(self, test_client, auth_headers):
        """非管理员返回 403"""
        resp = test_client.get("/api/admin/daily-usage", headers=auth_headers)
        assert resp.status_code == 403

    def test_daily_usage_admin(
        self, test_client, admin_headers, admin_user, test_user, db_session
    ):
        """管理员查看每日用量"""
        from datetime import date
        from app.models import UsageLog, Area

        today = date.today().isoformat()
        resp = test_client.get(
            f"/api/admin/daily-usage?date={today}", headers=admin_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "date" in data
        assert "users" in data

    def test_daily_usage_bad_date(self, test_client, admin_headers):
        """日期格式错误返回 400"""
        resp = test_client.get(
            "/api/admin/daily-usage?date=not-a-date", headers=admin_headers
        )
        assert resp.status_code == 400

    def test_daily_usage_with_data(
        self, test_client, admin_headers, test_user, test_area, db_session
    ):
        """有用量数据时正确返回"""
        from datetime import date, datetime
        from app.models import UsageLog

        today = datetime.utcnow().date()
        log = UsageLog(
            area_id=test_area.id,
            prompt_tokens=100,
            completion_tokens=50,
            total_tokens=150,
        )
        db_session.add(log)
        db_session.commit()

        # 调试信息
        assert log.created_at is not None
        assert log.created_at.date() == today, f"created_at={log.created_at} vs today={today}"

        resp = test_client.get(
            f"/api/admin/daily-usage?date={today.isoformat()}", headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        users = data["users"]
        test_user_data = [u for u in users if u["username"] == test_user.username]
        assert len(test_user_data) == 1, f"users={users}"
        assert test_user_data[0]["prompt_tokens"] == 100
        assert test_user_data[0]["completion_tokens"] == 50


class TestAdminConfig:
    def test_config_no_auth(self, test_client):
        """未认证返回 401"""
        resp = test_client.get("/api/admin/config")
        assert resp.status_code == 401

    def test_config_get(self, test_client, admin_headers, db_session):
        """获取配置"""
        from app.models import SystemConfig

        for key, val in [("daily_token_input_limit", "200000"), ("daily_token_output_limit", "200000")]:
            cfg = db_session.query(SystemConfig).filter(SystemConfig.key == key).first()
            if cfg:
                cfg.value = val
            else:
                db_session.add(SystemConfig(key=key, value=val))
        db_session.commit()

        resp = test_client.get("/api/admin/config", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["daily_token_input_limit"] == "200000"
        assert data["daily_token_output_limit"] == "200000"

    def test_config_update(self, test_client, admin_headers, db_session):
        """更新配置"""
        from app.models import SystemConfig

        for key, val in [("daily_token_input_limit", "200000"), ("daily_token_output_limit", "200000")]:
            cfg = db_session.query(SystemConfig).filter(SystemConfig.key == key).first()
            if cfg:
                cfg.value = val
            else:
                db_session.add(SystemConfig(key=key, value=val))
        db_session.commit()

        resp = test_client.put(
            "/api/admin/config",
            headers=admin_headers,
            json={"daily_token_input_limit": "300000", "daily_token_output_limit": "100000"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["daily_token_input_limit"] == "300000"
        assert data["daily_token_output_limit"] == "100000"

        # 验证持久化
        resp2 = test_client.get("/api/admin/config", headers=admin_headers)
        assert resp2.json()["daily_token_input_limit"] == "300000"
