/** A user-drawn board annotation. from === to means a circle around one square. */
export interface Shape { from: string; to: string }

export const ARROW_COLOR = '#3b82f6' // blue (Tailwind blue-500)

const FILES = 'abcdefgh'
const fileOf = (sq: string) => FILES.indexOf(sq[0])
const rankOf = (sq: string) => Number(sq[1])

export const shapeKey = (s: Shape) => `${s.from}${s.to}`

/** Drawing the same shape twice removes it (like Lichess). */
export const toggleShape = (list: Shape[], s: Shape): Shape[] =>
  list.some((x) => shapeKey(x) === shapeKey(s)) ? list.filter((x) => shapeKey(x) !== shapeKey(s)) : [...list, s]

/** True when the two squares are a knight's jump apart (1+2 or 2+1). */
export function isKnightJump(from: string, to: string): boolean {
  const dx = Math.abs(fileOf(from) - fileOf(to)), dy = Math.abs(rankOf(from) - rankOf(to))
  return (dx === 1 && dy === 2) || (dx === 2 && dy === 1)
}

export interface Pt { x: number; y: number }
export interface ArrowGeometry { shaft: Pt[]; head: [Pt, Pt, Pt] }

const SHAFT_END_MARGIN = 0.1 // how far the tip stops short of the centre of the target square
const HEAD_LEN = 0.42
const HEAD_HALF_WIDTH = 0.3

/**
 * Geometry in board units (1 unit = 1 square, origin top-left of the displayed board).
 * `a` and `b` are the centres of the start / end squares as displayed (so orientation is already applied).
 * A knight jump is routed as an "L": two squares along the long axis first, then one along the short axis.
 */
export function arrowGeometry(a: Pt, b: Pt, knight: boolean): ArrowGeometry {
  const dx = b.x - a.x, dy = b.y - a.y
  const corner: Pt | null = knight ? (Math.abs(dx) > Math.abs(dy) ? { x: b.x, y: a.y } : { x: a.x, y: b.y }) : null
  const from = corner ?? a // the last straight leg runs from here to b
  const len = Math.hypot(b.x - from.x, b.y - from.y) || 1
  const ux = (b.x - from.x) / len, uy = (b.y - from.y) / len
  const tip: Pt = { x: b.x - ux * SHAFT_END_MARGIN, y: b.y - uy * SHAFT_END_MARGIN }
  const base: Pt = { x: tip.x - ux * HEAD_LEN, y: tip.y - uy * HEAD_LEN }
  const nx = -uy, ny = ux
  return {
    shaft: corner ? [a, corner, base] : [a, base],
    head: [tip, { x: base.x + nx * HEAD_HALF_WIDTH, y: base.y + ny * HEAD_HALF_WIDTH }, { x: base.x - nx * HEAD_HALF_WIDTH, y: base.y - ny * HEAD_HALF_WIDTH }],
  }
}