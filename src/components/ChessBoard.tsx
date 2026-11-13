import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Square } from 'chess.js'
import { pieceUrl, safeChess } from '../lib/chess'
import { toggleShape, type Shape } from '../lib/arrows'
import BoardArrows from './BoardArrows'

export interface BoardProps {
  fen: string
  orientation?: 'w' | 'b'
  /** Which side the user may move. 'both' lets whoever is on turn move. */
  canMove?: 'w' | 'b' | 'both' | 'none'
  lastMove?: { from: string; to: string } | null
  hint?: { from: string; to: string } | null
  onMove?: (from: string, to: string, promotion?: string) => boolean
  className?: string
}

const FILES = 'abcdefgh'

export default function ChessBoard({ fen, orientation = 'w', canMove = 'none', lastMove, hint, onMove, className = '' }: BoardProps) {
  const chess = useMemo(() => safeChess(fen), [fen])
  const board = chess.board()
  const [selected, setSelected] = useState<Square | null>(null)
  const [shake, setShake] = useState(0)
  const [prevFen, setPrevFen] = useState(fen)
  const [shapes, setShapes] = useState<Shape[]>([]) // user-drawn arrows / circles
  const [draft, setDraft] = useState<Shape | null>(null) // the one being dragged right now
  const gridRef = useRef<HTMLDivElement>(null)
  if (prevFen !== fen) { setPrevFen(fen); setSelected(null); setShapes([]); setDraft(null) }

  const targets = useMemo(() => {
    if (!selected) return new Map<string, boolean>()
    return new Map(chess.moves({ square: selected, verbose: true }).map((m) => [m.to as string, !!m.captured]))
  }, [chess, selected])

  const kingInCheck = chess.inCheck() ? board.flat().find((p) => p && p.type === 'k' && p.color === chess.turn())?.square : undefined

  const movable = (color: 'w' | 'b') => canMove !== 'none' && chess.turn() === color && (canMove === 'both' || canMove === color)

  const attempt = (from: Square, to: Square) => {
    const piece = chess.get(from)
    const promo = piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined
    const ok = onMove?.(from, to, promo) ?? false
    if (!ok) setShake((s) => s + 1)
    setSelected(null)
  }

  const click = (sq: Square) => {
    if (selected && targets.has(sq)) return attempt(selected, sq)
    const p = chess.get(sq)
    if (p && movable(p.color)) setSelected(sq === selected ? null : sq)
    else setSelected(null)
  }

  const cols = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0]
  const rows = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0] // row index into board() => rank 8..1
  const colOf = (sq: string) => cols.indexOf(FILES.indexOf(sq[0]))
  const rowOf = (sq: string) => rows.indexOf(8 - Number(sq[1]))
  const centre = (sq: string) => ({ x: colOf(sq) + 0.5, y: rowOf(sq) + 0.5 })

  /** Square under the pointer, using the displayed (possibly flipped) layout. */
  const squareAt = (e: { clientX: number; clientY: number }): string | null => {
    const el = gridRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const c = Math.floor(((e.clientX - r.left) / r.width) * 8), rw = Math.floor(((e.clientY - r.top) / r.height) * 8)
    if (c < 0 || c > 7 || rw < 0 || rw > 7) return null
    return `${FILES[cols[c]]}${8 - rows[rw]}`
  }

  return (
    <motion.div
      key={shake}
      animate={shake ? { x: [0, -7, 7, -5, 5, 0] } : undefined}
      transition={{ duration: 0.35 }}
      className={`relative w-full aspect-square p-[clamp(6px,1.4vw,14px)] bg-gradient-to-br from-blood-800 via-coal to-ink glow-red ${className}`}
    >
      <div
        ref={gridRef}
        className="relative grid grid-cols-8 grid-rows-8 w-full h-full select-none shadow-[0_20px_60px_-10px_rgba(0,0,0,.9)]"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button === 2) { const sq = squareAt(e); if (sq) { e.currentTarget.setPointerCapture(e.pointerId); setDraft({ from: sq, to: sq }) } }
          else if (e.button === 0) setShapes((s) => (s.length ? [] : s)) // a normal click clears the drawings
        }}
        onPointerMove={(e) => { if (!draft) return; const sq = squareAt(e); if (sq && sq !== draft.to) setDraft({ ...draft, to: sq }) }}
        onPointerUp={(e) => { if (e.button !== 2 || !draft) return; const d = draft; setDraft(null); setShapes((s) => toggleShape(s, d)) }}
        onPointerCancel={() => setDraft(null)}
      >
        {rows.map((r) => cols.map((f) => {
          const sq = `${FILES[f]}${8 - r}` as Square
          const p = board[r][f]
          const dark = (f + (7 - r)) % 2 === 0
          const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq)
          const isTarget = targets.has(sq)
          const isHint = hint && (hint.from === sq || hint.to === sq)
          const dc = colOf(sq), dr = rowOf(sq)
          const showFile = dr === 7, showRank = dc === 7
          const moved = lastMove && lastMove.to === sq
          return (
            <div
              key={sq}
              data-square={sq}
              className="board-sq"
              style={{ background: dark ? 'var(--sq-dark)' : 'var(--sq-light)', gridColumn: dc + 1, gridRow: dr + 1 }}
              onClick={() => click(sq)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData('text/plain') as Square; if (from && from !== sq) attempt(from, sq) }}
            >
              {isLast && <div className="absolute inset-0 bg-blood-400/40" />}
              {selected === sq && <div className="absolute inset-0 bg-blood-500/60" />}
              {isHint && <div className="absolute inset-0 ring-4 ring-inset ring-blood-400 animate-pulseDot" />}
              {kingInCheck === sq && <div className="absolute inset-0" style={{ background: 'radial-gradient(circle, rgba(255,0,0,.95) 0%, rgba(200,0,0,.6) 40%, transparent 72%)' }} />}
              {showFile && <span className="absolute left-[4%] bottom-[2%] text-[clamp(8px,1.2vw,13px)] font-medium z-10 pointer-events-none" style={{ color: dark ? 'var(--sq-light)' : 'var(--sq-dark)' }}>{FILES[f]}</span>}
              {showRank && <span className="absolute right-[5%] top-[2%] text-[clamp(8px,1.2vw,13px)] font-medium z-10 pointer-events-none" style={{ color: dark ? 'var(--sq-light)' : 'var(--sq-dark)' }}>{8 - r}</span>}
              {p && (
                <div
                  key={`${fen}-${sq}`}
                  className="absolute inset-0"
                  draggable={movable(p.color)}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', sq); e.dataTransfer.effectAllowed = 'move'; if (movable(p.color)) setSelected(sq) }}
                >
                  <motion.div
                    className="piece"
                    style={{ backgroundImage: `url(${pieceUrl(p.color, p.type)})`, cursor: movable(p.color) ? 'grab' : 'default' }}
                    initial={moved && lastMove ? { x: `${(colOf(lastMove.from) - dc) * 100}%`, y: `${(rowOf(lastMove.from) - dr) * 100}%` } : false}
                    animate={{ x: 0, y: 0 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                  />
                </div>
              )}
              {isTarget && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  {targets.get(sq)
                    ? <div className="w-[92%] h-[92%] rounded-full border-[5px] border-black/25" />
                    : <div className="w-[30%] h-[30%] rounded-full bg-black/25" />}
                </div>
              )}
            </div>
          )
        }))}
        <BoardArrows shapes={shapes} draft={draft} centre={centre} />
      </div>
    </motion.div>
  )
}