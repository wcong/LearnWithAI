"""测试 app/routes/notes.py — 学习笔记 API"""


class TestGetNote:
    def test_get_note_empty(self, test_client, auth_headers, test_area):
        """获取笔记，未创建时返回空内容"""
        resp = test_client.get(
            f"/api/notes/{test_area.id}", headers=auth_headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["area_id"] == test_area.id
        assert data["content"] == ""

    def test_get_note_not_found(self, test_client, auth_headers):
        """不存在的领域返回 404"""
        resp = test_client.get("/api/notes/99999", headers=auth_headers)
        assert resp.status_code == 404

    def test_get_other_users_note(self, test_client, auth_headers, db_session):
        """不能获取其他用户的笔记"""
        from app.models import Area, User
        from app.auth import hash_password

        other_user = User(username="other2", password_hash=hash_password("pass"))
        db_session.add(other_user)
        db_session.flush()
        other = Area(user_id=other_user.id, name="别人的")
        db_session.add(other)
        db_session.commit()

        resp = test_client.get(f"/api/notes/{other.id}", headers=auth_headers)
        assert resp.status_code == 404


class TestSaveNote:
    def test_save_note_create(self, test_client, auth_headers, test_area):
        """创建笔记"""
        resp = test_client.put(
            f"/api/notes/{test_area.id}",
            headers=auth_headers,
            json={"content": "<p>我的笔记内容</p>"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["area_id"] == test_area.id
        assert data["content"] == "<p>我的笔记内容</p>"

    def test_save_note_update(self, test_client, auth_headers, test_area, db_session):
        """更新已有笔记"""
        from app.models import AreaNote

        note = AreaNote(area_id=test_area.id, content="<p>旧内容</p>")
        db_session.add(note)
        db_session.commit()

        resp = test_client.put(
            f"/api/notes/{test_area.id}",
            headers=auth_headers,
            json={"content": "<p>新内容</p>"},
        )
        assert resp.status_code == 200
        assert resp.json()["content"] == "<p>新内容</p>"

    def test_save_note_not_found(self, test_client, auth_headers):
        """不存在的领域返回 404"""
        resp = test_client.put(
            "/api/notes/99999",
            headers=auth_headers,
            json={"content": "内容"},
        )
        assert resp.status_code == 404

    def test_save_triggers_rag_rebuild(self, test_client, auth_headers, test_area):
        """保存笔记后触发 RAG 重建（不报错即可）"""
        resp = test_client.put(
            f"/api/notes/{test_area.id}",
            headers=auth_headers,
            json={"content": "<p>RAG 测试</p>"},
        )
        assert resp.status_code == 200
