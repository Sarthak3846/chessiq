"""
One-off export of the trained checkpoint to a PyTorch-free .npz file.

Run on a machine that has PyTorch (your own PC), from the chessengine/ directory:

    python -m api.export_numpy_weights
    python -m api.export_numpy_weights --checkpoint checkpoints/model_d_square.pth --out checkpoints/model_d_square.npz

It then checks the NumPy forward pass against the real PyTorch evaluator on a set of positions and refuses to finish
if they disagree.
"""
import argparse
import sys
from pathlib import Path

import chess
import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.engine.evaluator import NNUEEvaluator  # noqa: E402  (the real, torch-based evaluator)

from api.numpy_evaluator import NumpyEvaluator  # noqa: E402

# Layer indices inside ChessIQNNUE.network (activations sit between them and have no weights)
LAYERS = {"0": "w0", "2": "w1", "4": "w2", "6": "w3"}
CHECK_FENS = [
    chess.STARTING_FEN,
    "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
    "r2q1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2Q1RK1 w - - 0 10",
    "8/8/4k3/8/8/3K4/4P3/8 w - - 0 1",
    "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3",
    "4k3/8/8/8/8/8/4P3/4K2R w K - 37 60",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="checkpoints/model_d_square.pth")
    ap.add_argument("--out", default="checkpoints/model_d_square.npz")
    args = ap.parse_args()

    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    state = ckpt["model_state_dict"]
    arrays = {}
    for idx, name in LAYERS.items():
        arrays[name] = state[f"network.{idx}.weight"].numpy()
        arrays["b" + name[1:]] = state[f"network.{idx}.bias"].numpy()
    arrays["epoch"] = np.array(ckpt.get("epoch", -1))
    np.savez_compressed(args.out, **arrays)
    print(f"Wrote {args.out} ({Path(args.out).stat().st_size // 1024} KB)")

    torch_eval = NNUEEvaluator(args.checkpoint)
    numpy_eval = NumpyEvaluator(args.out)
    worst = 0.0
    for fen in CHECK_FENS:
        a, b = torch_eval.evaluate_white(fen), numpy_eval.evaluate_white(fen)
        worst = max(worst, abs(a - b))
        print(f"  torch {a:+.6f}  numpy {b:+.6f}  {fen}")
    if worst > 1e-3:
        raise SystemExit(f"FAILED: NumPy and PyTorch disagree by {worst:.6f} pawns. Do not use the .npz file.")
    print(f"OK: largest difference {worst:.2e} pawns")


if __name__ == "__main__":
    main()