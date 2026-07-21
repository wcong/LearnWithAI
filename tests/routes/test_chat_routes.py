"""测试 app/routes/chat.py — 聊天交互 API (mock LearningAgent)"""


class TestChat:
    def test_chat_no_auth(self, test_client):
        """未认证时返回 401"""
        resp = test_client.post(
            "/api/chat",
            json={"area_id": 1, "message": "你好"},
        )
        assert resp.status_code == 401

    def test_chat_nonexistent_area(self, test_client, auth_headers):
        """不存在的领域返回 404"""
        resp = test_client.post(
            "/api/chat",
            headers=auth_headers,
            json={"area_id": 99999, "message": "你好"},
        )
        assert resp.status_code == 404

    def test_chat_success(self, test_client, auth_headers, test_area):
        """正常聊天返回 AI 回复"""
        from app.agents.learning_agent import LearningAgent

        # 直接 setattr 添加 ask 方法（接受 self 因为实例方法）
        async def mock_ask(self, message):
            return ("模拟回复", {
                "model": "test-model",
                "provider": "openai",
                "prompt_tokens": 10,
                "completion_tokens": 20,
                "total_tokens": 30,
                "duration_ms": 100,
            })

        setattr(LearningAgent, "ask", mock_ask)
        try:
            resp = test_client.post(
                "/api/chat",
                headers=auth_headers,
                json={"area_id": test_area.id, "message": "什么是机器学习？"},
            )
            assert resp.status_code == 200, resp.text
            data = resp.json()
            assert "reply" in data
            assert data["area_id"] == test_area.id
            assert data["message_id"] is not None
        finally:
            delattr(LearningAgent, "ask")

    def test_chat_with_skill(self, test_client, auth_headers, test_area, db_session):
        """带技能模板的聊天"""
        from app.models import Skill
        from app.agents.learning_agent import LearningAgent

        async def mock_ask(self, message):
            return ("面试回复", {
                "model": "test-model",
                "provider": "openai",
                "prompt_tokens": 5,
                "completion_tokens": 15,
                "total_tokens": 20,
                "duration_ms": 50,
            })

        setattr(LearningAgent, "ask", mock_ask)
        try:
            skill = Skill(
                name="面试",
                description="面试模板",
                prompt_template="请用面试形式回答：{topic}",
                user_id=test_area.user_id,
            )
            db_session.add(skill)
            db_session.commit()

            resp = test_client.post(
                "/api/chat",
                headers=auth_headers,
                json={
                    "area_id": test_area.id,
                    "message": "Python 基础",
                    "skill_id": skill.id,
                },
            )
            assert resp.status_code == 200
            assert "reply" in resp.json()
        finally:
            delattr(LearningAgent, "ask")


class TestChatStream:
    def test_chat_stream_success(self, test_client, auth_headers, test_area):
        """流式聊天返回 SSE 事件流"""
        from app.agents.learning_agent import LearningAgent

        async def mock_chat_stream(self, message, callback_handler=None):
            if callback_handler:
                await callback_handler.on_llm_new_token("模拟")
            return ("模拟流式回复", {
                "model": "test-model",
                "provider": "openai",
                "prompt_tokens": 10,
                "completion_tokens": 20,
                "total_tokens": 30,
                "duration_ms": 100,
            })

        setattr(LearningAgent, "chat_stream", mock_chat_stream)
        try:
            resp = test_client.post(
                "/api/chat/stream",
                headers=auth_headers,
                json={"area_id": test_area.id, "message": "你好"},
            )
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/event-stream")
        finally:
            delattr(LearningAgent, "chat_stream")


class TestHistory:
    def test_get_history(self, test_client, auth_headers, test_area):
        """获取聊天历史"""
        resp = test_client.get(
            f"/api/chat/history/{test_area.id}", headers=auth_headers
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_get_history_not_found(self, test_client, auth_headers):
        """不存在的领域返回 404"""
        resp = test_client.get("/api/chat/history/99999", headers=auth_headers)
        assert resp.status_code == 404


class TestUsage:
    def test_get_usage(self, test_client, auth_headers, test_area, db_session):
        """获取用量记录"""
        from app.models import ChatMessage, UsageLog

        msg = ChatMessage(area_id=test_area.id, role="assistant", content="回复")
        db_session.add(msg)
        db_session.flush()

        log = UsageLog(
            area_id=test_area.id,
            message_id=msg.id,
            model="test",
            provider="openai",
            prompt_tokens=10,
            completion_tokens=20,
            total_tokens=30,
            duration_ms=100,
        )
        db_session.add(log)
        db_session.commit()

        resp = test_client.get(
            f"/api/chat/usage/{msg.id}", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_tokens"] == 30


class TestSession:
    def test_save_session(self, test_client, auth_headers, test_area):
        """保存学习会话"""
        resp = test_client.post(
            f"/api/chat/session/{test_area.id}",
            headers=auth_headers,
            params={"summary": "今天学习了机器学习基础"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["area_id"] == test_area.id
        assert data["summary"] == "今天学习了机器学习基础"

    def test_list_sessions(self, test_client, auth_headers, test_area):
        """列出会话"""
        resp = test_client.get(
            f"/api/chat/sessions/{test_area.id}", headers=auth_headers
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestDeleteMessage:
    def test_delete_message(self, test_client, auth_headers, test_area, db_session):
        """删除消息"""
        from app.models import ChatMessage

        msg = ChatMessage(area_id=test_area.id, role="user", content="待删除")
        db_session.add(msg)
        db_session.commit()

        resp = test_client.delete(
            f"/api/chat/message/{msg.id}", headers=auth_headers
        )
        assert resp.status_code == 200

    def test_delete_other_users_message(
        self, test_client, auth_headers, db_session
    ):
        """不能删除其他用户的消息"""
        from app.models import Area, ChatMessage, User
        from app.auth import hash_password

        other_user = User(username="other", password_hash=hash_password("pass"))
        db_session.add(other_user)
        db_session.flush()
        other_area = Area(user_id=other_user.id, name="别人的")
        db_session.add(other_area)
        db_session.flush()
        msg = ChatMessage(area_id=other_area.id, role="user", content="秘密")
        db_session.add(msg)
        db_session.commit()

        resp = test_client.delete(
            f"/api/chat/message/{msg.id}", headers=auth_headers
        )
        assert resp.status_code == 403
