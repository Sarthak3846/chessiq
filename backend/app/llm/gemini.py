import json
from typing import AsyncIterator, Optional

import httpx

from ..config import settings
from .base import ProviderError, classify_status


class GeminiProvider:
    name = "gemini"

    def __init__(self, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.transport = transport

    @property
    def configured(self) -> bool:
        return bool(settings.gemini_api_key)

    @staticmethod
    def _convert(messages: list[dict]) -> tuple[Optional[dict], list[dict]]:
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in messages if m["role"] != "system"]
        return ({"parts": [{"text": system}]} if system else None), contents

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        system, contents = self._convert(messages)
        payload: dict = {"contents": contents, "generationConfig": {"temperature": 0.4, "maxOutputTokens": 700}}
        if system:
            payload["systemInstruction"] = system
        url = f"{settings.gemini_base_url}/models/{settings.gemini_model}:streamGenerateContent?alt=sse"
        headers = {"x-goog-api-key": settings.gemini_api_key, "Content-Type": "application/json"}
        timeout = httpx.Timeout(connect=5.0, read=settings.llm_timeout, write=10.0, pool=5.0)
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=self.transport) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as r:
                    if r.status_code != 200:
                        body = (await r.aread()).decode(errors="ignore")[:200]
                        raise ProviderError(self.name, classify_status(r.status_code), f"Gemini HTTP {r.status_code}: {body}", r.status_code)
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        try:
                            obj = json.loads(line[5:].strip())
                        except json.JSONDecodeError:
                            continue
                        if obj.get("promptFeedback", {}).get("blockReason"):
                            raise ProviderError(self.name, "invalid", "Gemini blocked the request.")
                        for cand in obj.get("candidates", []):
                            for part in cand.get("content", {}).get("parts", []):
                                if part.get("text"):
                                    yield part["text"]
        except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as e:
            raise ProviderError(self.name, "retryable", f"Gemini network error: {e.__class__.__name__}") from e