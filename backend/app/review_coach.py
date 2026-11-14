"""Coach Magnus explanations for single moves. Stockfish decides; the LLM only explains the facts it is given."""
import json
import re
import threading
from collections import OrderedDict
from typing import Literal, Optional

import chess

from .llm.router import LLMFailure, LLMNotConfigured, router as llm_router
from .review import move_traits

Mode = Literal["short", "deep"]

SYSTEM = """You are Coach Magnus, an experienced, friendly chess instructor reviewing one move of a player's game.

Hard rules:
- The ENGINE FACTS block is the only source of evaluations, best moves, lines and the move's classification. Never contradict it, never invent variations, and never state a number or a move that is not in it.
- You may only name moves that appear in ENGINE FACTS (played_move, engine_best_move, or inside the two lines). Describe other ideas in words, without notation.
- Do not decide whether the move was good or bad yourself: the "classification" field already says so. Match your tone to it.
- Use the move traits (piece moved, capture, check, castling) as given; do not claim tactics (forks, pins, skewers, discovered attacks) unless the lines in ENGINE FACTS make them evident. When unsure, speak in general terms (development, centre, king safety, activity).
- If the engine line is empty or short, say less rather than guessing.
- Refer to the side that moved as "you" only if player_side equals played_by; otherwise use the colour name ("White", "Black").
- Voice: conversational, direct about mistakes, encouraging without gushing, educational not judgmental. No headings, lists or emoji.
- classification "best" or "good": say what the move accomplishes, no mistake analysis. inaccuracy/mistake/blunder: say what it allowed or overlooked, then the better move and why, then (deep mode) one thing to remember."""

LENGTH = {"short": "Reply in 1 to 3 sentences, at most 55 words.", "deep": "Reply in 3 to 5 sentences, at most 130 words: what happened, why, what was better, and one lesson."}

_SAN_RE = re.compile(r"\b(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8])(?:=[QRBN])?[+#]?")
_NUM_RE = re.compile(r"(?<![\w.])[+-]?\d+\.\d+")


def _norm(san: str) -> str:
    return san.rstrip("+#")


def build_facts(entry: dict, player_side: Optional[str]) -> dict:
    board = chess.Board(entry["fen_before"])
    best = None
    if entry.get("best_uci"):
        mv = chess.Move.from_uci(entry["best_uci"])
        if mv in board.legal_moves:
            t = move_traits(board, mv)
            best = {"piece": t["piece"], "captures": t["captures"], "gives_check": t["gives_check"], "castles": t["castles"]}
    t = entry["traits"]
    return {
        "move_number": entry["move_number"], "played_by": "White" if entry["by"] == "w" else "Black",
        "player_side": {"w": "White", "b": "Black"}.get(player_side or "", "unknown"), "game_phase": entry["phase"],
        "played_move": entry["san"], "played_move_traits": {"piece": t["piece"], "captures": t["captures"], "gives_check": t["gives_check"], "castles": t["castles"], "promotes_to": t["promotes_to"]},
        "classification": entry["classification"], "played_was_engine_top_choice": entry["is_engine_best"], "centipawn_loss": entry["cp_loss"],
        "evaluation_before": entry["eval_before"], "evaluation_after": entry["eval_after"], "evaluation_note": "pawns from White's point of view; M = forced mate in N",
        "engine_best_move": entry["best_san"], "engine_best_move_traits": best, "engine_best_line": " ".join(entry["best_line"]),
        "opponent_best_reply_after_played_move": entry["reply_san"], "line_after_played_move": " ".join(entry["reply_line"]),
    }


def _allowed_moves(f: dict) -> set[str]:
    toks = [f["played_move"], f["engine_best_move"] or ""] + f["engine_best_line"].split() + f["line_after_played_move"].split()
    return {_norm(t) for t in toks if t}


def _allowed_numbers(f: dict) -> set[str]:
    nums = set(_NUM_RE.findall(f"{f['evaluation_before']} {f['evaluation_after']}"))
    loss = f["centipawn_loss"] / 100
    nums |= {f"{loss:.2f}", f"{loss:.1f}"}
    return {n.lstrip("+-") for n in nums}


def violations(text: str, f: dict) -> list[str]:
    """Anything in the answer that is not backed by the engine facts (moves, evaluation numbers)."""
    bad = [m.group(0) for m in _SAN_RE.finditer(text) if _norm(m.group(0)) not in _allowed_moves(f) and _norm(re.sub(r"=[QRBN]", "", m.group(0))) not in _allowed_moves(f)]
    ok = _allowed_numbers(f)
    bad += [n for n in _NUM_RE.findall(text) if n.lstrip("+-") not in ok]
    return bad


_cache: "OrderedDict[tuple, dict]" = OrderedDict()
_lock = threading.Lock()


def cached(key: tuple) -> Optional[dict]:
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    return None


def store(key: tuple, value: dict) -> None:
    with _lock:
        _cache[key] = value
        while len(_cache) > 2000:
            _cache.popitem(last=False)


async def _complete(messages: list[dict]) -> tuple[str, Optional[str]]:
    text, provider = [], None
    async for kind, val in llm_router.stream(messages):
        if kind == "token":
            text.append(val)
        elif kind == "provider":
            provider = val
    return "".join(text).strip(), provider


async def explain(entry: dict, mode: Mode, player_side: Optional[str]) -> dict:
    """Raises LLMNotConfigured / LLMFailure / ExplanationRejected. Never caches a failure."""
    facts = build_facts(entry, player_side)
    base = [{"role": "system", "content": SYSTEM}, {"role": "system", "content": "ENGINE FACTS:\n" + json.dumps(facts, indent=1)},
            {"role": "user", "content": f"Explain this move to the player. {LENGTH[mode]}"}]
    for attempt in (1, 2):
        msgs = base if attempt == 1 else base + [{"role": "user", "content": "Your previous answer mentioned moves or numbers that are not in ENGINE FACTS. Rewrite it using only what ENGINE FACTS contains."}]
        text, provider = await _complete(msgs)
        if text and not violations(text, facts):
            return {"text": text, "provider": provider}
    raise ExplanationRejected("The coach's explanation did not match the engine analysis, so it was discarded.")


class ExplanationRejected(RuntimeError):
    pass