"""测试 app/routes/areas.py — 学习领域 CRUD"""


class TestListAreas:
    def test_empty_tree(self, test_client, auth_headers):
        """初始时领域树为空"""
        resp = test_client.get("/api/areas/tree", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_with_area(self, test_client, auth_headers, test_area):
        """创建后列表包含该领域"""
        resp = test_client.get("/api/areas", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "测试领域"


class TestCreateArea:
    def test_create_root(self, test_client, auth_headers):
        """创建根领域"""
        resp = test_client.post(
            "/api/areas",
            headers=auth_headers,
            json={"name": "新领域", "description": "描述"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["name"] == "新领域"
        assert data["parent_id"] is None

    def test_create_child(self, test_client, auth_headers, test_area):
        """创建子领域"""
        resp = test_client.post(
            "/api/areas",
            headers=auth_headers,
            json={"name": "子领域", "parent_id": test_area.id},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["parent_id"] == test_area.id

    def test_create_child_nonexistent_parent(self, test_client, auth_headers):
        """父节点不存在返回 404"""
        resp = test_client.post(
            "/api/areas",
            headers=auth_headers,
            json={"name": "子领域", "parent_id": 99999},
        )
        assert resp.status_code == 404

    def test_create_other_users_parent(self, test_client, auth_headers, db_session):
        """不能以其他用户的领域作为父节点"""
        from app.models import Area, User
        from app.auth import hash_password

        # 先创建另一个用户（FK 约束）
        other_user = User(username="other", password_hash=hash_password("pass"))
        db_session.add(other_user)
        db_session.flush()
        other_area = Area(user_id=other_user.id, name="别人的领域")
        db_session.add(other_area)
        db_session.commit()

        resp = test_client.post(
            "/api/areas",
            headers=auth_headers,
            json={"name": "子领域", "parent_id": other_area.id},
        )
        assert resp.status_code == 403


class TestGetArea:
    def test_get_existing(self, test_client, auth_headers, test_area):
        """获取已有领域"""
        resp = test_client.get(f"/api/areas/{test_area.id}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["name"] == "测试领域"

    def test_get_not_found(self, test_client, auth_headers):
        """不存在的领域返回 404"""
        resp = test_client.get("/api/areas/99999", headers=auth_headers)
        assert resp.status_code == 404

    def test_get_other_users_area(self, test_client, auth_headers, db_session):
        """不能获取其他用户的领域"""
        from app.models import Area, User
        from app.auth import hash_password

        other_user = User(username="other2", password_hash=hash_password("pass"))
        db_session.add(other_user)
        db_session.flush()
        other = Area(user_id=other_user.id, name="别人的")
        db_session.add(other)
        db_session.commit()

        resp = test_client.get(f"/api/areas/{other.id}", headers=auth_headers)
        assert resp.status_code == 403


class TestUpdateArea:
    def test_update_name(self, test_client, auth_headers, test_area):
        """更新领域名称"""
        resp = test_client.patch(
            f"/api/areas/{test_area.id}",
            headers=auth_headers,
            json={"name": "新名称"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "新名称"

    def test_update_description(self, test_client, auth_headers, test_area):
        """更新领域描述"""
        resp = test_client.patch(
            f"/api/areas/{test_area.id}",
            headers=auth_headers,
            json={"description": "新描述"},
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "新描述"


class TestDeleteArea:
    def test_delete(self, test_client, auth_headers, test_area):
        """删除领域"""
        resp = test_client.delete(
            f"/api/areas/{test_area.id}", headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_delete_not_found(self, test_client, auth_headers):
        """删除不存在的领域返回 404"""
        resp = test_client.delete("/api/areas/99999", headers=auth_headers)
        assert resp.status_code == 404


class TestSiblings:
    def test_get_siblings(self, test_client, auth_headers, test_area, db_session):
        """获取兄弟节点"""
        from app.models import Area

        # 创建两个同级别的子领域
        child1 = Area(
            user_id=test_area.user_id,
            name="子1",
            parent_id=test_area.id,
        )
        child2 = Area(
            user_id=test_area.user_id,
            name="子2",
            parent_id=test_area.id,
        )
        db_session.add_all([child1, child2])
        db_session.commit()

        resp = test_client.get(
            f"/api/areas/{child1.id}/siblings", headers=auth_headers
        )
        assert resp.status_code == 200
        siblings = resp.json()
        assert len(siblings) == 1
        assert siblings[0]["name"] == "子2"


class TestExamineAndGenerate:
    """审查和生成子领域（依赖 mock LLM，验证路由可达）"""

    def test_examine_no_children(self, test_client, auth_headers, test_area):
        """无子领域时审查返回 400"""
        resp = test_client.post(
            f"/api/areas/{test_area.id}/examine", headers=auth_headers
        )
        assert resp.status_code == 400

    def test_polish_empty(self, test_client, auth_headers, test_area):
        """润色空列表返回 400"""
        resp = test_client.post(
            f"/api/areas/{test_area.id}/polish-subareas",
            headers=auth_headers,
            json={"sub_areas": []},
        )
        assert resp.status_code == 400
