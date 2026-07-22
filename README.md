# 🌲 LearnWithAI

> AI-Assisted Deep Learning Platform powered by **FastAPI + LangChain + SQLite/MySQL**

LearnWithAI helps you manage learning domains through a horizontal knowledge tree, engage in deep learning conversations with an AI tutor, and persist everything locally.

**Key Features:**
- **Knowledge Tree** — Horizontally expanding tree structure with infinite drill-down
- **AI Tutor** — Each node binds an independent conversation; AI acts as a learning mentor
- **Rich Notes** — Quill-based rich text editor with RAG semantic search across notes
- **Plan Mode** — AI recursively explores a domain and auto-generates a structured learning path
- **Skill Templates** — Reusable prompt templates for different learning scenarios
- **Multi-LLM** — Supports OpenAI, Anthropic Claude, and Ollama local models
- **Chat History** — All conversations persist to database, survives refresh
- **Admin Dashboard** — Token usage statistics, user and domain overview
- **Responsive** — Desktop and mobile (PWA-like) interfaces

---

## Prerequisites

- **Python** 3.10+
- **pip** (Python package manager)

---

## Quick Start

### 1. Install Dependencies

```bash
cd LearnWithAI
pip install -r requirements.txt
```

Depending on your LLM backend, you may need an additional package:

```bash
# For OpenAI
pip install langchain-openai

# For Anthropic Claude
pip install langchain-anthropic

# For Ollama (local inference)
pip install langchain-ollama
```

### 2. Configure LLM

Set environment variables (copy `.env.example` or set directly):

```bash
# Option A: Direct environment variables
export LLM_PROVIDER=openai           # openai / anthropic / ollama
export LLM_MODEL=gpt-4o-mini
export LLM_API_KEY=sk-your-key-here
# export LLM_API_BASE=https://your-proxy-url/v1   # Optional: custom API base URL

# Option B: Use .env file
cp .env.example .env
# Edit .env with your settings
```

**LLM Backend Examples:**

| Provider | Variables |
|----------|-----------|
| **OpenAI** | `LLM_PROVIDER=openai` `LLM_MODEL=gpt-4o-mini` `LLM_API_KEY=sk-xxx` |
| **Anthropic** | `LLM_PROVIDER=anthropic` `LLM_MODEL=claude-sonnet-4-20250514` `LLM_API_KEY=sk-ant-xxx` |
| **Ollama** | `LLM_PROVIDER=ollama` `LLM_MODEL=llama3.2` (no API key needed) |

### 3. Start the Server

```bash
python main.py
```

Expected output:

```
  🌲 LearnWithAI 开发模式
  📡 127.0.0.1:7860
  🤖 openai / gpt-4o-mini
  💾 SQLite: /path/to/LearnWithAI/data/learn.db
```

Open **http://127.0.0.1:7860** in your browser.

---

## Configuration Reference

All settings are read from environment variables (or `.env` file at project root).

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `""` | MySQL connection string, e.g. `mysql+pymysql://user:pass@host/db`. Leave empty for SQLite. |
| `LLM_PROVIDER` | `openai` | LLM provider: `openai` / `anthropic` / `ollama` |
| `LLM_MODEL` | `gpt-4o-mini` | Model name |
| `LLM_API_KEY` | `""` | API key |
| `LLM_API_BASE` | `""` | Custom API base URL (for proxies / relays) |
| `LLM_TEMPERATURE` | `0.7` | Generation randomness |
| `JWT_SECRET` | `learnwithai-dev-secret-change-in-prod` | JWT signing secret |
| `HOST` | `127.0.0.1` | Listening address |
| `PORT` | `7860` | Listening port |
| `ADMIN_USERNAME` | `admin` | Admin username |
| `ENV` | `development` | Set to `production` to disable hot-reload and use 4 workers |

> **Security**: In production, always set `JWT_SECRET` to a strong random string.

---

## Production Deployment

### 1. System Dependencies (Linux)

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git

# CentOS / RHEL / Fedora
sudo yum install -y python3 python3-pip git
```

### 2. Clone and Setup

```bash
git clone https://github.com/your-org/LearnWithAI.git
cd LearnWithAI
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env with your production settings
vim .env
```

Key configuration for production:

```ini
LLM_API_KEY=sk-xxx
LLM_API_BASE=https://your-proxy-url/v1   # if using a relay
HOST=0.0.0.0
PORT=7860
ENV=production
JWT_SECRET=your-strong-random-secret
ADMIN_USERNAME=admin
DATABASE_URL=                             # leave empty for SQLite, or use MySQL
```

### 4. Run with systemd (Recommended)

Create a service file:

```bash
sudo vim /etc/systemd/system/learnwithai.service
```

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

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl start learnwithai
sudo systemctl enable learnwithai    # auto-start on boot
sudo systemctl status learnwithai
```

View logs:

```bash
sudo journalctl -u learnwithai -f
```

### 5. Nginx Reverse Proxy (Optional)

```bash
sudo apt install -y nginx    # Ubuntu/Debian
sudo yum install -y nginx    # CentOS/RHEL
```

Create config:

```bash
sudo vim /etc/nginx/sites-available/learnwithai
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

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

Enable and restart:

```bash
sudo ln -s /etc/nginx/sites-available/learnwithai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 6. SSL with Let's Encrypt (Optional)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 7. Run Directly without systemd

```bash
cd /path/to/LearnWithAI
source venv/bin/activate
nohup python main.py > app.log 2>&1 &
tail -f app.log
```

### 8. Management Commands

```bash
sudo systemctl status learnwithai      # check status
sudo systemctl restart learnwithai     # restart
sudo systemctl stop learnwithai        # stop
sudo journalctl -u learnwithai -n 50   # recent logs
sudo journalctl -u learnwithai -f      # follow logs
```

---

## Data Management

### Export Database

```bash
# Export to stdout
python cli/dump.py

# Export to file
python cli/dump.py -o backup.sql

# Export MySQL database
DATABASE_URL=mysql+pymysql://user:pass@host/dbname python cli/dump.py -o backup.sql
```

### Import Database

```bash
python cli/import_data.py -i backup.sql

# Import to MySQL target
DATABASE_URL=mysql+pymysql://user:pass@host/dbname python cli/import_data.py -i backup.sql
```

> **Note**: The target database should have empty tables (existing data may cause primary key conflicts).

---

## Tech Stack

- **Backend**: FastAPI + Uvicorn
- **AI**: LangChain v1.x Agent + SummarizationMiddleware (OpenAI / Anthropic / Ollama)
- **Database**: SQLite (default) / MySQL (optional) + SQLAlchemy
- **Frontend**: Vanilla HTML/CSS/JS + D3.js v7 + Quill.js
- **Auth**: JWT (python-jose) + SHA-256 password hashing
- **RAG**: LangChain text splitters + numpy cosine similarity

---

## License

MIT
