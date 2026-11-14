import asyncio
import time
from collections import defaultdict, deque
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from . import review, review_coach
from .engine import EngineUnavailable
from .llm.router import LLMFailure, LLMNotConfigured

router = APIRouter(prefix="/api/review")
_hits: dict[tuple, deque] = defaultdict(deque)


def limit(request: Request, bucket: str, per_min: int) -> None:
    ip, now = (request.client.host if request.client else "unknown"), time.time()
    q = _hits[(bucket, ip)]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= per_min:
        raise HTTPException(429, "Too many requests. Please wait a few seconds and try again.")
    q.append(now)


class ReviewIn(BaseModel):
    pgn: str = Field(min_length=1, max_length=20000)


class ExplainIn(ReviewIn):
    ply: int = Field(ge=1, le=review.MAX_PLIES)
    mode: Literal["short", "deep"] = "short"
    player_side: Optional[Literal["w", "b"]] = None


@router.post("")
async def review_game(body: ReviewIn, request: Request):
    limit(request, "review", 10)
    try:
        return await asyncio.to_thread(review.get_review, body.pgn)
    except review.ReviewError as e:
        raise HTTPException(422, str(e))
    except EngineUnavailable as e:
        raise HTTPException(503, "Stockfish is unavailable, so this game cannot be analysed right now.") from e


@router.post("/explain")
async def explain_move(body: ExplainIn, request: Request):
    limit(request, "explain", 60)
    try:
        entry = await asyncio.to_thread(review.get_ply, body.pgn, body.ply)
    except review.ReviewError as e:
        raise HTTPException(422, str(e))
    except EngineUnavailable as e:
        raise HTTPException(503, "Stockfish is unavailable, so this move cannot be explained right now.") from e
    if entry is None:
        raise HTTPException(404, "That move was not analysed.")
    key = (review.game_key(body.pgn), body.ply, body.mode, body.player_side)
    if hit := review_coach.cached(key):
        return {**hit, "cached": True}
    try:
        result = await review_coach.explain(entry, body.mode, body.player_side)
    except LLMNotConfigured as e:
        raise HTTPException(503, str(e))
    except (LLMFailure, review_coach.ExplanationRejected) as e:
        raise HTTPException(502, str(e))
    review_coach.store(key, result)
    return {**result, "cached": False}