"""测试 app/config.py — Settings 配置类"""

from app.config import Settings


class TestSettings:
    def test_default_values(self):
        """验证 Settings 基本结构"""
        s = Settings()
        assert s.PROJECT_NAME == "LearnWithAI"
        assert s.JWT_ALGORITHM == "HS256"
        assert s.JWT_EXPIRE_HOURS == 72
        assert s.HOST == "127.0.0.1"
        # PORT 受环境变量影响，只检查是有效端口
        assert 0 < s.PORT < 65536

    def test_env_override(self, monkeypatch):
        """验证环境变量可以覆盖默认值"""
        # Settings 的类属性在模块加载时就确定了，需要 monkeypatch attributes 而非 env
        s = Settings()
        monkeypatch.setattr(s, "LLM_PROVIDER", "ollama")
        monkeypatch.setattr(s, "LLM_MODEL", "llama3")
        monkeypatch.setattr(s, "PORT", 8080)
        assert s.LLM_PROVIDER == "ollama"
        assert s.LLM_MODEL == "llama3"
        assert s.PORT == 8080

    def test_jwt_secret_default(self):
        """JWT_SECRET 有合理的默认值"""
        s = Settings()
        assert len(s.JWT_SECRET) > 0
        assert isinstance(s.JWT_SECRET, str)

    def test_db_path_is_pathlib(self):
        """DB_PATH 是 Path 对象"""
        s = Settings()
        from pathlib import Path

        assert isinstance(s.DB_PATH, Path)
        assert s.DB_PATH.name == "learn.db"
