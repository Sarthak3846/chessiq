import { ARROW_COLOR, arrowGeometry, isKnightJump, shapeKey, type Pt, type Shape } from '../lib/arrows'

interface Props {
  shapes: Shape[]
  draft: Shape | null
  /** Centre of a square in board units, already accounting for board orientation. */
  centre: (sq: string) => Pt
}

const pts = (p: Pt[]) => p.map((q) => `${q.x},${q.y}`).join(' ')

function One({ s, centre, faint }: { s: Shape; centre: Props['centre']; faint?: boolean }) {
  const a = centre(s.from)
  // Group opacity (not per-shape) so the shaft and head don't darken where they overlap.
  if (s.from === s.to) return <circle cx={a.x} cy={a.y} r={0.45} fill="none" stroke={ARROW_COLOR} strokeWidth={0.07} opacity={faint ? 0.55 : 0.8} />
  const g = arrowGeometry(a, centre(s.to), isKnightJump(s.from, s.to))
  return (
    <g opacity={faint ? 0.55 : 0.8}>
      <polyline points={pts(g.shaft)} fill="none" stroke={ARROW_COLOR} strokeWidth={0.2} strokeLinejoin="miter" strokeLinecap="butt" />
      <polygon points={pts(g.head)} fill={ARROW_COLOR} />
    </g>
  )
}

/** Transparent SVG layer over the board; draws user annotations (right-click drag). Never intercepts the mouse. */
export default function BoardArrows({ shapes, draft, centre }: Props) {
  const draftIsNew = draft && !shapes.some((s) => shapeKey(s) === shapeKey(draft))
  return (
    <svg viewBox="0 0 8 8" className="absolute inset-0 w-full h-full pointer-events-none z-20" aria-hidden="true">
      {shapes.map((s) => <One key={shapeKey(s)} s={s} centre={centre} />)}
      {draftIsNew && <One s={draft} centre={centre} faint />}
    </svg>
  )
}