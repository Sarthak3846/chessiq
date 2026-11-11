"""Turns Stockfish output into compact, trustworthy 'engine facts' for the LLM, and reviews whole games."""
import io
from typing import Optional

import chess
import chess.pgn

from .engine import StockfishService, stockfish


def eval_text(cp: int, mate: Optional[int]) -> str:
    if mate is not None:
        return f"{'+' if mate > 0 else '-'}M{abs(mate)}"
    return f"{cp / 100:+.2f}"


def classify(cp_loss: int, is_best: bool) -> str:
    if is_best or cp_loss <= 10:
        return "best"
    if cp_loss < 50:
        return "good"
    if cp_loss < 100:
        return "inaccuracy"
    if cp_loss < 250:
        return "mistake"
    return "blunder"


def phase_of(fullmove: int) -> str:
    return "opening" if fullmove <= 10 else "middlegame" if fullmove <= 30 else "endgame"


def position_facts(board: chess.Board, movetime: Optional[float] = None, svc: StockfishService = stockfish) -> dict:
    r = svc.analyse(board, movetime)
    return {
        "fen": board.fen(), "side_to_move": "White" if board.turn else "Black",
        "evaluation": eval_text(r["cp"], r["mate"]), "evaluation_note": "pawns from White's point of view; M = forced mate in N",
        "best_move": r["best_san"], "best_line": " ".join(r["pv_san"]), "depth": r["depth"],
        "in_check": board.is_check(), "game_over": board.is_game_over(),
    }


def move_facts(fen_before: str, move_san: str, movetime: Optional[float] = None, svc: StockfishService = stockfish) -> dict:
    board = chess.Board(fen_before)
    mover_white = board.turn
    before = svc.analyse(board, movetime)
    move = board.parse_san(move_san)
    played_uci = move.uci()
    board.push(move)
    after = svc.analyse(board, movetime) if not board.is_game_over() else {"cp": 10000 if mover_white else -10000, "mate": None, "best_san": None, "pv_san": []}
    loss = max(0, min(1000, (1 if mover_white else -1) * (before["cp"] - after["cp"])))
    return {
        "played_move": move_san, "played_by": "White" if mover_white else "Black",
        "evaluation_before": eval_text(before["cp"], before["mate"]), "evaluation_after": eval_text(after["cp"], after["mate"]),
        "centipawn_loss": loss, "classification": classify(loss, played_uci == before["best_uci"]),
        "engine_best_move": before["best_san"], "engine_best_line": " ".join(before["pv_san"]),
        "opponent_best_reply_after_move": after["best_san"],
    }


def review_game_data(pgn: str, svc: StockfishService = stockfish, movetime: float = 0.15, max_plies: int = 90) -> dict:
    """Per-ply Stockfish review. Returns every inaccuracy/mistake/blunder with phase info (stored in games.analysis)."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None:
        return {"error": "Could not read the PGN."}
    board = game.board()
    prev = svc.analyse(board, movetime)
    errors, losses, reviewed = [], {"w": [], "b": []}, 0
    for ply, mv in enumerate(game.mainline_moves(), start=1):
        if ply > max_plies:
            break
        mover = board.turn
        san, fullmove = board.san(mv), board.fullmove_number
        was_best, best_san = mv.uci() == prev["best_uci"], prev["best_san"]
        board.push(mv)
        reviewed = ply
        if board.is_game_over():
            break
        cur = svc.analyse(board, movetime)
        loss = max(0, min(1000, (1 if mover else -1) * (prev["cp"] - cur["cp"])))
        losses["w" if mover else "b"].append(loss)
        cls = classify(loss, was_best)
        if cls in ("inaccuracy", "mistake", "blunder"):
            errors.append({"ply": ply, "move_number": f"{fullmove}{'.' if mover else '...'}", "move": san, "by": "w" if mover else "b",
                           "classification": cls, "cp_loss": loss, "engine_preferred": best_san, "phase": phase_of(fullmove)})
        prev = cur
    avg = lambda xs: round(sum(xs) / len(xs)) if xs else 0
    return {"plies_reviewed": reviewed, "avg_cp_loss": {"w": avg(losses["w"]), "b": avg(losses["b"])}, "errors": errors}


def review_for_chat(pgn: str, svc: StockfishService = stockfish) -> dict:
    d = review_game_data(pgn, svc)
    if "error" in d:
        return d
    names = {"w": "White", "b": "Black"}
    worst = sorted(d["errors"], key=lambda e: -e["cp_loss"])[:6]
    return {"plies_reviewed": d["plies_reviewed"], "average_cp_loss": {"White": d["avg_cp_loss"]["w"], "Black": d["avg_cp_loss"]["b"]},
            "biggest_errors": [{"move_number": e["move_number"], "move": e["move"], "by": names[e["by"]], "classification": e["classification"], "cp_loss": e["cp_loss"], "engine_preferred": e["engine_preferred"], "phase": e["phase"]} for e in worst]}


def summarize_weaknesses(rows: list[dict]) -> dict:
    """rows: games with analysis + player_color. Aggregates the PLAYER's own mistakes across games (real stored data only)."""
    phases = {p: {"inaccuracy": 0, "mistake": 0, "blunder": 0, "moves": 0} for p in ("opening", "middlegame", "endgame")}
    losses, n = [], 0
    for g in rows:
        a = g.get("analysis")
        if not a or "errors" not in a:
            continue
        n += 1
        me = g["player_color"]
        losses.append(a["avg_cp_loss"][me])
        for e in a["errors"]:
            if e["by"] == me:
                phases[e["phase"]][e["classification"]] += 1
    if n == 0:
        return {"available": False, "reason": "No analysed games are stored yet."}
    worst_phase = max(phases, key=lambda p: phases[p]["blunder"] * 3 + phases[p]["mistake"] * 2 + phases[p]["inaccuracy"])
    return {"available": True, "games_analysed": n, "average_cp_loss": round(sum(losses) / len(losses)), "errors_by_phase": phases, "phase_with_most_errors": worst_phase}