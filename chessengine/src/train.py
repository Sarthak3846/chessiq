
import argparse
import torch
import torch.nn as nn

from torch.utils.data import DataLoader
from tqdm import tqdm

from src.config import (
    BATCH_SIZE,
    EPOCHS,
    LEARNING_RATE,
    WEIGHT_DECAY,
    DEVICE,
    PATIENCE,
    LR_PATIENCE,
    LR_FACTOR,
    MIN_LR
)

from src.model import ChessIQNNUE
from src.dataset import ChessDataset
from src.utils import save_checkpoint


def train(
    hidden_1,
    checkpoint_path,
    hidden_2=32,
    hidden_3=None,
    use_sqr_activation=False
):

    train_dataset = ChessDataset("train")
    val_dataset = ChessDataset("val")

    train_loader = DataLoader(
        train_dataset,
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=0
    )

    val_loader = DataLoader(
        val_dataset,
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

    criterion = nn.SmoothL1Loss()

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=LEARNING_RATE,
        weight_decay=WEIGHT_DECAY
    )

    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer,
        mode="min",
        factor=LR_FACTOR,
        patience=LR_PATIENCE,
        min_lr=MIN_LR
    )

    parameters = sum(p.numel() for p in model.parameters())

    architecture = f"2048 -> {hidden_1} -> {hidden_2}"

    if hidden_3 is not None:
        architecture += f" -> {hidden_3}"

    architecture += " -> 1"

    print("\nArchitecture:", architecture)
    print("Parameters:", parameters)
    print("Training device:", DEVICE)

    best_val_loss = float("inf")
    epochs_without_improvement = 0

    for epoch in range(EPOCHS):

        model.train()
        train_loss = 0.0

        progress = tqdm(
            train_loader,
            desc=f"Epoch {epoch + 1}/{EPOCHS}"
        )

        for X, y in progress:

            X = X.to(DEVICE)
            y = y.to(DEVICE)

            optimizer.zero_grad()

            predictions = model(X)
            loss = criterion(predictions, y)

            loss.backward()
            optimizer.step()

            train_loss += loss.item()

        train_loss /= len(train_loader)

        model.eval()
        val_loss = 0.0

        with torch.no_grad():

            for X, y in val_loader:

                X = X.to(DEVICE)
                y = y.to(DEVICE)

                predictions = model(X)
                loss = criterion(predictions, y)

                val_loss += loss.item()

        val_loss /= len(val_loader)

        scheduler.step(val_loss)

        current_lr = optimizer.param_groups[0]["lr"]

        print(f"\nEpoch {epoch + 1}/{EPOCHS}")
        print(f"Train Loss: {train_loss:.6f}")
        print(f"Val Loss:   {val_loss:.6f}")
        print(f"Learning Rate: {current_lr:.7f}")

        if val_loss < best_val_loss:

            best_val_loss = val_loss
            epochs_without_improvement = 0

            save_checkpoint(
                model,
                optimizer,
                epoch + 1,
                val_loss,
                checkpoint_path
            )

            print("Best checkpoint saved.")

        else:

            epochs_without_improvement += 1

        if epochs_without_improvement >= PATIENCE:

            print("\nEarly stopping triggered.")
            break

    print("\nTraining complete.")
    print("Best validation loss:", best_val_loss)
    print("Checkpoint:", checkpoint_path)


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

    train(
        hidden_1=args.hidden1,
        hidden_2=args.hidden2,
        hidden_3=args.hidden3,
        checkpoint_path=args.checkpoint,
        use_sqr_activation=args.sqr_activation
    )
