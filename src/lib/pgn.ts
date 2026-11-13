import { Chess, type Color } from 'chess.js'
import { START_FEN } from './chess'

export type GameKind = 'stockfish' | 'coach' | 'local' | 'free'
export interface GameFlags { resigned?: Color; timedOut?: Color; agreed?: boolean }
export interface PgnInput extends GameFlags {
  startFen: string
  sans: string[]
  kind: GameKind
  playerColor: Color
  /** e.g. "Intermediate (≈1400 Elo)" — only for engine opponents */
  level?: string
}

/** PGN result code and termination for a (possibly unfinished) game. */
export function gameResult(c: Chess, f: GameFlags = {}): { code: '1-0' | '0-1' | '1/2-1/2' | '*'; termination: string } {
  if (f.agreed) return { code: '1/2-1/2', termination: 'Draw by agreement' }
  if (f.timedOut) return { code: f.timedOut === 'w' ? '0-1' : '1-0', termination: 'Time forfeit' }
  if (f.resigned) return { code: f.resigned === 'w' ? '0-1' : '1-0', termination: 'Resignation' }
  if (c.isCheckmate()) return { code: c.turn() === 'w' ? '0-1' : '1-0', termination: 'Checkmate' }
  if (c.isStalemate()) return { code: '1/2-1/2', termination: 'Stalemate' }
  if (c.isInsufficientMaterial()) return { code: '1/2-1/2', termination: 'Insufficient material' }
  if (c.isThreefoldRepetition()) return { code: '1/2-1/2', termination: 'Threefold repetition' }
  if (c.isDraw()) return { code: '1/2-1/2', termination: 'Draw' }
  return { code: '*', termination: 'Unterminated' }
}

const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '.')

/** Builds a PGN with ChessIQ metadata: Player, Opponent, Result, and game type. */
export function buildPgn(i: PgnInput): string {
  const c = new Chess(i.startFen === START_FEN ? undefined : i.startFen)
  i.sans.forEach((s) => c.move(s))
  const { code, termination } = gameResult(c, i)
  const outcome = code === '1-0' ? 'White win' : code === '0-1' ? 'Black win' : code === '1/2-1/2' ? 'Draw' : 'Unfinished'

  const opponent = i.kind === 'coach' ? 'My custom engine' : i.kind === 'stockfish' ? 'Stockfish' : null
  const gameType = i.kind === 'coach' ? 'Match against my custom engine' : i.kind === 'stockfish' ? 'Match against Stockfish' : i.kind === 'local' ? 'Local two-player game' : 'Free play'
  const player = 'Player'
  const white = opponent ? (i.playerColor === 'w' ? player : opponent) : i.kind === 'local' ? 'Player 1' : player
  const black = opponent ? (i.playerColor === 'b' ? player : opponent) : i.kind === 'local' ? 'Player 2' : player

  const headers: Record<string, string> = {
    Event: gameType, Site: 'ChessIQ', Date: today(), Round: '-', White: white, Black: black, Result: code,
    GameType: gameType, Outcome: outcome, Termination: termination,
  }
  if (opponent) { headers.Player = player; headers.Opponent = opponent; if (i.level) headers.OpponentLevel = i.level }
  Object.entries(headers).forEach(([k, v]) => c.setHeader(k, v))
  return c.pgn()
}

/** Copies text to the clipboard, with a fallback for non-secure contexts. Returns true on success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok
  } catch { return false }
}

export function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-chess-pgn' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
}