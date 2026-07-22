# 📖 LearnWithAI — User Guide

This guide covers all features available after starting the web server.  
Open **http://127.0.0.1:7860** in your browser to get started.

---

## Table of Contents

1. [User Registration & Login](#1-user-registration--login)
2. [Home Page Navigation](#2-home-page-navigation)
3. [Learning Domain Management](#3-learning-domain-management)
4. [AI Chat Conversation](#4-ai-chat-conversation)
5. [Learning Notes](#5-learning-notes)
6. [Plan Mode — Automated Learning Path](#6-plan-mode--automated-learning-path)
7. [Skill Templates](#7-skill-templates)
8. [RAG Semantic Search](#8-rag-semantic-search)
9. [Admin Dashboard](#9-admin-dashboard)
10. [Mobile Interface](#10-mobile-interface)

---

## 1. User Registration & Login

### Registration

On the login page, click the **Register** link and enter a username and password:
- Username: at least 2 characters
- Password: at least 4 characters

### Login

Enter your credentials to receive a JWT token. The token is stored in `localStorage` and persists across page refreshes.

### Automatic Login History

Each login records the IP address (masked), user-agent, and geographic location (via ip-api.com).

---

## 2. Home Page Navigation

After logging in, the home page (`/static/home.html`) shows four navigation cards:

| Card | Description |
|------|-------------|
| **📚 Learning Domains** | Manage knowledge tree & chat with AI tutor |
| **📝 Learning Notes** | Rich text editor for each domain |
| **⚙️ Skill Management** | Create and manage AI prompt templates |
| **💡 Learning Plan** (Experimental) | AI auto-explores a domain and generates a learning path |

---

## 3. Learning Domain Management

**Page**: `/domain` (3-column layout: tree + chat + tools)

### Create a Domain

Click **➕ New Domain** at the top of the left panel, enter a name, and optionally a description.

### Navigate the Knowledge Tree

- The tree expands **horizontally** to the right.
- Click a node to select it — the chat panel and tools activate for that domain.
- Click **➕ Add Sub-area** to create child nodes, enabling infinite drill-down.

  Example progression: `Machine Learning → Supervised Learning → Decision Trees → Random Forests`

### Edit / Delete

- **Right-click** or use the context menu on a node to rename or delete it.
- Deleting a parent node recursively removes all descendants.

### AI Sub-area Review

Click **🔍 Review** to trigger an AI agent that:
1. Lists all sub-areas and their analysis status
2. Recursively generates analysis for missing sub-areas
3. Aggregates them into a parent domain analysis report
4. Suggests missing important sub-directions

A streaming (SSE) version is also available to watch the AI's real-time thinking.

### Generate Sub-area Suggestions

Click **✨ Generate** to have the AI analyze chat history and suggest 3–6 new sub-areas to explore.

### Polish Descriptions

After generating or editing sub-areas, click **🎨 Polish** to have the AI improve descriptions without changing titles.

---

## 4. AI Chat Conversation

**Page**: `/domain` (right panel)

### Start a Chat

Select a domain node, type your question in the chat input, and press Enter.

**The AI tutor will:**
- Assess your current knowledge level
- Guide exploration of core concepts
- Recommend sub-directions for further study (2–3 suggestions per reply)

### Context Inheritance

The AI has access to the **full chain of ancestor domains' chat history**, providing context-aware answers that span the entire knowledge tree.

### Streaming Chat

Use the **streaming mode** to see the AI's response token-by-token in real time via Server-Sent Events (SSE).

### Skill Template Injection

When chatting, select a **Skill Template** from the dropdown to have the AI follow a specific role/format.  
For example, the built-in **"Interview Prep"** skill formats the AI's response as interview preparation material.

### Chat History

All messages are persisted to the database. The chat panel loads the complete history when you revisit.

### Learning Sessions

Click **💾 Save Session** to save a summary of your current learning progress.  
View all saved sessions for a domain via the sessions list.

### Delete Messages

You can delete individual chat messages (this also clears the agent's cache for that domain).

---

## 5. Learning Notes

**Page**: `/notes` (2-column layout: domain tree + rich text editor)

### Editor Features

- Powered by **Quill.js** rich text editor
- Supports headings, bold, italic, lists, code blocks, images, and more
- Content is stored in **HTML format** per domain

### Auto-save & RAG Indexing

When you save a note:
1. The HTML content is stored in the `area_notes` table
2. A background thread **automatically rebuilds the RAG index** for that domain:
   - Cleans HTML → extracts plain text
   - Splits text into chunks (500 chars with 50 overlap)
   - Generates embeddings (via configured LLM provider)
   - Stores chunks & vectors in `note_embeddings` table

### Search Notes (RAG)

See [RAG Semantic Search](#8-rag-semantic-search).

---

## 6. Plan Mode — Automated Learning Path

**Page**: `/plan` (experimental feature)

Plan Mode automatically explores a domain and generates a structured learning tree.

### How to Use

1. Navigate to `/plan` (or click **💡 Learning Plan** on the home page)
2. Enter a domain name (e.g., "Transformer Architecture", "Quantum Computing")
3. Set the **maximum exploration depth** (default: 2)
4. Click **Start**

### What Happens

The AI recursively:
1. Creates a root domain node in your knowledge tree
2. Generates a comprehensive domain overview (800–1500 words)
3. Extracts 3–5 specific, researchable sub-domain directions
4. Creates child nodes for each sub-domain
5. Recursively repeats steps 2–4 for each sub-domain
6. All sub-domains at the same level are explored **concurrently**

The UI shows real-time SSE events:
- **area_created** — new domain nodes being added
- **message** — AI-generated overview content
- **progress** — current exploration depth and status
- **thinking** — real-time AI token output

### Result

The explored domains appear in your knowledge tree with AI-generated overviews saved as chat messages.

---

## 7. Skill Templates

**Page**: `/static/skills.html`

Skill templates are reusable prompt templates that control how the AI responds during chat.

### Types of Skills

| Type | Description |
|------|-------------|
| **Personal Skills** | Created by you, visible only to you |
| **Global Skills** | Created by the admin, visible to all users |
| **Default Skills** | Built-in system skills (e.g., "Interview Prep"), cannot be deleted |

### Create a Personal Skill

1. Click **➕ New Skill**
2. Enter a **name** and **description**
3. Write the **prompt template** using `{topic}` as a placeholder for user input
4. Save — the skill becomes available in the chat dropdown

### Built-in Default Skill: Interview Prep

The system auto-creates an "Interview Prep" skill template that, when activated, asks the AI to provide interview-style coverage of a topic including:
- Core concepts & principles
- Implementation details & architecture
- Practical application scenarios
- Common interview questions with answers

### Admin: Manage Global Skills

The admin user can create, edit, and delete global skills visible to all users.

---

## 8. RAG Semantic Search

RAG (Retrieval-Augmented Generation) allows you to search across all your notes using natural language.

### How Search Works

1. Your query is converted to an **embedding vector** (via configured LLM provider)
2. All note chunks in the database are compared using **cosine similarity**
3. Top-K results are returned with similarity scores
4. **Fallback**: If embeddings aren't available, keyword matching is used

### Access

RAG search is available via the chat interface or programmatically via `POST /api/rag/search`.

---

## 9. Admin Dashboard

**Endpoint**: `GET /api/admin/stats` (JWT token required, admin user only)

The admin dashboard provides:
- **Global Summary**: Total users, domains, messages, and token usage
- **Per-User Breakdown**: Each user's domain count, message count, and token consumption (prompt, completion, total)

Configure the admin username via the `ADMIN_USERNAME` environment variable.

---

## 10. Mobile Interface

The mobile interface provides touch-optimized versions of the main features:

| Page | URL | Description |
|------|-----|-------------|
| Home | `/mobile` | Mobile home page |
| Domains | `/mobile/domain` | Chat + overlay domain navigation |
| Notes | `/mobile/notes` | Note editor for mobile |
| Plan | `/mobile/plan` | Plan Mode for mobile |

### Navigation Pattern

Mobile pages use a **slide-over/sheet pattern**:
- The main content (chat, notes, plan) fills the screen
- Tap a toggle to slide in the domain tree overlay
- Select a domain to update the main content

All features (chat with skills, note editing, Plan Mode, tree navigation) work the same as the desktop version.
