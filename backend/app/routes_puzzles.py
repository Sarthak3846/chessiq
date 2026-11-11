import math
import time
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from . import db
from .auth import User, current_user, optional_user
from .routes_account import ensure_profile

router = APIRouter(prefix="/api/puzzles")
COLS = "id, fen, moves, rating, popularity, nb_plays, themes, game_url, opening_tags"
_themes_cache: tuple[float, list] = (0.0, [])


def _public(r: dict) -> dict:
    return {**r, "popularity": r["popularity"], "attribution": "Lichess puzzle database (CC0)", "source_url": f"https://lichess.org/training/{r['id']}"}


async def _pick(where: str, params: list, r: float) -> Optional[dict]:
    row = await db.fetch_one(f"select {COLS} from puzzles where rand >= %s {where} order by rand asc limit 1", r, *params)
    return row or await db.fetch_one(f"select {COLS} from puzzles where rand < %s {where} order by rand desc limit 1", r, *params)


@router.get("/next")
async def next_puzzle(themes: Optional[str] = None, min_rating: int = Query(0, ge=0, le=4000), max_rating: int = Query(4000, ge=0, le=4000),
                      exclude: Optional[str] = None, user: Optional[User] = Depends(optional_user)):
    import random
    where, params = "and rating between %s and %s", [min_rating, max_rating]
    if themes:
        tl = [t for t in themes.split(",") if t.replace("_", "").isalnum()][:8]
        if tl:
            where += " and themes && %s::text[]"; params.append(tl)
    if exclude:
        ex = [x for x in exclude.split(",") if x.isalnum()][:50]
        if ex:
            where += " and not (id = any(%s::text[]))"; params.append(ex)
    if user:  # don't repeat puzzles this player already solved
        where += " and id not in (select puzzle_id from puzzle_attempts where user_id = %s and solved)"; params.append(user.id)
    row = await _pick(where, params, random.random())
    if not row:
        if user:  # solved everything in this slice: allow repeats instead of an empty page
            row = await _pick(where.replace(" and id not in (select puzzle_id from puzzle_attempts where user_id = %s and solved)", ""), params[:-1], random.random())
        if not row:
            raise HTTPException(404, "No puzzles match those filters. Try a wider rating range or another theme.")
    return _public(row)


@router.get("/daily")
async def daily():
    d = date.today()
    frac = ((d.toordinal() * 0.6180339887498949) % 1.0)
    row = await _pick("", [], frac)
    if not row:
        raise HTTPException(404, "The puzzle database is empty. Import puzzles with scripts/import_lichess_puzzles.py.")
    return _public(row)


@router.get("/themes")
async def themes():
    global _themes_cache
    if time.time() - _themes_cache[0] > 600:
        rows = await db.fetch_all("select t as theme, count(*) as count from puzzles, unnest(themes) t group by t order by count desc")
        _themes_cache = (time.time(), rows)
    return _themes_cache[1]


@router.get("/{puzzle_id}")
async def get_puzzle(puzzle_id: str):
    if not puzzle_id.isalnum():
        raise HTTPException(404, "Puzzle not found.")
    row = await db.fetch_one(f"select {COLS} from puzzles where id = %s", puzzle_id)
    if not row:
        raise HTTPException(404, "Puzzle not found.")
    return _public(row)


class AttemptIn(BaseModel):
    solved: bool
    hints_used: int = Field(0, ge=0, le=10)
    mistakes: int = Field(0, ge=0, le=50)
    time_ms: Optional[int] = Field(default=None, ge=0, le=86_400_000)


@router.post("/{puzzle_id}/attempts", status_code=201)
async def record_attempt(puzzle_id: str, body: AttemptIn, u: User = Depends(current_user)):
    p = await db.fetch_one("select rating from puzzles where id = %s", puzzle_id) if puzzle_id.isalnum() else None
    if not p:
        raise HTTPException(404, "Puzzle not found.")
    prof = await ensure_profile(u)
    first = not await db.fetch_one("select 1 from puzzle_attempts where user_id = %s and puzzle_id = %s limit 1", u.id, puzzle_id)
    await db.execute("insert into puzzle_attempts (user_id, puzzle_id, solved, hints_used, mistakes, time_ms) values (%s,%s,%s,%s,%s,%s)",
                     u.id, puzzle_id, body.solved, body.hints_used, body.mistakes, body.time_ms)
    rating, delta = prof["puzzle_rating"], 0
    if first:  # Elo-style update, only for a puzzle's first attempt so retries can't be farmed
        score = 1.0 if body.solved and not body.hints_used and not body.mistakes else 0.5 if body.solved else 0.0
        expected = 1 / (1 + math.pow(10, (p["rating"] - rating) / 400))
        delta = round(24 * (score - expected))
        rating = max(100, rating + delta)
        await db.execute("update profiles set puzzle_rating = %s where id = %s", rating, u.id)
    return {"rating": rating, "delta": delta}