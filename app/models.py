"""数据模型"""
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, LargeBinary

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(256), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> dict:
        return {"id": self.id, "username": self.username,
                "created_at": self.created_at.isoformat() if self.created_at else None}


class Area(Base):
    __tablename__ = "areas"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    name = Column(String(200), nullable=False, index=True)
    description = Column(Text, default="")
    parent_id = Column(Integer, nullable=True)
    order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "parent_id": self.parent_id,
            "order": self.order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    area_id = Column(Integer, nullable=False, index=True)
    role = Column(String(20), nullable=False)  # user / assistant
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "area_id": self.area_id,
            "role": self.role,
            "content": self.content,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AreaNote(Base):
    """学习笔记（每个 Area 一条，富文本 HTML 格式）"""
    __tablename__ = "area_notes"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    area_id = Column(Integer, nullable=False, unique=True, index=True)
    content = Column(Text, default="")  # HTML 格式
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "area_id": self.area_id,
            "content": self.content,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class NoteEmbedding(Base):
    """笔记向量分块（RAG 索引，每次笔记保存后重建）"""
    __tablename__ = "note_embeddings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    area_id = Column(Integer, nullable=False, index=True)
    chunk_text = Column(Text, nullable=False)
    embedding = Column(LargeBinary, nullable=True)  # numpy float32 序列化
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "area_id": self.area_id,
            "chunk_text": self.chunk_text,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class LearningSession(Base):
    __tablename__ = "learning_sessions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    area_id = Column(Integer, nullable=False, index=True)
    summary = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "area_id": self.area_id,
            "summary": self.summary,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class UsageLog(Base):
    """AI 调用消耗记录（Token 用量）"""
    __tablename__ = "usage_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    area_id = Column(Integer, nullable=False, index=True)
    message_id = Column(Integer, nullable=True)
    model = Column(String(100), default="")
    provider = Column(String(50), default="")
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    duration_ms = Column(Integer, default=0)  # 请求耗时
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "area_id": self.area_id,
            "message_id": self.message_id,
            "model": self.model,
            "provider": self.provider,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "duration_ms": self.duration_ms,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AreaAnalysis(Base):
    """子领域审查分析记录"""
    __tablename__ = "area_analyses"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    area_id = Column(Integer, nullable=False, index=True)
    summary = Column(Text, default="")
    sub_area_summaries = Column(Text, default="")  # JSON: [{name, summary}]
    missing_suggestions = Column(Text, default="")  # JSON: [{name, reason}]
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self) -> dict:
        import json
        return {
            "id": self.id,
            "area_id": self.area_id,
            "summary": self.summary,
            "sub_area_summaries": json.loads(self.sub_area_summaries) if self.sub_area_summaries else [],
            "missing_suggestions": json.loads(self.missing_suggestions) if self.missing_suggestions else [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Skill(Base):
    """技能模板：可复用的提示词模板，用户在聊天时引用"""
    __tablename__ = "skills"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(200), nullable=False, index=True)
    description = Column(Text, default="")
    prompt_template = Column(Text, nullable=False)  # 提示词模板，用 {topic} 占位用户输入
    is_global = Column(Integer, default=0)           # 1=全局技能（管理员创建）
    is_default = Column(Integer, default=0)          # 1=系统内置默认技能（不可删除）
    user_id = Column(Integer, nullable=True)  # 私人技能的所属用户
    created_by = Column(Integer, nullable=True)  # 创建者
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "prompt_template": self.prompt_template,
            "is_global": bool(self.is_global),
            "is_default": bool(self.is_default),
            "user_id": self.user_id,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class SystemConfig(Base):
    """系统运行时配置（键值对）"""
    __tablename__ = "system_config"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=False, default="")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "key": self.key,
            "value": self.value,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class LoginHistory(Base):
    """用户登录历史记录"""
    __tablename__ = "login_history"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    login_at = Column(DateTime, default=datetime.utcnow, index=True)
    ip_address_masked = Column(String(50), default="")
    location = Column(Text, default="")           # JSON: country, regionName, city, lat, lon, isp
    user_agent = Column(String(500), default="")
    success = Column(Integer, default=1)          # 1=成功  0=失败
    failure_reason = Column(String(200), default="")

    def to_dict(self) -> dict:
        import json
        return {
            "id": self.id,
            "user_id": self.user_id,
            "login_at": self.login_at.isoformat() if self.login_at else None,
            "ip_address_masked": self.ip_address_masked,
            "location": json.loads(self.location) if self.location else {},
            "user_agent": self.user_agent,
            "success": bool(self.success),
            "failure_reason": self.failure_reason,
        }
