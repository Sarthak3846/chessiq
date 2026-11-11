import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _e(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


@dataclass
class Settings:
    # LLM providers
    llm_provider_order: tuple[str, ...] = tuple(p.strip() for p in _e("LLM_PROVIDER_ORDER", "groq,gemini").split(",") if p.strip())
    llm_timeout: float = float(_e("LLM_TIMEOUT", "45"))
    groq_api_key: str = _e("GROQ_API_KEY")
    groq_model: str = _e("GROQ_MODEL", "llama-3.3-70b-versatile")
    groq_base_url: str = _e("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
    gemini_api_key: str = _e("GEMINI_API_KEY")
    gemini_model: str = _e("GEMINI_MODEL", "gemini-2.5-flash")
    gemini_base_url: str = _e("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
    # Stockfish
    stockfish_path: str = _e("STOCKFISH_PATH", "stockfish")
    stockfish_movetime: float = float(_e("STOCKFISH_MOVETIME", "0.8"))
    stockfish_hash_mb: int = int(_e("STOCKFISH_HASH_MB", "64"))
    # Supabase / database
    supabase_url: str = _e("SUPABASE_URL").rstrip("/")
    supabase_jwt_secret: str = _e("SUPABASE_JWT_SECRET")
    supabase_jwks_url: str = _e("SUPABASE_JWKS_URL")  # optional override; default derived from SUPABASE_URL
    database_url: str = _e("DATABASE_URL")
    # Web
    cors_origins: tuple[str, ...] = field(default_factory=lambda: tuple(o.strip() for o in _e("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()))
    rate_limit_per_min: int = int(_e("RATE_LIMIT_PER_MIN", "20"))

    @property
    def jwks_url(self) -> str:
        return self.supabase_jwks_url or (f"{self.supabase_url}/auth/v1/.well-known/jwks.json" if self.supabase_url else "")


settings = Settings()