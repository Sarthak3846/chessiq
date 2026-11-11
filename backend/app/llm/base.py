from typing import AsyncIterator, Literal, Optional, Protocol

ErrorKind = Literal["retryable", "auth", "invalid"]


class ProviderError(Exception):
    """kind: retryable = rate limit/timeout/5xx (try the next provider); auth = bad credentials (try next, but flag it);
    invalid = the request itself is wrong (do NOT retry anywhere)."""

    def __init__(self, provider: str, kind: ErrorKind, message: str, status: Optional[int] = None, retry_after: Optional[float] = None):
        super().__init__(message)
        self.provider, self.kind, self.status, self.retry_after = provider, kind, status, retry_after


def classify_status(status: int) -> ErrorKind:
    if status in (401, 403):
        return "auth"
    if status in (408, 409, 425, 429) or status >= 500:
        return "retryable"
    return "invalid"


class LLMProvider(Protocol):
    name: str

    @property
    def configured(self) -> bool: ...

    def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        """messages: [{role: system|user|assistant, content}]. Yields text chunks; raises ProviderError."""
        ...