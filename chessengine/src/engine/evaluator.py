
import os

import chess
import numpy as np
import torch

from src.config import DEVICE
from src.features import encode_position
from src.model import ChessIQNNUE


class NNUEEvaluator:

    def __init__(
        self,
        checkpoint_path="checkpoints/model_d_square.pth"
    ):

        self.device = DEVICE

        if not os.path.exists(checkpoint_path):
            raise FileNotFoundError(
                f"Checkpoint not found: {checkpoint_path}"
            )

        # Initialize the exact Model D-Square architecture.
        self.model = ChessIQNNUE(
            hidden_1=128,
            hidden_2=64,
            hidden_3=32,
            use_sqr_activation=True
        ).to(self.device)

        # Load trained weights.
        checkpoint = torch.load(
            checkpoint_path,
            map_location=self.device,
            weights_only=True
        )

        self.model.load_state_dict(
            checkpoint["model_state_dict"]
        )

        self.model.eval()

        self.checkpoint_epoch = checkpoint.get("epoch", None)

        print("Model D-Square loaded successfully.")
        print(f"Device: {self.device}")

        if self.checkpoint_epoch is not None:
            print(f"Checkpoint epoch: {self.checkpoint_epoch}")

    @torch.inference_mode()
    def evaluate_white(self, fen):
        """
        Evaluate a chess position from White's perspective.

        Returns:
            float: Evaluation in pawns.
            Positive = White advantage.
            Negative = Black advantage.
        """

        board = chess.Board(fen)

        # Encode the position using the original feature encoder.
        features = encode_position(fen)

        # Shape: (1, 2, 1024)
        features = torch.from_numpy(
            features.astype(np.float32)
        ).unsqueeze(0).to(self.device)

        prediction = self.model(features)

        return prediction.item()

    def evaluate_for_side_to_move(self, fen):
        """
        Evaluate from the perspective of the player to move.

        Positive = advantage for the player to move.
        Negative = disadvantage for the player to move.
        """

        board = chess.Board(fen)

        white_score = self.evaluate_white(fen)

        if board.turn == chess.WHITE:
            return white_score

        return -white_score

    def evaluate_centipawns(self, fen):
        """
        Return the White-perspective evaluation in centipawns.
        """

        return round(self.evaluate_white(fen) * 100)


if __name__ == "__main__":

    evaluator = NNUEEvaluator()

    board = chess.Board()

    score = evaluator.evaluate_white(board.fen())

    print("\nStarting position")
    print(f"White evaluation: {score:.4f} pawns")
    print(
        f"Centipawns: "
        f"{evaluator.evaluate_centipawns(board.fen())}"
    )
    print(
        f"Side-to-move evaluation: "
        f"{evaluator.evaluate_for_side_to_move(board.fen()):.4f}"
    )
