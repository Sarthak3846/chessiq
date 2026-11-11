
import os
import csv
import hashlib
import json

import numpy as np
from tqdm import tqdm

from src.features import encode_position


# ----------------------------------
# CONFIGURATION
# ----------------------------------

BASE_DIR = os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))
)

CSV_PATH = os.path.join(
    BASE_DIR,
    "data",
    "evaluated_positions_full.csv"
)

OUTPUT_DIR = os.path.join(
    BASE_DIR,
    "data",
    "processed"
)

VALIDATION_PERCENT = 10

FEATURE_SHAPE = (2, 1024)
HALFMOVE_INDEX = 837


# ----------------------------------
# SPLIT BY GAME ID
# ----------------------------------

def get_split(game_id):

    value = hashlib.sha256(
        str(game_id).encode()
    ).hexdigest()

    bucket = int(value[:8], 16) % 100

    return "val" if bucket < VALIDATION_PERCENT else "train"


# ----------------------------------
# VALIDATE A CSV ROW
# ----------------------------------

def get_valid_row(row):

    cp = row.get("evaluation_cp")
    mate = row.get("mate_score")
    game_id = row.get("game_id")
    fen = row.get("fen")

    if not cp or not fen or not game_id:
        return None

    if mate not in ("", None):
        return None

    try:
        cp = float(cp)
        int(game_id)

        if not np.isfinite(cp):
            return None

    except (ValueError, TypeError):
        return None

    return int(game_id), fen, cp


# ----------------------------------
# FIRST PASS: COUNT POSITIONS
# ----------------------------------

def count_positions():

    counts = {
        "train": 0,
        "val": 0
    }

    with open(
        CSV_PATH,
        "r",
        encoding="utf-8",
        newline=""
    ) as file:

        reader = csv.DictReader(file)

        for row in tqdm(
            reader,
            desc="Counting positions"
        ):

            item = get_valid_row(row)

            if item is None:
                continue

            game_id, fen, cp = item

            split = get_split(game_id)

            counts[split] += 1

    return counts


# ----------------------------------
# ENCODE FEATURES
# ----------------------------------

def encode_uint8(fen):

    features = encode_position(fen)

    # Binary features remain 0 or 1.
    # Store halfmove clock with 8-bit precision.

    features[:, HALFMOVE_INDEX] *= 255.0

    features = np.rint(features)

    return np.clip(
        features,
        0,
        255
    ).astype(np.uint8)


# ----------------------------------
# SECOND PASS: BUILD DATASET
# ----------------------------------

def build_dataset(counts):

    os.makedirs(
        OUTPUT_DIR,
        exist_ok=True
    )

    X_files = {}
    y_files = {}

    for split in ("train", "val"):

        X_path = os.path.join(
            OUTPUT_DIR,
            f"X_{split}.npy"
        )

        y_path = os.path.join(
            OUTPUT_DIR,
            f"y_{split}.npy"
        )

        X_files[split] = np.lib.format.open_memmap(
            X_path,
            mode="w+",
            dtype=np.uint8,
            shape=(counts[split], *FEATURE_SHAPE)
        )

        y_files[split] = np.lib.format.open_memmap(
            y_path,
            mode="w+",
            dtype=np.float32,
            shape=(counts[split],)
        )

    indices = {
        "train": 0,
        "val": 0
    }

    with open(
        CSV_PATH,
        "r",
        encoding="utf-8",
        newline=""
    ) as file:

        reader = csv.DictReader(file)

        for row in tqdm(
            reader,
            total=sum(counts.values()),
            desc="Encoding positions"
        ):

            item = get_valid_row(row)

            if item is None:
                continue

            game_id, fen, cp = item

            split = get_split(game_id)

            i = indices[split]

            X_files[split][i] = encode_uint8(fen)

            # White-perspective centipawns -> pawns
            y_files[split][i] = cp / 100.0

            indices[split] += 1

    for split in ("train", "val"):

        X_files[split].flush()
        y_files[split].flush()

        print(
            f"{split}: {indices[split]} positions"
        )

    del X_files
    del y_files

    metadata = {
        "feature_shape": FEATURE_SHAPE,
        "feature_dtype": "uint8",
        "target_dtype": "float32",
        "target_unit": "pawns",
        "evaluation_perspective": "white",
        "validation_percent": VALIDATION_PERCENT,
        "counts": counts
    }

    with open(
        os.path.join(OUTPUT_DIR, "metadata.json"),
        "w"
    ) as file:

        json.dump(metadata, file, indent=4)


# ----------------------------------
# MAIN
# ----------------------------------

if __name__ == "__main__":

    if not os.path.exists(CSV_PATH):
        raise FileNotFoundError(CSV_PATH)

    print("Counting valid positions...")

    counts = count_positions()

    print("\nDataset counts:")
    print(counts)

    if not counts["train"] or not counts["val"]:
        raise RuntimeError("Insufficient dataset positions.")

    print("\nGenerating encoded dataset...")

    build_dataset(counts)

    print("\nDataset generation complete!")
