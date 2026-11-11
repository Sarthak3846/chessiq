
import sys
import time
import threading
import contextlib

import chess

from src.engine.search import ChessIQSearch


class ChessIQUCI:

    def __init__(self):

        with contextlib.redirect_stdout(sys.stderr):
            self.engine = ChessIQSearch()

        self.board = chess.Board()
        self.default_depth = 3

        self.search_thread = None
        self.stop_event = threading.Event()
        self.lock = threading.Lock()

    def send(self, message):
        print(message, flush=True)

    def is_searching(self):
        return (
            self.search_thread is not None
            and self.search_thread.is_alive()
        )

    def stop_search(self):
        if self.is_searching():
            self.stop_event.set()

    def handle_position(self, command):

        if self.is_searching():
            self.send("info string Stop current search before changing position")
            return

        parts = command.split()

        if len(parts) < 2:
            return

        if parts[1] == "startpos":
            board = chess.Board()
            moves_index = 2

        elif parts[1] == "fen":

            try:
                moves_index = parts.index("moves")
            except ValueError:
                moves_index = len(parts)

            fen = " ".join(parts[2:moves_index])

            try:
                board = chess.Board(fen)
            except ValueError:
                self.send("info string Invalid FEN")
                return

            if not board.is_valid():
                self.send("info string Invalid chess position")
                return

        else:
            self.send("info string Invalid position command")
            return

        if "moves" in parts[moves_index:]:
            move_index = parts.index("moves", moves_index)

            for move_text in parts[move_index + 1:]:

                try:
                    move = chess.Move.from_uci(move_text)

                    if move not in board.legal_moves:
                        self.send("info string Illegal move: " + move_text)
                        return

                    board.push(move)

                except ValueError:
                    self.send("info string Invalid move: " + move_text)
                    return

        self.board = board

    def search_worker(self, board, depth, movetime=None):

        start_time = time.perf_counter()

        try:
            result = self.engine.search_best_move(
                board.fen(),
                depth=depth
            )

            elapsed = time.perf_counter() - start_time
            elapsed_ms = max(1, int(elapsed * 1000))

            if self.stop_event.is_set():
                self.send("info string Search stopped")
                return

            move = result["best_move"]
            score = result["evaluation"]

            if board.turn == chess.BLACK:
                score = -score

            if abs(score) >= 9900:
                mate_distance = max(
                    1,
                    round(10000 - abs(score))
                )
                mate_sign = 1 if score > 0 else -1
                score_text = f"score mate {mate_sign * mate_distance}"
            else:
                score_text = f"score cp {round(score * 100)}"

            nodes = result["nodes"]
            nps = int(nodes / elapsed) if elapsed > 0 else 0

            pv = move.uci() if move is not None else ""

            self.send(
                f"info depth {result['depth']} "
                f"{score_text} "
                f"nodes {nodes} "
                f"time {elapsed_ms} "
                f"nps {nps} "
                f"pv {pv}"
            )

            if move is None:
                self.send("bestmove 0000")
            else:
                self.send(f"bestmove {move.uci()}")

        except Exception as error:
            self.send(f"info string Search error: {error}")
            self.send("bestmove 0000")

    def handle_go(self, command):

        if self.is_searching():
            self.send("info string Search already running")
            return

        parts = command.split()

        depth = self.default_depth
        movetime = None

        if "depth" in parts:
            try:
                depth = int(parts[parts.index("depth") + 1])
                depth = max(1, min(depth, 10))
            except (ValueError, IndexError):
                depth = self.default_depth

        if "movetime" in parts:
            try:
                movetime = int(parts[parts.index("movetime") + 1])
            except (ValueError, IndexError):
                movetime = None

        # For now, movetime is parsed but does not interrupt search.
        if movetime is not None:
            self.send(
                "info string Movetime interruption will be enabled "
                "after search cancellation is integrated"
            )

        search_board = self.board.copy()
        self.stop_event.clear()

        self.search_thread = threading.Thread(
            target=self.search_worker,
            args=(search_board, depth, movetime),
            daemon=True
        )

        self.search_thread.start()

    def run(self):

        while True:

            try:
                command = input().strip()

            except EOFError:
                self.stop_search()
                break

            if not command:
                continue

            if command == "uci":

                self.send("id name CHESS-IQ")
                self.send("id author CHESS-IQ Project")
                self.send("uciok")

            elif command == "isready":

                self.send("readyok")

            elif command == "ucinewgame":

                self.stop_search()

                if self.is_searching():
                    self.search_thread.join()

                self.board = chess.Board()
                self.engine.transposition_table.clear()
                self.engine.nodes = 0
                self.engine.tt_hits = 0

            elif command.startswith("position"):

                self.handle_position(command)

            elif command.startswith("go"):

                self.handle_go(command)

            elif command == "stop":

                self.stop_search()

            elif command == "quit":

                self.stop_search()

                if self.is_searching():
                    self.search_thread.join()

                break


if __name__ == "__main__":

    uci = ChessIQUCI()
    uci.run()
