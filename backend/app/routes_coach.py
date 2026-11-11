import asyncio
import json
import re
import time
from collections import defaultdict, deque
from typing import Literal, Optional

import chess
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from . import analysis, db
from .auth import User, current_user, optional_user
from .config import settings
from .engine import EngineUnavailable, stockfish
from .llm.router import (
    LLMFailure,
    LLMNotConfigured,
    router as llm_router,
)
from .prompts import build_messages
from .routes_account import valid_uuid, weakness_profile

router = APIRouter(prefix="/api/coach")
_hits: dict[str, deque] = defaultdict(deque)
REVIEW_WORDS = re.compile(r"review|summar|key moment|mistakes|blunders|how did i (play|do)|my game", re.I)
WEAKNESS_WORDS = re.compile(r"weakness|recurring|pattern|keep (making|missing)|what should i (practi|work|improve|study)|improve", re.I)


def rate_limit(request: Request) -> None:
    ip, now = (request.client.host if request.client else "unknown"), time.time()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= settings.rate_limit_per_min:
        raise HTTPException(429, "You are asking questions very quickly. Please wait a few seconds and try again.")
    q.append(now)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class MoveContext(BaseModel):
    san: str = Field(max_length=12)
    fen_before: str = Field(max_length=100)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=60)
    fen: Optional[str] = Field(default=None, max_length=100)
    move: Optional[MoveContext] = None
    pgn: Optional[str] = Field(default=None, max_length=20000)
    conversation_id: Optional[str] = Field(default=None, max_length=40)
    retry: bool = False  # re-asking after an error: don't store the user message twice

    @field_validator("messages")
    @classmethod
    def last_is_user(cls, v):
        if v[-1].role != "user":
            raise ValueError("The last message must come from the user.")
        return v


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def suggestions(facts: dict) -> list[str]:
    m = facts.get("move")
    if m and m["classification"] in ("mistake", "blunder", "inaccuracy"):
        return ["What should I have played?", "What did that move allow?", "How do I avoid this next time?"]
    if m:
        return ["What is the idea behind it?", "What should I do next?", "Is there a better alternative?"]
    if facts.get("game_review"):
        return ["Explain my biggest mistake", "What should I practise?", "Which opening should I study?"]
    if facts.get("player_profile"):
        return ["Give me a training plan", "Show my weakest phase", "Which puzzles should I do?"]
    if facts.get("position"):
        return ["What is the plan here?", "Is there a tactic?", "Why is that the best move?"]
    return ["Analyse a position", "Teach me a tactic", "Explain an opening idea"]


def gather_engine_facts(req: ChatRequest) -> dict:
    facts: dict = {}
    if req.move:
        try:
            chess.Board(req.move.fen_before)
            facts["move"] = analysis.move_facts(req.move.fen_before, req.move.san)
        except ValueError:
            raise HTTPException(422, "That move is not legal in the given position.")
    if req.fen:
        facts["position"] = analysis.position_facts(chess.Board(req.fen))
    if req.pgn and REVIEW_WORDS.search(req.messages[-1].content):
        facts["game_review"] = analysis.review_for_chat(req.pgn)
    return facts


async def _own_conversation(cid: str, user_id: str) -> dict:
    row = await db.fetch_one("select id, title from conversations where id = %s and user_id = %s", valid_uuid(cid, "Conversation"), user_id)
    if not row:
        raise HTTPException(404, "Conversation not found.")
    return row


@router.post("/chat")
async def chat(req: ChatRequest, request: Request, user: Optional[User] = Depends(optional_user)):
    rate_limit(request)
    if req.fen:
        try:
            chess.Board(req.fen)
        except ValueError:
            raise HTTPException(422, "That FEN is not a valid position.")
    convo = None
    if req.conversation_id:
        if not user:
            raise HTTPException(401, "Sign in to save conversations.")
        convo = await _own_conversation(req.conversation_id, user.id)
        if not req.retry:
            await db.execute("insert into messages (conversation_id, user_id, role, content) values (%s,%s,'user',%s)", convo["id"], user.id, req.messages[-1].content)
        if convo["title"] == "New conversation":
            await db.execute("update conversations set title = %s where id = %s and user_id = %s", req.messages[-1].content[:60], convo["id"], user.id)

    async def events():
        facts: dict = {}
        try:
            facts = await asyncio.to_thread(gather_engine_facts, req)
        except EngineUnavailable as e:
            facts = {"engine": "UNAVAILABLE — Stockfish could not be reached, so no evaluations, best moves or lines are available for this question."}
            yield sse("warning", {"message": "Engine analysis is unavailable right now. The Coach will not quote evaluations."})
        except HTTPException as e:
            yield sse("error", {"message": e.detail})
            return
        if WEAKNESS_WORDS.search(req.messages[-1].content):
            try:
                facts["player_profile"] = await weakness_profile(user.id) if user else {"available": False, "reason": "The player is not signed in, so no history is stored."}
            except HTTPException:
                facts["player_profile"] = {"available": False, "reason": "Player history is temporarily unavailable."}
        yield sse("analysis", {"facts": facts, "suggestions": suggestions(facts)})
        messages = build_messages([m.model_dump() for m in req.messages][-12:], facts or None)
        text, provider = [], None
        try:
            async for kind, val in llm_router.stream(messages):
                if kind == "token":
                    text.append(val)
                    yield sse("token", {"t": val})
                else:
                    if kind == "provider":
                        provider = val
                    yield sse("meta", {kind: val})
        except (LLMNotConfigured, LLMFailure) as e:
            yield sse("error", {"message": str(e)})
            return
        if convo and user and text:
            try:
                await db.execute("insert into messages (conversation_id, user_id, role, content, facts, provider) values (%s,%s,'assistant',%s,%s::jsonb,%s)",
                                 convo["id"], user.id, "".join(text), json.dumps(facts, default=str), provider)
                await db.execute("update conversations set updated_at = now() where id = %s and user_id = %s", convo["id"], user.id)
            except HTTPException:
                pass
        yield sse("done", {})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class ConvoIn(BaseModel):
    title: str = Field(default="New conversation", max_length=60)


@router.get("/conversations")
async def list_conversations(u: User = Depends(current_user)):
    rows = await db.fetch_all("select id, title, updated_at from conversations where user_id = %s order by updated_at desc limit 50", u.id)
    return [{**r, "id": str(r["id"])} for r in rows]


@router.post("/conversations", status_code=201)
async def create_conversation(body: ConvoIn, u: User = Depends(current_user)):
    r = await db.fetch_one("insert into conversations (user_id, title) values (%s, %s) returning id, title, updated_at", u.id, body.title)
    return {**r, "id": str(r["id"])}


@router.get("/conversations/{cid}/messages")
async def conversation_messages(cid: str, u: User = Depends(current_user)):
    await _own_conversation(cid, u.id)
    rows = await db.fetch_all("select id, role, content, facts, provider, created_at from messages where conversation_id = %s and user_id = %s order by created_at", cid, u.id)
    return [{**r, "id": str(r["id"])} for r in rows]


@router.delete("/conversations/{cid}", status_code=204)
async def delete_conversation(cid: str, u: User = Depends(current_user)):
    await _own_conversation(cid, u.id)
    await db.execute("delete from conversations where id = %s and user_id = %s", cid, u.id)