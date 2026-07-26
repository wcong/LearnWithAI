"""Langfuse 可观测性回调处理器工厂

提供 create_langfuse_handler() 工厂函数，在路由层创建带用户/会话上下文的
Langfuse CallbackHandler。未配置时优雅降级返回 None。
"""
import logging

log = logging.getLogger("learnwithai")


def create_langfuse_handler(
    user_id: str | int = "",
    session_id: str = "",
    tags: list[str] | None = None,
    trace_name: str = "",
) -> object:
    """创建带上下文的 Langfuse CallbackHandler。

    如果 LANGFUSE_SECRET_KEY 未配置，返回 None。
    该 Handler 通过 LangChain config={"callbacks": [handler]} 传递给 Agent/LLM 的 invoke。

    Args:
        user_id: 用户标识，用于 Langfuse 用户级分析
        session_id: 会话标识，将多次请求关联到同一会话
        tags: 过滤标签，如 ["area:123", "chat"]
        trace_name: Trace 名称，默认为 "langchain-trace"

    Returns:
        CallbackHandler 实例，或 None（未配置 / 初始化失败时）
    """
    from app.config import settings

    if not settings.LANGFUSE_SECRET_KEY:
        return None

    try:
        from langfuse import get_client
        from langfuse.langchain import CallbackHandler

        # get_client() 是懒加载单例，首次调用时会从环境变量读取配置
        _client = get_client()

        handler = CallbackHandler(
            user_id=str(user_id),
            session_id=session_id or None,
            tags=tags or [],
            trace_name=trace_name or None,
        )

        log.info(
            "Langfuse handler 已创建: user_id=%s, session_id=%s, tags=%s, trace=%s",
            user_id, session_id, tags, trace_name,
        )
        return handler

    except Exception as e:
        log.warning("Langfuse handler 创建失败（已降级）: %s", e)
        return None
