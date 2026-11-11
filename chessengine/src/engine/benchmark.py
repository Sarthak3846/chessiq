
import time
import chess

from src.engine.search import ChessIQSearch


POSITIONS = {
    "Starting Position":
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",

    "Winning Position":
        "k7/8/8/8/8/8/7Q/4K3 w - - 0 1",

    "Losing Position":
        "k7/8/8/8/8/8/q7/4K3 w - - 0 1",

    "Tactical Position":
        "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 4",

    "Checkmate Position":
        "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1",
}


def run_benchmark(depth=2):
    engine = ChessIQSearch()

    print("\n========== CHESS-IQ BENCHMARK ==========")
    print(f"Search depth: {depth}\n")

    for name, fen in POSITIONS.items():
        board = chess.Board(fen)

        if not board.is_valid():
            print(f"{name}: Invalid position. Skipping.")
            continue

        print(f"--- {name} ---")

        start_time = time.perf_counter()

        result = engine.search_best_move(fen, depth=depth)

        elapsed = time.perf_counter() - start_time

        move = result["best_move"]

        if move is None:
            print("Best move: None (game over)")
        else:
            print(f"Best move: {move.uci()}")
            print(f"Move in SAN: {board.san(move)}")

        print(f"Evaluation: {result['evaluation']:.4f}")
        print(f"Nodes searched: {result['nodes']}")
        print(f"Time: {elapsed:.4f} seconds")
        print(f"Transposition table hits: {result['tt_hits']}")
        print()


if __name__ == "__main__":
    run_benchmark(depth=3)
