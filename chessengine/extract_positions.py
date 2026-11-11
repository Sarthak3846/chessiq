
import os
import json
import pandas as pd
import chess
import chess.pgn
import chess.engine

from io import StringIO
from tqdm import tqdm


CSV_PATH = r"C:\Users\sarth\Downloads\archive\GM_games_dataset.csv"

STOCKFISH_PATH = r"C:\Users\sarth\Downloads\stockfish-windows-x86-64-universal\stockfish\stockfish-windows-x86-64-universal.exe"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATA_DIR = os.path.join(BASE_DIR, "data")

OUTPUT_PATH = os.path.join(
    DATA_DIR,
    "evaluated_positions_full.csv"
)

CHECKPOINT_PATH = os.path.join(
    DATA_DIR,
    "checkpoint.json"
)

POSITION_INTERVAL = 1
ANALYSIS_DEPTH = 10
CHUNK_SIZE = 100


os.makedirs(DATA_DIR, exist_ok=True)


# Check whether output and checkpoint files are consistent

if os.path.exists(OUTPUT_PATH) and not os.path.exists(CHECKPOINT_PATH):
    raise RuntimeError(
        "Output file exists but checkpoint is missing. "
        "Do not restart from zero. Check the existing files first."
    )

if os.path.exists(CHECKPOINT_PATH) and not os.path.exists(OUTPUT_PATH):
    raise RuntimeError(
        "Checkpoint exists but output file is missing. "
        "Restore the output file before resuming."
    )


# Load checkpoint

if os.path.exists(CHECKPOINT_PATH):
    with open(CHECKPOINT_PATH, "r") as f:
        checkpoint = json.load(f)

    start_row = checkpoint["next_row"]

else:
    start_row = 0


print("Starting from game:", start_row)
print("Output:", OUTPUT_PATH)


# Start Stockfish

engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)


def analyse_position(board):

    result = engine.analyse(
        board,
        chess.engine.Limit(depth=ANALYSIS_DEPTH)
    )

    score = result["score"].pov(chess.WHITE)

    if score.is_mate():
        mate_score = score.mate()
        evaluation_cp = None

    else:
        mate_score = None
        evaluation_cp = score.score()

    return evaluation_cp, mate_score


row_index = 0
total_positions = 0
session_games = 0


try:

    chunks = pd.read_csv(
        CSV_PATH,
        chunksize=CHUNK_SIZE,
        usecols=["pgn", "Result"]
    )

    for chunk in chunks:

        records = []

        for _, row in tqdm(
            chunk.iterrows(),
            total=len(chunk),
            desc="Processing games"
        ):

            game_id = row_index
            row_index += 1

            # Skip games already processed in an earlier run

            if game_id < start_row:
                continue

            session_games += 1

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

                    if ply % POSITION_INTERVAL != 0:
                        continue

                    if board.is_game_over():
                        continue

                    evaluation_cp, mate_score = analyse_position(board)

                    records.append({
                        "game_id": game_id,
                        "ply": ply,
                        "fen": board.fen(),
                        "evaluation_cp": evaluation_cp,
                        "mate_score": mate_score,
                        "side_to_move": "white" if board.turn else "black",
                        "result": row["Result"]
                    })

                    total_positions += 1

            except Exception as e:

                print(f"Game {game_id} skipped: {e}")

        # Save the completed batch

        if records:

            df = pd.DataFrame(records)

            df.to_csv(
                OUTPUT_PATH,
                mode="a",
                header=not os.path.exists(OUTPUT_PATH),
                index=False
            )

        # Update checkpoint only after the batch is saved

        checkpoint = {
            "next_row": row_index
        }

        temp_checkpoint = CHECKPOINT_PATH + ".tmp"

        with open(temp_checkpoint, "w") as f:
            json.dump(checkpoint, f)

        os.replace(
            temp_checkpoint,
            CHECKPOINT_PATH
        )

        print(
            f"\nGames processed so far: {row_index}"
            f"\nPositions in current batch: {len(records)}"
            f"\nPositions evaluated this session: {total_positions}\n"
        )


finally:

    engine.quit()


print("\nProcessing session complete")
print("Games scanned up to:", row_index)
print("Games processed this session:", session_games)
print("Positions evaluated this session:", total_positions)
print("Output:", OUTPUT_PATH)
print("Checkpoint:", CHECKPOINT_PATH)
