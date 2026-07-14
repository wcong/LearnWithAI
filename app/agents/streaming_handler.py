"""流式回调处理器 - 将 LLM 的实时 token 输出推送到 asyncio.Queue"""

import asyncio
from langchain_core.callbacks import BaseCallbackHandler


class StreamEvent:
    """SSE 事件类型常量"""
    THINKING = "thinking"
    TOOL_CALL = "tool_call"
    RESULT = "result"
    ERROR = "error"
    DONE = "done"


class StreamingCallbackHandler(BaseCallbackHandler):
    """LangChain 回调处理器，捕获 LLM 的实时 tokens 推送到 asyncio.Queue

    注意：本处理器不会往 Queue 中放 "done" 哨兵值。
    "done" 信号由调用者在 Agent 执行完毕后主动发送。
    这是因为 Agent 可能多次调用 LLM（例如工具调用场景），
    on_llm_end 在每次 LLM 调用后都会触发，会导致过早中断流。
    """

    def __init__(self, queue: asyncio.Queue):
        self.queue = queue

    async def on_llm_new_token(self, token: str, **kwargs) -> None:
        """捕获每个新生成的 token"""
        if token:
            await self.queue.put(("thinking", token))

    async def on_llm_error(self, error: Exception, **kwargs) -> None:
        """LLM 发生错误"""
        await self.queue.put(("error", str(error)))

    async def on_tool_start(self, serialized, input_str, **kwargs) -> None:
        """Agent 开始调用工具"""
        tool_name = serialized.get("name", "unknown_tool")
        await self.queue.put(("tool_call", f"🔧 调用工具: {tool_name}({input_str})"))

    async def on_tool_end(self, output, **kwargs) -> None:
        """Agent 工具调用结束"""
        await self.queue.put(("tool_call", f"✅ 工具执行完成\n"))
