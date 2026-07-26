"""管理员统计面板 API"""
import sqlite3
from collections.abc import Generator
from datetime import date, datetime
from pathlib import Path
from typing import Any

import msgpack
from fastapi import HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, text
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import User, Area, ChatMessage, UsageLog, SystemConfig

router = APIRouter(prefix="/api/admin", tags=["Admin"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    """检查当前用户是否为配置的管理员（支持 username 和 email）"""
    if user.username == settings.ADMIN_USERNAME:
        return user
    if settings.ADMIN_EMAIL and user.email == settings.ADMIN_EMAIL:
        return user
    raise HTTPException(403, "仅管理员可访问")


class ConfigUpdateRequest(BaseModel):
    daily_token_input_limit: str | None = None
    daily_token_output_limit: str | None = None


@router.get("/check")
def check_admin(user: User = Depends(get_current_user)):
    """轻量检查当前用户是否为管理员（供前端判断是否显示管理入口）"""
    is_admin = False
    if user.username == settings.ADMIN_USERNAME:
        is_admin = True
    if not is_admin and settings.ADMIN_EMAIL and user.email == settings.ADMIN_EMAIL:
        is_admin = True
    return {"is_admin": is_admin, "username": user.username}


@router.get("/stats")
def get_admin_stats(db: Session = Depends(get_db),
                    _user: User = Depends(require_admin)):
    """返回全平台统计数据：用户维度和全局汇总"""

    # —— 全局汇总 ——
    total_users = db.query(func.count(User.id)).scalar() or 0
    total_areas = db.query(func.count(Area.id)).scalar() or 0
    total_messages = db.query(func.count(ChatMessage.id)).scalar() or 0

    total_prompt = db.query(func.coalesce(func.sum(UsageLog.prompt_tokens), 0)).scalar() or 0
    total_completion = db.query(func.coalesce(func.sum(UsageLog.completion_tokens), 0)).scalar() or 0
    total_tokens = db.query(func.coalesce(func.sum(UsageLog.total_tokens), 0)).scalar() or 0

    # —— 每个用户维度 ——
    users_rows = (
        db.query(
            User.id,
            User.username,
            func.count(func.distinct(Area.id)).label("area_count"),
            func.count(func.distinct(ChatMessage.id)).label("message_count"),
            func.coalesce(func.sum(UsageLog.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(UsageLog.completion_tokens), 0).label("completion_tokens"),
            func.coalesce(func.sum(UsageLog.total_tokens), 0).label("total_tokens"),
        )
        .outerjoin(Area, Area.user_id == User.id)
        .outerjoin(ChatMessage, ChatMessage.area_id == Area.id)
        .outerjoin(UsageLog, UsageLog.area_id == Area.id)
        .group_by(User.id)
        .order_by(User.id)
        .all()
    )

    users_data = [
        {
            "id": uid,
            "username": uname,
            "area_count": ac,
            "message_count": mc,
            "prompt_tokens": pt,
            "completion_tokens": ct,
            "total_tokens": tt,
        }
        for uid, uname, ac, mc, pt, ct, tt in users_rows
    ]

    return {
        "summary": {
            "total_users": total_users,
            "total_areas": total_areas,
            "total_messages": total_messages,
            "total_prompt_tokens": total_prompt,
            "total_completion_tokens": total_completion,
            "total_tokens": total_tokens,
        },
        "users": users_data,
    }


@router.get("/daily-usage")
def get_daily_usage(date_str: str = Query(default=None, alias="date", description="日期 YYYY-MM-DD，默认今天"),
                    db: Session = Depends(get_db),
                    _user: User = Depends(require_admin)):
    """获取指定日期每个用户的 token 使用量"""
    target_date: date
    if date_str:
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "日期格式错误，请使用 YYYY-MM-DD")
    else:
        target_date = datetime.utcnow().date()

    from datetime import timedelta
    day_start = datetime.combine(target_date, datetime.min.time())
    day_end = day_start + timedelta(days=1)

    rows = (
        db.query(
            User.id,
            User.username,
            func.coalesce(func.sum(UsageLog.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(UsageLog.completion_tokens), 0).label("completion_tokens"),
            func.coalesce(func.sum(UsageLog.total_tokens), 0).label("total_tokens"),
        )
        .outerjoin(Area, Area.user_id == User.id)
        .outerjoin(UsageLog, UsageLog.area_id == Area.id)
        .filter(UsageLog.created_at >= day_start)
        .filter(UsageLog.created_at < day_end)
        .group_by(User.id)
        .order_by(User.id)
        .all()
    )

    users_data = [
        {
            "user_id": uid,
            "username": uname,
            "prompt_tokens": pt,
            "completion_tokens": ct,
            "total_tokens": tt,
        }
        for uid, uname, pt, ct, tt in rows
    ]

    return {
        "date": target_date.isoformat(),
        "users": users_data,
    }


@router.get("/config")
def get_config(_user: User = Depends(require_admin),
               db: Session = Depends(get_db)):
    """获取所有系统配置（键值对）"""
    configs = db.query(SystemConfig).all()
    return {c.key: c.value for c in configs}


@router.put("/config")
def update_config(req: ConfigUpdateRequest,
                  _user: User = Depends(require_admin),
                  db: Session = Depends(get_db)):
    """更新系统配置（运行时生效，无需重启）"""
    updates = {}
    if req.daily_token_input_limit is not None:
        updates["daily_token_input_limit"] = req.daily_token_input_limit
    if req.daily_token_output_limit is not None:
        updates["daily_token_output_limit"] = req.daily_token_output_limit

    for key, value in updates.items():
        config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
        if config:
            config.value = value
            config.updated_at = datetime.utcnow()
        else:
            db.add(SystemConfig(key=key, value=value))

    db.commit()
    return {"ok": True, **updates}


# ── 检查点数据库连接（支持 MySQL / SQLite 双后端） ──────────────


def _open_checkpoint_db() -> tuple[Any, str] | tuple[None, None]:
    """打开检查点数据库连接，返回 (conn, db_type)

    根据 settings.PLAN_CHECKPOINT_DB_URL 决定后端：
      - 有值 → MySQL（通过 pymysql）
      - 无值 → SQLite fallback
    """
    url = settings.PLAN_CHECKPOINT_DB_URL
    if url:
        import pymysql
        from urllib.parse import urlparse

        parsed = urlparse(url)
        conn = pymysql.connect(
            host=parsed.hostname or "localhost",
            port=parsed.port or 3306,
            user=parsed.username or "root",
            password=parsed.password or "",
            database=parsed.path.lstrip("/"),
            charset="utf8mb4",
        )
        return conn, "mysql"
    # SQLite fallback
    cp_path = Path(settings.DB_PATH).parent / "plan_checkpoints.db"
    if not cp_path.exists():
        return None, None
    conn = sqlite3.connect(str(cp_path))
    return conn, "sqlite"


def _writes_table(db_type: str) -> str:
    """返回 writes 表名：MySQL 用 checkpoint_writes，SQLite 用 writes"""
    return "checkpoint_writes" if db_type == "mysql" else "writes"


def _writes_value_col(db_type: str) -> str:
    """返回 writes 表 value 列名：MySQL 用 `blob`（保留字），SQLite 用 value"""
    return "`blob`" if db_type == "mysql" else "value"


def _decode_checkpoint_blob(db_type: str, data) -> dict:
    """解码 checkpoints 表的 checkpoint 列：
       MySQL: JSON 类型 → json.loads
       SQLite: BLOB → msgpack.unpackb → json"""
    if data is None:
        return {}
    try:
        if db_type == "mysql":
            raw = json.loads(data) if isinstance(data, str) else data
        else:
            raw = msgpack.unpackb(data)
        if isinstance(raw, dict):
            cv = raw.get("channel_values", {})
            sanitized = {}
            for k, v in cv.items():
                try:
                    json.dumps(v)
                    sanitized[k] = v
                except (TypeError, OverflowError):
                    sanitized[k] = repr(v)
            return sanitized
    except Exception:
        pass
    return {"_error": "解码失败"}


def _decode_metadata_blob(db_type: str, data) -> dict:
    """解码 checkpoints 表的 metadata 列：
       MySQL: JSON 类型 → json.loads
       SQLite: BLOB → bytes → json.loads"""
    if data is None:
        return {}
    try:
        if db_type == "mysql":
            return json.loads(data) if isinstance(data, str) else data
        else:
            return json.loads(data.decode("utf-8"))
    except Exception:
        return {"_error": "metadata 解码失败"}


def _adapt_sql(sql: str, db_type: str) -> str:
    """适配 SQL 参数占位符：SQLite ? → MySQL %s"""
    return sql.replace("?", "%s") if db_type == "mysql" else sql


def _exec(cur, db_type: str, sql: str, params: tuple = ()):
    """统一执行 SQL（自动适配参数风格）"""
    cur.execute(_adapt_sql(sql, db_type), params)


def _fetchall(cur, db_type: str, sql: str, params: tuple = ()):
    """统一查询并 fetchall"""
    _exec(cur, db_type, sql, params)
    return cur.fetchall()


def _get_latest_state(thread_id: str, channel: str, db_type: str, cur) -> Any:
    """从 writes 表获取指定 thread 的某个 channel 最新值"""
    wt = _writes_table(db_type)
    wv = _writes_value_col(db_type)
    try:
        rows = _fetchall(
            cur, db_type,
            f"SELECT {wv} FROM {wt} WHERE thread_id = ? AND channel = ? "
            "ORDER BY checkpoint_id DESC LIMIT 1",
            (thread_id, channel),
        )
        if rows and rows[0]:
            return msgpack.unpackb(rows[0][0] if isinstance(rows[0], (tuple, list)) else rows[0][0])
    except Exception:
        pass
    return None


# ── API 端点 ──────────────────────────────────────────────────


@router.get("/plan-runs")
def get_plan_runs(db: Session = Depends(get_db),
                  _user: User = Depends(require_admin)):
    """从检查点数据库读取所有 Plan 运行记录（支持 MySQL / SQLite）

    检查点数据库存有每个 Plan 运行线程的完整状态数据（topic, total_areas,
    total_messages, max_depth, overview 等），通过 msgpack 解码后返回。
    """
    conn, db_type = _open_checkpoint_db()
    if conn is None:
        return []

    user_cache: dict[int, str] = {}

    def _get_username(uid: int) -> str:
        if uid not in user_cache:
            u = db.query(User).filter(User.id == uid).first()
            user_cache[uid] = u.username if u else f"user_{uid}"
        return user_cache[uid]

    try:
        cur = conn.cursor()
        wt = _writes_table(db_type)
        wv = _writes_value_col(db_type)

        # 获取所有 thread 及 steps
        rows = _fetchall(cur, db_type,
            f"SELECT thread_id, COUNT(DISTINCT checkpoint_id) AS steps "
            f"FROM {wt} GROUP BY thread_id ORDER BY thread_id")
        thread_steps = {}
        for r in rows:
            thread_steps[str(r[0])] = int(r[1])

        # 每个 thread 的最新 result
        rows = _fetchall(cur, db_type,
            f"SELECT w1.thread_id, w1.{wv} "
            f"FROM {wt} w1 INNER JOIN ("
            f"  SELECT thread_id, MAX(checkpoint_id) AS max_cp "
            f"  FROM {wt} WHERE channel = 'result' GROUP BY thread_id"
            f") w2 ON w1.thread_id = w2.thread_id AND w1.checkpoint_id = w2.max_cp")
        results = {}
        for r in rows:
            tid = str(r[0])
            val_blob = r[1]
            if val_blob:
                try:
                    results[tid] = msgpack.unpackb(val_blob)
                except Exception:
                    results[tid] = {}

        # 每个 thread 最新的 overview
        rows = _fetchall(cur, db_type,
            f"SELECT w1.thread_id, w1.{wv} "
            f"FROM {wt} w1 INNER JOIN ("
            f"  SELECT thread_id, MAX(checkpoint_id) AS max_cp "
            f"  FROM {wt} WHERE channel = 'overview' GROUP BY thread_id"
            f") w2 ON w1.thread_id = w2.thread_id AND w1.checkpoint_id = w2.max_cp")
        overviews = {}
        for r in rows:
            tid = str(r[0])
            val_blob = r[1]
            if val_blob:
                try:
                    val = msgpack.unpackb(val_blob)
                    if isinstance(val, str):
                        overviews[tid] = val[:200] + ("..." if len(val) > 200 else "")
                except Exception:
                    pass

        # 每个 thread 最新的 finished 状态
        rows = _fetchall(cur, db_type,
            f"SELECT w1.thread_id, w1.{wv} "
            f"FROM {wt} w1 INNER JOIN ("
            f"  SELECT thread_id, MAX(checkpoint_id) AS max_cp "
            f"  FROM {wt} WHERE channel = 'finished' GROUP BY thread_id"
            f") w2 ON w1.thread_id = w2.thread_id AND w1.checkpoint_id = w2.max_cp")
        finished_map = {}
        for r in rows:
            tid = str(r[0])
            val_blob = r[1]
            if val_blob:
                try:
                    finished_map[tid] = msgpack.unpackb(val_blob)
                except Exception:
                    pass

        runs = []
        for thread_id in sorted(thread_steps.keys(), reverse=True):
            parts = thread_id.split("_")
            uid = int(parts[1]) if len(parts) >= 3 else 0
            start_ts = int(parts[2]) if len(parts) >= 3 else 0
            start_time = datetime.utcfromtimestamp(start_ts).strftime(
                "%Y-%m-%d %H:%M:%S"
            ) if start_ts else None

            result = results.get(thread_id)
            if not isinstance(result, dict):
                result = {}

            topic = result.get("name") or ""
            total_areas = result.get("total_areas") or 0
            total_messages = result.get("total_messages") or 0
            max_depth = result.get("max_depth") or 0
            root_area_id = result.get("root_area_id")
            fin = result.get("finished")

            # fallback: 从 state channel 补充
            if not topic:
                val = _get_latest_state(thread_id, "current_area_name", db_type, cur)
                topic = str(val) if isinstance(val, str) else ""
            if not total_areas:
                val = _get_latest_state(thread_id, "total_areas", db_type, cur)
                total_areas = val if isinstance(val, (int, float)) else 0
            if not total_messages:
                val = _get_latest_state(thread_id, "total_messages", db_type, cur)
                total_messages = val if isinstance(val, (int, float)) else 0
            if not max_depth:
                val = _get_latest_state(thread_id, "current_depth", db_type, cur)
                max_depth = val if isinstance(val, (int, float)) else 0
            if not isinstance(fin, bool):
                val = _get_latest_state(thread_id, "finished", db_type, cur)
                fin = val if isinstance(val, bool) else False

            overview_raw = overviews.get(thread_id)
            overview = str(overview_raw) if isinstance(overview_raw, str) else ""
            steps = thread_steps.get(thread_id, 0)

            runs.append({
                "thread_id": thread_id,
                "user_id": uid,
                "username": _get_username(uid),
                "start_time": start_time,
                "steps": steps,
                "topic": topic,
                "total_areas": int(total_areas),
                "total_messages": int(total_messages),
                "max_depth": int(max_depth),
                "root_area_id": root_area_id,
                "finished": bool(fin),
                "overview_preview": overview or "",
            })

        return runs

    finally:
        conn.close()


@router.get("/plan-checkpoints/{thread_id}")
def get_plan_checkpoint_detail(thread_id: str,
                               _user: User = Depends(require_admin)):
    """返回指定 thread 的完整检查点数据（checkpoints + writes 两表）

    支持 MySQL / SQLite 两种后端。
    """
    conn, db_type = _open_checkpoint_db()
    if conn is None:
        raise HTTPException(404, "检查点数据库不存在")

    try:
        cur = conn.cursor()

        # ── 1. 读取 checkpoints 表 ──
        rows = _fetchall(cur, db_type,
            "SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata "
            "FROM checkpoints WHERE thread_id = ? ORDER BY checkpoint_id",
            (thread_id,))
        checkpoints = []
        for cp_id, parent_cp_id, ctype, cp_data, meta_data in rows:
            channel_values = _decode_checkpoint_blob(db_type, cp_data)
            metadata = _decode_metadata_blob(db_type, meta_data)

            checkpoints.append({
                "checkpoint_id": cp_id,
                "parent_checkpoint_id": parent_cp_id,
                "type": ctype,
                "step": metadata.get("step", -1),
                "source": metadata.get("source", ""),
                "channel_values": channel_values,
                "metadata": metadata,
            })

        # ── 2. 读取 writes 表 ──
        wt = _writes_table(db_type)
        wv = _writes_value_col(db_type)
        rows = _fetchall(cur, db_type,
            f"SELECT checkpoint_id, task_id, channel, type, {wv} "
            f"FROM {wt} WHERE thread_id = ? ORDER BY checkpoint_id, task_id, idx",
            (thread_id,))
        writes = []
        for cp_id, task_id, channel, wtype, val_blob in rows:
            decoded = None
            if val_blob:
                try:
                    decoded = msgpack.unpackb(val_blob)
                    try:
                        json.dumps(decoded)
                    except (TypeError, OverflowError):
                        decoded = repr(decoded)
                except Exception:
                    decoded = "<msgpack 解码失败>"
            writes.append({
                "checkpoint_id": cp_id,
                "task_id": task_id,
                "channel": channel,
                "value": decoded,
            })

        return {
            "thread_id": thread_id,
            "checkpoints": checkpoints,
            "writes": writes,
        }
    finally:
        conn.close()
