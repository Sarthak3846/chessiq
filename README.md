<<<<<<< HEAD
# ChessIQ — Frontend (v0.1)

Frontend-only implementation of the ChessIQ PRD v3: a browser chess learning and playing platform.
React 18 + TypeScript + Vite + Tailwind CSS. No backend, database, API or LLM — all data is mock.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

## Pages

| Route | Page |
| --- | --- |
| `/` | Home / dashboard |
| `/play` | Play: vs Stockfish (placeholder engine), practice position (FEN), analysis board, local two-player |
| `/coach` | AI Coach chat (canned, streamed replies) |
| `/puzzles` | Tactical puzzles with hints, retry, solution and adaptive rating |
| `/openings` | Opening explorer and trainer |
| `/analysis` | Game analysis (Opera Game sample, PGN import/export) |

## Where to plug in the real services later

- **Stockfish:** `pickPlaceholderMove` in `src/lib/chess.ts` (used by `src/pages/Play.tsx`). Replace with a Stockfish WASM worker or a backend call.
- **Evaluations / move classification:** `build()` in `src/pages/Analysis.tsx` (mock evals) and `src/data/mock.ts`.
- **AI Coach:** `reply()` and `send()` in `src/pages/Coach.tsx`. Swap for the WebSocket stream from the FastAPI coach service.
- **Data:** `src/data/mock.ts` (stats, puzzles, openings, sample game).

## Design notes

- Palette: black `#050505`, blood reds `#5c0a0a`–`#d12a2a`, bone `#f1e9df`. Type: Bodoni Moda (display) and Jost (body), loaded from Google Fonts.
- Pieces: the Lichess default "cburnett" set (Colin M. L. Burnett), in `public/pieces/`. These are licensed GPLv2+ — check that licence suits your distribution.
- Board colours match the Lichess brown board in the reference (`--sq-light`, `--sq-dark` in `src/index.css`).
- There is no camera capture, OTB recording or PGN-from-camera code anywhere in this project.
=======
# chessiq
>>>>>>> 08ddd96403a50cd9dc3b59011ede3d835ca01dc2
