
import os
import json
import numpy as np

from src.config import INPUT_FEATURES


BASE_DIR = os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))
)

DATA_DIR = os.path.join(
    BASE_DIR, "data", "processed"
)


def validate_split(split):

    print(f"\nValidating {split} dataset")
    print("-" * 40)

    X = np.load(
        os.path.join(DATA_DIR, f"X_{split}.npy"),
        mmap_mode="r"
    )

    y = np.load(
        os.path.join(DATA_DIR, f"y_{split}.npy"),
        mmap_mode="r"
    )

    # Shape validation
    assert X.ndim == 3
    assert X.shape[1:] == (2, INPUT_FEATURES)
    assert y.ndim == 1
    assert len(X) == len(y)

    # Data type validation
    assert X.dtype == np.uint8
    assert y.dtype == np.float32

    # Check evaluation values
    assert np.isfinite(y).all()

    # Check feature range
    assert X.min() >= 0
    assert X.max() <= 255

    # Inspect feature activation
    sample_count = min(1000, len(X))

    samples = X[:sample_count]

    piece_counts = np.count_nonzero(
        samples[:, :, :768],
        axis=2
    )

    side_to_move = samples[:, :, 836]

    halfmove = samples[:, :, 837]

    # Both perspectives must represent the same
    # number of pieces in each position.
    assert np.array_equal(
        piece_counts[:, 0],
        piece_counts[:, 1]
    )

    # Exactly one perspective should have
    # the relative side-to-move feature active.
    assert np.all(
        side_to_move.sum(axis=1) == 1
    )

    # Halfmove clock must be identical
    # for both perspectives.
    assert np.array_equal(
        halfmove[:, 0],
        halfmove[:, 1]
    )

    print("Positions:", len(X))
    print("Feature shape:", X.shape)
    print("Target shape:", y.shape)

    print("Feature dtype:", X.dtype)
    print("Target dtype:", y.dtype)

    print(
        "Average pieces per position:",
        piece_counts.mean()
    )

    print(
        "Average evaluation:",
        y.mean()
    )

    print(
        "Minimum evaluation:",
        y.min()
    )

    print(
        "Maximum evaluation:",
        y.max()
    )

    print(
        "Mean absolute evaluation:",
        np.abs(y).mean()
    )

    print("All checks passed!")

    del X, y


def main():

    validate_split("train")
    validate_split("val")

    metadata_path = os.path.join(
        DATA_DIR,
        "metadata.json"
    )

    with open(metadata_path) as file:
        metadata = json.load(file)

    print("\nDataset metadata:")
    print(json.dumps(metadata, indent=4))

    print("\nDataset validation complete!")


if __name__ == "__main__":
    main()
