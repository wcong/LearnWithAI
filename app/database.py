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
    from app.models import Area, ChatMessage, LearningSession, UsageLog, User, NoteEmbedding, LoginHistory  # noqa: F401
    Base.metadata.create_all(bind=engine)

    # 迁移：旧版 areas 表缺少 user_id 列
    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE areas ADD COLUMN user_id INTEGER REFERENCES users(id)"))
            conn.commit()
    except Exception:
        pass  # 列已存在则忽略


def get_db():
    """FastAPI 依赖：获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
