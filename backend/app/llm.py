"""Streams explanations from a vLLM server (OpenAI-compatible /v1/chat/completions). Credentials stay on the backend."""
import json
from typing import AsyncIterator

import httpx

from .config import settings

SYSTEM_PROMPT = """You are the ChessIQ AI Coach: a warm, clear, encouraging chess teacher.

Rules:
- Stockfish has already analysed the position. The ENGINE FACTS block is the ONLY source of evaluations, best moves, lines and move classifications. Quote them exactly; never invent, adjust or guess engine numbers or lines.
- If the facts do not cover something the player asks, say so plainly and give general chess principles instead, clearly marked as general advice.
- Explain WHY, in plain language: ideas, threats, piece activity, king safety, tactics. Avoid dumping long variations.
- When a move was a mistake or blunder, say what it allowed and what to play instead (use engine_best_move), then suggest one habit to improve.
- Answer follow-up questions using the earlier conversation. Keep replies under about 180 words.
- Formatting: short paragraphs separated by blank lines; use **bold** for key moves and "- " bullets sparingly. No headings, no tables, no code blocks."""


class LLMUnavailable(RuntimeError):
    pass


def build_messages(history: list[dict], facts: dict | None) -> list[dict]:
    msgs: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if facts:
        msgs.append({"role": "system", "content": "ENGINE FACTS (Stockfish):\n" + json.dumps(facts, indent=1)})
    msgs.extend(history)
    return msgs


async def stream_completion(messages: list[dict]) -> AsyncIterator[str]:
    headers = {"Content-Type": "application/json"}
    if settings.vllm_api_key:
        headers["Authorization"] = f"Bearer {settings.vllm_api_key}"
    payload = {"model": settings.vllm_model, "messages": messages, "stream": True, "temperature": 0.4, "max_tokens": 600}
    timeout = httpx.Timeout(connect=5.0, read=60.0, write=10.0, pool=5.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", f"{settings.vllm_base_url}/chat/completions", headers=headers, json=payload) as r:
                if r.status_code != 200:
                    body = (await r.aread()).decode(errors="ignore")[:300]
                    raise LLMUnavailable(f"The language model returned HTTP {r.status_code}. {body}")
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        delta = json.loads(data)["choices"][0].get("delta", {}).get("content")
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
                    if delta:
                        yield delta
    except (httpx.ConnectError, httpx.ConnectTimeout):
        raise LLMUnavailable("The language model server is not reachable.")
    except httpx.ReadTimeout:
        raise LLMUnavailable("The language model took too long to respond.")


async def llm_reachable() -> bool:
    headers = {"Authorization": f"Bearer {settings.vllm_api_key}"} if settings.vllm_api_key else {}
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            return (await c.get(f"{settings.vllm_base_url}/models", headers=headers)).status_code == 200
    except httpx.HTTPError:
        return False