# LearnWithAI 测试指南

## 简介

本项目使用 **[pytest](https://docs.pytest.org/)** 作为测试框架，为 `app/` 目录下的 Python 文件提供单元测试和集成测试。

### 测试覆盖范围

| 测试文件 | 覆盖模块 | 类型 |
|---------|---------|------|
| `tests/test_config.py` | `app/config.py` | 单元测试 |
| `tests/test_auth.py` | `app/auth.py` | 单元测试 |
| `tests/test_database.py` | `app/database.py` | 单元测试 |
| `tests/test_models.py` | `app/models.py` | 单元测试 |
| `tests/test_streaming_handler.py` | `app/agents/streaming_handler.py` | 单元测试 |
| `tests/test_learning_agent.py` | `app/agents/learning_agent.py` | 单元测试 |
| `tests/test_plan_agent.py` | `app/agents/plan_agent.py` | 单元测试 |
| `tests/test_rag_engine.py` | `app/rag/rag_engine.py` | 单元测试 |
| `tests/routes/test_auth_routes.py` | `app/routes/auth.py` | 集成测试 |
| `tests/routes/test_areas_routes.py` | `app/routes/areas.py` | 集成测试 |
| `tests/routes/test_chat_routes.py` | `app/routes/chat.py` | 集成测试 |
| `tests/routes/test_notes_routes.py` | `app/routes/notes.py` | 集成测试 |
| `tests/routes/test_skills_routes.py` | `app/routes/skills.py` | 集成测试 |
| `tests/routes/test_admin_routes.py` | `app/routes/admin.py` | 集成测试 |
| `tests/routes/test_plan_routes.py` | `app/routes/plan.py` | 集成测试 |
| `tests/routes/test_rag_routes.py` | `app/routes/rag.py` | 集成测试 |

## 环境要求

- Python 3.10+
- 已安装项目依赖（`pip install -r requirements.txt`）

## 安装测试依赖

```bash
# 安装项目依赖
pip install -r requirements.txt

# 安装测试工具
pip install pytest pytest-asyncio httpx
```

## 运行测试

### 运行全部测试

```bash
# 从项目根目录执行
pytest
```

### 运行特定测试文件

```bash
# 运行核心模块测试
pytest tests/test_models.py -v

# 运行所有路由测试
pytest tests/routes/ -v

# 运行单一测试类
pytest tests/test_auth.py::TestHashPassword -v

# 运行单一测试方法
pytest tests/test_auth.py::TestHashPassword::test_hash_and_verify -v
```

### 常用选项

```bash
# 显示详细输出（每个测试名称）
pytest -v

# 显示打印语句
pytest -s

# 失败时立即停止
pytest -x

# 只运行匹配名称的测试
pytest -k "chat or auth"

# 显示前 3 个失败的完整回溯
pytest --tb=short
```

## 测试设计

### 数据库

所有测试使用 **SQLite :memory:** 作为数据库，由 `tests/conftest.py` 自动配置：

- 每个测试开始时创建隔离的内存数据库
- 测试结束后自动清空所有表数据
- 无需配置真实数据库连接

### 认证

测试框架自动创建测试用户和 JWT Token：

- `test_user` fixture：创建一个名为 `testuser` 的测试用户
- `auth_headers` fixture：生成对应的 Bearer Token
- `admin_user` / `admin_headers`：管理员测试用户

### Mock

所有 AI/LLM 调用（OpenAI、Anthropic、Ollama）被自动 mock，避免真实的 API 请求：

- `_build_llm()` 返回 MagicMock
- `ainvoke()` 返回预设的模拟回复
- `embed_documents()` / `aembed_query()` 返回模拟向量

### 测试隔离

- 每个测试函数有独立的数据库事务
- 测试之间的数据完全隔离
- 不依赖测试执行顺序

## 编写新测试

1. 在 `tests/` 或 `tests/routes/` 下创建 `test_*.py` 文件
2. 使用 `tests/conftest.py` 中定义的 fixtures
3. 对于需要数据库的测试，使用 `db_session` fixture
4. 对于需要 HTTP 请求的测试，使用 `test_client` fixture
5. 测试函数名以 `test_` 开头，pytest 自动发现

### 示例

```python
# tests/test_example.py
def test_create_user(db_session):
    """测试创建用户"""
    from app.models import User
    user = User(username="test", password_hash="hash")
    db_session.add(user)
    db_session.commit()
    assert user.id is not None
    assert user.username == "test"
```
