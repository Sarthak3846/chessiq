# CHESS-IQ Demo

A desktop chessboard built with Python Tkinter and connected to the existing CHESS-IQ UCI engine.

## Features
- 8x8 board with Unicode chess pieces.
- You play White; CHESS-IQ automatically plays Black.
- Legal move validation using `python-chess`.
- Click a piece, then click a highlighted destination.
- New game and undo-turn controls.
- Engine searches to depth 3 by default.

## Install and run

Open PowerShell in the `chessengine` directory:

```powershell
python -m pip install python-chess
python demo/main.py
```

The existing project dependencies and trained checkpoint must already be installed/present. The checkpoint is expected at `chessengine/checkpoints/model_d_square.pth`.

The engine runs as a separate process through its UCI interface. CPU search may take several seconds per move. Time controls and search cancellation are not part of this first demo.
