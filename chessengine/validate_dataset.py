
import os
import sqlite3
import pandas as pd


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

DB_PATH = os.path.join(DATA_DIR, "positions.db")

CSV_PATH = os.path.join(
    DATA_DIR,
    "evaluated_positions_full.csv"
)


conn = sqlite3.connect(DB_PATH)


print("\nDATABASE VALIDATION")

total_positions = conn.execute(
    "SELECT COUNT(*) FROM positions"
).fetchone()[0]

evaluated_positions = conn.execute(
    "SELECT COUNT(*) FROM positions WHERE evaluated = 1"
).fetchone()[0]

pending_positions = conn.execute(
    "SELECT COUNT(*) FROM positions WHERE evaluated = 0"
).fetchone()[0]

mate_positions = conn.execute(
    "SELECT COUNT(*) FROM positions WHERE mate_score IS NOT NULL"
).fetchone()[0]

games_represented = conn.execute(
    "SELECT COUNT(DISTINCT game_id) FROM positions"
).fetchone()[0]


print("Total unique positions:", total_positions)
print("Evaluated positions:", evaluated_positions)
print("Pending positions:", pending_positions)
print("Mate positions:", mate_positions)
print("Games represented:", games_represented)


print("\nSIDE TO MOVE")

side_counts = conn.execute(
    """
    SELECT
        CASE
            WHEN substr(fen, instr(fen, ' ') + 1, 1) = 'w'
            THEN 'white'
            ELSE 'black'
        END,
        COUNT(*)
    FROM positions
    WHERE evaluated = 1
    GROUP BY 1
    """
).fetchall()

for side, count in side_counts:
    print(side, count)


print("\nEVALUATION STATISTICS")

evaluation_stats = conn.execute(
    """
    SELECT
        COUNT(evaluation_cp),
        AVG(evaluation_cp),
        MIN(evaluation_cp),
        MAX(evaluation_cp)
    FROM positions
    WHERE evaluated = 1
    """
).fetchone()

print("Centipawn evaluations:", evaluation_stats[0])
print("Mean:", evaluation_stats[1])
print("Minimum:", evaluation_stats[2])
print("Maximum:", evaluation_stats[3])


conn.close()


print("\nCSV VALIDATION")

if os.path.exists(CSV_PATH):

    df = pd.read_csv(CSV_PATH)

    print("Dataset shape:", df.shape)

    print("\nMissing values:")
    print(df.isnull().sum())

    print("\nEvaluation statistics:")
    print(df["evaluation_cp"].describe())

    print("\nSide to move:")
    print(df["side_to_move"].value_counts())

    print("\nMate positions:")
    print(df["mate_score"].notna().sum())

    print("\nDuplicate FENs:")
    print(df["fen"].duplicated().sum())

else:

    print("CSV has not been exported yet.")
