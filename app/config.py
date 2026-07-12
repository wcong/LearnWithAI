"""应用配置"""
import os
from pathlib import Path

from dotenv import load_dotenv

# 从项目根目录加载 .env 文件（必须在 os.getenv 之前调用）
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


class Settings:
    PROJECT_NAME = "LearnWithAI"
    PROJECT_DESC = "AI辅助深度学习平台"

    # 数据库
    DB_PATH = Path(__file__).resolve().parent.parent / "data" / "learn.db"

    # LLM 配置（可通过环境变量覆盖）
    LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")  # openai / anthropic / ollama
    LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
    LLM_API_KEY = os.getenv("LLM_API_KEY", "")
    LLM_API_BASE = os.getenv("LLM_API_BASE", "")
    LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.7"))

    # JWT
    JWT_SECRET = os.getenv("JWT_SECRET", "learnwithai-dev-secret-change-in-prod")
    JWT_ALGORITHM = "HS256"
    JWT_EXPIRE_HOURS = 72

    # 服务
    HOST = os.getenv("HOST", "127.0.0.1")
    PORT = int(os.getenv("PORT", "7860"))


settings = Settings()
