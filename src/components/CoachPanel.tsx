import { useEffect, useRef, useState } from 'react'
import { explainMove } from '../lib/api'

interface Props {
  /** PGN the explanations are generated for; null for the built-in sample game (no AI explanations). */
  pgn: string | null
  ply: number
  lastPly: number
  /** Text shown instantly from engine/fixed data; the AI explanation replaces it when it arrives. */
  summary: string
  /** Engine analysis exists for this move (so the AI Coach may explain it). */
  analysed: boolean
  /** The engine's preferred move, only when it differs from the move played. */
  best: { san: string; line: string[] } | null
  showBest: boolean
  onToggleBest: () => void
  onNext: () => void
  /** Evaluation after the move (White's point of view), e.g. +0.43 or +M3. */
  evaluation?: string
  notice?: string | null
  onRetry?: () => void
}

type Mode = 'short' | 'deep'
const DWELL_MS = 700 // only ask the LLM once the player has stayed on a move; stepping quickly costs nothing

/** Coach Magnus feedback for the selected move: instant engine summary, lazy cached AI explanation, Explain / Best / Next. */
export default function CoachPanel({ pgn, ply, lastPly, summary, analysed, best, showBest, onToggleBest, onNext, evaluation, notice, onRetry }: Props) {
  const cache = useRef(new Map<string, string>())
  const [, bump] = useState(0)
  const [busy, setBusy] = useState<Mode | null>(null)
  const [failed, setFailed] = useState<Mode | null>(null)
  const [deep, setDeep] = useState(false)

  useEffect(() => { cache.current.clear(); bump((n) => n + 1) }, [pgn])
  useEffect(() => { setDeep(false); setFailed(null) }, [ply, pgn])

  const request = async (mode: Mode, isStale: () => boolean) => {
    const key = `${ply}:${mode}`
    if (!pgn || ply < 1 || cache.current.has(key)) return
    setBusy(mode); setFailed(null)
    try {
      const r = await explainMove(pgn, ply, mode)
      cache.current.set(key, r.text)
    } catch { if (!isStale()) setFailed(mode) }
    if (!isStale()) { setBusy(null); bump((n) => n + 1) }
  }

  useEffect(() => {
    if (!pgn || !analysed || ply < 1) return
    let stale = false
    const t = setTimeout(() => { void request('short', () => stale) }, DWELL_MS)
    return () => { stale = true; clearTimeout(t); setBusy(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pgn, ply, analysed])

  const explain = () => { setDeep(true); void request('deep', () => false) }
  const short = cache.current.get(`${ply}:short`), long = cache.current.get(`${ply}:deep`)
  const text = (deep && long) || short || summary
  const aiPending = !!pgn && analysed && ply > 0 && !short && !failed

  return (
    <div>
      <p className={`mt-2 leading-relaxed transition-opacity ${aiPending && busy ? 'opacity-70' : ''}`} aria-live="polite">{text}</p>
      {showBest && best && (
        <p className="mt-2 text-sm text-ash">Stockfish prefers <span className="text-bone">{best.san}</span>{best.line.length > 1 && <> — line: <span className="text-bone">{best.line.slice(0, 5).join(' ')}</span></>}</p>
      )}
      {evaluation && ply > 0 && <p className="mt-1 text-sm text-ash">Evaluation <span className="text-bone tabular-nums">{evaluation}</span></p>}
      {(busy || failed || notice) && (
        <p className="label mt-2" role="status">
          {notice ?? (busy === 'deep' ? 'Coach Magnus is preparing a deeper explanation…' : busy ? 'Coach Magnus is writing…' : `The AI explanation is unavailable right now — showing the engine summary.`)}
          {(failed || (notice && onRetry)) && <button className="ml-2 underline hover:text-bone" onClick={failed ? explain : onRetry}>Retry</button>}
        </p>
      )}
      <div className="flex gap-2 mt-3">
        {pgn && analysed && ply > 0 && <button className="btn btn-ghost !px-4" onClick={explain} disabled={busy === 'deep'}>{long ? 'Explained' : 'Explain'}</button>}
        {best && ply > 0 && <button className={`btn btn-ghost !px-4 ${showBest ? 'text-bone border-blood-500' : ''}`} onClick={onToggleBest} aria-pressed={showBest}>Best</button>}
        <button className="btn !px-4" onClick={onNext} disabled={ply >= lastPly}>Next</button>
      </div>
    </div>
  )
}