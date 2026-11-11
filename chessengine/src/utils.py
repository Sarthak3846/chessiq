
import os
import torch


def save_checkpoint(model, optimizer, epoch, loss, path):

    os.makedirs(os.path.dirname(path), exist_ok=True)

    torch.save({

        "epoch": epoch,
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "loss": loss

    }, path)


def load_checkpoint(model, path, optimizer=None):

    checkpoint = torch.load(
        path,
        map_location="cpu",
        weights_only=True
    )

    model.load_state_dict(
        checkpoint["model_state_dict"]
    )

    if optimizer is not None:
        optimizer.load_state_dict(
            checkpoint["optimizer_state_dict"]
        )

    return checkpoint
