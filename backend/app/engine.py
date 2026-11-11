"""Stockfish service (python-chess UCI). One long-lived engine process guarded by a lock; call via asyncio.to_thread."""
import threading
from typing import Optional

import chess
import chess.engine

from .config import settings


class EngineUnavailable(RuntimeError):
    pass


class StockfishService:
    def __init__(self) -> None:
        self._engine: Optional[chess.engine.SimpleEngine] = None
        self._lock = threading.Lock()

    def _start(self) -> chess.engine.SimpleEngine:
        try:
            eng = chess.engine.SimpleEngine.popen_uci(settings.stockfish_path)
            eng.configure({"Hash": settings.stockfish_hash_mb})
            return eng
        except (FileNotFoundError, PermissionError, chess.engine.EngineError, OSError) as e:
            raise EngineUnavailable(f"Could not start Stockfish at '{settings.stockfish_path}': {e}") from e

    def analyse(self, board: chess.Board, movetime: Optional[float] = None) -> dict:
        """Returns white-POV score, best move and principal variation (SAN) for `board`."""
        limit = chess.engine.Limit(time=movetime or settings.stockfish_movetime)
        with self._lock:
            for attempt in (1, 2):
                try:
                    if self._engine is None:
                        self._engine = self._start()
                    info = self._engine.analyse(board, limit)
                    break
                except (chess.engine.EngineTerminatedError, chess.engine.EngineError):
                    self._engine = None  # crashed: restart once
                    if attempt == 2:
                        raise EngineUnavailable("Stockfish stopped responding.")
        score = info["score"].white()
        pv = info.get("pv", [])
        san, b = [], board.copy()
        for mv in pv[:6]:
            san.append(b.san(mv))
            b.push(mv)
        return {
            "cp": score.score(mate_score=10000),
            "mate": score.mate(),
            "depth": info.get("depth", 0),
            "best_uci": pv[0].uci() if pv else None,
            "best_san": san[0] if san else None,
            "pv_san": san,
        }

    def available(self) -> bool:
        try:
            with self._lock:
                if self._engine is None:
                    self._engine = self._start()
            return True
        except EngineUnavailable:
            return False

    def close(self) -> None:
        with self._lock:
            if self._engine is not None:
                try:
                    self._engine.quit()
                except Exception:
                    pass
                self._engine = None


stockfish = StockfishService()        # interactive requests (chat, analysis)
stockfish_bg = StockfishService()     # background game reviews, so they never block a chat reply