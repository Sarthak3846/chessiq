import queue
import subprocess
import threading
import time
import sys
import chess

class UCIEngine:
    """Launches the existing CHESS-IQ engine and communicates through UCI."""
    def __init__(self, engine_root, depth=3):
        self.depth = depth
        self.lines = queue.Queue()
        self.process = subprocess.Popen(
            [sys.executable, "-u", "-m", "src.engine.uci"],
            cwd=str(engine_root), stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1
        )
        threading.Thread(target=self._read_output, daemon=True).start()
        self.send("uci")
        self._wait_for("uciok", 120)
        self.send("isready")
        self._wait_for("readyok", 120)
        self.send("ucinewgame")

    def _read_output(self):
        try:
            for line in self.process.stdout:
                self.lines.put(line.strip())
        finally:
            self.lines.put("__PROCESS_EXITED__")

    def send(self, command):
        if self.process.poll() is not None:
            raise RuntimeError("CHESS-IQ engine process has stopped.")
        self.process.stdin.write(command + "\n")
        self.process.stdin.flush()

    def _wait_for(self, expected, timeout):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError("Engine exited before sending " + expected)
            try:
                line = self.lines.get(timeout=0.2)
            except queue.Empty:
                continue
            if line == expected:
                return
        raise TimeoutError("Timed out waiting for " + expected)

    def best_move(self, board):
        self.send("position fen " + board.fen())
        self.send(f"go depth {self.depth}")
        deadline = time.time() + 240
        while time.time() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError("CHESS-IQ engine process has stopped.")
            try:
                line = self.lines.get(timeout=0.2)
            except queue.Empty:
                continue
            if line.startswith("bestmove "):
                uci = line.split()[1]
                if uci == "(none)":
                    return None
                move = chess.Move.from_uci(uci)
                if move not in board.legal_moves:
                    raise RuntimeError(f"Engine returned illegal move: {uci}")
                return move
        raise TimeoutError("Engine did not return a move within 240 seconds.")

    def new_game(self):
        self.send("ucinewgame")

    def close(self):
        if self.process.poll() is None:
            try:
                self.send("quit")
                self.process.wait(timeout=3)
            except Exception:
                self.process.terminate()
