"""测试 app/agents/streaming_handler.py — 流式回调处理器"""

import asyncio

from app.agents.streaming_handler import (
    StreamingCallbackHandler,
    StreamEvent,
)


class TestStreamingCallbackHandler:
    def test_on_llm_new_token(self):
        """on_llm_new_token 推送 thinking 事件"""
        queue = asyncio.Queue()
        handler = StreamingCallbackHandler(queue)
        asyncio.run(handler.on_llm_new_token("Hello"))
        event_type, data = queue.get_nowait()
        assert event_type == StreamEvent.THINKING
        assert data == "Hello"

    def test_on_llm_new_token_empty(self):
        """空 token 不推送"""
        queue = asyncio.Queue()
        handler = StreamingCallbackHandler(queue)
        asyncio.run(handler.on_llm_new_token(""))
        assert queue.empty()

    def test_on_llm_error(self):
        """on_llm_error 推送 error 事件"""
        queue = asyncio.Queue()
        handler = StreamingCallbackHandler(queue)
        asyncio.run(handler.on_llm_error(ValueError("API 错误")))
        event_type, data = queue.get_nowait()
        assert event_type == StreamEvent.ERROR
        assert "API 错误" in data

    def test_on_tool_start(self):
        """on_tool_start 推送 tool_call 事件"""
        queue = asyncio.Queue()
        handler = StreamingCallbackHandler(queue)
        asyncio.run(
            handler.on_tool_start(
                serialized={"name": "search_tool"},
                input_str="query=AI",
            )
        )
        event_type, data = queue.get_nowait()
        assert event_type == StreamEvent.TOOL_CALL
        assert "search_tool" in data

    def test_on_tool_end(self):
        """on_tool_end 推送 tool_call 事件"""
        queue = asyncio.Queue()
        handler = StreamingCallbackHandler(queue)
        asyncio.run(handler.on_tool_end(output="结果"))
        event_type, data = queue.get_nowait()
        assert event_type == StreamEvent.TOOL_CALL

    def test_queue_multiple_tokens(self):
        """多个 token 依次推送"""
        queue = asyncio.Queue()
        handler = StreamingCallbackHandler(queue)

        async def push_tokens():
            for token in ["A", "B", "C"]:
                await handler.on_llm_new_token(token)

        asyncio.run(push_tokens())
        assert queue.qsize() == 3
        for expected in ["A", "B", "C"]:
            _, data = queue.get_nowait()
            assert data == expected
