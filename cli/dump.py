#!/usr/bin/env python3
"""
LearnWithAI 数据导出工具

将当前数据库所有表导出为 SQL INSERT 语句，方便跨库迁移或备份。

用法:
    # 默认导出到 stdout
    python cli/dump.py

    # 指定输出文件
    python cli/dump.py -o backup.sql

    # 使用 MySQL 数据库导出
    DATABASE_URL=mysql+pymysql://user:pass@localhost/dbname python cli/dump.py -o backup.sql
"""
import argparse
import logging
import sys
from datetime import date, datetime
from pathlib import Path

# 将项目根目录加入 sys.path，确保能导入 app 模块
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect as sa_inspect, text

from app.database import engine, get_db_type, DATABASE_URL

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("dump")

# 表导出顺序：必须满足外键依赖（父表在前）
TABLE_ORDER = [
    "users",
    "areas",
    "area_notes",
    "note_embeddings",
    "chat_messages",
    "learning_sessions",
    "usage_logs",
]


def _format_value(value):
    """将 Python 值转为 SQL 字面量"""
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        # LargeBinary → hex 编码，兼容 SQLite 和 MySQL
        return f"X'{value.hex()}'"
    if isinstance(value, (datetime, date)):
        return f"'{value.strftime('%Y-%m-%d %H:%M:%S')}'"
    if isinstance(value, (int, float)):
        return str(value)
    # 字符串：转义单引号（双写）
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def dump(output_file: str | None = None):
    """导出所有表为 SQL 语句"""
    inspector = sa_inspect(engine)
    existing_tables = set(inspector.get_table_names())

    out = sys.stdout if output_file is None else open(output_file, "w", encoding="utf-8")
    try:
        _write(out, f"-- LearnWithAI Database Dump\n")
        _write(out, f"-- Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        _write(out, f"-- Database: {get_db_type()}\n")
        _write(out, f"-- URL: {DATABASE_URL}\n\n")

        _write(out, "BEGIN TRANSACTION;\n\n")

        total_rows = 0
        with engine.connect() as conn:
            for table_name in TABLE_ORDER:
                if table_name not in existing_tables:
                    log.warning("跳过不存在的表: %s", table_name)
                    continue

                columns = [col["name"] for col in inspector.get_columns(table_name)]
                col_list = ", ".join(columns)

                _write(out, f"-- Table: {table_name}\n")

                result = conn.execute(text(f"SELECT * FROM {table_name}"))
                rows = result.fetchall()

                for row in rows:
                    values = ", ".join(_format_value(v) for v in row)
                    _write(out, f"INSERT INTO {table_name} ({col_list}) VALUES ({values});\n")
                    total_rows += 1

                _write(out, "\n")

        _write(out, "COMMIT;\n")
        log.info("✅ 导出完成：共 %d 条记录", total_rows)
    finally:
        if output_file is not None:
            out.close()


def _write(fp, text: str):
    fp.write(text)


def main():
    parser = argparse.ArgumentParser(description="LearnWithAI 数据库导出工具")
    parser.add_argument("-o", "--output", help="输出文件路径（默认 stdout）")
    args = parser.parse_args()
    dump(args.output)


if __name__ == "__main__":
    main()
