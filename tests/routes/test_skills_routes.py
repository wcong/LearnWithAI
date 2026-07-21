"""测试 app/routes/skills.py — 技能模板 CRUD"""


class TestListSkills:
    def test_list_empty(self, test_client, auth_headers):
        """初始时技能列表可能包含默认技能"""
        resp = test_client.get("/api/skills", headers=auth_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestCreateSkill:
    def test_create_personal(self, test_client, auth_headers):
        """创建个人技能"""
        resp = test_client.post(
            "/api/skills",
            headers=auth_headers,
            json={
                "name": "我的模板",
                "description": "个人模板",
                "prompt_template": "请回答：{topic}",
            },
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["name"] == "我的模板"
        assert data["is_global"] is False
        assert data["is_default"] is False


class TestUpdateSkill:
    def test_update_own_skill(self, test_client, auth_headers, db_session, test_user):
        """更新自己的个人技能"""
        from app.models import Skill

        skill = Skill(
            name="旧名称",
            description="旧描述",
            prompt_template="旧模板",
            user_id=test_user.id,
            created_by=test_user.id,
        )
        db_session.add(skill)
        db_session.commit()

        resp = test_client.patch(
            f"/api/skills/{skill.id}",
            headers=auth_headers,
            json={"name": "新名称"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "新名称"

    def test_update_other_skill(self, test_client, auth_headers, db_session):
        """不能修改别人的技能"""
        from app.models import Skill, User
        from app.auth import hash_password

        other_user = User(username="other_skill", password_hash=hash_password("pass"))
        db_session.add(other_user)
        db_session.flush()

        skill = Skill(
            name="别人的",
            description="",
            prompt_template="模板",
            user_id=other_user.id,
            created_by=other_user.id,
        )
        db_session.add(skill)
        db_session.commit()

        resp = test_client.patch(
            f"/api/skills/{skill.id}",
            headers=auth_headers,
            json={"name": "新的"},
        )
        assert resp.status_code == 403

    def test_update_default_skill(self, test_client, auth_headers, db_session, test_user):
        """默认技能不可修改（默认技能属于当前用户才走到 400 检查）"""
        from app.models import Skill

        skill = Skill(
            name="默认",
            description="",
            prompt_template="模板",
            is_default=1,
            user_id=test_user.id,
            created_by=test_user.id,
        )
        db_session.add(skill)
        db_session.commit()

        resp = test_client.patch(
            f"/api/skills/{skill.id}",
            headers=auth_headers,
            json={"name": "新的"},
        )
        assert resp.status_code == 400


class TestDeleteSkill:
    def test_delete_own_skill(self, test_client, auth_headers, db_session, test_user):
        """删除自己的个人技能"""
        from app.models import Skill

        skill = Skill(
            name="待删除",
            description="",
            prompt_template="模板",
            user_id=test_user.id,
            created_by=test_user.id,
        )
        db_session.add(skill)
        db_session.commit()

        resp = test_client.delete(
            f"/api/skills/{skill.id}", headers=auth_headers
        )
        assert resp.status_code == 200

    def test_delete_default_skill(self, test_client, auth_headers, db_session, test_user):
        """默认技能不可删除（默认技能属于当前用户才走到 400 检查）"""
        from app.models import Skill

        skill = Skill(
            name="默认",
            description="",
            prompt_template="模板",
            is_default=1,
            user_id=test_user.id,
            created_by=test_user.id,
        )
        db_session.add(skill)
        db_session.commit()

        resp = test_client.delete(
            f"/api/skills/{skill.id}", headers=auth_headers
        )
        assert resp.status_code == 400


class TestGlobalSkills:
    def test_list_global_no_admin(self, test_client, auth_headers):
        """非管理员无法查看全局技能列表"""
        resp = test_client.get(
            "/api/skills/global/list", headers=auth_headers
        )
        assert resp.status_code == 403

    def test_list_global_as_admin(self, test_client, admin_headers):
        """管理员可以查看全局技能列表"""
        resp = test_client.get(
            "/api/skills/global/list", headers=admin_headers
        )
        assert resp.status_code == 200

    def test_create_global_as_admin(self, test_client, admin_headers):
        """管理员创建全局技能"""
        resp = test_client.post(
            "/api/skills/global",
            headers=admin_headers,
            json={
                "name": "全局模板",
                "description": "管理员创建",
                "prompt_template": "请回答：{topic}",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["is_global"] is True
