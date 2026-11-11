
import argparse
import numpy as np
import torch

from torch.utils.data import DataLoader

from src.config import BATCH_SIZE, DEVICE
from src.model import ChessIQNNUE
from src.dataset import ChessDataset
from src.utils import load_checkpoint


def evaluate(
    hidden_1,
    checkpoint_path,
    hidden_2=32,
    hidden_3=None,
    use_sqr_activation=False
):

    dataset = ChessDataset("val")

    loader = DataLoader(
        dataset,
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=0
    )

    model = ChessIQNNUE(
    hidden_1=hidden_1,
    hidden_2=hidden_2,
    hidden_3=hidden_3,
    use_sqr_activation=use_sqr_activation
).to(DEVICE)

    checkpoint = load_checkpoint(model, checkpoint_path)

    print("\nLoaded checkpoint from epoch:", checkpoint["epoch"])
    print("Architecture:", f"2048 -> {hidden_1} -> 32 -> 1")

    model.eval()

    predictions = []
    targets = []

    with torch.no_grad():

        for X, y in loader:

            X = X.to(DEVICE)

            output = model(X)

            predictions.extend(output.cpu().numpy().flatten())
            targets.extend(y.numpy().flatten())

    predictions = np.array(predictions)
    targets = np.array(targets)

    errors = predictions - targets

    mae = np.mean(np.abs(errors))
    mse = np.mean(errors ** 2)
    rmse = np.sqrt(mse)
    correlation = np.corrcoef(predictions, targets)[0, 1]

    print("\n========== NNUE EVALUATION ==========")
    print(f"MAE:         {mae:.4f} pawns")
    print(f"RMSE:        {rmse:.4f} pawns")
    print(f"Mean error:  {np.mean(errors):.4f} pawns")
    print(f"Correlation: {correlation:.4f}")
    print("====================================")


if __name__ == "__main__":

    parser = argparse.ArgumentParser()

    parser.add_argument("--hidden1", type=int, required=True)
    parser.add_argument("--hidden2", type=int, required=True)
    parser.add_argument("--hidden3", type=int, default=None)

    parser.add_argument("--checkpoint", type=str, required=True)

    parser.add_argument(
        "--sqr-activation",
        action="store_true"
    )

    args = parser.parse_args()

    evaluate(
        hidden_1=args.hidden1,
        hidden_2=args.hidden2,
        hidden_3=args.hidden3,
        checkpoint_path=args.checkpoint,
        use_sqr_activation=args.sqr_activation
    )
