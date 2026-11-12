"""Runtime configuration for the CHESS-IQ engine API. Everything is read from environment variables."""
import os
from dataclasses import dataclass, field
from pathlib import Path

# chessengine/ — the directory that contains `src/`, `checkpoints/` and this `api/` package.
ENGINE_ROOT = Path(__file__).resolve().parent.parent


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


def _checkpoint_path() -> Path:
    raw = _env("ENGINE_CHECKPOINT", "checkpoints/model_d_square.pth")
    path = Path(raw)
    # Relative paths are resolved against chessengine/, never against the process working directory.
    return path if path.is_absolute() else (ENGINE_ROOT / path)


def _origins() -> tuple[str, ...]:
    raw = _env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return tuple(o.strip().rstrip("/") for o in raw.split(",") if o.strip())


@dataclass(frozen=True)
class Settings:
    # Model
    checkpoint_path: Path = field(default_factory=_checkpoint_path)
    # Search depth. The default is deliberately small: the search is pure Python and depth 6 can take minutes.
    default_depth: int = field(default_factory=lambda: _int("ENGINE_DEFAULT_DEPTH", 3))
    max_depth: int = field(default_factory=lambda: _int("ENGINE_MAX_DEPTH", 4))
    # How many searches may run at the same time. The search is CPU-bound Python (GIL), so 1 is right for
    # a single small instance; extra requests wait in a queue instead of slowing every game down.
    max_concurrent_searches: int = field(default_factory=lambda: max(1, _int("ENGINE_MAX_CONCURRENT", 1)))
    # How many requests may wait behind the running searches before new ones are rejected with 503.
    max_queue: int = field(default_factory=lambda: max(0, _int("ENGINE_MAX_QUEUE", 8)))
    # How long a request may wait for a free search slot before the API answers 503 (seconds).
    queue_timeout: float = field(default_factory=lambda: _float("ENGINE_QUEUE_TIMEOUT", 60.0))
    # Hard limit on one request (queue wait + search). The search itself cannot be interrupted.
    request_timeout: float = field(default_factory=lambda: _float("ENGINE_REQUEST_TIMEOUT", 120.0))
    # Longest game the API will replay per request (plies).
    max_plies: int = field(default_factory=lambda: _int("ENGINE_MAX_PLIES", 600))
    # Per-IP requests per minute (in memory). Generous, because many players can share one NAT address.
    rate_limit_per_min: int = field(default_factory=lambda: max(1, _int("ENGINE_RATE_LIMIT_PER_MIN", 120)))
    # Torch CPU threads. The network is tiny, so extra intra-op threads only add overhead.
    torch_threads: int = field(default_factory=lambda: max(1, _int("TORCH_NUM_THREADS", 1)))
    # Web
    cors_origins: tuple[str, ...] = field(default_factory=_origins)
    # Optional regex for preview deployments, e.g. https://chessiq-.*\.vercel\.app
    cors_origin_regex: str = field(default_factory=lambda: _env("CORS_ORIGIN_REGEX"))
    log_level: str = field(default_factory=lambda: _env("LOG_LEVEL", "INFO").upper())


def load_settings() -> Settings:
    s = Settings()
    if s.default_depth < 1 or s.max_depth < 1 or s.default_depth > s.max_depth:
        raise RuntimeError(
            f"Invalid depth configuration: ENGINE_DEFAULT_DEPTH={s.default_depth}, ENGINE_MAX_DEPTH={s.max_depth}. "
            "Need 1 <= default <= max."
        )
    return s