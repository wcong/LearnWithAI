"""公共工具函数"""
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Area, SystemConfig, UsageLog


def check_daily_token_limit(user_id: int, db: Session) -> dict | None:
    """检查用户当日免费 token 额度是否用尽。
    若超限返回 dict 包含用量详情（字段值均为 int），否则返回 None。"""
    # 读取限额配置
    input_limit_conf = db.query(SystemConfig).filter(
        SystemConfig.key == "daily_token_input_limit"
    ).first()
    output_limit_conf = db.query(SystemConfig).filter(
        SystemConfig.key == "daily_token_output_limit"
    ).first()

    input_limit = int(input_limit_conf.value) if input_limit_conf else 200000
    output_limit = int(output_limit_conf.value) if output_limit_conf else 200000

    # 查询当日已用 token（通过 area 关联用户）
    today = datetime.utcnow().date()
    day_start = datetime.combine(today, datetime.min.time())
    day_end = day_start + timedelta(days=1)
    usage = (
        db.query(
            func.coalesce(func.sum(UsageLog.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(UsageLog.completion_tokens), 0).label("completion_tokens"),
        )
        .join(Area, UsageLog.area_id == Area.id)
        .filter(Area.user_id == user_id)
        .filter(UsageLog.created_at >= day_start)
        .filter(UsageLog.created_at < day_end)
        .first()
    )

    # int() 确保 Decimal 等类型转为 JSON 可序列化的 int
    used_prompt = int(usage.prompt_tokens) if usage else 0
    used_completion = int(usage.completion_tokens) if usage else 0

    if used_prompt >= input_limit or used_completion >= output_limit:
        return {
            "exceeded": True,
            "used_prompt": used_prompt,
            "used_completion": used_completion,
            "limit_prompt": input_limit,
            "limit_output": output_limit,
        }
    return None
