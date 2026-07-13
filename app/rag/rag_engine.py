"""
RAG 引擎 —— 持久化索引版本

工作流程：
  笔记保存 → rebuild_area_index(area_id)  → 清洗HTML → 分块 → 生成embedding → 写入 note_embeddings 表
  搜索     → search(query, user_id)         → 生成query embedding → 从DB加载所有向量 → 余弦相似度 → Top-K
"""

import logging
import re
import html as html_lib

import numpy as np
from langchain_text_splitters import RecursiveCharacterTextSplitter

log = logging.getLogger("learnwithai.rag")


# ============================================================
#  HTML 清洗（不用 beautifulsoup，减少依赖）
# ============================================================

def clean_html(html_content: str) -> str:
    """从 Quill 编辑器生成的 HTML 中提取纯文本"""
    if not html_content:
        return ""

    text = html_lib.unescape(html_content)

    # 移除 <style>/<script> 块
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)

    # 块级标签 → 换行（保留段落结构）
    text = re.sub(r'</?(?:p|div|br|h[1-6]|li|tr|blockquote|pre|ol|ul)[^>]*>', '\n', text, flags=re.IGNORECASE)

    # 移除剩余所有标签
    text = re.sub(r'<[^>]+>', '', text)

    # 合并多余空白/空行
    text = re.sub(r'\n[ \t]*\n', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)

    return text.strip()


# ============================================================
#  RAG 引擎
# ============================================================

class RAGEngine:
    """RAG 引擎：负责索引构建和语义搜索"""

    def __init__(self):
        self._embeddings = None
        self._text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50,
            separators=["\n\n", "\n", "。", "！", "？", ". ", " ", ""],
        )

    # ── Embeddings 懒加载 ──────────────────────────────────

    def _get_embeddings(self):
        """根据配置构建 Embeddings 实例（懒加载，单例）"""
        if self._embeddings is not None:
            return self._embeddings

        from app.config import settings
        provider = settings.LLM_PROVIDER.lower()

        if provider == "openai":
            from langchain_openai import OpenAIEmbeddings
            kwargs = {"model": "text-embedding-3-small"}
            if settings.LLM_API_KEY:
                kwargs["openai_api_key"] = settings.LLM_API_KEY
            if settings.LLM_API_BASE:
                kwargs["openai_api_base"] = settings.LLM_API_BASE
            self._embeddings = OpenAIEmbeddings(**kwargs)

        elif provider == "ollama":
            from langchain_ollama import OllamaEmbeddings
            self._embeddings = OllamaEmbeddings(model="nomic-embed-text")

        elif provider == "anthropic":
            # Anthropic 不提供 embedding API
            self._embeddings = None

        else:
            raise ValueError(f"不支持的 LLM 提供商: {provider}")

        return self._embeddings

    # ── 索引构建（笔记保存时调用） ────────────────────────

    def rebuild_area_index(self, area_id: int) -> None:
        """重建某个领域的 RAG 索引（在后台线程中执行）

        1. 删除旧索引
        2. 清洗 HTML
        3. 分块
        4. 生成 embedding
        5. 写入 note_embeddings 表
        """
        from app.database import SessionLocal
        from app.models import AreaNote, NoteEmbedding

        db = SessionLocal()
        try:
            # 删除旧索引
            db.query(NoteEmbedding).filter(NoteEmbedding.area_id == area_id).delete()
            db.flush()

            # 获取笔记内容
            note = db.query(AreaNote).filter(AreaNote.area_id == area_id).first()
            if not note or not note.content:
                db.commit()
                log.info("RAG 索引已清除 (area_id=%s)：笔记为空", area_id)
                return

            # 清洗 & 分块
            clean_text = clean_html(note.content)
            if not clean_text:
                db.commit()
                log.info("RAG 索引已清除 (area_id=%s)：清洗后无内容", area_id)
                return

            chunks = self._text_splitter.split_text(clean_text)

            # 生成 embedding
            embedder = self._get_embeddings()
            embeddings = []
            if embedder:
                try:
                    # 同步 embedding（后台线程中安全）
                    embeddings = embedder.embed_documents(chunks)
                    log.info("embedding 生成完成 area_id=%s, chunks=%s", area_id, len(chunks))
                except Exception as e:
                    log.warning("embedding 生成失败 area_id=%s，降级为纯文本索引: %s", area_id, e)
                    embeddings = [None] * len(chunks)
            else:
                embeddings = [None] * len(chunks)

            # 写入 DB
            for i, chunk_text in enumerate(chunks):
                emb_bytes = None
                if embeddings[i] is not None:
                    emb_bytes = np.array(embeddings[i], dtype=np.float32).tobytes()

                db.add(NoteEmbedding(
                    area_id=area_id,
                    chunk_text=chunk_text,
                    embedding=emb_bytes,
                ))

            db.commit()
            log.info("RAG 索引构建完成 area_id=%s, chunks=%s", area_id, len(chunks))

        except Exception as e:
            db.rollback()
            log.error("RAG 索引重建失败 area_id=%s: %s", area_id, e)
        finally:
            db.close()

    # ── 搜索 ──────────────────────────────────────────────

    async def search(self, query: str, user_id: int, top_k: int = 5) -> list[dict]:
        """对用户的所有笔记执行语义搜索

        返回: [{"area_id": int, "area_name": str, "snippet": str, "score": float}, ...]
        """
        from app.database import SessionLocal
        from app.models import Area, NoteEmbedding

        db = SessionLocal()
        try:
            # 获取用户所有领域
            areas = db.query(Area).filter(Area.user_id == user_id).all()
            if not areas:
                return []

            area_ids = [a.id for a in areas]
            area_map = {a.id: a.name for a in areas}

            # 加载所有 embedding 记录
            records = db.query(NoteEmbedding).filter(
                NoteEmbedding.area_id.in_(area_ids)
            ).all()

            if not records:
                return []

            # 生成 query embedding
            embedder = self._get_embeddings()
            query_vec = None

            if embedder:
                try:
                    q_emb = await embedder.aembed_query(query)
                    query_vec = np.array(q_emb, dtype=np.float32)
                except Exception as e:
                    log.warning("query embedding 失败，降级为关键词: %s", e)

            # 有真实 embedding → 余弦相似度搜索
            if query_vec is not None and any(r.embedding for r in records):
                return self._semantic_search(query_vec, records, area_map, top_k)

            # 降级：关键词搜索
            return self._keyword_search(query, records, area_map, top_k)

        finally:
            db.close()

    # ── 内部：语义搜索 ────────────────────────────────────

    def _semantic_search(
        self, query_vec: np.ndarray, records: list, area_map: dict, top_k: int
    ) -> list[dict]:
        """向量余弦相似度搜索"""
        stored_vecs = []
        valid = []
        for r in records:
            if r.embedding:
                stored_vecs.append(np.frombuffer(r.embedding, dtype=np.float32))
                valid.append(r)

        if not stored_vecs:
            return []

        vecs = np.array(stored_vecs, dtype=np.float32)
        query_norm = query_vec / (np.linalg.norm(query_vec) + 1e-10)
        chunk_norms = vecs / (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-10)
        scores = np.dot(chunk_norms, query_norm)

        top_idx = np.argsort(scores)[::-1][:top_k]

        results = []
        for idx in top_idx:
            if scores[idx] < 0.1:
                continue
            rec = valid[idx]
            snippet = rec.chunk_text[:150]
            if len(rec.chunk_text) > 150:
                snippet += "..."
            results.append({
                "area_id": rec.area_id,
                "area_name": area_map.get(rec.area_id, "未知领域"),
                "snippet": snippet,
                "score": round(float(scores[idx]), 4),
            })

        return results

    # ── 内部：关键词降级搜索 ──────────────────────────────

    def _keyword_search(
        self, query: str, records: list, area_map: dict, top_k: int
    ) -> list[dict]:
        """无 embedding 时的降级方案：关键词命中率搜索"""
        query_lower = query.lower()
        query_terms = set(query_lower.split())

        scored = []
        for rec in records:
            text_lower = rec.chunk_text.lower()
            hits = sum(1 for t in query_terms if t in text_lower)
            if hits == 0:
                continue
            first_pos = min(
                (text_lower.find(t) for t in query_terms if t in text_lower),
                default=9999,
            )
            score = hits / (len(query_terms) + 1) * (1 / (1 + first_pos / 1000))
            snippet = rec.chunk_text[:150]
            if len(rec.chunk_text) > 150:
                snippet += "..."
            scored.append({
                "area_id": rec.area_id,
                "area_name": area_map.get(rec.area_id, "未知领域"),
                "snippet": snippet,
                "score": round(score, 4),
            })

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:top_k]


# 全局单例
engine = RAGEngine()
