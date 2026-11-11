
import chess

from src.engine.evaluator import NNUEEvaluator


MATE_SCORE = 10000
MAX_QUIESCENCE_DEPTH = 12

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 300,
    chess.BISHOP: 320,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000
}


class ChessIQSearch:

    def __init__(self, evaluator=None):
        self.evaluator = evaluator or NNUEEvaluator()
        self.nodes = 0
        self.transposition_table = {}
        self.tt_hits = 0

    def evaluate(self, board):
        """Return evaluation from White's perspective."""
        return self.evaluator.evaluate_white(board.fen())

    def terminal_score(self, board, ply):
        """Return terminal score from White's perspective."""

        if board.is_checkmate():
            if board.turn == chess.WHITE:
                return -MATE_SCORE + ply

            return MATE_SCORE - ply

        if board.is_game_over(claim_draw=True):
            return 0.0

        return None

    def move_ordering_score(self, board, move):
        """Prioritize captures and promotions."""

        score = 0

        if board.is_capture(move):

            attacker = board.piece_at(move.from_square)
            victim = board.piece_at(move.to_square)

            # En passant captures have no piece on the target square.
            if victim is None:
                victim_value = PIECE_VALUES[chess.PAWN]
            else:
                victim_value = PIECE_VALUES[victim.piece_type]

            attacker_value = PIECE_VALUES[attacker.piece_type]

            score += 10 * victim_value - attacker_value

        if move.promotion:
            score += PIECE_VALUES[move.promotion]

        return score

    def ordered_moves(self, board, tt_move=None):
        moves = list(board.legal_moves)

        moves.sort(
            key=lambda move: self.move_ordering_score(board, move),
            reverse=True
        )

        # Search the previously stored best move first.
        if tt_move is not None and tt_move in moves:
            moves.remove(tt_move)
            moves.insert(0, tt_move)

        return moves

    def quiescence(self, board, alpha, beta, ply, qply=0):
        """
        Extend search through forcing tactical moves.
        All scores are from White's perspective.
        """

        if qply > 0:
            self.nodes += 1

        terminal = self.terminal_score(board, ply)

        if terminal is not None:
            return terminal

        in_check = board.is_check()

        # At the safety limit, do not stand pat while in check.
        # Search legal evasions once before returning a static score.
        if qply >= MAX_QUIESCENCE_DEPTH:

            if not in_check:
                return self.evaluate(board)

            best_score = (
                float("-inf") if board.turn == chess.WHITE
                else float("inf")
            )

            for move in self.ordered_moves(board):

                board.push(move)

                score = self.terminal_score(board, ply + 1)

                if score is None:
                    score = self.evaluate(board)

                board.pop()

                if board.turn == chess.WHITE:
                    best_score = max(best_score, score)
                    alpha = max(alpha, best_score)
                else:
                    best_score = min(best_score, score)
                    beta = min(beta, best_score)

                if beta <= alpha:
                    break

            return best_score

        # A checked side cannot use stand-pat evaluation.
        if not in_check:

            stand_pat = self.evaluate(board)

            if board.turn == chess.WHITE:

                if stand_pat >= beta:
                    return stand_pat

                alpha = max(alpha, stand_pat)

            else:

                if stand_pat <= alpha:
                    return stand_pat

                beta = min(beta, stand_pat)

            # Search captures.
            moves = list(board.generate_legal_captures())

            # Also include non-capturing promotions.
            for move in board.legal_moves:
                if move.promotion and not board.is_capture(move):
                    moves.append(move)

        else:
            # In check: search every legal evasion.
            moves = list(board.legal_moves)

        moves.sort(
            key=lambda move: self.move_ordering_score(board, move),
            reverse=True
        )

        if board.turn == chess.WHITE:

            best_score = (
                stand_pat if not in_check else float("-inf")
            )

            for move in moves:

                board.push(move)

                score = self.quiescence(
                    board,
                    alpha,
                    beta,
                    ply + 1,
                    qply + 1
                )

                board.pop()

                best_score = max(best_score, score)
                alpha = max(alpha, best_score)

                if beta <= alpha:
                    break

            return best_score

        else:

            best_score = (
                stand_pat if not in_check else float("inf")
            )

            for move in moves:

                board.push(move)

                score = self.quiescence(
                    board,
                    alpha,
                    beta,
                    ply + 1,
                    qply + 1
                )

                board.pop()

                best_score = min(best_score, score)
                beta = min(beta, best_score)

                if beta <= alpha:
                    break

            return best_score

    def minimax(self, board, depth, alpha, beta, ply):

        self.nodes += 1

        terminal = self.terminal_score(board, ply)

        if terminal is not None:
            return terminal

        # Preserve the original alpha-beta window.
        original_alpha = alpha
        original_beta = beta

        # Position key for the transposition table.
        position_key = board.fen()

        entry = self.transposition_table.get(position_key)
        tt_move = None

        if entry is not None:

            tt_move = entry["best_move"]

            if entry["depth"] >= depth:

                self.tt_hits += 1

                if entry["flag"] == "EXACT":
                    return entry["score"]

                elif entry["flag"] == "LOWER":
                    alpha = max(alpha, entry["score"])

                elif entry["flag"] == "UPPER":
                    beta = min(beta, entry["score"])

                if alpha >= beta:
                    return entry["score"]

        # Extend search at the normal depth limit.
        if depth == 0:
            return self.quiescence(
                board,
                alpha,
                beta,
                ply
            )

        best_move = None

        # White maximizes.
        if board.turn == chess.WHITE:

            best_score = float("-inf")

            for move in self.ordered_moves(board, tt_move):

                board.push(move)

                score = self.minimax(
                    board,
                    depth - 1,
                    alpha,
                    beta,
                    ply + 1
                )

                board.pop()

                if score > best_score:
                    best_score = score
                    best_move = move

                alpha = max(alpha, best_score)

                if beta <= alpha:
                    break

        # Black minimizes.
        else:

            best_score = float("inf")

            for move in self.ordered_moves(board, tt_move):

                board.push(move)

                score = self.minimax(
                    board,
                    depth - 1,
                    alpha,
                    beta,
                    ply + 1
                )

                board.pop()

                if score < best_score:
                    best_score = score
                    best_move = move

                beta = min(beta, best_score)

                if beta <= alpha:
                    break

        # Classify the stored result.
        if best_score <= original_alpha:
            flag = "UPPER"

        elif best_score >= original_beta:
            flag = "LOWER"

        else:
            flag = "EXACT"

        # Store the result.
        self.transposition_table[position_key] = {
            "depth": depth,
            "score": best_score,
            "flag": flag,
            "best_move": best_move
        }

        return best_score

    def search_best_move(self, fen, depth=3):

        board = chess.Board(fen)

        if not board.is_valid():
            raise ValueError("Invalid chess position.")

        self.nodes = 0
        self.transposition_table.clear()
        self.tt_hits = 0

        if board.is_game_over(claim_draw=True):
            return {
                "best_move": None,
                "evaluation": self.terminal_score(board, 0),
                "nodes": self.nodes,
                "depth": 0,
                "tt_hits": self.tt_hits
            }

        legal_moves = self.ordered_moves(board)

        best_move = None
        best_score = self.evaluate(board)
        completed_depth = 0

        # Iterative deepening.
        for current_depth in range(1, depth + 1):

            ordered = legal_moves.copy()

            # Prioritize the previous iteration's best move.
            if best_move is not None:
                ordered.remove(best_move)
                ordered.insert(0, best_move)

            iteration_best_move = None

            iteration_best_score = (
                float("-inf") if board.turn == chess.WHITE
                else float("inf")
            )

            alpha = float("-inf")
            beta = float("inf")

            for move in ordered:

                board.push(move)

                score = self.minimax(
                    board,
                    current_depth - 1,
                    alpha,
                    beta,
                    1
                )

                board.pop()

                if board.turn == chess.WHITE:

                    if score > iteration_best_score:
                        iteration_best_score = score
                        iteration_best_move = move

                    alpha = max(alpha, iteration_best_score)

                else:

                    if score < iteration_best_score:
                        iteration_best_score = score
                        iteration_best_move = move

                    beta = min(beta, iteration_best_score)

            # Save the completed iteration.
            if iteration_best_move is not None:
                best_move = iteration_best_move
                best_score = iteration_best_score
                completed_depth = current_depth

        return {
            "best_move": best_move,
            "evaluation": best_score,
            "nodes": self.nodes,
            "depth": completed_depth,
            "tt_hits": self.tt_hits
        }


if __name__ == "__main__":

    search = ChessIQSearch()
    board = chess.Board()

    result = search.search_best_move(
        board.fen(),
        depth=2
    )

    print("\n========== CHESS-IQ SEARCH ==========")
    print("Position:", board.fen())
    print("Depth:", result["depth"])
    print("Best move:", result["best_move"])
    print("Evaluation:", result["evaluation"])
    print("Nodes searched:", result["nodes"])
    print("Transposition table hits:", result["tt_hits"])

    if result["best_move"] is not None:
        print(
            "Move in SAN:",
            board.san(result["best_move"])
        )

    print("=====================================")
