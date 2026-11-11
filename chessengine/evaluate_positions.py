
import os
import csv
import sqlite3
from multiprocessing.util import Finalize
import chess
import chess.engine

from concurrent.futures import ProcessPoolExecutor
from multiprocessing import freeze_support


STOCKFISH_PATH = r"C:\Users\sarth\Downloads\stockfish-windows-x86-64-universal\stockfish\stockfish-windows-x86-64-universal.exe"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

DB_PATH = os.path.join(DATA_DIR, "positions.db")

OUTPUT_PATH = os.path.join(
    DATA_DIR,
    "evaluated_positions_full.csv"
)

WORKERS = 4
HASH_MB = 128
ANALYSIS_DEPTH = 10
BATCH_SIZE = 500


engine = None


def start_worker():

    global engine

    engine = chess.engine.SimpleEngine.popen_uci(
        STOCKFISH_PATH
    )

    engine.configure({
        "Threads": 1,
        "Hash": HASH_MB
    })

    Finalize(None, engine.quit, exitpriority=10)


def evaluate_position(item):

    position_key, fen = item

    board = chess.Board(fen)

    result = engine.analyse(
        board,
        chess.engine.Limit(depth=ANALYSIS_DEPTH)
    )

    score = result["score"].pov(chess.WHITE)

    if score.is_mate():

        evaluation_cp = None
        mate_score = score.mate()

    else:

        evaluation_cp = score.score()
        mate_score = None

    return position_key, evaluation_cp, mate_score


def get_pending_batch(conn):

    return conn.execute(
        """
        SELECT position_key, fen
        FROM positions
        WHERE evaluated = 0
        LIMIT ?
        """,
        (BATCH_SIZE,)
    ).fetchall()


def export_to_csv():

    print("\nExporting evaluated positions...")

    conn = sqlite3.connect(DB_PATH)

    cursor = conn.execute(
        """
        SELECT
            game_id,
            ply,
            fen,
            evaluation_cp,
            mate_score,
            result
        FROM positions
        WHERE evaluated = 1
        """
    )

    with open(
        OUTPUT_PATH,
        "w",
        newline="",
        encoding="utf-8"
    ) as f:

        writer = csv.writer(f)

        writer.writerow([
            "game_id",
            "ply",
            "fen",
            "evaluation_cp",
            "mate_score",
            "side_to_move",
            "result"
        ])

        while True:

            rows = cursor.fetchmany(10000)

            if not rows:
                break

            output_rows = []

            for game_id, ply, fen, cp, mate, result in rows:

                side_to_move = fen.split()[1]

                side_to_move = (
                    "white" if side_to_move == "w" else "black"
                )

                output_rows.append([
                    game_id,
                    ply,
                    fen,
                    cp,
                    mate,
                    side_to_move,
                    result
                ])

            writer.writerows(output_rows)

    conn.close()

    print("CSV exported:", OUTPUT_PATH)


def evaluate_all():

    conn = sqlite3.connect(DB_PATH)

    total_positions = conn.execute(
        "SELECT COUNT(*) FROM positions"
    ).fetchone()[0]

    pending = conn.execute(
        "SELECT COUNT(*) FROM positions WHERE evaluated = 0"
    ).fetchone()[0]

    completed = total_positions - pending

    print("Total unique positions:", total_positions)
    print("Already evaluated:", completed)
    print("Awaiting evaluation:", pending)

    if pending == 0:

        print("All positions have already been evaluated.")
        conn.close()
        return

    session_completed = 0

    try:

        with ProcessPoolExecutor(
            max_workers=WORKERS,
            initializer=start_worker
        ) as executor:

            while True:

                batch = get_pending_batch(conn)

                if not batch:
                    break

                results = list(
                    executor.map(
                        evaluate_position,
                        batch,
                        chunksize=1
                    )
                )

                conn.executemany(
                    """
                    UPDATE positions
                    SET evaluation_cp = ?,
                        mate_score = ?,
                        evaluated = 1
                    WHERE position_key = ?
                    """,
                    [
                        (cp, mate, key)
                        for key, cp, mate in results
                    ]
                )

                conn.commit()

                session_completed += len(results)

                print(
                    f"Evaluated this session: "
                    f"{session_completed} | "
                    f"Remaining: "
                    f"{max(0, pending - session_completed)}"
                )

    finally:

        conn.close()

    print("\nStockfish evaluation complete.")


if __name__ == "__main__":

    freeze_support()

    evaluate_all()

    export_to_csv()
