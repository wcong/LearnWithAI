"""SQLite 数据库引擎 & 会话管理"""
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import settings

# 确保 data 目录存在
Path(settings.DB_PATH).parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f"sqlite:///{settings.DB_PATH}",
    connect_args={"check_same_thread": False},  # FastAPI 多线程需要
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def init_db():
    """创建所有表，并自动迁移旧的 areas 表（补充 user_id 列）"""
    from app.models import Area, ChatMessage, LearningSession, UsageLog, User  # noqa: F401
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
