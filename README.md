# 🌳 LearnWithAI – AI 辅助深度学习平台

一个基于 **FastAPI + LangChain + SQLite + D3.js** 的交互式学习工具。  
通过横向知识树管理学习领域，与 AI 导师对话进行深度学习，所有内容持久化保存到本地。

---

## ✨ 功能

| 功能 | 说明 |
|------|------|
| **知识树** | 横向展开的树形结构，节点代表学习领域，支持无限层级下钻 |
| **AI 导师** | 每个节点绑定独立对话，AI 扮演学习导师引导深度探索 |
| **多 LLM 后端** | 支持 OpenAI / Anthropic Claude / Ollama 本地模型 |
| **对话历史** | 所有聊天记录自动存入 SQLite，刷新不丢失 |
| **学习会话** | 可保存学习总结，按领域分组查看 |

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd LearnWithAI
pip install -r requirements.txt
```

根据你使用的 LLM 后端，可能需要额外安装：

```bash
# 使用 OpenAI
pip install langchain-openai

# 使用 Anthropic Claude
pip install langchain-anthropic

# 使用 Ollama（本地推理）
pip install langchain-ollama
```

### 2. 配置 LLM

通过环境变量配置 LLM 提供商（复制 `.env.example` 或直接设置）：

```bash
# 方式一：直接设置环境变量
export LLM_PROVIDER=openai           # openai / anthropic / ollama
export LLM_MODEL=gpt-4o-mini
export LLM_API_KEY=sk-your-key-here
# export LLM_API_BASE=https://your-proxy-url/v1   # 可选：自定义 API 地址

# 方式二：使用 .env 文件（需安装 python-dotenv）
cp .env.example .env
# 编辑 .env 填入你的配置
```

#### 不同 LLM 后端示例

**OpenAI**
```
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-xxx
```

**Anthropic Claude**
```
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-20250514
LLM_API_KEY=sk-ant-xxx
```

**Ollama（本地）**
```
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2
# 无需 API Key
```

### 3. 启动

```bash
python main.py
```

终端输出示例：

```
  🌳 LearnWithAI 启动中...
  📡 访问地址: http://127.0.0.1:7860
  🤖 LLM 后端: openai / gpt-4o-mini
  💾 数据库:   /Users/xxx/LearnWithAI/data/learn.db
```

### 4. 打开浏览器

访问 **http://127.0.0.1:7860**

---

## 🎯 使用指南

### 第一步：创建学习领域

点击左侧面板顶部的 **「➕ 新建领域」**，输入领域名称（如"机器学习""量子计算"）。

### 第二步：与 AI 对话

点击知识树上的节点，右侧聊天面板激活。输入你的问题或学习目标，AI 导师会：

- 评估你的当前知识水平
- 引导探索核心概念
- 推荐子方向作为下一步学习点

### 第三步：扩展知识树

在对话中获得启发后，点击 **「➕ 添加子领域」** 创建分支节点。  
例如：`机器学习 → 监督学习 → 决策树 → 随机森林`

知识树横向生长，形成一个可视化的知识图谱。

---

## 📁 项目结构

```
LearnWithAI/
├── main.py                      # 入口：启动 FastAPI 服务器
├── requirements.txt             # Python 依赖
├── .env.example                 # 环境变量模板
├── README.md                    # 本文件
└── app/
    ├── config.py                # 配置：LLM / 服务端口 / 数据库路径
    ├── database.py              # SQLite 引擎 & 会话管理
    ├── models.py                # 数据模型：Area / ChatMessage / LearningSession
    ├── agents/
    │   └── learning_agent.py    # LangChain v1 Agent + SummarizationMiddleware
    ├── routes/
    │   ├── areas.py             # 领域 CRUD API
    │   └── chat.py              # 聊天 & 会话 API
    └── static/
        ├── index.html           # 主页面（左右双栏布局）
        ├── css/style.css        # 样式
        └── js/app.js            # D3.js 知识树 + 聊天交互
```

---

## 🗄️ 数据存储

- **数据库文件**: `data/learn.db`（自动创建）
- **表**:
  - `areas` — 知识树节点（支持自引用树结构）
  - `chat_messages` — 对话历史
  - `learning_sessions` — 学习会话记录

所有数据存储在本地，无需联网数据库。

---

## 🐧 Linux 生产部署

### 1. 安装 Python 和依赖

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git

# CentOS / RHEL / Fedora
sudo yum install -y python3 python3-pip git
```

### 2. 克隆项目并创建虚拟环境

```bash
git clone https://github.com/your-org/LearnWithAI.git
cd LearnWithAI
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入你的 LLM API Key 等配置
vim .env
```

关键配置项：

| 变量 | 说明 |
|------|------|
| `LLM_API_KEY` | **必填**，LLM 服务商 API Key |
| `LLM_API_BASE` | 自定义 API 地址（如使用中转代理） |
| `HOST` | 监听地址，生产环境建议 `0.0.0.0` |
| `PORT` | 监听端口（默认 `7860`） |
| `ADMIN_USERNAME` | 管理员用户名（默认 `admin`） |

> **安全提醒**：生产环境请务必修改 `JWT_SECRET`（默认值为开发密钥），在 `.env` 中添加：
> ```
> JWT_SECRET=your-random-secret-string-here
> ```

### 4. 使用 systemd 注册为系统服务（推荐）

创建服务文件：

```bash
sudo vim /etc/systemd/system/learnwithai.service
```

写入以下内容（请根据实际路径修改 `User`、`WorkingDirectory` 和 `ExecStart`）：

```ini
[Unit]
Description=LearnWithAI - AI Learning Platform
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/home/your-user/LearnWithAI
ExecStart=/home/your-user/LearnWithAI/venv/bin/python main.py
Restart=always
RestartSec=5
Environment=ENV=production

[Install]
WantedBy=multi-user.target
```

启动并启用开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl start learnwithai
sudo systemctl enable learnwithai    # 开机自启
sudo systemctl status learnwithai    # 查看状态
```

查看实时日志：

```bash
sudo journalctl -u learnwithai -f
```

### 5. （可选）使用 Nginx 反向代理

安装 Nginx：

```bash
sudo apt install -y nginx    # Ubuntu/Debian
sudo yum install -y nginx    # CentOS/RHEL
```

创建 Nginx 配置：

```bash
sudo vim /etc/nginx/sites-available/learnwithai
```

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名或 IP

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:7860;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用并重启：

```bash
sudo ln -s /etc/nginx/sites-available/learnwithai /etc/nginx/sites-enabled/
sudo nginx -t                    # 测试配置
sudo systemctl restart nginx
```

### 6. （可选）使用 SSL（HTTPS）

使用 Let's Encrypt 免费证书：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 7. 后台直接运行（不使用 systemd）

```bash
cd /path/to/LearnWithAI
source venv/bin/activate
nohup python main.py > app.log 2>&1 &
```

查看日志：

```bash
tail -f app.log
```

### 8. 常用管理命令

```bash
# 查看服务状态
sudo systemctl status learnwithai

# 重启服务
sudo systemctl restart learnwithai

# 查看最近日志
sudo journalctl -u learnwithai -n 50

# 实时跟踪日志
sudo journalctl -u learnwithai -f

# 停止服务
sudo systemctl stop learnwithai
```

---

## ⚙️ 高级配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `LLM_PROVIDER` | `openai` | LLM 提供商：`openai` / `anthropic` / `ollama` |
| `LLM_MODEL` | `gpt-4o-mini` | 模型名称 |
| `LLM_API_KEY` | `""` | API 密钥 |
| `LLM_API_BASE` | `""` | 自定义 API 地址（兼容代理/中转） |
| `LLM_TEMPERATURE` | `0.7` | 生成随机性 |
| `HOST` | `127.0.0.1` | 服务监听地址 |
| `PORT` | `7860` | 服务端口 |

---

## 🧪 技术栈

- **后端**: FastAPI + Uvicorn
- **AI**: LangChain v1.x Agent + Middleware（支持多 LLM 后端）
- **数据库**: SQLite + SQLAlchemy
- **前端**: 原生 HTML/CSS/JS + D3.js v7
