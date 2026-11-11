import sqlite3

conn = sqlite3.connect("chessengine/data/positions.db")

total_positions = conn.execute(
    "SELECT COUNT(*) FROM positions"
).fetchone()[0]

games = conn.execute(
    "SELECT COUNT(DISTINCT game_id) FROM positions"
).fetchone()[0]

print("Games processed:", games)
print("Total unique positions:", total_positions)

conn.close()