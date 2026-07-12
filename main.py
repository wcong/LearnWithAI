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
import time

import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.routes import areas, chat, auth, notes

# ── 日志配置 ──────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
# 关掉 uvicorn 访问日志的重复（我们用自己 middleware 记录）
logging.getLogger("uvicorn.access").disabled = True
log = logging.getLogger("learnwithai")

# 创建应用
app = FastAPI(title=settings.PROJECT_NAME, description=settings.PROJECT_DESC)


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


@app.get("/")
async def root():
    """重定向到主页面"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/static/index.html")


@app.on_event("startup")
def on_startup():
    """启动时初始化数据库"""
    init_db()
    log.info("数据库初始化完成: %s", settings.DB_PATH)


if __name__ == "__main__":
    print(f"  🌳 LearnWithAI 启动中...")
    print(f"  📡 访问地址: http://{settings.HOST}:{settings.PORT}")
    print(f"  🤖 LLM 后端: {settings.LLM_PROVIDER} / {settings.LLM_MODEL}")
    print(f"  💾 数据库:   {settings.DB_PATH}")
    print()
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
        log_level="debug",
    )
