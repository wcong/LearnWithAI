#!/usr/bin/env python3
"""
LearnWithAI 数据导入工具

从 dump.py 导出的 SQL 文件恢复数据到当前数据库。

用法:
    python cli/import_data.py -i backup.sql

    # 指定 MySQL 目标数据库
    DATABASE_URL=mysql+pymysql://user:pass@localhost/dbname python cli/import_data.py -i backup.sql

注意：
    - 目标数据库应为空表（有数据时可能因主键冲突而失败）
    - 导入顺序与导出时一致，按外键依赖逐表插入
"""
import argparse
import logging
import sys
from pathlib import Path

# 将项目根目录加入 sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text

from app.database import engine, get_db_type, DATABASE_URL

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("import_data")


def import_sql(input_file: str):
    """读取 SQL 文件并逐条执行 INSERT 语句"""
    if not Path(input_file).exists():
        log.error("文件不存在: %s", input_file)
        sys.exit(1)

    log.info("📥 目标数据库: %s | %s", get_db_type(), DATABASE_URL)
    log.info("📄 读取文件: %s", input_file)

    with open(input_file, "r", encoding="utf-8") as f:
        content = f.read()

    # 按分号切分为独立语句
    statements = [s.strip() for s in content.split(";") if s.strip()]

    # 过滤掉注释行和 BEGIN/COMMIT 等控制语句
    insert_count = 0
    with engine.begin() as conn:
        # MySQL：临时禁用外键检查（areas 表有自引用 parent_id）
        if get_db_type() == "MySQL":
            conn.execute(text("SET FOREIGN_KEY_CHECKS = 0;"))

        for raw_stmt in statements:
            # 跳过元语句
            upper = raw_stmt.upper()
            if any(
                kw in upper
                for kw in [
                    "BEGIN TRANSACTION",
                    "COMMIT",
                    "BEGIN",
                    "ROLLBACK",
                ]
            ):
                continue
            # 跳过纯注释行
            if raw_stmt.startswith("--"):
                continue

            try:
                conn.execute(text(raw_stmt + ";"))
                if raw_stmt.upper().startswith("INSERT"):
                    insert_count += 1
            except Exception as e:
                log.error("执行失败: %s", raw_stmt[:120])
                log.error("错误: %s", e)
                raise

        # MySQL：重新启用外键检查
        if get_db_type() == "MySQL":
            conn.execute(text("SET FOREIGN_KEY_CHECKS = 1;"))

    log.info("✅ 导入完成：共执行 %d 条 INSERT 语句", insert_count)


def main():
    parser = argparse.ArgumentParser(description="LearnWithAI 数据导入工具")
    parser.add_argument("-i", "--input", required=True, help="要导入的 SQL 文件路径")
    args = parser.parse_args()
    import_sql(args.input)


if __name__ == "__main__":
    main()
