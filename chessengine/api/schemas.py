"""Request / response models for the CHESS-IQ engine API."""
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class MoveRequest(BaseModel):
    """
    Ask the engine for its move.

    Send EITHER `fen` (one position) OR `start_fen` + `moves` (a whole game).
    The website sends the game form, so threefold repetition and the fifty-move rule are detected correctly.
    `start_fen` may be null/omitted for the standard starting position. `moves` are UCI strings (e2e4, e7e8q).
    """

    fen: Optional[str] = Field(default=None, max_length=100)
    start_fen: Optional[str] = Field(default=None, max_length=100)
    moves: list[str] = Field(default_factory=list)
    depth: Optional[int] = Field(default=None, ge=1, description="Search depth; defaults to the server setting.")

    @field_validator("moves")
    @classmethod
    def _moves_look_like_uci(cls, value: list[str]) -> list[str]:
        for text in value:
            if not (4 <= len(text) <= 5):
                raise ValueError(f"'{text}' is not a UCI move (expected e.g. e2e4 or e7e8q).")
        return value


class Score(BaseModel):
    """White's point of view. Exactly one of `cp` / `mate` is set."""

    cp: Optional[int] = None
    mate: Optional[int] = None


class Status(BaseModel):
    game_over: bool
    result: str
    termination: Optional[str] = None
    check: bool
    turn: str


class MoveResponse(BaseModel):
    best_move: Optional[str] = Field(description="UCI move, or null when the position is already finished.")
    san: Optional[str] = None
    fen: str = Field(description="Position after the engine's move (or the unchanged position).")
    depth: int
    nodes: int
    tt_hits: int
    elapsed_ms: int
    score: Optional[Score] = None
    status: Status


class ModelInfo(BaseModel):
    name: str
    device: Optional[str] = None
    checkpoint: str
    checkpoint_epoch: Optional[int] = None


class HealthResponse(BaseModel):
    status: str
    ready: bool
    model: ModelInfo
    default_depth: int
    max_depth: int
    max_concurrent_searches: int
    queued_or_running: int
    searches_completed: int
    error: Optional[str] = None