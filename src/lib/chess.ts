import { Chess, type Color, type PieceSymbol } from 'chess.js'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
export const pieceUrl = (color: Color, type: PieceSymbol) => `/pieces/${color}${type.toUpperCase()}.svg`
export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export function safeChess(fen?: string): Chess {
  try { return fen ? new Chess(fen) : new Chess() } catch { return new Chess() }
}

/** Material balance in pawns, white perspective. */
export function materialEval(chess: Chess): number {
  let s = 0
  for (const row of chess.board()) for (const p of row) if (p) s += (p.color === 'w' ? 1 : -1) * VALUE[p.type]
  return s
}

const START_COUNT: Record<PieceSymbol, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 }
/** Pieces each side has lost (i.e. what the opponent has captured). */
export function capturedPieces(chess: Chess): { w: PieceSymbol[]; b: PieceSymbol[] } {
  const have: Record<Color, Record<PieceSymbol, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  }
  for (const row of chess.board()) for (const p of row) if (p) have[p.color][p.type]++
  const out = { w: [] as PieceSymbol[], b: [] as PieceSymbol[] }
  ;(['w', 'b'] as Color[]).forEach((c) => {
    ;(['q', 'r', 'b', 'n', 'p'] as PieceSymbol[]).forEach((t) => {
      const lost = Math.max(0, START_COUNT[t] - have[c][t])
      for (let i = 0; i < lost; i++) out[c].push(t)
    })
  })
  return out
}

export const fmtEval = (e: number) => (Math.abs(e) >= 10 ? (e > 0 ? '#' : '-#') : `${e > 0 ? '+' : ''}${e.toFixed(1)}`)

export function resultText(chess: Chess, resigned?: Color): string | null {
  if (resigned) return resigned === 'w' ? 'Black wins — White resigned' : 'White wins — Black resigned'
  if (chess.isCheckmate()) return chess.turn() === 'w' ? 'Black wins by checkmate' : 'White wins by checkmate'
  if (chess.isStalemate()) return 'Draw by stalemate'
  if (chess.isInsufficientMaterial()) return 'Draw — insufficient material'
  if (chess.isThreefoldRepetition()) return 'Draw by repetition'
  if (chess.isDraw()) return 'Draw'
  return null
}

export const fmtClock = (s: number) => {
  const m = Math.floor(s / 60), r = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}