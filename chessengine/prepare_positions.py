
import os
import json
import random
import sqlite3
import pandas as pd
import chess
import chess.pgn

from io import StringIO
from tqdm import tqdm


CSV_PATH = r"C:\Users\sarth\Downloads\archive\GM_games_dataset.csv"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

DB_PATH = os.path.join(DATA_DIR, "positions.db")
CHECKPOINT_PATH = os.path.join(DATA_DIR, "prepare_checkpoint.json")

TOTAL_GAMES = 4193152
SAMPLE_SIZE = 200000
RANDOM_SEED = 42

SKIP_PLIES = 20
POSITION_INTERVAL = 8
CHUNK_SIZE = 10000


def save_checkpoint(next_row, completed=False):

    temp_path = CHECKPOINT_PATH + ".tmp"

    checkpoint = {
        "next_row": next_row,
        "completed": completed,
        "random_seed": RANDOM_SEED,
        "sample_size": SAMPLE_SIZE,
        "skip_plies": SKIP_PLIES,
        "position_interval": POSITION_INTERVAL
    }

    with open(temp_path, "w") as f:
        json.dump(checkpoint, f)

    os.replace(temp_path, CHECKPOINT_PATH)


def create_database():

    os.makedirs(DATA_DIR, exist_ok=True)

    conn = sqlite3.connect(DB_PATH)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS positions (
            position_key TEXT PRIMARY KEY,
            fen TEXT NOT NULL,
            game_id INTEGER,
            ply INTEGER,
            result TEXT,
            evaluation_cp REAL,
            mate_score INTEGER,
            evaluated INTEGER DEFAULT 0
        )
    """)

    conn.commit()

    return conn


def extract_positions(conn):

    random.seed(RANDOM_SEED)

    selected_games = set(
        random.sample(
            range(TOTAL_GAMES),
            SAMPLE_SIZE
        )
    )

    if os.path.exists(CHECKPOINT_PATH):

        with open(CHECKPOINT_PATH, "r") as f:
            checkpoint = json.load(f)

        expected = {
            "random_seed": RANDOM_SEED,
            "sample_size": SAMPLE_SIZE,
            "skip_plies": SKIP_PLIES,
            "position_interval": POSITION_INTERVAL
        }

        for key, value in expected.items():

            if checkpoint.get(key) != value:
                raise RuntimeError(
                    "Extraction settings have changed. "
                    "Do not resume with different settings."
                )

        if checkpoint.get("completed"):
            print("Position extraction is already complete.")
            return

        start_row = checkpoint["next_row"]

    else:

        existing = conn.execute(
            "SELECT COUNT(*) FROM positions"
        ).fetchone()[0]

        if existing > 0:
            raise RuntimeError(
                "Database already contains positions but the "
                "extraction checkpoint is missing."
            )

        start_row = 0

    print("Selected games:", SAMPLE_SIZE)
    print("Resuming from row:", start_row)

    row_index = 0
    total_extracted = 0
    total_inserted = 0

    chunks = pd.read_csv(
        CSV_PATH,
        chunksize=CHUNK_SIZE,
        usecols=["pgn", "Result"]
    )

    for chunk in chunks:

        chunk_end = int(chunk.index[-1]) + 1

        if chunk_end <= start_row:
            row_index = chunk_end
            continue

        selected_rows = chunk[
            chunk.index.isin(selected_games)
            & (chunk.index >= start_row)
        ]

        batch_extracted = 0
        batch_inserted = 0

        for game_id, row in tqdm(
            selected_rows.iterrows(),
            total=len(selected_rows),
            desc="Extracting positions"
        ):

            pgn_text = row["pgn"]

            if not isinstance(pgn_text, str) or not pgn_text.strip():
                continue

            try:

                game = chess.pgn.read_game(
                    StringIO(pgn_text)
                )

                if game is None:
                    continue

                board = game.board()

                for ply, move in enumerate(
                    game.mainline_moves(),
                    start=1
                ):

                    board.push(move)

                    if ply <= SKIP_PLIES:
                        continue

                    if (ply - SKIP_PLIES) % POSITION_INTERVAL != 0:
                        continue

                    if board.is_game_over():
                        continue

                    fen = board.fen()

                    # Ignore the fullmove counter.
                    # Retain side to move, castling rights,
                    # en-passant square and halfmove clock.

                    position_key = " ".join(fen.split()[:5])

                    cursor = conn.execute(
                        """
                        INSERT OR IGNORE INTO positions
                        (position_key, fen, game_id, ply, result)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            position_key,
                            fen,
                            int(game_id),
                            int(ply),
                            row["Result"]
                        )
                    )

                    batch_extracted += 1

                    if cursor.rowcount == 1:
                        batch_inserted += 1

            except Exception as e:

                print(f"Game {game_id} skipped: {e}")

        conn.commit()

        total_extracted += batch_extracted
        total_inserted += batch_inserted

        # Save checkpoint only after database commit.

        save_checkpoint(chunk_end)

        row_index = chunk_end

        print(
            f"\nRows scanned: {row_index}"
            f"\nPositions extracted: {batch_extracted}"
            f"\nNew unique positions: {batch_inserted}"
        )

    save_checkpoint(row_index, completed=True)

    total_unique = conn.execute(
        "SELECT COUNT(*) FROM positions"
    ).fetchone()[0]

    print("\nExtraction complete")
    print("Rows scanned:", row_index)
    print("Positions extracted this session:", total_extracted)
    print("New unique positions this session:", total_inserted)
    print("Total unique positions:", total_unique)


if __name__ == "__main__":

    connection = create_database()

    try:
        extract_positions(connection)

    finally:
        connection.close()
