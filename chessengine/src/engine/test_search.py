
import chess

from src.engine.search import ChessIQSearch


search = ChessIQSearch()

# Test 1: Starting position
board = chess.Board()
original_fen = board.fen()

result = search.search_best_move(
    board.fen(),
    depth=2
)

assert result["best_move"] is not None
assert result["best_move"] in board.legal_moves
assert board.fen() == original_fen

print("Test 1 passed: Legal move and board preserved")


# Test 2: Black to move
board = chess.Board()
board.push_san("e4")

result = search.search_best_move(
    board.fen(),
    depth=2
)

assert result["best_move"] is not None
assert result["best_move"] in board.legal_moves

print("Test 2 passed: Black move selection")


# Test 3: Checkmate
board = chess.Board()
board.push_san("f3")
board.push_san("e5")
board.push_san("g4")
board.push_san("Qh4#")

result = search.search_best_move(
    board.fen(),
    depth=2
)

assert result["best_move"] is None
assert board.is_checkmate()

print("Test 3 passed: Checkmate detection")


# Test 4: Stalemate
stalemate_fen = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"

board = chess.Board(stalemate_fen)

assert board.is_stalemate()

result = search.search_best_move(
    board.fen(),
    depth=2
)

assert result["best_move"] is None
assert result["evaluation"] == 0.0

print("Test 4 passed: Stalemate detection")


print("\nAll search tests passed!")
