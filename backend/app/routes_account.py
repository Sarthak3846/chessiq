import io
import uuid
from datetime import date, timedelta
from typing import Literal, Optional

import chess.pgn
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from . import analysis, db
from .auth import User, current_user
from .engine import EngineUnavailable, stockfish_bg

router = APIRouter(prefix="/api")
Difficulty = Literal["beginner", "easy", "intermediate", "advanced", "expert", "max"]


class ProfilePatch(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    preferred_difficulty: Optional[Difficulty] = None


class GameIn(BaseModel):
    pgn: str = Field(min_length=1, max_length=50000)
    mode: Literal["coach", "stockfish", "local"]
    opponent: str = Field(max_length=40)
    difficulty: Optional[Difficulty] = None
    player_color: Literal["w", "b"]
    result: Literal["1-0", "0-1", "1/2-1/2"]
    termination: Optional[str] = Field(default=None, max_length=60)


async def ensure_profile(u: User) -> dict:
    return await db.fetch_one(
        """insert into profiles (id, display_name, avatar_url) values (%s, %s, %s)
           on conflict (id) do update set display_name = coalesce(profiles.display_name, excluded.display_name), avatar_url = coalesce(profiles.avatar_url, excluded.avatar_url)
           returning id, display_name, avatar_url, preferred_difficulty, puzzle_rating, created_at""",
        u.id, u.name or (u.email or "Player").split("@")[0], u.avatar)


@router.get("/me")
async def me(u: User = Depends(current_user)):
    p = await ensure_profile(u)
    return {**p, "id": str(p["id"]), "email": u.email}


@router.patch("/me")
async def patch_me(body: ProfilePatch, u: User = Depends(current_user)):
    await ensure_profile(u)
    p = await db.fetch_one(
        "update profiles set display_name = coalesce(%s, display_name), preferred_difficulty = coalesce(%s, preferred_difficulty), updated_at = now() where id = %s "
        "returning id, display_name, avatar_url, preferred_difficulty, puzzle_rating, created_at",
        body.display_name, body.preferred_difficulty, u.id)
    return {**p, "id": str(p["id"]), "email": u.email}


async def _analyse_game(game_id: str, user_id: str, pgn: str) -> None:
    """Background Stockfish review stored on the game row; failure just leaves analysis null."""
    import asyncio
    import json
    try:
        data = await asyncio.to_thread(analysis.review_game_data, pgn, stockfish_bg, 0.12, 80)
        if "error" not in data:
            await db.execute("update games set analysis = %s::jsonb where id = %s and user_id = %s", json.dumps(data), game_id, user_id)
    except (EngineUnavailable, HTTPException, Exception):  # noqa: BLE001 — best effort
        pass


@router.post("/games", status_code=201)
async def save_game(body: GameIn, tasks: BackgroundTasks, u: User = Depends(current_user)):
    game = chess.pgn.read_game(io.StringIO(body.pgn))
    moves = len(list(game.mainline_moves())) if game else 0
    if moves < 1:
        raise HTTPException(422, "That PGN contains no moves.")
    outcome = "draw" if body.result == "1/2-1/2" else "win" if (body.result == "1-0") == (body.player_color == "w") else "loss"
    await ensure_profile(u)
    row = await db.fetch_one(
        """insert into games (user_id, mode, opponent, difficulty, player_color, result, outcome, termination, moves_count, pgn)
           values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id, played_at""",
        u.id, body.mode, body.opponent, body.difficulty, body.player_color, body.result, outcome, body.termination, moves, body.pgn)
    if body.mode != "local":
        tasks.add_task(_analyse_game, str(row["id"]), u.id, body.pgn)
    return {"id": str(row["id"]), "played_at": row["played_at"], "outcome": outcome}


@router.get("/games")
async def list_games(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), u: User = Depends(current_user)):
    rows = await db.fetch_all(
        "select id, played_at, mode, opponent, difficulty, player_color, result, outcome, termination, moves_count, analysis is not null as analysed "
        "from games where user_id = %s order by played_at desc limit %s offset %s", u.id, limit, offset)
    return [{**r, "id": str(r["id"])} for r in rows]


def valid_uuid(value: str, what: str = "Game") -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(404, f"{what} not found.")


@router.get("/games/{game_id}")
async def get_game(game_id: str, u: User = Depends(current_user)):
    row = await db.fetch_one("select * from games where id = %s and user_id = %s", valid_uuid(game_id), u.id)
    if not row:
        raise HTTPException(404, "Game not found.")
    return {**row, "id": str(row["id"]), "user_id": str(row["user_id"])}


@router.delete("/games/{game_id}", status_code=204)
async def delete_game(game_id: str, u: User = Depends(current_user)):
    if not await db.fetch_one("delete from games where id = %s and user_id = %s returning id", valid_uuid(game_id), u.id):
        raise HTTPException(404, "Game not found.")


async def weakness_profile(user_id: str) -> dict:
    rows = await db.fetch_all("select player_color, analysis from games where user_id = %s and analysis is not null order by played_at desc limit 30", user_id)
    prof = analysis.summarize_weaknesses(rows)
    themes = await db.fetch_all(
        """select t as theme, count(*) as attempts, count(*) filter (where a.solved) as solved
           from puzzle_attempts a join puzzles p on p.id = a.puzzle_id, unnest(p.themes) t
           where a.user_id = %s group by t having count(*) >= 3 order by (count(*) filter (where a.solved))::float / count(*) asc, count(*) desc limit 5""", user_id)
    prof["weakest_puzzle_themes"] = [{"theme": r["theme"], "attempts": r["attempts"], "success_rate_pct": round(100 * r["solved"] / r["attempts"])} for r in themes]
    if not prof["available"] and not themes:
        prof["reason"] = "No analysed games or puzzle history stored yet."
    return prof


@router.get("/me/stats")
async def stats(u: User = Depends(current_user)):
    prof = await ensure_profile(u)
    g = await db.fetch_one(
        "select count(*) total, count(*) filter (where outcome='win') wins, count(*) filter (where outcome='loss') losses, count(*) filter (where outcome='draw') draws from games where user_id = %s", u.id)
    by_diff = await db.fetch_all(
        "select mode, coalesce(difficulty,'-') difficulty, count(*) games, count(*) filter (where outcome='win') wins from games where user_id = %s and mode <> 'local' group by 1,2 order by games desc", u.id)
    recent = await db.fetch_all("select id, played_at, mode, opponent, difficulty, outcome, result, termination, moves_count from games where user_id = %s order by played_at desc limit 8", u.id)
    pz = await db.fetch_one(
        """select count(*) attempts, count(*) filter (where solved) solved_attempts, count(distinct puzzle_id) filter (where solved) puzzles_solved,
                  coalesce(round(avg(time_ms) filter (where solved) / 1000.0), 0)::int avg_solve_seconds
           from puzzle_attempts where user_id = %s""", u.id)
    days = await db.fetch_all("select d from (select (played_at at time zone 'utc')::date d from games where user_id=%s union select (created_at at time zone 'utc')::date from puzzle_attempts where user_id=%s) x", u.id, u.id)
    active = {r["d"] for r in days}
    streak, d = 0, date.today()
    if d not in active:
        d -= timedelta(days=1)
    while d in active:
        streak += 1
        d -= timedelta(days=1)
    total = g["total"] or 0
    return {
        "profile": {**prof, "id": str(prof["id"]), "email": u.email},
        "games": {"total": total, "wins": g["wins"], "losses": g["losses"], "draws": g["draws"], "win_rate_pct": round(100 * g["wins"] / total) if total else None},
        "by_difficulty": by_diff,
        "recent_games": [{**r, "id": str(r["id"])} for r in recent],
        "puzzles": {"attempts": pz["attempts"], "puzzles_solved": pz["puzzles_solved"], "accuracy_pct": round(100 * pz["solved_attempts"] / pz["attempts"]) if pz["attempts"] else None,
                    "avg_solve_seconds": pz["avg_solve_seconds"], "rating": prof["puzzle_rating"]},
        "streak_days": streak,
        "weaknesses": await weakness_profile(u.id),
    }