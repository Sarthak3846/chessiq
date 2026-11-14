import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import settings
from .engine import stockfish, stockfish_bg
from .llm.router import router as llm_router
from .routes_account import router as account_router
from .routes_coach import router as coach_router
from .routes_puzzles import router as puzzles_router
from .routes_review import router as review_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.open_pool()
    yield
    await db.close_pool()
    stockfish.close()
    stockfish_bg.close()


app = FastAPI(title="ChessIQ API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "Authorization"])
app.include_router(account_router)
app.include_router(puzzles_router)
app.include_router(coach_router)
app.include_router(review_router)


@app.get("/api/health")
async def health():
    sf = await asyncio.to_thread(stockfish.available)
    providers = llm_router.configured()
    return {
        "status": "ok" if sf and providers else "degraded",
        "stockfish": sf,
        "llm": {"providers": providers, "order": list(settings.llm_provider_order)},
        "database": db.pool is not None,
        "auth": bool(settings.supabase_url or settings.supabase_jwt_secret),
    }