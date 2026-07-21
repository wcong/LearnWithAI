"""测试 app/routes/plan.py — Plan Mode API"""


class TestStartPlan:
    def test_no_auth(self, test_client):
        """未认证返回 401"""
        resp = test_client.post(
            "/api/plan/start",
            json={"domain": "机器学习"},
        )
        assert resp.status_code == 401

    def test_empty_domain(self, test_client, auth_headers):
        """空领域名称返回 400"""
        resp = test_client.post(
            "/api/plan/start",
            headers=auth_headers,
            json={"domain": "  "},
        )
        assert resp.status_code == 400

    def test_long_domain(self, test_client, auth_headers):
        """领域名称过长返回 400"""
        resp = test_client.post(
            "/api/plan/start",
            headers=auth_headers,
            json={"domain": "x" * 101},
        )
        assert resp.status_code == 400

    def test_start_plan_success(self, test_client, auth_headers):
        """正常启动返回 SSE 流"""
        resp = test_client.post(
            "/api/plan/start",
            headers=auth_headers,
            json={"domain": "机器学习"},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        # 验证 SSE 内容（mock LLM 应产生事件）
        content = resp.text
        assert "event:" in content
