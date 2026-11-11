
import chess
import numpy as np
from src.engine.evaluator import NNUEEvaluator


evaluator = NNUEEvaluator()

test_positions = {
    "Starting position": chess.STARTING_FEN,

    "White has extra queen": (
        "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/"
        "RNBQKBNR w KQkq - 0 1"
    ),

    "Black has extra queen": (
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/"
        "RNB1KBNR b KQkq - 0 1"
    )
}

print("\n========== EVALUATOR TEST ==========")

for name, fen in test_positions.items():

    white_score = evaluator.evaluate_white(fen)
    side_score = evaluator.evaluate_for_side_to_move(fen)

    print(f"\n{name}")
    print(f"White perspective: {white_score:.4f} pawns")
    print(f"Side to move: {side_score:.4f} pawns")

    assert isinstance(white_score, float)
    assert np.isfinite(white_score)

print("\nAll evaluator tests completed!")
