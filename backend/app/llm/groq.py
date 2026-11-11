import json
from typing import AsyncIterator, Optional

import httpx

from ..config import settings
from .base import ProviderError, classify_status


def _retry_after(r: httpx.Response) -> Optional[float]:
    try:
        return float(r.headers.get("retry-after", ""))
    except ValueError:
        return None


class GroqProvider:
    name = "groq"

    def __init__(self, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.transport = transport

    @property
    def configured(self) -> bool:
        return bool(settings.groq_api_key)

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        payload = {"model": settings.groq_model, "messages": messages, "stream": True, "temperature": 0.4, "max_tokens": 700}
        headers = {"Authorization": f"Bearer {settings.groq_api_key}", "Content-Type": "application/json"}
        timeout = httpx.Timeout(connect=5.0, read=settings.llm_timeout, write=10.0, pool=5.0)
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=self.transport) as client:
                async with client.stream("POST", f"{settings.groq_base_url}/chat/completions", headers=headers, json=payload) as r:
                    if r.status_code != 200:
                        body = (await r.aread()).decode(errors="ignore")[:200]
                        raise ProviderError(self.name, classify_status(r.status_code), f"Groq HTTP {r.status_code}: {body}", r.status_code, _retry_after(r))
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
        except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as e:
            raise ProviderError(self.name, "retryable", f"Groq network error: {e.__class__.__name__}") from e