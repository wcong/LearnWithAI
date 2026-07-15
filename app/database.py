"""数据库引擎 & 会话管理 — 支持 SQLite 和 MySQL（通过 DATABASE_URL 环境变量切换）"""
import os
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import settings


def _get_database_url() -> str:
    """优先读取 DATABASE_URL 环境变量，否则回退到 SQLite"""
    url = settings.DATABASE_URL
    if url:
        return url
    # 默认使用 SQLite：确保 data 目录存在
    db_path = Path(settings.DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{db_path}"


DATABASE_URL = _get_database_url()

# SQLite 需要 check_same_thread=False 配合 FastAPI 多线程
_connect_args: dict = {}
if DATABASE_URL.startswith("sqlite"):
    _connect_args["check_same_thread"] = False

engine = create_engine(DATABASE_URL, connect_args=_connect_args, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db_type() -> str:
    """返回当前数据库类型名称（用于日志/展示）"""
    if DATABASE_URL.startswith("mysql"):
        return "MySQL"
    elif DATABASE_URL.startswith("sqlite"):
        return "SQLite"
    return DATABASE_URL.split("://")[0].upper()


def init_db():
    """创建所有表，并自动迁移旧的 areas 表（补充 user_id 列）"""
    from app.models import Area, ChatMessage, LearningSession, UsageLog, User, NoteEmbedding, LoginHistory, Skill  # noqa: F401
    Base.metadata.create_all(bind=engine)

    # 迁移：旧版 areas 表缺少 user_id 列
    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE areas ADD COLUMN user_id INTEGER REFERENCES users(id)"))
            conn.commit()
    except Exception:
        pass  # 列已存在则忽略

    # 创建默认面试准备 Skill（仅首次创建）
    _create_default_skills()


def _create_default_skills():
    """创建系统预设的全局默认 Skill"""
    from app.models import Skill
    from sqlalchemy import select

    db = SessionLocal()
    try:
        existing = db.execute(select(Skill).where(Skill.is_default == 1)).scalar()
        if existing:
            return

        interview_skill = Skill(
            name="面试准备",
            description="围绕指定主题，详细介绍实现细节、使用场景和常见面试问题",
            prompt_template=(
                '请围绕「{topic}」这个主题，详细地介绍一下这个主题的内容，包括：\n\n'
                '1. **核心概念和原理**：介绍该主题的核心概念、基本原理和技术背景。\n\n'
                '2. **实现细节和技术要点**：深入讲解关键实现细节、架构设计、代码示例（如有）以及技术难点。\n\n'
                '3. **实际应用场景**：列举并分析该技术在实际项目中的应用场景，说明其优势和局限性。\n\n'
                '4. **面试常见问题与参考答案**：整理面试中关于该主题最常见的问题，并提供高质量的参考答案和答题思路。\n\n'
                '请尽量详细、专业，确保内容适合作为面试准备材料。'
            ),
            is_global=1,
            is_default=1,
        )
        db.add(interview_skill)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def get_db():
    """FastAPI 依赖：获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
