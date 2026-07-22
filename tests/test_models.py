"""测试 app/models.py — 所有 SQLAlchemy 数据模型"""

import json
from datetime import datetime

import pytest

from app.models import (
    User,
    Area,
    ChatMessage,
    AreaNote,
    NoteEmbedding,
    LearningSession,
    UsageLog,
    AreaAnalysis,
    Skill,
    LoginHistory,
    SystemConfig,
)


class TestUserModel:
    def test_create_user(self, db_session):
        """创建 User 模型"""
        user = User(username="alice", password_hash="salt$hash")
        db_session.add(user)
        db_session.commit()
        assert user.id is not None
        assert user.username == "alice"

    def test_to_dict(self, db_session):
        """User.to_dict() 序列化"""
        user = User(username="bob", password_hash="salt$hash")
        db_session.add(user)
        db_session.commit()
        d = user.to_dict()
        assert d["username"] == "bob"
        assert "id" in d
        assert "created_at" in d

    def test_unique_username(self, db_session):
        """用户名必须唯一"""
        db_session.add(User(username="unique", password_hash="x"))
        db_session.commit()
        with pytest.raises(Exception):
            db_session.add(User(username="unique", password_hash="y"))
            db_session.commit()


class TestAreaModel:
    def test_create_area(self, test_user, db_session):
        """创建 Area 模型并关联 User"""
        area = Area(user_id=test_user.id, name="机器学习", description="ML 基础")
        db_session.add(area)
        db_session.commit()
        assert area.id is not None
        assert area.user_id == test_user.id

    def test_area_to_dict(self, test_user, db_session):
        """Area.to_dict() 序列化"""
        area = Area(user_id=test_user.id, name="深度学习", parent_id=None, order=1)
        db_session.add(area)
        db_session.commit()
        d = area.to_dict()
        assert d["name"] == "深度学习"
        assert d["parent_id"] is None
        assert d["order"] == 1

    def test_area_tree(self, test_user, db_session):
        """Area 树形结构（手动查询）"""
        parent = Area(user_id=test_user.id, name="AI")
        db_session.add(parent)
        db_session.commit()
        child = Area(user_id=test_user.id, name="NLP", parent_id=parent.id)
        db_session.add(child)
        db_session.commit()

        tree = parent.to_dict()
        children = db_session.query(Area).filter(Area.parent_id == parent.id).all()
        tree["children"] = [c.to_dict() for c in children]
        assert tree["name"] == "AI"
        assert len(tree["children"]) == 1
        assert tree["children"][0]["name"] == "NLP"

    def test_cascade_delete(self, test_user, db_session):
        """手动删除 Area（无 FK 约束，需先删关联的 Area）"""
        user = test_user
        area = Area(user_id=user.id, name="待删除")
        db_session.add(area)
        db_session.commit()
        area_id = area.id

        # 手动删除关联的 Area，再删 User
        db_session.delete(area)
        db_session.delete(user)
        db_session.commit()

        assert db_session.query(Area).get(area_id) is None


class TestChatMessageModel:
    def test_create_message(self, test_area, db_session):
        """创建 ChatMessage 并关联 Area"""
        msg = ChatMessage(area_id=test_area.id, role="user", content="你好")
        db_session.add(msg)
        db_session.commit()
        assert msg.id is not None
        assert msg.role == "user"

    def test_to_dict(self, test_area, db_session):
        """ChatMessage.to_dict()"""
        msg = ChatMessage(area_id=test_area.id, role="assistant", content="回复内容")
        db_session.add(msg)
        db_session.commit()
        d = msg.to_dict()
        assert d["role"] == "assistant"
        assert d["content"] == "回复内容"


class TestAreaNoteModel:
    def test_create_note(self, test_area, db_session):
        """创建 AreaNote（每个 Area 一条）"""
        note = AreaNote(area_id=test_area.id, content="<p>笔记内容</p>")
        db_session.add(note)
        db_session.commit()
        assert note.id is not None

    def test_unique_area_note(self, test_area, db_session):
        """每个 Area 只能有一条笔记"""
        db_session.add(AreaNote(area_id=test_area.id, content="内容1"))
        db_session.commit()
        with pytest.raises(Exception):
            db_session.add(AreaNote(area_id=test_area.id, content="内容2"))
            db_session.commit()


class TestNoteEmbeddingModel:
    def test_create_embedding(self, test_area, db_session):
        """创建 NoteEmbedding"""
        emb = NoteEmbedding(
            area_id=test_area.id,
            chunk_text="文本块",
            embedding=b"\x00\x01\x02",
        )
        db_session.add(emb)
        db_session.commit()
        assert emb.id is not None

    def test_to_dict(self, test_area, db_session):
        """NoteEmbedding.to_dict() 不包含 embedding 二进制"""
        emb = NoteEmbedding(area_id=test_area.id, chunk_text="测试")
        db_session.add(emb)
        db_session.commit()
        d = emb.to_dict()
        assert "chunk_text" in d
        assert "embedding" not in d  # 不应暴露二进制


class TestLearningSessionModel:
    def test_create_session(self, test_area, db_session):
        """创建 LearningSession"""
        session = LearningSession(area_id=test_area.id, summary="本次学习了...")
        db_session.add(session)
        db_session.commit()
        assert session.id is not None


class TestUsageLogModel:
    def test_create_usage_log(self, test_area, db_session):
        """创建 UsageLog"""
        log = UsageLog(
            area_id=test_area.id,
            model="gpt-4",
            provider="openai",
            prompt_tokens=50,
            completion_tokens=100,
            total_tokens=150,
            duration_ms=500,
        )
        db_session.add(log)
        db_session.commit()
        d = log.to_dict()
        assert d["total_tokens"] == 150
        assert d["model"] == "gpt-4"


class TestAreaAnalysisModel:
    def test_create_analysis(self, test_area, db_session):
        """创建 AreaAnalysis"""
        analysis = AreaAnalysis(
            area_id=test_area.id,
            summary="分析摘要",
            sub_area_summaries=json.dumps(
                [{"name": "子方向A", "summary": "摘要内容"}], ensure_ascii=False
            ),
            missing_suggestions=json.dumps(
                [{"name": "补充方向", "reason": "理由"}], ensure_ascii=False
            ),
        )
        db_session.add(analysis)
        db_session.commit()
        d = analysis.to_dict()
        assert d["summary"] == "分析摘要"
        assert len(d["sub_area_summaries"]) == 1
        assert d["sub_area_summaries"][0]["name"] == "子方向A"


class TestSkillModel:
    def test_create_skill(self, test_user, db_session):
        """创建 Skill"""
        skill = Skill(
            name="面试准备",
            description="面试技能",
            prompt_template="请围绕{topic}展开",
            is_global=1,
            is_default=1,
            created_by=test_user.id,
        )
        db_session.add(skill)
        db_session.commit()
        d = skill.to_dict()
        assert d["name"] == "面试准备"
        assert d["is_global"] is True
        assert d["is_default"] is True
        assert d["user_id"] is None  # 全局技能无 user_id


class TestSystemConfigModel:
    def test_create_config(self, db_session):
        """创建 SystemConfig"""
        cfg = SystemConfig(key="daily_token_input_limit", value="200000")
        db_session.add(cfg)
        db_session.commit()
        assert cfg.id is not None
        assert cfg.key == "daily_token_input_limit"
        assert cfg.value == "200000"

    def test_unique_key(self, db_session):
        """配置 key 必须唯一"""
        db_session.add(SystemConfig(key="test_key", value="100"))
        db_session.commit()
        with pytest.raises(Exception):
            db_session.add(SystemConfig(key="test_key", value="200"))
            db_session.commit()

    def test_to_dict(self, db_session):
        """SystemConfig.to_dict()"""
        cfg = SystemConfig(key="daily_token_output_limit", value="300000")
        db_session.add(cfg)
        db_session.commit()
        d = cfg.to_dict()
        assert d["key"] == "daily_token_output_limit"
        assert d["value"] == "300000"
        assert "updated_at" in d

    def test_update_value(self, db_session):
        """更新配置值"""
        cfg = SystemConfig(key="daily_token_input_limit", value="200000")
        db_session.add(cfg)
        db_session.commit()
        cfg.value = "150000"
        db_session.commit()
        db_session.refresh(cfg)
        assert cfg.value == "150000"


class TestLoginHistoryModel:
    def test_create_login_history(self, test_user, db_session):
        """创建 LoginHistory"""
        history = LoginHistory(
            user_id=test_user.id,
            ip_address_masked="192.168.1.x",
            user_agent="pytest",
            success=1,
        )
        db_session.add(history)
        db_session.commit()
        d = history.to_dict()
        assert d["user_id"] == test_user.id
        assert d["success"] is True

    def test_login_history_order(self, test_user, db_session):
        """登录历史按时间倒序（手动查询）"""
        from datetime import datetime, timedelta

        h1 = LoginHistory(
            user_id=test_user.id, login_at=datetime.utcnow(), success=1
        )
        h2 = LoginHistory(
            user_id=test_user.id,
            login_at=datetime.utcnow() - timedelta(hours=1),
            success=1,
        )
        db_session.add_all([h1, h2])
        db_session.commit()
        # 手动查询登录历史，按时间倒序
        logins = db_session.query(LoginHistory).filter(
            LoginHistory.user_id == test_user.id
        ).order_by(LoginHistory.login_at.desc()).all()
        assert len(logins) == 2
        assert logins[0].id == h1.id  # 最新的在前
