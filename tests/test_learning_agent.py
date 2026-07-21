"""测试 app/agents/learning_agent.py — 工具函数（不依赖 LLM）"""

import json

from app.agents.learning_agent import (
    _parse_llm_json,
    _build_children_context,
    extract_usage,
    _get_chat_messages_text,
)


class TestParseLlmJson:
    def test_parse_plain_json(self):
        """解析纯 JSON 字符串"""
        text = '{"name": "test", "value": 42}'
        result = _parse_llm_json(text)
        assert result == {"name": "test", "value": 42}

    def test_parse_code_block(self):
        """解析代码块包裹的 JSON"""
        text = '```json\n{"name": "test"}\n```'
        result = _parse_llm_json(text)
        assert result == {"name": "test"}

    def test_parse_code_block_no_lang(self):
        """解析无语言标记的代码块"""
        text = '```\n{"name": "test"}\n```'
        result = _parse_llm_json(text)
        assert result == {"name": "test"}

    def test_parse_invalid_text(self):
        """非法文本返回 None"""
        text = "这不是 JSON"
        assert _parse_llm_json(text) is None

    def test_parse_mixed_text_with_json(self):
        """混合文本中包含 JSON 代码块"""
        text = "分析结果如下：\n```json\n{\"summary\": \"结果\"}\n```\n以上为结果。"
        result = _parse_llm_json(text)
        assert result == {"summary": "结果"}


class TestBuildChildrenContext:
    def test_empty_list(self):
        """空列表返回空字符串"""
        assert _build_children_context([]) == ""

    def test_with_analyses(self):
        """有子领域分析时生成上下文"""
        analyses = [
            {
                "name": "NLP",
                "summary": "自然语言处理",
                "sub_area_summaries": [
                    {"name": "文本分类", "summary": "分类任务"}
                ],
                "missing_suggestions": [
                    {"name": "机器翻译", "reason": "重要方向"}
                ],
            }
        ]
        context = _build_children_context(analyses)
        assert "NLP" in context
        assert "自然语言处理" in context
        assert "文本分类" in context
        assert "机器翻译" in context


class TestGetChatMessagesText:
    def test_no_messages(self, db_session, test_area):
        """无消息时返回空字符串"""
        text = _get_chat_messages_text(db_session, test_area.id)
        assert text == ""

    def test_with_messages(self, db_session, test_area):
        """有消息时格式化输出"""
        from app.models import ChatMessage

        db_session.add_all([
            ChatMessage(area_id=test_area.id, role="user", content="你好"),
            ChatMessage(area_id=test_area.id, role="assistant", content="你好！有什么可以帮助你的？"),
        ])
        db_session.commit()

        text = _get_chat_messages_text(db_session, test_area.id)
        assert "用户" in text
        assert "你好" in text


class TestExtractUsage:
    def test_without_metadata(self):
        """无 usage_metadata 时返回默认值"""
        from unittest.mock import MagicMock

        msg = MagicMock()
        msg.usage_metadata = None
        msg.response_metadata = {}

        llm = MagicMock()
        llm.model_name = "gpt-4"

        usage = extract_usage(msg, llm, 500)
        assert usage["model"] == "gpt-4"
        assert usage["provider"] == "openai"
        assert usage["duration_ms"] == 500
        assert usage["total_tokens"] == 0

    def test_with_usage_metadata(self):
        """有 usage_metadata 时正确提取"""
        from unittest.mock import MagicMock

        um = MagicMock()
        um.input_tokens = 10
        um.output_tokens = 20
        um.total_tokens = 30

        msg = MagicMock()
        msg.usage_metadata = um

        llm = MagicMock()
        llm.model_name = "gpt-4"

        usage = extract_usage(msg, llm, 200)
        assert usage["prompt_tokens"] == 10
        assert usage["completion_tokens"] == 20
        assert usage["total_tokens"] == 30
        assert usage["duration_ms"] == 200

    def test_with_response_metadata(self):
        """通过 response_metadata 提取用量（OpenAI 格式）"""
        from unittest.mock import MagicMock

        msg = MagicMock()
        msg.usage_metadata = None
        msg.response_metadata = {
            "token_usage": {
                "prompt_tokens": 50,
                "completion_tokens": 100,
                "total_tokens": 150,
            }
        }

        llm = MagicMock()
        llm.model_name = "claude-3"

        usage = extract_usage(msg, llm, 300)
        assert usage["prompt_tokens"] == 50
        assert usage["completion_tokens"] == 100
        assert usage["total_tokens"] == 150
