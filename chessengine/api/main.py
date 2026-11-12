"""
CHESS-IQ engine API (FastAPI).

Run from the chessengine/ directory:
    uvicorn api.main:app --host 0.0.0.0 --port 8001
"""
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .schemas import HealthResponse, MoveRequest, MoveResponse
from .service import (
    EngineBusy,
    EngineService,
    EngineTimeout,
    EngineUnavailable,
    InvalidPosition,
    build_board,
    game_status,
)
from .settings import load_settings

settings = load_settings()
logging.basicConfig(level=getattr(logging, settings.log_level, logging.INFO), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("chessiq.api")

service = EngineService(settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    service.load()          # loads the checkpoint once; failures are reported by /api/health
    yield
    service.close()


app = FastAPI(title="CHESS-IQ Engine API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# ---- very small per-IP rate limit (in memory; protects the CPU, not a security boundary) -------------------
_hits: dict[str, deque] = defaultdict(deque)


def _rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= settings.rate_limit_per_min:
        raise HTTPException(429, "Too many requests. Please wait a few seconds.")
    q.append(now)
    if len(_hits) > 5000:            # keep the table from growing forever
        for key in [k for k, v in _hits.items() if not v or now - v[-1] > 60]:
            _hits.pop(key, None)


@app.get("/api/health", response_model=HealthResponse)
async def health():
    body = HealthResponse(
        status="ok" if service.ready else "unavailable",
        ready=service.ready,
        model=service.info(),
        default_depth=settings.default_depth,
        max_depth=settings.max_depth,
        max_concurrent_searches=settings.max_concurrent_searches,
        queued_or_running=service._pending,
        searches_completed=service.searches_done,
        error=service.error,
    )
    # 503 makes Render / Railway health checks fail loudly when the checkpoint is missing or broken.
    return JSONResponse(status_code=200 if service.ready else 503, content=body.model_dump())


@app.post("/api/engine/move", response_model=MoveResponse)
async def engine_move(req: MoveRequest, request: Request):
    _rate_limit(request)

    depth = req.depth if req.depth is not None else settings.default_depth
    if depth > settings.max_depth:
        raise HTTPException(422, f"Search depth {depth} is above this server's limit of {settings.max_depth}.")

    try:
        board = build_board(req.fen, req.start_fen, req.moves, settings.max_plies)
    except InvalidPosition as exc:
        raise HTTPException(422, str(exc)) from exc

    try:
        result = await service.best_move(board, depth)
    except EngineBusy as exc:
        raise HTTPException(503, str(exc), headers={"Retry-After": "5"}) from exc
    except EngineTimeout as exc:
        raise HTTPException(504, str(exc)) from exc
    except EngineUnavailable as exc:
        raise HTTPException(503, f"The CHESS-IQ engine is unavailable: {exc}") from exc

    if result["game_over_before"]:
        status = result["status"]
        return MoveResponse(
            best_move=None, san=None, fen=board.fen(), depth=0, nodes=0, tt_hits=0, elapsed_ms=0,
            score=None, status=status.as_dict(),
        )

    log.info("move %s depth=%s nodes=%s %sms", result["move"].uci(), result["depth"], result["nodes"], result["elapsed_ms"])
    return MoveResponse(
        best_move=result["move"].uci(),
        san=result["san"],
        fen=result["after"].fen(),
        depth=result["depth"],
        nodes=result["nodes"],
        tt_hits=result["tt_hits"],
        elapsed_ms=result["elapsed_ms"],
        score=result["score"],
        status=result["status"].as_dict(),
    )


@app.get("/")
async def root():
    return {"service": "CHESS-IQ Engine API", "health": "/api/health", "docs": "/docs"}