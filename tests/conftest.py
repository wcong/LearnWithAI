"""
pytest 共享 Fixtures

测试策略：
  1. 在模块加载时创建 SQLite :memory: 引擎和 Session，建好所有表
  2. 每个测试前使用 autouse fixture 替换 app.database.engine / SessionLocal
  3. 每个测试后清空所有表数据，保证隔离
  4. FastAPI TestClient 通过 dependency_overrides 替换 get_db
  5. 全局 mock 所有 LLM 相关调用，避免真实的网络请求
"""

import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# -----------------------------------------------------------
# 在导入 app 模块前设置测试环境变量
# -----------------------------------------------------------
os.environ.setdefault("LLM_PROVIDER", "openai")
os.environ.setdefault("LLM_API_KEY", "test-key")
os.environ.setdefault("LLM_MODEL", "gpt-4o-mini")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-for-testing-only")
os.environ.setdefault("ADMIN_USERNAME", "admin")

from app.database import Base  # noqa: E402
# 导入所有模型以在 Base.metadata 上注册表
from app.models import (  # noqa: E402, F401
    User, Area, ChatMessage, AreaNote, NoteEmbedding,
    LearningSession, UsageLog, AreaAnalysis, Skill, LoginHistory, PasswordReset,
)

# -----------------------------------------------------------
# 为 SQLite :memory: 启用外键约束
# -----------------------------------------------------------
test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    echo=False,
)


@event.listens_for(test_engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """启用外键约束（SQLite 默认关闭）"""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

# 创建所有表
Base.metadata.create_all(bind=test_engine)


# -----------------------------------------------------------
# 全局 Fixtures
# -----------------------------------------------------------

@pytest.fixture(autouse=True, scope="function")
def _override_db(monkeypatch):
    """替换 app.database 中的 engine 和 SessionLocal 为测试实例"""
    monkeypatch.setattr("app.database.engine", test_engine)
    monkeypatch.setattr("app.database.SessionLocal", TestSessionLocal)
    # 每个测试开始前清空所有表数据
    from sqlalchemy import text as sa_text
    with test_engine.connect() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(sa_text(f"DELETE FROM {table.name}"))
        conn.commit()
    yield


@pytest.fixture
def db_session(_override_db):
    """提供一个测试数据库会话（测试结束后自动关闭）"""
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def test_client(_override_db):
    """FastAPI TestClient，自动覆盖 get_db 依赖"""
    from main import app
    from app.database import get_db

    def _get_test_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_test_db

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


@pytest.fixture
def test_user(db_session):
    """创建并返回一个测试用户（邮箱用户）"""
    from app.auth import hash_password
    from app.models import User

    user = User(username="testuser", email="testuser@test.com", password_hash=hash_password("testpass123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def auth_headers(test_user):
    """生成测试用户的 JWT Bearer Token"""
    from app.auth import create_token

    token = create_token(test_user.id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def test_area(test_user, db_session):
    """创建并返回一个测试学习领域"""
    from app.models import Area

    area = Area(
        user_id=test_user.id,
        name="测试领域",
        description="这是一个测试领域",
    )
    db_session.add(area)
    db_session.commit()
    db_session.refresh(area)
    return area


@pytest.fixture
def admin_user(db_session):
    """创建并返回管理员用户（用户名与 ADMIN_USERNAME 一致）"""
    from app.auth import hash_password
    from app.models import User

    admin = User(username="admin", email="admin@test.com", password_hash=hash_password("admin123"))
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


@pytest.fixture
def admin_headers(admin_user):
    """生成管理员的 JWT Bearer Token"""
    from app.auth import create_token

    token = create_token(admin_user.id)
    return {"Authorization": f"Bearer {token}"}


# -----------------------------------------------------------
# 全局 Mock LLM 相关调用（避免真实 API 请求）
# -----------------------------------------------------------

@pytest.fixture(autouse=True)
def _mock_llm(monkeypatch):
    """Mock app.agents.learning_agent._build_llm，返回一个 MagicMock"""

    def _mock_build_llm(streaming=False, callbacks=None):
        mock_llm = MagicMock()
        mock_llm.model_name = "test-model"
        mock_llm.model = "test-model"

        # mock ainvoke — 返回一个 AIMessage 结构
        async def mock_ainvoke(messages, **kwargs):
            from langchain_core.messages import AIMessage

            msg = AIMessage(
                content="这是 AI 模拟回复内容。",
                usage_metadata={
                    "input_tokens": 10,
                    "output_tokens": 20,
                    "total_tokens": 30,
                },
            )
            return msg

        mock_llm.ainvoke = AsyncMock(side_effect=mock_ainvoke)

        # mock embed_documents
        mock_llm.embed_documents = MagicMock(return_value=[[0.1] * 384])

        # mock aembed_query
        async def mock_aembed_query(query):
            return [0.1] * 384

        mock_llm.aembed_query = AsyncMock(side_effect=mock_aembed_query)

        return mock_llm

    monkeypatch.setattr(
        "app.agents.learning_agent._build_llm", _mock_build_llm
    )
    monkeypatch.setattr("app.agents.plan_agent._build_llm", _mock_build_llm)
