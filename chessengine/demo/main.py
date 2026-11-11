from pathlib import Path
import tkinter as tk
from tkinter import messagebox
from board_ui import ChessBoardApp
from engine_bridge import UCIEngine

def main():
    root = tk.Tk()
    root.title("CHESS-IQ | Play against your engine")
    root.geometry("700x740")
    root.minsize(620, 680)
    try:
        engine = UCIEngine(Path(__file__).resolve().parent.parent, depth=3)
    except Exception as exc:
        messagebox.showerror("Engine startup failed", str(exc))
        root.destroy()
        return
    app = ChessBoardApp(root, engine)
    root.protocol("WM_DELETE_WINDOW", app.close)
    root.mainloop()

if __name__ == "__main__":
    main()
