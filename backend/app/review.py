"""Full per-move game review (every ply, real Stockfish numbers) for the Game Review page.

Reuses analysis.classify / eval_text / phase_of so classifications stay identical to the rest of ChessIQ.
Results are cached in memory by game, so navigating the review never re-runs Stockfish.
"""
import hashlib
import io
import threading
from collections import OrderedDict
from typing import Optional

import chess
import chess.pgn

from .analysis import classify, eval_text, phase_of
from .engine import StockfishService, stockfish_bg

PIECE_NAMES = {chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop", chess.ROOK: "rook", chess.QUEEN: "queen", chess.KING: "king"}
MAX_PLIES = 120
MOVETIME = 0.12

_cache: "OrderedDict[str, dict]" = OrderedDict()
_cache_lock = threading.Lock()
_key_locks: dict[str, threading.Lock] = {}
CACHE_SIZE = 64


class ReviewError(ValueError):
    pass


def parse_game(pgn: str) -> tuple[chess.Board, list[chess.Move]]:
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None:
        raise ReviewError("Could not read the PGN.")
    moves = list(game.mainline_moves())
    if not moves:
        raise ReviewError("The PGN contains no moves.")
    return game.board(), moves


def game_key(pgn: str) -> str:
    board, moves = parse_game(pgn)
    raw = board.fen() + "|" + " ".join(m.uci() for m in moves) + f"|{MOVETIME}"
    return hashlib.sha1(raw.encode()).hexdigest()


def move_traits(board: chess.Board, move: chess.Move) -> dict:
    """Facts python-chess can state with certainty about a move (played in `board`, before it is pushed)."""
    piece = board.piece_at(move.from_square)
    captured = board.piece_at(move.to_square)
    if board.is_en_passant(move):
        captured = chess.Piece(chess.PAWN, not board.turn)
    gives_check = board.gives_check(move)
    return {
        "piece": PIECE_NAMES[piece.piece_type] if piece else None,
        "captures": PIECE_NAMES[captured.piece_type] if captured else None,
        "gives_check": gives_check,
        "castles": board.is_castling(move),
        "promotes_to": PIECE_NAMES[move.promotion] if move.promotion else None,
        "from": chess.square_name(move.from_square), "to": chess.square_name(move.to_square),
    }


def review_game(pgn: str, svc: StockfishService = stockfish_bg, movetime: float = MOVETIME, max_plies: int = MAX_PLIES) -> dict:
    board, moves = parse_game(pgn)
    start = svc.analyse(board, movetime)
    prev, out, losses = start, [], {"w": [], "b": []}
    for ply, mv in enumerate(moves[:max_plies], start=1):
        mover, fullmove, fen_before = board.turn, board.fullmove_number, board.fen()
        san, traits = board.san(mv), move_traits(board, mv)
        was_best = mv.uci() == prev["best_uci"]
        board.push(mv)
        if board.is_game_over():
            outcome = board.outcome()
            won = outcome is not None and outcome.winner is not None
            cur = {"cp": (10000 if outcome.winner else -10000) if won else 0, "mate": None, "best_san": None, "pv_san": [], "text": "Checkmate" if won else "Draw"}
        else:
            cur = svc.analyse(board, movetime)
        loss = max(0, min(1000, (1 if mover else -1) * (prev["cp"] - cur["cp"])))
        losses["w" if mover else "b"].append(loss)
        out.append({
            "ply": ply, "move_number": f"{fullmove}{'.' if mover else '...'}", "by": "w" if mover else "b", "san": san, "uci": mv.uci(),
            "fen_before": fen_before, "traits": traits, "phase": phase_of(fullmove),
            "cp_before": prev["cp"], "cp_after": cur["cp"], "eval_before": eval_text(prev["cp"], prev["mate"]), "eval_after": cur.get("text") or eval_text(cur["cp"], cur["mate"]),
            "cp_loss": loss, "classification": classify(loss, was_best), "is_engine_best": was_best,
            "best_san": prev["best_san"], "best_uci": prev["best_uci"], "best_line": prev["pv_san"],
            "reply_san": cur["best_san"], "reply_line": cur["pv_san"],
        })
        prev = cur
    avg = lambda xs: round(sum(xs) / len(xs)) if xs else 0
    return {"start_cp": start["cp"], "start_eval": eval_text(start["cp"], start["mate"]), "plies": out, "total_plies": len(moves),
            "truncated": len(moves) > max_plies, "avg_cp_loss": {"w": avg(losses["w"]), "b": avg(losses["b"])}}


def get_review(pgn: str, svc: StockfishService = stockfish_bg) -> dict:
    """Cached review. Concurrent identical requests share one computation."""
    key = game_key(pgn)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
        lock = _key_locks.setdefault(key, threading.Lock())
    with lock:
        with _cache_lock:
            if key in _cache:
                return _cache[key]
        result = {**review_game(pgn, svc), "game_id": key}
        with _cache_lock:
            _cache[key] = result
            while len(_cache) > CACHE_SIZE:
                _cache.popitem(last=False)
            _key_locks.pop(key, None)
        return result


def get_ply(pgn: str, ply: int, svc: StockfishService = stockfish_bg) -> Optional[dict]:
    r = get_review(pgn, svc)
    return r["plies"][ply - 1] if 1 <= ply <= len(r["plies"]) else None