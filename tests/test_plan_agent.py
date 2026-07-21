"""测试 app/agents/plan_agent.py — 核心 DB 操作函数"""

import asyncio

from app.agents.plan_agent import (
    _save_area,
    _save_message,
    _save_usage,
    _build_context_path,
    _push_event,
)


class TestSaveArea:
    def test_save_root(self):
        """创建根 Area"""
        area = _save_area(user_id=1, name="机器学习", description="ML", parent_id=None)
        assert area.id is not None
        assert area.name == "机器学习"
        assert area.parent_id is None

    def test_save_child(self):
        """创建子 Area"""
        parent = _save_area(user_id=1, name="父", description="", parent_id=None)
        child = _save_area(
            user_id=1, name="子", description="子领域", parent_id=parent.id
        )
        assert child.parent_id == parent.id


class TestSaveMessage:
    def test_save_message(self):
        """保存 ChatMessage"""
        area = _save_area(user_id=1, name="领域", description="", parent_id=None)
        msg = _save_message(area.id, "assistant", "领域概况内容")
        assert msg.id is not None
        assert msg.area_id == area.id
        assert msg.role == "assistant"
        assert msg.content == "领域概况内容"


class TestSaveUsage:
    def test_save_usage(self):
        """保存 UsageLog"""
        area = _save_area(user_id=1, name="领域", description="", parent_id=None)
        msg = _save_message(area.id, "assistant", "内容")
        usage = {
            "model": "gpt-4",
            "provider": "openai",
            "prompt_tokens": 10,
            "completion_tokens": 20,
            "total_tokens": 30,
            "duration_ms": 500,
        }
        # 不应抛异常
        _save_usage(area.id, msg.id, usage)


class TestBuildContextPath:
    def test_root_only(self):
        """根节点返回自身名称"""
        area = _save_area(user_id=1, name="AI", description="", parent_id=None)
        path = _build_context_path(area.id)
        assert path == "AI"

    def test_with_children(self):
        """子节点返回完整路径"""
        root = _save_area(user_id=1, name="AI", description="", parent_id=None)
        child = _save_area(
            user_id=1, name="NLP", description="", parent_id=root.id
        )
        path = _build_context_path(child.id)
        assert path == "AI → NLP"

    def test_deep_path(self):
        """深层节点返回完整路径"""
        root = _save_area(user_id=1, name="CS", description="", parent_id=None)
        child1 = _save_area(
            user_id=1, name="AI", description="", parent_id=root.id
        )
        child2 = _save_area(
            user_id=1, name="ML", description="", parent_id=child1.id
        )
        path = _build_context_path(child2.id)
        assert path == "CS → AI → ML"


class TestPushEvent:
    def test_push_event(self):
        """事件推送到队列"""
        queue = asyncio.Queue()

        async def push():
            await _push_event(queue, "progress", {"status": "测试"})

        asyncio.run(push())
        event_type, data = queue.get_nowait()
        assert event_type == "progress"
        assert data == {"status": "测试"}
