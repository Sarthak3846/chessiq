"""Provider chain with fallback. Add a provider = implement LLMProvider and register it in `build_router`."""
import logging
import time
from typing import AsyncIterator, Optional

from ..config import settings
from .base import LLMProvider, ProviderError
from .gemini import GeminiProvider
from .groq import GroqProvider

log = logging.getLogger("chessiq.llm")


class LLMNotConfigured(RuntimeError):
    pass


class LLMFailure(RuntimeError):
    """No provider could answer (message is safe to show to the user)."""


class LLMRouter:
    def __init__(self, providers: list[LLMProvider]):
        self.providers = providers
        self._cooldown: dict[str, float] = {}

    def configured(self) -> list[str]:
        return [p.name for p in self.providers if p.configured]

    async def stream(self, messages: list[dict]) -> AsyncIterator[tuple[str, str]]:
        """Yields ('provider', name) once, optional ('notice', text), then ('token', text)…"""
        candidates = [p for p in self.providers if p.configured]
        if not candidates:
            raise LLMNotConfigured("No language model is configured on the server (set GROQ_API_KEY and/or GEMINI_API_KEY).")
        notices: list[str] = []
        failures: list[str] = []
        now = time.monotonic()
        ready = [p for p in candidates if self._cooldown.get(p.name, 0) <= now]
        for p in (ready or candidates):  # if everything is cooling down, try anyway
            started = False
            try:
                async for tok in p.stream(messages):
                    if not started:
                        started = True
                        yield ("provider", p.name)
                        if notices:
                            yield ("notice", " ".join(notices))
                    yield ("token", tok)
                if not started:
                    raise ProviderError(p.name, "retryable", f"{p.name} returned an empty response")
                return
            except ProviderError as e:
                log.warning("LLM provider %s failed (%s): %s", p.name, e.kind, e)
                if started:  # can't splice two answers together
                    raise LLMFailure("The language model stopped responding mid-answer. Please try again.") from e
                if e.kind == "invalid":  # our request is wrong; another provider would fail the same way
                    raise LLMFailure("The language model rejected the request. Try rephrasing your question.") from e
                self._cooldown[p.name] = time.monotonic() + (300 if e.kind == "auth" else min(e.retry_after or (20 if e.status == 429 else 5), 120))
                failures.append(f"{p.name}: {'credentials rejected' if e.kind == 'auth' else 'rate limited' if e.status == 429 else 'unavailable'}")
                notices.append(f"{p.name.capitalize()} was {'misconfigured' if e.kind == 'auth' else 'busy' if e.status == 429 else 'unavailable'}, so another provider answered.")
        raise LLMFailure("The AI Coach is temporarily unavailable (" + "; ".join(failures) + "). Please try again shortly.")


def build_router(transports: Optional[dict] = None) -> LLMRouter:
    t = transports or {}
    registry = {"groq": lambda: GroqProvider(t.get("groq")), "gemini": lambda: GeminiProvider(t.get("gemini"))}
    return LLMRouter([registry[n]() for n in settings.llm_provider_order if n in registry])


router = build_router()