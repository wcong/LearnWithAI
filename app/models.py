"""数据模型"""
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, LargeBinary
from sqlalchemy.orm import relationship, backref

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(256), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    areas = relationship("Area", back_populates="user", cascade="all, delete-orphan")

    def to_dict(self) -> dict:
        return {"id": self.id, "username": self.username,
                "created_at": self.created_at.isoformat() if self.created_at else None}


class Area(Base):
    __tablename__ = "areas"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False, index=True)
    description = Column(Text, default="")
    parent_id = Column(Integer, ForeignKey("areas.id"), nullable=True)
    order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 用户
    user = relationship("User", back_populates="areas")

    # 树关系（自引用：remote_side 放在 parent 侧）
    parent = relationship("Area", remote_side=[id],
                          backref=backref("children", order_by="Area.order"))
    chat_messages = relationship("ChatMessage", back_populates="area",
                                 cascade="all, delete-orphan")
    sessions = relationship("LearningSession", back_populates="area",
                            cascade="all, delete-orphan")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "parent_id": self.parent_id,
            "order": self.order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def to_tree(self) -> dict:
        """返回节点及其子节点构成的树"""
        node = self.to_dict()
        node["children"] = [c.to_tree() for c in self.children]
        return node


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # user / assistant
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    area = relationship("Area", back_populates="chat_messages")

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
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False, unique=True, index=True)
    content = Column(Text, default="")  # HTML 格式
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    area = relationship("Area", backref=backref("note", uselist=False, cascade="all, delete-orphan"))

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
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False, index=True)
    chunk_text = Column(Text, nullable=False)
    embedding = Column(LargeBinary, nullable=True)  # numpy float32 序列化
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    area = relationship("Area")

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
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False, index=True)
    summary = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    area = relationship("Area", back_populates="sessions")

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
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False, index=True)
    message_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=True)
    model = Column(String(100), default="")
    provider = Column(String(50), default="")
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    duration_ms = Column(Integer, default=0)  # 请求耗时
    created_at = Column(DateTime, default=datetime.utcnow)

    area = relationship("Area")

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
