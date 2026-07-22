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
    """创建所有表，并自动迁移旧的 areas / users 表（补充新列）"""
    from app.models import Area, ChatMessage, LearningSession, UsageLog, User, NoteEmbedding, LoginHistory, Skill, SystemConfig, PasswordReset  # noqa: F401
    Base.metadata.create_all(bind=engine)

    # 迁移：旧版 areas 表缺少 user_id 列
    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE areas ADD COLUMN user_id INTEGER REFERENCES users(id)"))
            conn.commit()
    except Exception:
        pass  # 列已存在则忽略

    # 迁移：旧版 users 表缺少 email 列
    _add_column("users", "email", "VARCHAR(200)")
    # 迁移：旧版 users 表缺少 wechat_openid 列
    _add_column("users", "wechat_openid", "VARCHAR(100)")
    # 迁移：旧版 users 表缺少 nickname 列
    _add_column("users", "nickname", "VARCHAR(100)")
    # 迁移：旧版 users 表 password_hash 改为 nullable
    _make_column_nullable("users", "password_hash")

    # 初始化系统默认配置
    _init_default_configs()

    # 创建默认面试准备 Skill（仅首次创建）
    _create_default_skills()


def _add_column(table: str, column: str, col_type: str):
    """安全添加列（若已存在则跳过）"""
    try:
        with engine.connect() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
            conn.commit()
    except Exception:
        pass


def _make_column_nullable(table: str, column: str):
    """安全将列改为 nullable（支持 MySQL 和 SQLite）"""
    try:
        if DATABASE_URL.startswith("mysql"):
            with engine.connect() as conn:
                conn.execute(text(f"ALTER TABLE {table} MODIFY `{column}` VARCHAR(256) NULL"))
                conn.commit()
        elif DATABASE_URL.startswith("sqlite"):
            # SQLite 不支持 ALTER COLUMN，用重建表方式
            # 先尝试 INSERT NULL 看是否被拒绝，如被拒则重建表
            try:
                with engine.connect() as conn:
                    conn.execute(text(f"INSERT INTO {table} (username, {column}) VALUES ('_migrate_null_check', NULL)"))
                    conn.execute(text(f"DELETE FROM {table} WHERE username = '_migrate_null_check'"))
                    conn.commit()
            except Exception:
                # 列有 NOT NULL 约束，需重建表
                _sqlite_rebuild_column_nullable(table, column)
    except Exception:
        pass


def _sqlite_rebuild_column_nullable(table: str, column: str):
    """SQLite 重建表移除 NOT NULL 约束"""
    from app.models import User  # noqa: F401
    from sqlalchemy import inspect

    inspector = inspect(engine)
    columns = inspector.get_columns(table)
    col_defs = []
    for col in columns:
        col_type = str(col["type"])
        col_name = col["name"]
        nullable = "NULL" if col["nullable"] else "NOT NULL"
        default = f"DEFAULT {col['default']}" if col["default"] else ""
        if col_name == column:
            nullable = "NULL"  # 强制改为可空
        col_defs.append(f'"{col_name}" {col_type} {nullable} {default}'.strip())

    with engine.connect() as conn:
        conn.execute(text("PRAGMA foreign_keys=OFF"))
        conn.execute(text(f'CREATE TABLE {table}_new ({", ".join(col_defs)})'))
        conn.execute(text(f'INSERT INTO {table}_new SELECT * FROM {table}'))
        conn.execute(text(f'DROP TABLE {table}'))
        conn.execute(text(f'ALTER TABLE {table}_new RENAME TO {table}'))
        conn.execute(text("PRAGMA foreign_keys=ON"))
        conn.commit()


def _init_default_configs():
    """插入系统默认配置（仅首次运行，已存在则跳过）"""
    from app.models import SystemConfig
    from sqlalchemy import select

    defaults = {
        "daily_token_input_limit": "200000",
        "daily_token_output_limit": "200000",
    }

    db = SessionLocal()
    try:
        for key, value in defaults.items():
            existing = db.execute(select(SystemConfig).where(SystemConfig.key == key)).scalar()
            if not existing:
                db.add(SystemConfig(key=key, value=value))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


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
