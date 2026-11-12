"""
PyTorch-free runtime for the CHESS-IQ network.

The deployed API only needs the forward pass of the trained network, which is four small linear layers:

    2 x 1024 features -> flatten (2048) -> Linear(2048,128) -> clip(0,1)^2
                      -> Linear(128,64)  -> clip(0,1)
                      -> Linear(64,32)   -> clip(0,1)
                      -> Linear(32,1)

Running that in NumPy gives the same numbers as `src/engine/evaluator.py` (checked by the export script) while
keeping the server small enough for a 512 MB host: PyTorch is not installed at all.

The weights come from an .npz file written ONCE, on a machine that has PyTorch, by `python -m api.export_numpy_weights`.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import numpy as np

from src.features import encode_position  # numpy + python-chess only; no torch


class NumpyEvaluator:
    """Drop-in replacement for NNUEEvaluator: same constructor argument and the same `evaluate_white(fen)`."""

    def __init__(self, checkpoint_path: str = "checkpoints/model_d_square.npz") -> None:
        path = Path(checkpoint_path)
        if not path.is_file():
            raise FileNotFoundError(f"Weights file not found: {path}")
        data = np.load(path)
        self.w0, self.b0 = data["w0"].astype(np.float32), data["b0"].astype(np.float32)   # (128, 2048), (128,)
        self.w1, self.b1 = data["w1"].astype(np.float32), data["b1"].astype(np.float32)   # (64, 128),  (64,)
        self.w2, self.b2 = data["w2"].astype(np.float32), data["b2"].astype(np.float32)   # (32, 64),   (32,)
        self.w3, self.b3 = data["w3"].astype(np.float32), data["b3"].astype(np.float32)   # (1, 32),    (1,)
        epoch = data["epoch"] if "epoch" in data.files else None
        self.checkpoint_epoch = int(epoch) if epoch is not None and epoch.size else None
        self.device = "cpu (numpy)"

    def evaluate_white(self, fen: str) -> float:
        """Evaluation in pawns from White's point of view (same contract as NNUEEvaluator.evaluate_white)."""
        x = encode_position(fen).astype(np.float32).reshape(-1)          # (2048,)
        h = np.clip(self.w0 @ x + self.b0, 0.0, 1.0)
        h = h * h                                                         # squared clipped ReLU
        h = np.clip(self.w1 @ h + self.b1, 0.0, 1.0)
        h = np.clip(self.w2 @ h + self.b2, 0.0, 1.0)
        return float((self.w3 @ h + self.b3)[0])


def install_as_evaluator_module() -> None:
    """
    `src/engine/search.py` does `from src.engine.evaluator import NNUEEvaluator`, and the real evaluator module imports
    PyTorch at import time. When running without PyTorch we register this class under that module name first, so the
    existing search code runs unchanged and never touches torch. Call this BEFORE importing src.engine.search.
    """
    module = types.ModuleType("src.engine.evaluator")
    module.NNUEEvaluator = NumpyEvaluator
    sys.modules["src.engine.evaluator"] = module