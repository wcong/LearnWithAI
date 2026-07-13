"""RAG 语义搜索路由"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User
from app.rag.rag_engine import engine

router = APIRouter(prefix="/api/rag", tags=["RAG"])


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


@router.post("/search")
async def search_notes(
    req: SearchRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """搜索当前用户的笔记内容（从预构建的 RAG 索引中检索）"""
    results = await engine.search(req.query, user.id, top_k=req.top_k)
    return {"results": results, "total": len(results)}
