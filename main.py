"""
LearnWithAI – AI 辅助深度学习平台

启动方式：
    # 1. 安装依赖
    pip install -r requirements.txt

    # 2. 配置环境变量（可选，有默认值）
    export LLM_PROVIDER=openai          # openai / anthropic / ollama
    export LLM_MODEL=gpt-4o-mini        # 模型名
    export LLM_API_KEY=sk-xxx           # API Key
    export LLM_API_BASE=https://xxx     # 自定义 base_url（可选）

    # 3. 启动
    python main.py

打开浏览器访问 http://127.0.0.1:7860
"""
import logging
import os
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db, get_db_type
from app.routes import areas, chat, auth, notes, rag

# ── 日志配置 ──────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
# 关掉 uvicorn 访问日志的重复（我们用自己 middleware 记录）
logging.getLogger("uvicorn.access").disabled = True
log = logging.getLogger("learnwithai")


# ── 生命周期事件（必须在 FastAPI() 之前定义） ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时初始化数据库，关闭时可做资源清理"""
    init_db()
    db_type = get_db_type()
    if db_type == "SQLite":
        log.info("数据库初始化完成 [%s]: %s", db_type, settings.DB_PATH)
    else:
        log.info("数据库初始化完成 [%s]", db_type)
    yield
    # 关闭时在此处添加清理逻辑（如关闭连接池）


# 创建应用
app = FastAPI(title=settings.PROJECT_NAME, description=settings.PROJECT_DESC, lifespan=lifespan)


# ── 请求日志中间件 ─────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """记录每个请求的方法、路径、状态码和耗时"""
    start = time.time()
    try:
        response = await call_next(request)
        elapsed = time.time() - start
        log.info(
            "%s %s → %s (%.0fms)",
            request.method,
            request.url.path,
            response.status_code,
            elapsed * 1000,
        )
        return response
    except Exception as exc:
        elapsed = time.time() - start
        log.exception(
            "%s %s → ❌ %s (%.0fms)",
            request.method,
            request.url.path,
            repr(exc),
            elapsed * 1000,
        )
        # 重新抛出，让 FastAPI 的默认异常处理器处理
        raise


# ── 静态文件 ──────────────────────────────
app.mount("/static", StaticFiles(directory="app/static"), name="static")


# ── 注册路由 ──────────────────────────────
app.include_router(auth.router)
app.include_router(areas.router)
app.include_router(chat.router)
app.include_router(notes.router)
app.include_router(rag.router)


@app.get("/")
async def root():
    """重定向到主页面"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/static/index.html")


if __name__ == "__main__":
    is_dev = os.getenv("ENV", "development").lower() in ("dev", "development", "local")
    if is_dev:
        print(f"  🌳 LearnWithAI 开发模式")
        print(f"  📡 {settings.HOST}:{settings.PORT}")
        print(f"  🤖 {settings.LLM_PROVIDER} / {settings.LLM_MODEL}")
        print(f"  💾 {get_db_type()}: {settings.DB_PATH if get_db_type() == 'SQLite' else settings.DATABASE_URL or settings.DB_PATH}")
        print()
        uvicorn.run(
            "main:app",
            host=settings.HOST,
            port=settings.PORT,
            reload=True,
            log_level="debug",
        )
    else:
        # 生产模式：由 gunicorn 或 systemd 启动，不使用 reload
        import uvicorn
        uvicorn.run(
            "main:app",
            host=settings.HOST,
            port=settings.PORT,
            reload=False,
            log_level="info",
            workers=4,
        )
