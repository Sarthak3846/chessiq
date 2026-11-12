"""
CHESS-IQ engine service.

* The neural network is loaded ONCE (at application start-up) and shared by every request.
* Each request creates its own lightweight `ChessIQSearch` object (search counters + transposition table),
  so two games can never see each other's search state. The only shared object is the read-only evaluator.
* Searches run on a small thread pool, so the event loop stays responsive and the number of simultaneous
  searches is bounded. Requests beyond the bound wait in a queue; a full queue is rejected with an error.
* The API is stateless: every request carries the game's start position and move list, which the server
  replays and validates. Nothing about a game is kept between requests.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Optional

import chess

from .settings import ENGINE_ROOT, Settings

# The engine package uses `from src...` imports relative to chessengine/.
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

log = logging.getLogger("chessiq.engine")

MATE_SCORE = 10000          # same constant as src/engine/search.py
MATE_THRESHOLD = 9900       # same threshold as src/engine/uci.py


class EngineUnavailable(RuntimeError):
    """The model could not be loaded, or the engine failed while searching."""


class EngineBusy(RuntimeError):
    """Too many searches are waiting."""


class EngineTimeout(RuntimeError):
    """The request did not finish in time."""


class InvalidPosition(ValueError):
    """The FEN or move list sent by the client is not valid chess."""


@dataclass
class GameStatus:
    game_over: bool
    result: str                 # "1-0" | "0-1" | "1/2-1/2" | "*"
    termination: Optional[str]
    check: bool
    turn: str                   # "w" | "b"

    def as_dict(self) -> dict:
        return {
            "game_over": self.game_over,
            "result": self.result,
            "termination": self.termination,
            "check": self.check,
            "turn": self.turn,
        }


def game_status(board: chess.Board) -> GameStatus:
    """Terminal-state detection. Draw rules match the website (chess.js): stalemate, insufficient material,
    threefold repetition and the fifty-move rule all end the game."""
    turn = "w" if board.turn == chess.WHITE else "b"
    check = board.is_check()
    if board.is_checkmate():
        # The side to move has been mated.
        return GameStatus(True, "0-1" if board.turn == chess.WHITE else "1-0", "Checkmate", check, turn)
    if board.is_stalemate():
        return GameStatus(True, "1/2-1/2", "Stalemate", check, turn)
    if board.is_insufficient_material():
        return GameStatus(True, "1/2-1/2", "Insufficient material", check, turn)
    if board.is_repetition(3):
        return GameStatus(True, "1/2-1/2", "Threefold repetition", check, turn)
    if board.halfmove_clock >= 100:
        return GameStatus(True, "1/2-1/2", "Fifty-move rule", check, turn)
    return GameStatus(False, "*", None, check, turn)


def build_board(fen: Optional[str], start_fen: Optional[str], moves: list[str], max_plies: int) -> chess.Board:
    """Rebuild and validate a position. Either `fen` (a single position) or `start_fen` + `moves` (a game)."""
    if fen and (start_fen or moves):
        raise InvalidPosition("Send either `fen`, or `start_fen` with `moves` — not both.")
    if len(moves) > max_plies:
        raise InvalidPosition(f"Too many moves ({len(moves)}); the limit is {max_plies}.")

    base = fen or start_fen
    try:
        board = chess.Board(base) if base else chess.Board()
    except ValueError as exc:
        raise InvalidPosition(f"Invalid FEN: {exc}") from exc
    if not board.is_valid():
        problems = [flag.name for flag in chess.Status if flag != chess.STATUS_VALID and board.status() & flag]
        raise InvalidPosition("Illegal position: " + ", ".join(problems or ["invalid"]).lower().replace("_", " "))

    for index, text in enumerate(moves, start=1):
        try:
            move = chess.Move.from_uci(text)
        except ValueError as exc:
            raise InvalidPosition(f"Move {index} ('{text}') is not valid UCI notation.") from exc
        if move not in board.legal_moves:
            raise InvalidPosition(f"Move {index} ('{text}') is illegal in the position after {index - 1} move(s).")
        board.push(move)
    return board


def score_to_dict(score_white: float) -> dict:
    """Search score (pawns, White's point of view) -> {cp, mate}. Mate score = MATE_SCORE - plies."""
    if abs(score_white) >= MATE_THRESHOLD:
        plies = max(1, round(MATE_SCORE - abs(score_white)))
        moves_to_mate = (plies + 1) // 2
        return {"cp": None, "mate": moves_to_mate if score_white > 0 else -moves_to_mate}
    return {"cp": int(round(score_white * 100)), "mate": None}


class EngineService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.evaluator = None
        self.error: Optional[str] = None
        self.loaded_in: float = 0.0
        self._pool: Optional[ThreadPoolExecutor] = None
        self._lock = threading.Lock()
        self._pending = 0          # searches queued or running
        self.max_pending = settings.max_concurrent_searches + settings.max_queue
        self.searches_done = 0

    # ------------------------------------------------------------------ lifecycle
    def load(self) -> None:
        """Load the checkpoint once. Never raises: failures are stored so /api/health can report them."""
        started = time.perf_counter()
        try:
            import torch

            torch.set_num_threads(self.settings.torch_threads)
            path = self.settings.checkpoint_path
            if not path.is_file():
                raise FileNotFoundError(f"Checkpoint not found: {path}")

            from src.engine.evaluator import NNUEEvaluator   # existing class, unchanged

            self.evaluator = NNUEEvaluator(checkpoint_path=str(path))
            # Warm-up: proves the model + feature encoder work before we report ready.
            self.evaluator.evaluate_white(chess.STARTING_FEN)
            self.error = None
            self._pool = ThreadPoolExecutor(
                max_workers=self.settings.max_concurrent_searches, thread_name_prefix="chessiq-search"
            )
            self.loaded_in = time.perf_counter() - started
            log.info("CHESS-IQ model ready in %.2fs (device=%s)", self.loaded_in, self.evaluator.device)
        except Exception as exc:  # noqa: BLE001 - reported through /api/health
            self.evaluator = None
            self.error = f"{type(exc).__name__}: {exc}"
            log.exception("Could not load the CHESS-IQ model")

    def close(self) -> None:
        if self._pool is not None:
            self._pool.shutdown(wait=False, cancel_futures=True)
            self._pool = None

    @property
    def ready(self) -> bool:
        return self.evaluator is not None and self._pool is not None

    def info(self) -> dict:
        ev = self.evaluator
        return {
            "name": "CHESS-IQ NNUE",
            "device": str(ev.device) if ev is not None else None,
            "checkpoint": self.settings.checkpoint_path.name,
            "checkpoint_epoch": getattr(ev, "checkpoint_epoch", None) if ev is not None else None,
        }

    # ------------------------------------------------------------------ search
    def _search_sync(self, board: chess.Board, depth: int) -> dict:
        from src.engine.search import ChessIQSearch    # existing class, unchanged

        # A fresh search object per request: its node counters and transposition table are private.
        search = ChessIQSearch(evaluator=self.evaluator)
        started = time.perf_counter()
        result = search.search_best_move(board.fen(), depth=depth)
        result["elapsed_ms"] = int((time.perf_counter() - started) * 1000)
        return result

    async def best_move(self, board: chess.Board, depth: int) -> dict:
        if not self.ready:
            raise EngineUnavailable(self.error or "The engine is not loaded.")

        status_before = game_status(board)
        if status_before.game_over:
            return {"game_over_before": True, "status": status_before}

        with self._lock:
            if self._pending >= self.max_pending:
                raise EngineBusy("The engine is busy with other games. Please try again in a moment.")
            self._pending += 1

        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(self._pool, self._search_sync, board.copy(stack=False), depth)

        def _release(_: object) -> None:
            with self._lock:
                self._pending -= 1

        # The slot is released when the search really finishes (even if the client gave up waiting).
        future.add_done_callback(_release)

        try:
            result = await asyncio.wait_for(asyncio.shield(future), timeout=self.settings.request_timeout)
        except asyncio.TimeoutError as exc:
            future.cancel()  # only succeeds if the search has not started yet
            raise EngineTimeout("The engine took too long to answer. Try a lower search depth.") from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("Search failed")
            raise EngineUnavailable(f"Engine search failed: {exc}") from exc

        move = result.get("best_move")
        if move is None or move not in board.legal_moves:
            # Never forward a move the rules do not allow.
            raise EngineUnavailable(f"Engine returned no legal move (got {move!r}).")

        san = board.san(move)
        after = board.copy(stack=True)
        after.push(move)
        self.searches_done += 1
        return {
            "game_over_before": False,
            "move": move,
            "san": san,
            "after": after,
            "depth": result["depth"],
            "nodes": result["nodes"],
            "tt_hits": result["tt_hits"],
            "elapsed_ms": result["elapsed_ms"],
            "score": score_to_dict(result["evaluation"]),
            "status": game_status(after),
        }