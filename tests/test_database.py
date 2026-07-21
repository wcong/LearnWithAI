"""测试 app/database.py — 数据库引擎和初始化"""

from app.database import _get_database_url


class TestDatabaseUtils:
    def test_get_database_url_sqlite(self, monkeypatch):
        """默认返回 sqlite:/// 路径"""
        from app.config import settings as cfg

        monkeypatch.setattr(cfg, "DATABASE_URL", "")
        url = _get_database_url()
        assert url.startswith("sqlite:///")

    def test_get_database_url_mysql(self, monkeypatch):
        """当 DATABASE_URL 为 MySQL 时返回 MySQL URL"""
        from app.config import settings as cfg

        monkeypatch.setattr(
            cfg, "DATABASE_URL", "mysql+pymysql://user:pass@localhost/db"
        )
        url = _get_database_url()
        assert url.startswith("mysql+pymysql://")

    def test_db_type_label(self, monkeypatch):
        """数据库类型标签"""
        from app.database import get_db_type, DATABASE_URL

        # DATABASE_URL 是模块级常量，需 monkeypatch 模块属性
        monkeypatch.setattr("app.database.DATABASE_URL", "sqlite:///test.db")
        assert get_db_type() == "SQLite"

        monkeypatch.setattr("app.database.DATABASE_URL", "mysql+pymysql://u:p@h/db")
        assert get_db_type() == "MySQL"
