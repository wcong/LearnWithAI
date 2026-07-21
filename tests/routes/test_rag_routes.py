"""测试 app/routes/rag.py — RAG 语义搜索 API"""


class TestRagSearch:
    def test_no_auth(self, test_client):
        """未认证返回 401"""
        resp = test_client.post(
            "/api/rag/search",
            json={"query": "机器学习", "top_k": 3},
        )
        assert resp.status_code == 401

    def test_search_empty(self, test_client, auth_headers):
        """无笔记时搜索返回空列表"""
        resp = test_client.post(
            "/api/rag/search",
            headers=auth_headers,
            json={"query": "机器学习", "top_k": 3},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "results" in data
        assert "total" in data
        assert data["total"] == 0

    def test_search_with_data(self, test_client, auth_headers, test_area, db_session):
        """有笔记 embedding 时搜索结果"""
        from app.models import NoteEmbedding

        emb = NoteEmbedding(
            area_id=test_area.id,
            chunk_text="机器学习是人工智能的一个重要分支",
        )
        db_session.add(emb)
        db_session.commit()

        resp = test_client.post(
            "/api/rag/search",
            headers=auth_headers,
            json={"query": "机器学习", "top_k": 5},
        )
        assert resp.status_code == 200
        data = resp.json()
        # 关键词降级搜索应命中
        assert data["total"] >= 1
