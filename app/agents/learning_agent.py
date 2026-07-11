"""基于 LangChain v1 的 AI 学习助手 Agent

使用 Agent + SummarizationMiddleware 替代旧的 chain + memory 模式。
支持不同 LLM 后端：OpenAI / Anthropic / Ollama。
"""
from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware
from langchain_core.messages import HumanMessage, AIMessage

from app.config import settings


def _build_llm():
    """根据配置构建 LLM 实例"""
    provider = settings.LLM_PROVIDER.lower()

    if provider == "openai":
        from langchain_openai import ChatOpenAI
        kwargs = {"model": settings.LLM_MODEL, "temperature": settings.LLM_TEMPERATURE}
        if settings.LLM_API_KEY:
            kwargs["api_key"] = settings.LLM_API_KEY
        if settings.LLM_API_BASE:
            kwargs["base_url"] = settings.LLM_API_BASE
        return ChatOpenAI(**kwargs)

    elif provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        kwargs = {"model": settings.LLM_MODEL, "temperature": settings.LLM_TEMPERATURE}
        if settings.LLM_API_KEY:
            kwargs["api_key"] = settings.LLM_API_KEY
        return ChatAnthropic(**kwargs)

    elif provider == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=settings.LLM_MODEL,
            temperature=settings.LLM_TEMPERATURE,
        )

    else:
        raise ValueError(f"不支持的 LLM 提供商: {provider}")


def extract_usage(last_msg, llm, duration_ms: int) -> dict:
    """从 AIMessage 中提取 token 用量和模型信息"""
    usage = {
        "model": getattr(llm, "model_name", "") or getattr(llm, "model", "") or "",
        "provider": _provider_name(),
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "duration_ms": duration_ms,
    }

    # 方式 1: usage_metadata（LangChain 标准化字段）
    um = getattr(last_msg, "usage_metadata", None)
    if um:
        usage["prompt_tokens"] = getattr(um, "input_tokens", 0) or um.get("input_tokens", 0)
        usage["completion_tokens"] = getattr(um, "output_tokens", 0) or um.get("output_tokens", 0)
        usage["total_tokens"] = getattr(um, "total_tokens", 0) or um.get("total_tokens", 0)
        return usage

    # 方式 2: response_metadata（各提供商原始响应）
    rm = getattr(last_msg, "response_metadata", None) or {}
    if not rm:
        return usage

    # OpenAI
    tu = rm.get("token_usage") or rm.get("usage") or {}
    if tu:
        usage["prompt_tokens"] = tu.get("prompt_tokens", 0)
        usage["completion_tokens"] = tu.get("completion_tokens", 0)
        usage["total_tokens"] = tu.get("total_tokens", 0)

    # Anthropic
    if not usage["total_tokens"]:
        usage["prompt_tokens"] = rm.get("input_tokens", 0)
        usage["completion_tokens"] = rm.get("output_tokens", 0)
        usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]

    return usage


def _provider_name() -> str:
    return settings.LLM_PROVIDER.lower()


SYSTEM_PROMPT_TEMPLATE = """你是一位专业的 AI 学习导师，擅长引导用户进行深度学习。

## 当前学习领域
{area_name}

## 领域简介
{area_description}

## 学习指南
1. 首先了解用户在该领域现有的知识水平。
2. 根据用户的兴趣，引导探索该领域的 **子方向 / 核心知识点**。
3. 每次回答后，可以提供 2-3 个建议的**下一步探索方向**，帮助横向拓展知识树。
4. 回答要清晰、结构化，适当使用标题和列表。
5. 如果用户提到具体问题，请深入解答，并提供相关的前沿信息。
6. 对话结束前，可以建议用户将当前所学总结为一个新的子领域节点。

请开始与用户的学习对话。"""


class LearningAgent:
    """单个学习领域的 AI 助手（v1 Agent + Middleware）"""

    def __init__(self, area_name: str, area_description: str = "", session_id: str = "default"):
        self.area_name = area_name
        self.area_description = area_description
        self.session_id = session_id
        self.llm = _build_llm()

        # 编译 system prompt（字段固定后不再变化）
        system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
            area_name=area_name,
            area_description=area_description or "暂无简介",
        )

        # 历史消息（启动时从 DB 加载）
        self._history: list = []

        # 使用 v1 Agent + SummarizationMiddleware
        self._agent = create_agent(
            model=self.llm,
            tools=[],
            system_prompt=system_prompt,
            middleware=[
                SummarizationMiddleware(
                    model=self.llm,
                    trigger={"messages": 20},  # 超过 20 条消息时自动总结
                ),
            ],
        )

    def add_history(self, messages: list[dict]):
        """从数据库加载历史消息到内存"""
        for msg in messages:
            if msg["role"] == "user":
                self._history.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                self._history.append(AIMessage(content=msg["content"]))

    async def ask(self, user_input: str) -> tuple[str, dict]:
        """发送用户消息并获取 AI 回复，返回 (reply, usage_dict)

        usage_dict 结构:
            {"model": str, "provider": str,
             "prompt_tokens": int, "completion_tokens": int, "total_tokens": int}
        """
        import time
        start = time.time()

        result = await self._agent.ainvoke({
            "messages": self._history + [HumanMessage(content=user_input)],
        })

        elapsed = int((time.time() - start) * 1000)

        # create_agent 返回状态 dict，内含 messages 列表
        messages = result.get("messages", [])
        last_msg = messages[-1] if messages else result
        reply = last_msg.content if hasattr(last_msg, "content") else str(last_msg)

        # 用 agent 返回的完整消息列表替换历史（避免重复追加）
        self._history = [m for m in messages if hasattr(m, "content")]

        # 提取用量元数据
        usage = extract_usage(last_msg, self.llm, elapsed)

        return reply, usage
