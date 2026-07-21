# 🏗️ LearnWithAI — Project Structure

This document explains the organization of the LearnWithAI codebase.

---

## Directory Tree

```
LearnWithAI/
├── main.py                       # Application entry point
├── requirements.txt              # Python dependencies
├── .env.example                  # Environment variable template
├── .gitignore
│
├── app/                          # Core application
│   ├── __init__.py
│   ├── config.py                 # Configuration (env vars → Settings)
│   ├── database.py               # Database engine & session management
│   ├── models.py                 # SQLAlchemy data models (10 tables)
│   ├── auth.py                   # JWT authentication utilities
│   │
│   ├── agents/                   # AI agent implementations
│   │   ├── learning_agent.py     # LearningAgent + Area analysis tools
│   │   ├── plan_agent.py         # Plan Mode recursive exploration engine
│   │   └── streaming_handler.py  # SSE streaming callback handler
│   │
│   ├── rag/                      # RAG (Retrieval-Augmented Generation)
│   │   └── rag_engine.py         # Index builder + semantic search engine
│   │
│   ├── routes/                   # API route handlers
│   │   ├── auth.py               # Register / Login / Get current user
│   │   ├── areas.py              # Learning domain CRUD + AI review
│   │   ├── chat.py               # Chat (streaming + non-streaming)
│   │   ├── notes.py              # Rich text notes CRUD
│   │   ├── plan.py               # Plan Mode SSE endpoint
│   │   ├── skills.py             # Skill templates CRUD
│   │   ├── rag.py                # RAG semantic search
│   │   └── admin.py              # Admin statistics dashboard
│   │
│   └── static/                   # Frontend files
│       ├── home.html             # Home page (navigation cards)
│       ├── domain.html           # Domain page (3-column layout)
│       ├── notes.html            # Notes page (2-column layout)
│       ├── plan.html             # Plan Mode page
│       ├── skills.html           # Skill management page
│       ├── css/                  # Stylesheets
│       │   ├── style.css         # Main styles
│       │   ├── home.css          # Home page styles
│       │   ├── nav.css           # Navigation bar styles
│       │   ├── notes.css         # Notes page styles
│       │   ├── skills.css        # Skills page styles
│       │   └── lib/              # Third-party CSS
│       │       ├── atom-one-dark.min.css  # highlight.js theme
│       │       ├── quill.snow.css         # Quill editor theme
│       │       └── tailwind.min.css       # Tailwind CSS utility
│       ├── js/                   # JavaScript
│       │   ├── app.js            # Main application logic (60KB)
│       │   ├── notes.js          # Notes page logic
│       │   ├── plan.js           # Plan Mode logic
│       │   ├── skills.js         # Skills management logic
│       │   └── lib/              # Third-party JS
│       │       ├── quill.js      # Quill rich text editor
│       │       ├── marked.min.js # Markdown rendering
│       │       └── highlight.min.js # Code syntax highlighting
│       │
│       └── mobile/               # Mobile-optimized frontend
│           ├── home.html         # Mobile home page
│           ├── index.html        # Mobile domain page (chat + overlay)
│           ├── notes.html        # Mobile notes page
│           ├── plan.html         # Mobile Plan Mode page
│           ├── css/
│           │   ├── style.css     # Mobile main styles
│           │   └── home.css      # Mobile home styles
│           └── js/
│               ├── app.js        # Mobile main logic
│               ├── common.js     # Mobile shared utilities
│               ├── notes.js      # Mobile notes logic
│               └── plan.js       # Mobile Plan Mode logic
│
├── cli/                          # Command-line tools
│   ├── dump.py                   # Database export (SQL INSERT format)
│   └── import_data.py            # Database import (parse & execute SQL)
│
└── data/                         # SQLite database directory (auto-created)
```

---

## Entry Point: `main.py`

The application entry point that:
1. Creates the FastAPI app with lifecycle management
2. Initializes the database on startup
3. Registers request logging middleware
4. Mounts static files at `/static`
5. Registers all API routers
6. Serves frontend pages via redirect routes:
   - `/` → `home.html`
   - `/domain` → `domain.html`
   - `/notes` → `notes.html`
   - `/plan` → `plan.html`
   - `/mobile*` → mobile pages
7. Runs in **development** mode (hot-reload, single worker) or **production** mode (no reload, 4 workers)

---

## Backend Modules

### `app/config.py`

Reads environment variables (and `.env` file) into a `Settings` singleton.  
Manages: LLM provider, model, API key, JWT secret, server host/port, database URL, admin username.

### `app/database.py`

Manages the SQLAlchemy engine and session factory:
- **SQLite** (default): auto-creates `data/learn.db`
- **MySQL** (optional): configured via `DATABASE_URL` env var
- Runs automatic migration for legacy tables
- Creates default built-in skills on first startup

### `app/models.py`

Defines 10 SQLAlchemy models:

| Table | Key Fields | Description |
|-------|-----------|-------------|
| `users` | id, username, password_hash | User accounts |
| `areas` | id, user_id, name, description, parent_id, order | Knowledge tree nodes (self-referencing) |
| `chat_messages` | id, area_id, role, content | Chat history |
| `area_notes` | id, area_id, content (HTML) | One rich-text note per domain |
| `note_embeddings` | id, area_id, chunk_text, embedding | RAG vector index chunks |
| `learning_sessions` | id, area_id, summary | Saved learning session summaries |
| `usage_logs` | id, area_id, model, tokens, duration_ms | AI token usage records |
| `area_analyses` | id, area_id, summary, sub_area_summaries, missing_suggestions | AI-generated domain analysis reports |
| `skills` | id, name, prompt_template, is_global, is_default | Reusable prompt templates |
| `login_history` | id, user_id, ip, location, user_agent | Login event records |

### `app/auth.py`

JWT authentication utilities:
- `hash_password()` / `verify_password()` — SHA-256 with random salt
- `create_token()` — JWT token generation (default 72h expiry)
- `get_current_user()` — FastAPI dependency to extract and validate the authenticated user
- `mask_ip()` — IP address masking for privacy

### `app/agents/learning_agent.py`

The core AI agent module using LangChain v1 Agent + SummarizationMiddleware:

- **`LearningAgent` class**: Manages per-domain chat sessions with context inheritance across ancestor domains
  - `chat()` — non-streaming response
  - `chat_stream()` — streaming response via callback handler
  - `add_history()` — loads historical messages from DB

- **Area Analysis Tools** (used by the review feature):
  - `list_sub_areas(area_id)` — lists sub-areas with analysis status
  - `generate_sub_analysis(area_id)` — recursively generates analysis for child domains
  - `generate_parent_analysis(area_id)` — aggregates child analyses into parent summary

- **Sub-area Generation**:
  - `run_generate_subareas_stream()` — AI suggests new sub-areas based on chat history
  - `run_polish_subareas()` — AI polishes sub-area descriptions

- **Review Functions**:
  - `run_examine_agent()` / `run_examine_agent_stream()` — orchestrate the full review workflow

### `app/agents/plan_agent.py`

Plan Mode's recursive exploration engine:
- Depth-first with same-level concurrency (up to MAX_BRANCHES=10)
- Steps per node: generate overview → save as chat → extract sub-domains → create child nodes → recurse
- Supports configurable `max_depth` (default: 2)
- Pushes SSE events: `area_created`, `message`, `progress`, `thinking`

### `app/agents/streaming_handler.py`

LangChain callback handler that captures real-time token output and passes it to an `asyncio.Queue` for SSE streaming:
- `on_llm_new_token()` → `thinking` events
- `on_tool_start()` / `on_tool_end()` → `tool_call` events
- `on_llm_error()` → `error` events

### `app/rag/rag_engine.py`

RAG engine for semantic search across user notes:
- `rebuild_area_index(area_id)` — called in background after note save:
  - Cleans HTML → splits into 500-char chunks → generates embeddings → stores in `note_embeddings`
- `search(query, user_id)` — semantic search:
  - Embeds query → cosine similarity against stored vectors → returns top-K results
  - Falls back to keyword matching if embeddings are unavailable

Support for OpenAI, Ollama, and Anthropic embeddings (Anthropic falls back to keyword).

### API Routes

#### `routes/auth.py`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Register new user |
| POST | `/api/auth/login` | No | Login, returns JWT token |
| GET | `/api/auth/me` | Yes | Get current user info |

#### `routes/areas.py`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/areas/tree` | Yes | Get full knowledge tree |
| GET | `/api/areas` | Yes | List root areas with tree |
| POST | `/api/areas` | Yes | Create area/domain |
| GET | `/api/areas/{id}` | Yes | Get area detail |
| PATCH | `/api/areas/{id}` | Yes | Update area |
| DELETE | `/api/areas/{id}` | Yes | Delete area (recursive) |
| GET | `/api/areas/{id}/siblings` | Yes | List siblings |
| POST | `/api/areas/{id}/examine` | Yes | AI review (non-streaming) |
| POST | `/api/areas/{id}/examine/stream` | Yes | AI review (streaming SSE) |
| POST | `/api/areas/{id}/generate-subareas/stream` | Yes | Generate sub-area suggestions |
| POST | `/api/areas/{id}/polish-subareas` | Yes | Polish descriptions |

#### `routes/chat.py`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/chat` | Yes | Non-streaming chat |
| POST | `/api/chat/stream` | Yes | Streaming chat (SSE) |
| GET | `/api/chat/history/{id}` | Yes | Get chat history |
| GET | `/api/chat/usage/{message_id}` | Yes | Get token usage |
| POST | `/api/chat/session/{id}` | Yes | Save learning session |
| GET | `/api/chat/sessions/{id}` | Yes | List learning sessions |
| DELETE | `/api/chat/message/{id}` | Yes | Delete message |

#### `routes/notes.py`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/notes/{id}` | Yes | Get note (per domain) |
| PUT | `/api/notes/{id}` | Yes | Save note (triggers RAG reindex) |

#### `routes/rag.py`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/rag/search` | Yes | Semantic search across notes |

#### `routes/plan.py`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/plan/start` | Yes | Start Plan Mode exploration (SSE) |

#### `routes/skills.py`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/skills` | Yes | List available skills |
| POST | `/api/skills` | Yes | Create personal skill |
| PATCH | `/api/skills/{id}` | Yes | Update personal skill |
| DELETE | `/api/skills/{id}` | Yes | Delete personal skill |
| GET | `/api/skills/global/list` | Admin | List global skills |
| POST | `/api/skills/global` | Admin | Create global skill |
| PATCH | `/api/skills/global/{id}` | Admin | Update global skill |
| DELETE | `/api/skills/global/{id}` | Admin | Delete global skill |

#### `routes/admin.py`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/stats` | Admin | Get platform statistics |

---

## Frontend Pages

### Desktop Pages

| Page | Path | Description |
|------|------|-------------|
| **Home** | `/static/home.html` | Navigation cards for all features |
| **Domains** | `/static/domain.html` | 3-column: domain tree (left), chat (center), tools panel (right) |
| **Notes** | `/static/notes.html` | 2-column: domain tree (left), Quill rich text editor (right) |
| **Plan** | `/static/plan.html` | Single-page: input domain → real-time SSE exploration progress |
| **Skills** | `/static/skills.html` | CRUD interface for personal and global skill templates |

### Mobile Pages

| Page | Path | Description |
|------|------|-------------|
| **Home** | `/static/mobile/home.html` | Mobile-optimized landing |
| **Domains** | `/static/mobile/index.html` | Chat with slide-over domain panel |
| **Notes** | `/static/mobile/notes.html` | Mobile note editor |
| **Plan** | `/static/mobile/plan.html` | Mobile Plan Mode |

### Key Libraries

- **D3.js v7** — horizontal knowledge tree visualization (force-directed layout)
- **Quill.js** — rich text editor (notes)
- **marked.js** — Markdown-to-HTML rendering
- **highlight.js** — code syntax highlighting in chat messages

---

## CLI Tools

### `cli/dump.py`

Exports the entire database as SQL INSERT statements:
- Respects foreign key dependency order for safe import
- Supports SQLite and MySQL
- Handles `LargeBinary` fields (embeddings), datetime, and string escaping

### `cli/import_data.py`

Imports SQL files generated by `dump.py`:
- Smart SQL statement parsing (handles quoted strings with semicolons)
- Temporarily disables foreign key checks for MySQL (self-referencing areas table)
- Reports insert counts on completion
