# 🏗️ LearnWithAI — 项目结构说明

本文档详解 LearnWithAI 代码库的目录组织、各模块功能和架构设计。

---

## 目录树

```
LearnWithAI/
├── main.py                       # 应用入口
├── requirements.txt              # Python 依赖清单
├── .env.example                  # 环境变量模板
├── .gitignore
│
├── app/                          # 核心应用
│   ├── __init__.py
│   ├── config.py                 # 配置（环境变量 → Settings 对象）
│   ├── database.py               # 数据库引擎与会话管理
│   ├── models.py                 # SQLAlchemy 数据模型（10 张表）
│   ├── auth.py                   # JWT 认证工具
│   │
│   ├── agents/                   # AI 代理实现
│   │   ├── learning_agent.py     # LearningAgent + 领域审查工具
│   │   ├── plan_agent.py         # Plan Mode 递归探索引擎
│   │   └── streaming_handler.py  # SSE 流式回调处理器
│   │
│   ├── rag/                      # RAG（检索增强生成）
│   │   └── rag_engine.py         # 索引构建 + 语义搜索引擎
│   │
│   ├── routes/                   # API 路由处理器
│   │   ├── auth.py               # 注册 / 登录 / 获取当前用户
│   │   ├── areas.py              # 学习领域 CRUD + AI 审查
│   │   ├── chat.py               # 聊天（流式 + 非流式）
│   │   ├── notes.py              # 富文本笔记 CRUD
│   │   ├── plan.py               # Plan Mode SSE 端点
│   │   ├── skills.py             # 技能模板 CRUD
│   │   ├── rag.py                # RAG 语义搜索
│   │   └── admin.py              # 管理员统计面板
│   │
│   └── static/                   # 前端文件
│       ├── home.html             # 首页（导航卡片）
│       ├── domain.html           # 领域页（三栏布局）
│       ├── notes.html            # 笔记页（两栏布局）
│       ├── plan.html             # Plan Mode 页面
│       ├── skills.html           # 技能管理页面
│       ├── css/                  # 样式文件
│       │   ├── style.css         # 主样式
│       │   ├── home.css          # 首页样式
│       │   ├── nav.css           # 导航栏样式
│       │   ├── notes.css         # 笔记页样式
│       │   ├── skills.css        # 技能页样式
│       │   └── lib/              # 第三方样式库
│       │       ├── atom-one-dark.min.css  # highlight.js 主题
│       │       ├── quill.snow.css         # Quill 编辑器主题
│       │       └── tailwind.min.css       # Tailwind CSS 工具类
│       ├── js/                   # JavaScript
│       │   ├── app.js            # 主应用逻辑（约 60KB）
│       │   ├── notes.js          # 笔记页逻辑
│       │   ├── plan.js           # Plan Mode 逻辑
│       │   ├── skills.js         # 技能管理逻辑
│       │   └── lib/              # 第三方 JS 库
│       │       ├── quill.js      # Quill 富文本编辑器
│       │       ├── marked.min.js # Markdown 渲染
│       │       └── highlight.min.js # 代码语法高亮
│       │
│       └── mobile/               # 移动端前端
│           ├── home.html         # 移动端首页
│           ├── index.html        # 移动端领域页（对话 + 覆盖层）
│           ├── notes.html        # 移动端笔记页
│           ├── plan.html         # 移动端 Plan Mode 页
│           ├── css/
│           │   ├── style.css     # 移动端主样式
│           │   └── home.css      # 移动端首页样式
│           └── js/
│               ├── app.js        # 移动端主逻辑
│               ├── common.js     # 移动端通用工具函数
│               ├── notes.js      # 移动端笔记逻辑
│               └── plan.js       # 移动端 Plan Mode 逻辑
│
├── cli/                          # 命令行工具
│   ├── dump.py                   # 数据库导出（SQL INSERT 格式）
│   └── import_data.py            # 数据库导入（解析并执行 SQL）
│
└── data/                         # SQLite 数据库目录（自动创建）
```

---

## 入口文件：`main.py`

应用入口，负责：
1. 创建 FastAPI 应用，配置生命周期管理
2. 启动时初始化数据库
3. 注册请求日志中间件
4. 挂载 `/static` 静态文件目录
5. 注册所有 API 路由
6. 提供前端页面重定向路由：
   - `/` → `home.html`
   - `/domain` → `domain.html`
   - `/notes` → `notes.html`
   - `/plan` → `plan.html`
   - `/mobile*` → 移动端页面
7. **开发模式**（默认）：单 worker + 热重载；**生产模式**（`ENV=production`）：4 workers + 无热重载

---

## 后端模块

### `app/config.py`

从环境变量（及根目录 `.env` 文件）读取配置，封装为 `Settings` 单例。  
管理：LLM 提供商、模型、API Key、JWT 密钥、服务地址/端口、数据库 URL、管理员用户名。

### `app/database.py`

管理 SQLAlchemy 引擎与会话工厂：
- **SQLite**（默认）：自动创建 `data/learn.db`
- **MySQL**（可选）：通过 `DATABASE_URL` 环境变量配置
- 自动执行旧表迁移
- 首次启动时创建系统内置默认技能

### `app/models.py`

定义 10 张 SQLAlchemy 数据模型表：

| 表名 | 关键字段 | 说明 |
|------|---------|------|
| `users` | id, username, password_hash | 用户账号 |
| `areas` | id, user_id, name, description, parent_id, order | 知识树节点（自引用树结构） |
| `chat_messages` | id, area_id, role, content | 聊天历史记录 |
| `area_notes` | id, area_id, content (HTML) | 每个领域的富文本笔记 |
| `note_embeddings` | id, area_id, chunk_text, embedding | RAG 向量索引分块 |
| `learning_sessions` | id, area_id, summary | 学习会话摘要 |
| `usage_logs` | id, area_id, model, tokens, duration_ms | AI Token 用量记录 |
| `area_analyses` | id, area_id, summary, sub_area_summaries, missing_suggestions | AI 生成的领域分析报告 |
| `skills` | id, name, prompt_template, is_global, is_default | 可复用的提示词模板 |
| `login_history` | id, user_id, ip, location, user_agent | 登录事件记录 |

### `app/auth.py`

JWT 认证工具函数：
- `hash_password()` / `verify_password()` — SHA-256 + 随机盐
- `create_token()` — 生成 JWT Token（默认 72 小时过期）
- `get_current_user()` — FastAPI 依赖注入，解析并验证认证用户
- `mask_ip()` — IP 地址脱敏处理

### `app/agents/learning_agent.py`

核心 AI 代理模块，基于 LangChain v1 Agent + SummarizationMiddleware：

- **`LearningAgent` 类**：管理按领域的聊天会话，支持祖先领域上下文继承
  - `chat()` — 非流式回复
  - `chat_stream()` — 流式回复（通过回调处理器）
  - `add_history()` — 从数据库加载历史消息

- **领域分析工具**（审查功能使用）：
  - `list_sub_areas(area_id)` — 列出子领域及分析状态
  - `generate_sub_analysis(area_id)` — 递归生成子领域分析
  - `generate_parent_analysis(area_id)` — 聚合子领域分析为父领域摘要

- **子领域生成**：
  - `run_generate_subareas_stream()` — AI 基于聊天记录推荐子领域
  - `run_polish_subareas()` — AI 润色子领域描述

- **审查函数**：
  - `run_examine_agent()` / `run_examine_agent_stream()` — 编排完整审查流程

### `app/agents/plan_agent.py`

Plan Mode 递归探索引擎：
- 深度优先 + 同层并发（最大分支数 MAX_BRANCHES=10）
- 每节点流程：生成概况 → 保存为聊天消息 → 提取子领域 → 创建子节点 → 递归
- 支持可配置的最大深度（max_depth，默认 2）
- 推送 SSE 事件：`area_created`、`message`、`progress`、`thinking`

### `app/agents/streaming_handler.py`

LangChain 回调处理器，捕捉实时 Token 输出并推入 `asyncio.Queue` 供 SSE 流式传输：
- `on_llm_new_token()` → `thinking` 事件
- `on_tool_start()` / `on_tool_end()` → `tool_call` 事件
- `on_llm_error()` → `error` 事件

### `app/rag/rag_engine.py`

笔记语义搜索的 RAG 引擎：
- `rebuild_area_index(area_id)` — 笔记保存后在后台调用：
  - 清洗 HTML → 分块（500 字符） → 生成向量嵌入 → 存入 `note_embeddings`
- `search(query, user_id)` — 语义搜索：
  - 向量化查询 → 余弦相似度匹配 → 返回 Top-K 结果
  - 嵌入不可用时降级为关键词匹配

支持 OpenAI、Ollama 和 Anthropic 的嵌入（Anthropic 降级为关键词）。

### API 路由

#### `routes/auth.py`
| 方法 | 路径 | 认证 | 说明 |
|--------|------|------|------|
| POST | `/api/auth/register` | 无需 | 注册新用户 |
| POST | `/api/auth/login` | 无需 | 登录，返回 JWT Token |
| GET | `/api/auth/me` | 需要 | 获取当前用户信息 |

#### `routes/areas.py`
| 方法 | 路径 | 认证 | 说明 |
|--------|------|------|------|
| GET | `/api/areas/tree` | 需要 | 获取完整知识树 |
| GET | `/api/areas` | 需要 | 列出根领域（含子树） |
| POST | `/api/areas` | 需要 | 创建领域 |
| GET | `/api/areas/{id}` | 需要 | 获取领域详情 |
| PATCH | `/api/areas/{id}` | 需要 | 更新领域 |
| DELETE | `/api/areas/{id}` | 需要 | 删除领域（递归） |
| GET | `/api/areas/{id}/siblings` | 需要 | 列出同级节点 |
| POST | `/api/areas/{id}/examine` | 需要 | AI 审查（非流式） |
| POST | `/api/areas/{id}/examine/stream` | 需要 | AI 审查（流式 SSE） |
| POST | `/api/areas/{id}/generate-subareas/stream` | 需要 | 生成子领域建议 |
| POST | `/api/areas/{id}/polish-subareas` | 需要 | 润色描述 |

#### `routes/chat.py`
| 方法 | 路径 | 认证 | 说明 |
|--------|------|------|------|
| POST | `/api/chat` | 需要 | 非流式聊天 |
| POST | `/api/chat/stream` | 需要 | 流式聊天（SSE） |
| GET | `/api/chat/history/{id}` | 需要 | 获取聊天历史 |
| GET | `/api/chat/usage/{message_id}` | 需要 | 获取 Token 用量 |
| POST | `/api/chat/session/{id}` | 需要 | 保存学习会话 |
| GET | `/api/chat/sessions/{id}` | 需要 | 列出学习会话 |
| DELETE | `/api/chat/message/{id}` | 需要 | 删除消息 |

#### `routes/notes.py`
| 方法 | 路径 | 认证 | 说明 |
|--------|------|------|------|
| GET | `/api/notes/{id}` | 需要 | 获取笔记（按领域） |
| PUT | `/api/notes/{id}` | 需要 | 保存笔记（触发 RAG 重建） |

#### `routes/rag.py`
| 方法 | 路径 | 认证 | 说明 |
|--------|------|------|------|
| POST | `/api/rag/search` | 需要 | 跨笔记语义搜索 |

#### `routes/plan.py`
| 方法 | 路径 | 认证 | 说明 |
|--------|------|------|------|
| POST | `/api/plan/start` | 需要 | 启动 Plan Mode 探索（SSE） |

#### `routes/skills.py`
| 方法 | 路径 | 认证 | 说明 |
|--------|------|------|------|
| GET | `/api/skills` | 需要 | 列出可用技能 |
| POST | `/api/skills` | 需要 | 创建个人技能 |
| PATCH | `/api/skills/{id}` | 需要 | 更新个人技能 |
| DELETE | `/api/skills/{id}` | 需要 | 删除个人技能 |
| GET | `/api/skills/global/list` | 管理员 | 列出全局技能 |
| POST | `/api/skills/global` | 管理员 | 创建全局技能 |
| PATCH | `/api/skills/global/{id}` | 管理员 | 更新全局技能 |
| DELETE | `/api/skills/global/{id}` | 管理员 | 删除全局技能 |

#### `routes/admin.py`
| 方法 | 路径 | 认证 | 说明 |
|--------|------|------|------|
| GET | `/api/admin/stats` | 管理员 | 获取平台统计数据 |

---

## 前端页面

### 桌面端页面

| 页面 | 路径 | 说明 |
|------|------|------|
| **首页** | `/static/home.html` | 所有功能导航卡片 |
| **领域** | `/static/domain.html` | 三栏布局：知识树（左）、聊天（中）、工具面板（右） |
| **笔记** | `/static/notes.html` | 两栏布局：领域树（左）、Quill 富文本编辑器（右） |
| **计划** | `/static/plan.html` | 单页：输入领域 → 实时 SSE 探索进度 |
| **技能** | `/static/skills.html` | 个人/全局技能模板的 CRUD 界面 |

### 移动端页面

| 页面 | 路径 | 说明 |
|------|------|------|
| **首页** | `/static/mobile/home.html` | 移动端着陆页 |
| **领域** | `/static/mobile/index.html` | 对话 + 滑出领域面板 |
| **笔记** | `/static/mobile/notes.html` | 移动端笔记编辑器 |
| **计划** | `/static/mobile/plan.html` | 移动端 Plan Mode |

### 核心前端库

- **D3.js v7** — 横向知识树可视化（力导向布局）
- **Quill.js** — 富文本编辑器（笔记）
- **marked.js** — Markdown 转 HTML 渲染
- **highlight.js** — 聊天消息中的代码语法高亮

---

## CLI 工具

### `cli/dump.py`

将整个数据库导出为 SQL INSERT 语句：
- 按外键依赖顺序导出，保证导入安全
- 支持 SQLite 和 MySQL
- 正确处理 `LargeBinary` 字段（嵌入向量）、日期时间和字符串转义

### `cli/import_data.py`

导入 `dump.py` 生成的 SQL 文件：
- 智能 SQL 语句解析（正确处理字符串内的分号）
- MySQL 下临时禁用外键检查（areas 表有自引用）
- 完成后报告插入记录数
