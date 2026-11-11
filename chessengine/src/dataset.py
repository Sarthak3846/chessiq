
import os
import numpy as np
import torch

from torch.utils.data import Dataset


class ChessDataset(Dataset):

    def __init__(self, split, data_dir="data/processed"):

        if split not in ("train", "val"):
            raise ValueError("Split must be train or val")

        X_path = os.path.join(
            data_dir,
            f"X_{split}.npy"
        )

        y_path = os.path.join(
            data_dir,
            f"y_{split}.npy"
        )

        self.X = np.load(
            X_path,
            mmap_mode="r"
        )

        self.y = np.load(
            y_path,
            mmap_mode="r"
        )

        assert self.X.ndim == 3
        assert self.X.shape[1:] == (2, 1024)

        assert len(self.X) == len(self.y)

        print(f"Loaded {len(self.X)} {split} positions")

        print("Feature shape:", self.X.shape)
        print("Feature dtype:", self.X.dtype)

    def __len__(self):

        return len(self.X)

    def __getitem__(self, index):

        # Copy the memory-mapped sample before
        # converting it into a PyTorch tensor.

        x = self.X[index].copy()

        x = x.astype(np.float32)

        # Restore normalized halfmove clock
        x[:, 837] /= 255.0

        y = float(self.y[index])

        return (
            torch.from_numpy(x),
            torch.tensor([y], dtype=torch.float32)
        )
