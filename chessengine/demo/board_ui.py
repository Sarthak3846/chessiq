import tkinter as tk
from tkinter import messagebox
import threading
import chess

LIGHT, DARK = "#F0D9B5", "#B58863"
SELECTED, LAST, DOT = "#F6F669", "#CDD26A", "#356B45"
GLYPHS = {
    (True, chess.KING): "♔", (True, chess.QUEEN): "♕",
    (True, chess.ROOK): "♖", (True, chess.BISHOP): "♗",
    (True, chess.KNIGHT): "♘", (True, chess.PAWN): "♙",
    (False, chess.KING): "♚", (False, chess.QUEEN): "♛",
    (False, chess.ROOK): "♜", (False, chess.BISHOP): "♝",
    (False, chess.KNIGHT): "♞", (False, chess.PAWN): "♟",
}

class ChessBoardApp:
    def __init__(self, root, engine):
        self.root, self.engine = root, engine
        self.board = chess.Board()
        self.selected = None
        self.thinking = False
        self.size = 80

        root.configure(bg="#202124")
        tk.Label(root, text="CHESS-IQ", font=("Segoe UI", 22, "bold"),
                 fg="white", bg="#202124").pack(pady=(12, 2))
        self.status = tk.StringVar(value="Your turn (White). Select a piece.")
        tk.Label(root, textvariable=self.status, font=("Segoe UI", 11),
                 fg="#E8EAED", bg="#202124").pack(pady=(0, 10))

        self.canvas = tk.Canvas(root, width=640, height=640,
                                highlightthickness=0)
        self.canvas.pack(padx=12, pady=4)
        self.canvas.bind("<Button-1>", self.on_click)

        controls = tk.Frame(root, bg="#202124")
        controls.pack(pady=12)
        tk.Button(controls, text="New game", command=self.new_game,
                  padx=14).pack(side="left", padx=6)
        tk.Button(controls, text="Undo turn", command=self.undo_turn,
                  padx=14).pack(side="left", padx=6)
        self.draw()

    def square_at(self, x, y):
        file_no, rank_row = x // self.size, y // self.size
        if not (0 <= file_no < 8 and 0 <= rank_row < 8):
            return None
        return chess.square(file_no, 7 - rank_row)

    def draw(self):
        self.canvas.delete("all")
        targets = set()
        if self.selected is not None:
            targets = {m.to_square for m in self.board.legal_moves
                       if m.from_square == self.selected}
        last = self.board.peek() if self.board.move_stack else None

        for row in range(8):
            for file_no in range(8):
                sq = chess.square(file_no, 7 - row)
                x, y = file_no * 80, row * 80
                color = LIGHT if (row + file_no) % 2 == 0 else DARK
                if last and sq in (last.from_square, last.to_square):
                    color = LAST
                if sq == self.selected:
                    color = SELECTED
                self.canvas.create_rectangle(x, y, x+80, y+80,
                                             fill=color, outline=color)
                piece = self.board.piece_at(sq)
                if piece:
                    self.canvas.create_text(
                        x+40, y+40, text=GLYPHS[(piece.color, piece.piece_type)],
                        font=("DejaVu Sans", 48), fill="#171717")
                if sq in targets:
                    if piece:
                        self.canvas.create_oval(x+5, y+5, x+75, y+75,
                                                outline=DOT, width=5)
                    else:
                        self.canvas.create_oval(x+32, y+32, x+48, y+48,
                                                fill=DOT, outline="")
        for i, f in enumerate("abcdefgh"):
            self.canvas.create_text(i*80+72, 632, text=f,
                                    fill="#202124", font=("Segoe UI", 9))
        for i in range(8):
            self.canvas.create_text(7, i*80+8, text=str(8-i),
                                    fill="#202124", font=("Segoe UI", 9))

    def on_click(self, event):
        if self.thinking or self.board.is_game_over():
            return
        sq = self.square_at(event.x, event.y)
        if sq is None:
            return
        piece = self.board.piece_at(sq)
        if self.selected is None:
            if piece and piece.color == chess.WHITE:
                self.selected = sq
        else:
            move = chess.Move(self.selected, sq)
            moving = self.board.piece_at(self.selected)
            if moving and moving.piece_type == chess.PAWN and chess.square_rank(sq) == 7:
                move.promotion = chess.QUEEN
            if move in self.board.legal_moves:
                self.board.push(move)
                self.selected = None
                self.draw()
                if self.board.is_game_over():
                    self.show_result()
                    return
                self.status.set("CHESS-IQ is thinking...")
                self.thinking = True
                snapshot = self.board.copy()
                threading.Thread(target=self.engine_worker,
                                 args=(snapshot,), daemon=True).start()
                return
            self.selected = sq if piece and piece.color == chess.WHITE else None
        self.draw()

    def engine_worker(self, snapshot):
        try:
            move = self.engine.best_move(snapshot)
            self.root.after(0, lambda: self.engine_finished(move))
        except Exception as exc:
            self.root.after(0, lambda: self.engine_failed(str(exc)))

    def engine_finished(self, move):
        self.thinking = False
        if move is not None and move in self.board.legal_moves:
            self.board.push(move)
        self.draw()
        if self.board.is_game_over():
            self.show_result()
        else:
            self.status.set("Your turn (White). Select a piece.")

    def engine_failed(self, error):
        self.thinking = False
        self.status.set("Engine error.")
        messagebox.showerror("CHESS-IQ engine error", error)

    def show_result(self):
        outcome = self.board.outcome()
        if outcome is None:
            return
        if outcome.winner is None:
            result = "Draw"
        elif outcome.winner == chess.WHITE:
            result = "You win"
        else:
            result = "CHESS-IQ wins"
        reason = outcome.termination.name.replace("_", " ").lower()
        self.status.set(f"Game over: {result} ({reason}).")

    def new_game(self):
        if self.thinking:
            messagebox.showinfo("Please wait", "Wait for the engine's move.")
            return
        self.board.reset()
        self.selected = None
        self.engine.new_game()
        self.status.set("Your turn (White). Select a piece.")
        self.draw()

    def undo_turn(self):
        if self.thinking:
            return
        # A completed turn consists of the player's move and the engine reply.
        if self.board.move_stack:
            self.board.pop()
        if self.board.move_stack and self.board.turn == chess.BLACK:
            self.board.pop()
        self.selected = None
        self.status.set("Your turn (White). Select a piece.")
        self.draw()

    def close(self):
        self.engine.close()
        self.root.destroy()
