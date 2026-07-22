# 🌲 LearnWithAI

> AI 辅助深度学习平台，基于 **FastAPI + LangChain + SQLite/MySQL**

通过横向知识树管理学习领域，与 AI 导师对话进行深度学习，支持富文本笔记与 RAG 语义搜索，所有内容持久化保存到本地。

**核心功能：**
- **知识树** — 横向展开的树形结构，支持无限层级下钻
- **AI 导师** — 每个节点绑定独立对话，AI 扮演学习导师引导深度探索
- **富文本笔记** — 基于 Quill 编辑器的学习笔记，支持 RAG 语义搜索
- **Plan Mode** — AI 自动递归探索领域，生成结构化学习路径
- **技能模板** — 可复用的提示词模板，适配不同学习场景
- **多 LLM 后端** — 支持 OpenAI / Anthropic Claude / Ollama 本地模型
- **对话持久化** — 所有聊天记录自动存入数据库，刷新不丢失
- **管理员面板** — Token 用量统计、用户与领域总览
- **响应式设计** — 桌面端 + 移动端双界面

---

## 环境要求

- **Python** 3.10+
- **pip**（Python 包管理器）

---

## 快速开始

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

通过环境变量或 `.env` 文件配置：

```bash
# 方式一：直接设置环境变量
export LLM_PROVIDER=openai           # openai / anthropic / ollama
export LLM_MODEL=gpt-4o-mini
export LLM_API_KEY=sk-your-key-here
# export LLM_API_BASE=https://your-proxy-url/v1   # 可选：自定义 API 地址

# 方式二：使用 .env 文件
cp .env.example .env
# 编辑 .env 填入你的配置
```

**LLM 后端配置示例：**

| 提供商 | 配置 |
|--------|------|
| **OpenAI** | `LLM_PROVIDER=openai` `LLM_MODEL=gpt-4o-mini` `LLM_API_KEY=sk-xxx` |
| **Anthropic** | `LLM_PROVIDER=anthropic` `LLM_MODEL=claude-sonnet-4-20250514` `LLM_API_KEY=sk-ant-xxx` |
| **Ollama** | `LLM_PROVIDER=ollama` `LLM_MODEL=llama3.2`（无需 API Key） |

### 3. 启动服务器

```bash
python main.py
```

终端输出示例：

```
  🌲 LearnWithAI 开发模式
  📡 127.0.0.1:7860
  🤖 openai / gpt-4o-mini
  💾 SQLite: /path/to/LearnWithAI/data/learn.db
```

在浏览器中打开 **http://127.0.0.1:7860**。

---

## 配置参考

所有配置通过环境变量读取（或项目根目录的 `.env` 文件）。

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `DATABASE_URL` | `""` | MySQL 连接串，如 `mysql+pymysql://user:pass@host/db`。留空则使用 SQLite。 |
| `LLM_PROVIDER` | `openai` | LLM 提供商：`openai` / `anthropic` / `ollama` |
| `LLM_MODEL` | `gpt-4o-mini` | 模型名称 |
| `LLM_API_KEY` | `""` | API 密钥 |
| `LLM_API_BASE` | `""` | 自定义 API 地址（兼容代理/中转） |
| `LLM_TEMPERATURE` | `0.7` | 生成随机性 |
| `JWT_SECRET` | `learnwithai-dev-secret-change-in-prod` | JWT 签名密钥 |
| `HOST` | `127.0.0.1` | 服务监听地址 |
| `PORT` | `7860` | 服务端口 |
| `ADMIN_USERNAME` | `admin` | 管理员用户名 |
| `ENV` | `development` | 设为 `production` 可关闭热重载并使用 4 个 worker 进程 |

> **安全提醒**：生产环境务必修改 `JWT_SECRET` 为强随机字符串。

---

## 生产部署

### 1. 系统依赖（Linux）

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
# 编辑 .env 填入生产配置
vim .env
```

生产环境推荐配置：

```ini
LLM_API_KEY=sk-xxx
LLM_API_BASE=https://your-proxy-url/v1   # 如使用中转代理
HOST=0.0.0.0
PORT=7860
ENV=production
JWT_SECRET=your-strong-random-secret
ADMIN_USERNAME=admin
DATABASE_URL=                             # 留空用 SQLite，或使用 MySQL
```

### 4. 使用 systemd 注册为系统服务（推荐）

```bash
sudo vim /etc/systemd/system/learnwithai.service
```

```ini
[Unit]
Description=LearnWithAI - AI 辅助深度学习平台
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
sudo systemctl status learnwithai
```

查看日志：

```bash
sudo journalctl -u learnwithai -f
```

### 5. Nginx 反向代理（可选）

```bash
sudo apt install -y nginx    # Ubuntu/Debian
sudo yum install -y nginx    # CentOS/RHEL
```

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
sudo nginx -t
sudo systemctl restart nginx
```

### 6. SSL（可选）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 7. 直接后台运行

```bash
cd /path/to/LearnWithAI
source venv/bin/activate
nohup python main.py > app.log 2>&1 &
tail -f app.log
```

### 8. 常用管理命令

```bash
sudo systemctl status learnwithai      # 查看状态
sudo systemctl restart learnwithai     # 重启
sudo systemctl stop learnwithai        # 停止
sudo journalctl -u learnwithai -n 50   # 最近日志
sudo journalctl -u learnwithai -f      # 实时日志
```

---

## 数据管理

### 导出数据库

```bash
# 导出到标准输出
python cli/dump.py

# 导出到文件
python cli/dump.py -o backup.sql

# 导出 MySQL 数据库
DATABASE_URL=mysql+pymysql://user:pass@host/dbname python cli/dump.py -o backup.sql
```

### 导入数据库

```bash
python cli/import_data.py -i backup.sql

# 导入到 MySQL 目标库
DATABASE_URL=mysql+pymysql://user:pass@host/dbname python cli/import_data.py -i backup.sql
```

> **注意**：目标数据库的表应为空表（已有数据可能导致主键冲突）。

---

## 技术栈

- **后端**: FastAPI + Uvicorn
- **AI**: LangChain v1.x Agent + SummarizationMiddleware（OpenAI / Anthropic / Ollama）
- **数据库**: SQLite（默认）/ MySQL（可选）+ SQLAlchemy
- **前端**: 原生 HTML/CSS/JS + D3.js v7 + Quill.js
- **认证**: JWT（python-jose）+ SHA-256 密码哈希
- **RAG**: LangChain 文本分块 + numpy 余弦相似度

---

## 开源协议

MIT
