import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Chess } from 'chess.js'
import { AnimatePresence, motion } from 'framer-motion'
import BoardColumn from '../components/BoardColumn'
import ChessBoard from '../components/ChessBoard'
import { PageHead } from '../components/Ui'
import { nextPuzzle, puzzleThemes, recordAttempt, type PuzzleDto } from '../lib/api'
import { fmtClock } from '../lib/chess'
import { useApp } from '../store/app'
import { useAuth } from '../store/auth'

const BANDS = [
  { id: 'Any', min: 0, max: 4000 }, { id: 'Easy', min: 0, max: 1199 }, { id: 'Medium', min: 1200, max: 1599 },
  { id: 'Hard', min: 1600, max: 1999 }, { id: 'Expert', min: 2000, max: 4000 },
]
// Lichess theme keys shown as quick filters (only those present in the imported database are displayed)
const FEATURED = ['fork', 'pin', 'skewer', 'discoveredAttack', 'mate', 'sacrifice', 'deflection', 'doubleCheck', 'backRankMate', 'hangingPiece']
const pretty = (t: string) => (t === 'mate' ? 'Checkmate' : t.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()))
const uci = (u: string) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })

type Status = 'loading' | 'play' | 'wrong' | 'solved' | 'revealed' | 'error' | 'empty'

export default function Puzzles() {
  const nav = useNavigate()
  const { user, profile } = useAuth()
  const setSeed = useApp((s) => s.setCoachSeed)
  const [availableThemes, setAvailableThemes] = useState<string[]>([])
  const [theme, setTheme] = useState('All')
  const [band, setBand] = useState('Any')
  const [puzzle, setPuzzle] = useState<PuzzleDto | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState('')
  const [fen, setFen] = useState('')
  const [last, setLast] = useState<{ from: string; to: string } | null>(null)
  const [step, setStep] = useState(0)
  const [hint, setHint] = useState(0)
  const [mistakes, setMistakes] = useState(0)
  const [secs, setSecs] = useState(0)
  const [rating, setRating] = useState<{ value: number; delta: number } | null>(null)
  const [session, setSession] = useState({ attempted: 0, solved: 0, clean: 0, streak: 0, time: 0 })
  const [seen, setSeen] = useState<string[]>([])
  const timers = useRef<number[]>([])
  const recorded = useRef(false)
  const orientation = useRef<'w' | 'b'>('w')

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  useEffect(() => () => clearTimers(), [])
  useEffect(() => { puzzleThemes().then((t) => setAvailableThemes(FEATURED.filter((f) => t.some((x) => x.theme === f)))).catch(() => undefined) }, [])

  const load = useCallback(async (opts: { theme: string; band: string; exclude: string[] }) => {
    clearTimers(); setStatus('loading'); setMessage(''); setHint(0); setMistakes(0); setSecs(0); setLast(null); setStep(0); setRating(null); recorded.current = false
    const b = BANDS.find((x) => x.id === opts.band) ?? BANDS[0]
    try {
      const p = await nextPuzzle({ themes: opts.theme === 'All' ? undefined : opts.theme, min: b.min, max: b.max, exclude: opts.exclude })
      // Lichess data: FEN is the position BEFORE the opponent's first move (moves[0]); the player then solves moves[1…].
      const c = new Chess(p.fen)
      orientation.current = c.turn() === 'w' ? 'b' : 'w'
      setPuzzle(p); setFen(p.fen); setStatus('play')
      timers.current.push(window.setTimeout(() => {
        const m = c.move(uci(p.moves[0]))
        setFen(c.fen()); setLast({ from: m.from, to: m.to }); setStep(1)
      }, 700))
    } catch (e) {
      const err = e as Error & { status?: number }
      setPuzzle(null); setMessage(err.message)
      setStatus(err.status === 404 ? 'empty' : 'error')
    }
  }, [])

  useEffect(() => { void load({ theme, band, exclude: [] }); setSeen([]) }, [theme, band, load])
  useEffect(() => {
    if (status !== 'play' && status !== 'wrong') return
    const id = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [status, puzzle?.id])

  const record = (solved: boolean) => {
    if (!puzzle || recorded.current) return
    recorded.current = true
    setSession((s) => ({ attempted: s.attempted + 1, solved: s.solved + (solved ? 1 : 0), clean: s.clean + (solved && !hint && !mistakes ? 1 : 0), streak: solved ? s.streak + 1 : 0, time: s.time + (solved ? secs : 0) }))
    if (user) recordAttempt(puzzle.id, { solved, hints_used: hint, mistakes, time_ms: secs * 1000 }).then((r) => setRating({ value: r.rating, delta: r.delta })).catch(() => undefined)
  }

  const onMove = (from: string, to: string, promotion?: string) => {
    if (!puzzle || status === 'solved' || status === 'revealed' || status === 'loading' || step < 1) return false
    const attempt = from + to + (promotion ?? '')
    const expected = puzzle.moves[step]
    const c = new Chess(fen)
    let m
    try { m = c.move({ from, to, promotion }) } catch { return false }
    // Lichess rule: the listed move, or any move that delivers checkmate, solves the final step
    const ok = attempt === expected || attempt.slice(0, 4) === expected.slice(0, 4) || c.isCheckmate()
    if (!ok) { setStatus('wrong'); setMistakes((n) => n + 1); return false }
    setFen(c.fen()); setLast({ from: m.from, to: m.to }); setStatus('play'); setHint(hint > 0 ? 1 : 0)
    const next = step + 1
    if (c.isCheckmate() || next >= puzzle.moves.length) { setStep(next); setStatus('solved'); record(true); return true }
    setStep(next)
    timers.current.push(window.setTimeout(() => {
      const r = c.move(uci(puzzle.moves[next]))
      setFen(c.fen()); setLast({ from: r.from, to: r.to }); setStep(next + 1)
    }, 550))
    return true
  }

  const reveal = () => {
    if (!puzzle) return
    record(false); setStatus('revealed')
    const c = new Chess(fen)
    puzzle.moves.slice(step).forEach((u, i) => timers.current.push(window.setTimeout(() => { const m = c.move(uci(u)); setFen(c.fen()); setLast({ from: m.from, to: m.to }) }, 700 * (i + 1))))
  }
  const next = () => {
    if (puzzle && !recorded.current && mistakes > 0) record(false)
    const ex = puzzle ? [...seen, puzzle.id].slice(-40) : seen
    setSeen(ex); void load({ theme, band, exclude: ex })
  }
  const retry = () => { if (puzzle) { clearTimers(); const p = puzzle; setStatus('play'); setHint(0); setSecs(0); setFen(p.fen); setStep(0); setLast(null); const c = new Chess(p.fen); timers.current.push(window.setTimeout(() => { const m = c.move(uci(p.moves[0])); setFen(c.fen()); setLast({ from: m.from, to: m.to }); setStep(1) }, 500)) } }

  const hintMove = puzzle && hint > 0 && (status === 'play' || status === 'wrong') && step >= 1 && puzzle.moves[step]
    ? { from: uci(puzzle.moves[step]).from, to: hint > 1 ? uci(puzzle.moves[step]).to : uci(puzzle.moves[step]).from } : null
  const done = status === 'solved' || status === 'revealed'
  const accuracy = session.attempted ? Math.round((session.solved / session.attempted) * 100) : null

  return (
    <div className="max-w-[1500px] mx-auto px-5 md:px-10 pt-24 md:pt-32 pb-16">
      <PageHead title="Puzzles" sub="Real puzzles from the Lichess database, drawn from real games. Find the best move; the opponent replies automatically."
        right={<div className="text-right"><div className="label">{user ? 'Your puzzle rating' : 'Sign in to track a rating'}</div><div className="display text-5xl tabular-nums">{user ? (rating?.value ?? profile?.puzzle_rating ?? '—') : '—'}</div></div>} />

      <div className="flex flex-wrap gap-2 mb-2">{['All', ...availableThemes].map((t) => <button key={t} onClick={() => setTheme(t)} className={`chip ${theme === t ? 'chip-on' : ''}`}>{t === 'All' ? 'All themes' : pretty(t)}</button>)}</div>
      <div className="flex flex-wrap gap-2 mb-10">{BANDS.map((b) => <button key={b.id} onClick={() => setBand(b.id)} className={`chip ${band === b.id ? 'chip-on' : ''}`}>{b.id === 'Any' ? 'Any difficulty' : `${b.id} · ${b.min}${b.max >= 4000 ? '+' : `–${b.max}`}`}</button>)}</div>

      {(status === 'error' || status === 'empty') && (
        <div className="border hair p-10 text-center">
          <h3 className="display text-3xl mb-2">{status === 'empty' ? 'No puzzles found' : 'Couldn’t load a puzzle'}</h3>
          <p className="text-ash mb-5 max-w-lg mx-auto">{message}</p>
          <div className="flex gap-3 justify-center">
            {status === 'empty' && <button className="btn btn-solid" onClick={() => { setTheme('All'); setBand('Any') }}>Clear filters</button>}
            <button className="btn" onClick={() => void load({ theme, band, exclude: seen })}>Try again</button>
          </div>
        </div>
      )}

      {status !== 'error' && status !== 'empty' && (
        <div className="grid lg:grid-cols-[minmax(0,640px)_1fr] gap-8 lg:gap-14">
          <BoardColumn>
            {puzzle ? <ChessBoard fen={fen} orientation={orientation.current} lastMove={last} hint={hintMove} canMove={done || status === 'loading' || step < 1 ? 'none' : orientation.current} onMove={onMove} />
              : <div className="aspect-square grid place-items-center border hair text-ash animate-pulseDot">Loading puzzle…</div>}
          </BoardColumn>

          <div className="space-y-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="label">Puzzle {puzzle?.id ?? '…'} · rated {puzzle?.rating ?? '…'}{puzzle?.nb_plays ? ` · played ${puzzle.nb_plays.toLocaleString()}×` : ''}</p>
                <div className="flex flex-wrap gap-1.5 mt-3">{(puzzle?.themes ?? []).filter((t) => !/^(short|long|veryLong|oneMove)$/.test(t)).slice(0, 6).map((t) => <span key={t} className="chip !cursor-default">{pretty(t)}</span>)}</div>
              </div>
              <div className="tabular-nums text-2xl border hair px-3 py-1">{fmtClock(secs)}</div>
            </div>

            <div className="min-h-[7rem]">
              <AnimatePresence mode="wait">
                <motion.div key={status + hint} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {status === 'loading' && <p className="text-xl font-light text-ash">Setting up the position…</p>}
                  {status === 'play' && <p className="text-xl font-light">{step < 1 ? 'Watch the opponent’s move…' : `${orientation.current === 'w' ? 'White' : 'Black'} to move. Find the best move.`}{hint > 0 && <span className="block mt-3 text-base text-ash">{hint === 1 ? 'The highlighted piece is the one to move.' : 'Move it to the highlighted square.'}</span>}</p>}
                  {status === 'wrong' && <p className="text-xl text-blood-400">Not the best move — try again or use a hint.</p>}
                  {done && (
                    <div className="border-l-2 border-blood-500 pl-5">
                      <p className="display text-3xl mb-1">{status === 'solved' ? 'Solved' : 'Solution shown'}</p>
                      {rating && <p className="text-bone/85">Puzzle rating {rating.value} <span className={rating.delta >= 0 ? 'text-bone' : 'text-blood-400'}>({rating.delta >= 0 ? '+' : ''}{rating.delta})</span></p>}
                      {!user && <p className="text-ash text-sm mt-1"><Link to="/login" className="underline underline-offset-4">Sign in</Link> to save your progress and earn a rating.</p>}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex flex-wrap gap-3">
              {(status === 'play' || status === 'wrong') && <>
                <button className="btn" disabled={hint >= 2 || step < 1} onClick={() => setHint((h) => Math.min(2, h + 1))}>{hint === 0 ? 'Show hint' : 'Show move'}</button>
                <button className="btn btn-ghost" onClick={retry}>Retry</button>
                <button className="btn btn-ghost" onClick={reveal}>Show solution</button>
                <button className="btn btn-ghost" onClick={next}>Skip</button>
              </>}
              {done && <>
                <button className="btn btn-solid" onClick={next}>Next puzzle</button>
                <button className="btn btn-ghost" onClick={retry}>Try again</button>
                {puzzle && <button className="btn btn-ghost" onClick={() => { setSeed({ text: `Explain the idea behind this puzzle (${puzzle.themes.slice(0, 3).join(', ')}).`, fen: puzzle.fen, context: `Puzzle ${puzzle.id}` }); nav('/coach') }}>Ask AI Coach</button>}
              </>}
            </div>

            <div className="grid grid-cols-4 gap-px bg-white/10 border hair">
              {[['Solved', session.solved], ['Accuracy', accuracy === null ? '—' : `${accuracy}%`], ['Streak', session.streak], ['Avg time', session.solved ? fmtClock(Math.round(session.time / session.solved)) : '—']].map(([l, v]) => (
                <div key={l as string} className="bg-coal p-3"><div className="display text-2xl">{v}</div><div className="label">{l} <span className="opacity-60">(session)</span></div></div>
              ))}
            </div>
            {puzzle && <p className="label">Source: <a className="underline underline-offset-4 hover:text-bone" href={puzzle.source_url} target="_blank" rel="noreferrer">Lichess puzzle {puzzle.id}</a> · {puzzle.attribution}</p>}
          </div>
        </div>
      )}
    </div>
  )
}