"""测试 app/rag/rag_engine.py — HTML 清洗及 RAG 引擎初始化"""

import numpy as np

from app.rag.rag_engine import clean_html, RAGEngine


class TestCleanHtml:
    def test_empty_string(self):
        """空字符串返回空"""
        assert clean_html("") == ""

    def test_none(self):
        """None 返回空"""
        assert clean_html(None) == ""

    def test_plain_text(self):
        """纯文本不受影响"""
        assert clean_html("Hello World") == "Hello World"

    def test_remove_html_tags(self):
        """移除 HTML 标签"""
        result = clean_html("<p>段落内容</p>")
        assert result == "段落内容"

    def test_block_tags_to_newline(self):
        """块级标签转换为换行"""
        result = clean_html("<p>第一段</p><p>第二段</p>")
        assert "第一段" in result
        assert "第二段" in result

    def test_remove_style_script(self):
        """移除 style 和 script 标签"""
        html = "<style>body {color: red}</style><p>内容</p><script>alert('x')</script>"
        result = clean_html(html)
        assert "color" not in result
        assert "alert" not in result
        assert "内容" in result

    def test_html_entities(self):
        """HTML 实体解码"""
        result = clean_html("<p>&amp; &lt; &gt;</p>")
        assert "&" in result
        assert "<" not in result  # 解码后为 < 但已被移除标签逻辑处理

    def test_nested_tags(self):
        """嵌套标签"""
        result = clean_html("<div><p><b>加粗</b>文本</p></div>")
        assert "加粗" in result
        assert "文本" in result

    def test_markdown_like_content(self):
        """Markdown 风格内容保持不变"""
        html = "<p># 标题</p><p>- 列表项</p>"
        result = clean_html(html)
        assert "# 标题" in result
        assert "- 列表项" in result


class TestRAGEngine:
    def test_engine_initialization(self):
        """引擎初始化"""
        engine = RAGEngine()
        assert engine._embeddings is None
        assert engine._text_splitter is not None

    def test_clean_html_method_available(self):
        """clean_html 函数可用"""
        result = clean_html("<p>测试</p>")
        assert result == "测试"

    def test_keyword_search_basic(self):
        """关键词降级搜索"""
        engine = RAGEngine()

        records = [
            type("Rec", (), {
                "chunk_text": "机器学习是人工智能的重要分支",
                "embedding": None,
                "area_id": 1,
            })(),
            type("Rec", (), {
                "chunk_text": "深度学习是机器学习的子领域",
                "embedding": None,
                "area_id": 1,
            })(),
            type("Rec", (), {
                "chunk_text": "Python 是一种编程语言",
                "embedding": None,
                "area_id": 2,
            })(),
        ]
        area_map = {1: "AI", 2: "编程"}

        results = engine._keyword_search("机器学习", records, area_map, top_k=5)
        assert len(results) == 2
        assert results[0]["area_name"] == "AI"
        assert results[0]["score"] > 0

    def test_keyword_search_empty(self):
        """关键词搜索无匹配时返回空列表"""
        engine = RAGEngine()
        records = [
            type("Rec", (), {
                "chunk_text": "一段不相关的内容",
                "embedding": None,
                "area_id": 1,
            })(),
        ]
        area_map = {1: "某领域"}
        results = engine._keyword_search("完全不匹配的关键词", records, area_map, top_k=5)
        assert len(results) == 0

    def test_keyword_search_snippet_truncated(self):
        """超长文本被截断"""
        engine = RAGEngine()
        long_text = "A" * 300
        records = [
            type("Rec", (), {
                "chunk_text": long_text,
                "embedding": None,
                "area_id": 1,
            })(),
        ]
        area_map = {1: "测试"}
        results = engine._keyword_search("A", records, area_map, top_k=5)
        assert len(results) == 1
        assert "..." in results[0]["snippet"]
