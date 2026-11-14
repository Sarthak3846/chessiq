import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BoardColumn from '../components/BoardColumn'
import { Area, AreaChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Chess } from 'chess.js'
import ChessBoard from '../components/ChessBoard'
import EvalBar from '../components/EvalBar'
import MoveList from '../components/MoveList'
import { Modal, PageHead } from '../components/Ui'
import CoachPanel from '../components/CoachPanel'
import { useGameReview } from '../hooks/useGameReview'
import type { GameReview, ReviewPly } from '../lib/api'
import { OPERA_BEST, OPERA_EVAL, OPERA_NOTES, OPERA_SAN, OPERA_SPECIAL } from '../data/mock'
import { START_FEN, fmtEval, materialEval } from '../lib/chess'
import { useApp } from '../store/app'

type Cls = 'brilliant' | 'great' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'
const CLS: Record<Cls, { label: string; color: string }> = {
  brilliant: { label: 'Brilliant', color: '#38bdf8' }, great: { label: 'Great', color: '#7dd3a8' }, best: { label: 'Best', color: '#a3e635' },
  good: { label: 'Good', color: '#9a908a' }, inaccuracy: { label: 'Inaccuracy', color: '#f5c451' }, mistake: { label: 'Mistake', color: '#f08a3c' }, blunder: { label: 'Blunder', color: '#e23b3b' },
}

interface Analysed { sans: string[]; evals: number[]; cls: Cls[]; loss: number[]; best: Record<number, string>; notes: Record<number, string>; fens: string[]; moves: { from: string; to: string }[]; headers: Record<string, string | null>
  /** Set when the numbers come from the real Stockfish review (otherwise they are estimates / the built-in sample). */
  real?: boolean; covered?: number; start?: number; evalText?: string[]; rp?: ReviewPly[] }

function classify(evals: number[], special: Record<number, Cls> = {}): { cls: Cls[]; loss: number[] } {
  const cls: Cls[] = [], loss: number[] = []
  evals.forEach((e, i) => {
    const prev = i === 0 ? 0.2 : evals[i - 1]
    const l = Math.max(0, i % 2 === 0 ? prev - e : e - prev)
    loss.push(l)
    cls.push(special[i + 1] ?? (l >= 2 ? 'blunder' : l >= 1 ? 'mistake' : l >= 0.5 ? 'inaccuracy' : l <= 0.08 ? 'best' : 'good'))
  })
  return { cls, loss }
}

function build(pgn: string | null): Analysed | null {
  const c = new Chess()
  if (pgn) { try { c.loadPgn(pgn) } catch { return null } } else OPERA_SAN.forEach((s) => c.move(s))
  const hist = c.history({ verbose: true })
  if (!hist.length) return null
  const g = new Chess()
  const fens = [START_FEN]
  hist.forEach((m) => { g.move(m.san); fens.push(g.fen()) })
  const mock = !pgn
  // Imported games: deterministic pseudo-evals from material so the UI is fully populated.
  const evals = mock ? OPERA_EVAL : (() => { const w = new Chess(); return hist.map((m, i) => { w.move(m.san); const wobble = Math.sin(i * 1.7) * 0.35; return Math.max(-9, Math.min(9, materialEval(w) * 0.8 + wobble)) }) })()
  const { cls, loss } = classify(evals, mock ? OPERA_SPECIAL : {})
  return { sans: hist.map((m) => m.san), evals, cls, loss, best: mock ? OPERA_BEST : {}, notes: mock ? OPERA_NOTES : {}, fens, moves: hist.map((m) => ({ from: m.from, to: m.to })), headers: mock ? { Event: 'Paris Opera House', White: 'Paul Morphy', Black: 'Duke of Brunswick & Count Isouard', Date: '1858.??.??', Result: '1-0' } : c.getHeaders() }
}
/** Replace the estimated numbers with the real Stockfish review. Returns the original if the review does not match the game. */
function applyReview(a: Analysed, r: GameReview): Analysed {
  const n = Math.min(r.plies.length, a.sans.length)
  if (n === 0 || r.plies.slice(0, n).some((p, i) => p.san !== a.sans[i])) return a
  const evals: number[] = [], cls: Cls[] = [], loss: number[] = [], evalText: string[] = [], best: Record<number, string> = {}
  a.sans.forEach((_, i) => {
    const p = r.plies[i]
    if (p) {
      evals.push(Math.max(-10, Math.min(10, p.cp_after / 100))); cls.push(p.classification); loss.push(p.cp_loss / 100); evalText.push(p.eval_after)
      if (!p.is_engine_best && p.best_san) best[i + 1] = p.best_san
    } else { evals.push(evals[i - 1] ?? 0); cls.push('good'); loss.push(0); evalText.push(evalText[i - 1] ?? '') } // beyond the analysed part
  })
  return { ...a, evals, cls, loss, best, evalText, real: true, covered: n, start: r.start_cp / 100, rp: r.plies }
}

/** Instant, fact-only summary built from the engine numbers; the AI Coach's explanation replaces it when it arrives. */
function engineSummary(p: ReviewPly): string {
  const pawns = (p.cp_loss / 100).toFixed(1)
  if (p.classification === 'best') return p.is_engine_best ? `${p.san} is the engine's top choice. Evaluation after the move: ${p.eval_after}.` : `${p.san} is practically as good as the engine's top choice, ${p.best_san}.`
  if (p.classification === 'good') return `${p.san} is a sound move (${p.eval_after}).${p.best_san ? ` The engine slightly preferred ${p.best_san}.` : ''}`
  const reply = p.reply_san ? ` The opponent's strongest reply is now ${p.reply_san}.` : ''
  return `${p.san} gives up about ${pawns} pawns of evaluation (${p.eval_before} → ${p.eval_after}). Stockfish preferred ${p.best_san}.${reply}`
}
const SAMPLE = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 Kxf7 7. Qf3+ Ke6 8. Nc3 Nb4 9. O-O c6 10. d4 Kd7 *'

function explain(a: Analysed, ply: number): string {
  if (ply === 0) return 'Select a move to see how the engine rates it and why.'
  const i = ply - 1, san = a.sans[i], c = a.cls[i]
  if (a.notes[ply]) return a.notes[ply]
  if (c === 'blunder' || c === 'mistake') return `${san} loses about ${a.loss[i].toFixed(1)} pawns of evaluation. It gives the opponent a clear tactical or positional chance — check what it leaves undefended.`
  if (c === 'inaccuracy') return `${san} is playable but slightly imprecise (−${a.loss[i].toFixed(1)}). A more active alternative keeps a larger advantage.`
  if (c === 'best' || c === 'great' || c === 'brilliant') return `${san} keeps the evaluation steady and follows sound principles: piece activity, king safety and central control.`
  return `${san} is a reasonable move that keeps the balance.`
}

export default function Analysis() {
  const nav = useNavigate()
  const { analysisSeed, setAnalysisSeed, setCoachSeed } = useApp()
  const [pgn, setPgn] = useState<string | null>(null)
  const [ply, setPly] = useState(0)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [flip, setFlip] = useState(false)

  useEffect(() => { if (analysisSeed) { setPgn(analysisSeed); setAnalysisSeed(null); setPly(0) } }, [analysisSeed, setAnalysisSeed])
  const a = useMemo(() => build(pgn), [pgn])
  const { status: rs, review, error: rerr, retry } = useGameReview(pgn && a ? pgn : null)
  const view = useMemo(() => { const v = a ?? build(null)!; return review ? applyReview(v, review) : v }, [a, review])
  const [showBest, setShowBest] = useState(false)
  useEffect(() => { setShowBest(false) }, [ply, pgn])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1))
      if (e.key === 'ArrowRight') setPly((p) => Math.min(view.sans.length, p + 1))
      if (e.key === 'Home') setPly(0)
      if (e.key === 'End') setPly(view.sans.length)
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [view.sans.length])

  const acc = (parity: 0 | 1) => {
    const ls = view.loss.filter((_, i) => i % 2 === parity && i < (view.covered ?? Infinity))
    return Math.max(20, Math.min(99.9, 100 - (ls.reduce((s, x) => s + x, 0) / Math.max(ls.length, 1)) * 45))
  }
  const count = (parity: 0 | 1, c: Cls) => view.cls.filter((x, i) => i % 2 === parity && x === c).length
  const data = [{ p: 0, e: 0.2 }, ...view.evals.map((e, i) => ({ p: i + 1, e: Math.max(-10, Math.min(10, e)) }))]
  const critical = view.cls.map((c, i) => ({ c, i })).filter((x) => ['blunder', 'mistake', 'brilliant', 'great'].includes(x.c)).slice(0, 6)
    const evalNow = ply === 0 ? (view.start ?? 0.2) : view.evals[ply - 1]
  const rp = ply > 0 ? view.rp?.[ply - 1] : undefined
  const analysed = !!rp
  const best = pgn && rp && !rp.is_engine_best && rp.best_san ? { san: rp.best_san, line: rp.best_line } : null
  const bestArrow = (() => {
    if (!showBest || !best) return undefined
    try { const m = new Chess(view.fens[ply - 1]).move(best.san); return [{ from: m.from, to: m.to }] } catch { return undefined }
  })()
  const notice = !pgn ? null
    : rs === 'loading' ? 'Stockfish is analysing this game — the numbers shown are provisional.'
    : rs === 'error' ? `Stockfish review unavailable (${rerr}). Evaluations are rough estimates from material.`
    : review?.truncated && view.real ? `Analysed the first ${view.covered} of ${review.total_plies} half-moves.` : null
  const cur = ply > 0 ? view.cls[ply - 1] : undefined
  const winner = view.headers.Result === '1-0' ? 'White' : view.headers.Result === '0-1' ? 'Black' : null

  const load = () => {
    try { const c = new Chess(); c.loadPgn(text.trim()); if (!c.history().length) throw new Error(); setPgn(text.trim()); setPly(0); setErr(''); setOpen(false) } catch { setErr('We couldn’t read that PGN. Paste standard move text such as “1. e4 e5 2. Nf3 …”.') }
  }
  const exportPgn = () => {
    const c = new Chess(); view.sans.forEach((s) => c.move(s))
    const url = URL.createObjectURL(new Blob([c.pgn()], { type: 'text/plain' })); const el = document.createElement('a'); el.href = url; el.download = 'chessiq-analysis.pgn'; el.click(); URL.revokeObjectURL(url)
  }
  const askCoach = () => {
  const full = new Chess(); view.sans.forEach((s) => full.move(s))
  setCoachSeed({
    text: ply ? `Why was move ${Math.ceil(ply / 2)}${ply % 2 ? '' : '...'} ${view.sans[ply - 1]} rated ${CLS[cur!].label.toLowerCase()}?` : 'Give me a summary of this game and its biggest mistakes.',
    fen: view.fens[ply], pgn: full.pgn(),
    move: ply ? { san: view.sans[ply - 1], fen_before: view.fens[ply - 1] } : undefined,
    context: ply ? `Move ${Math.ceil(ply / 2)} · ${view.sans[ply - 1]}` : 'Starting position',
  })
  nav('/coach')
}

  return (
    <div className="max-w-[1500px] mx-auto px-5 md:px-10 pt-24 md:pt-32 pb-16">
      <PageHead title="Analysis" sub={`${view.headers.White ?? 'White'} vs ${view.headers.Black ?? 'Black'}${view.headers.Event ? ` · ${view.headers.Event}` : ''}`}
        right={<div className="flex gap-2"><button className="btn" onClick={() => setOpen(true)}>Import PGN</button><button className="btn btn-ghost" onClick={exportPgn}>Export PGN</button></div>} />

      <div className="grid xl:grid-cols-[minmax(0,640px)_1fr] gap-8 lg:gap-12">
        <BoardColumn>
          <div className="flex gap-3 items-stretch">
            <EvalBar value={evalNow} orientation={flip ? 'b' : 'w'} />
            <div className="flex-1 min-w-0"><ChessBoard fen={view.fens[ply]} orientation={flip ? 'b' : 'w'} lastMove={ply ? view.moves[ply - 1] : null} arrows={bestArrow} /></div>
          </div>
          <div className="flex gap-2 mt-4">
            {[['⏮', () => setPly(0)], ['◀', () => setPly((p) => Math.max(0, p - 1))], ['▶', () => setPly((p) => Math.min(view.sans.length, p + 1))], ['⏭', () => setPly(view.sans.length)], ['Flip', () => setFlip((f) => !f)]].map(([l, fn], i) => <button key={i} onClick={fn as () => void} className="btn btn-ghost flex-1 !px-2">{l as string}</button>)}
          </div>
          <p className="label mt-2">Tip: use the arrow keys to step through the game.</p>
        </BoardColumn>

        <div className="space-y-8 min-w-0">
          <div className="h-44 -ml-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(s) => { const p = (s as { activeLabel?: number | string })?.activeLabel; if (p !== undefined) setPly(Number(p)) }}>
                <defs><linearGradient id="ev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f1e9df" stopOpacity={0.9} /><stop offset="50%" stopColor="#f1e9df" stopOpacity={0.15} /><stop offset="50%" stopColor="#8f0d0d" stopOpacity={0.15} /><stop offset="100%" stopColor="#8f0d0d" stopOpacity={0.9} /></linearGradient></defs>
                <XAxis dataKey="p" stroke="#9a908a" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis domain={[-10, 10]} stroke="#9a908a" fontSize={11} tickLine={false} axisLine={false} width={30} />
                <Tooltip formatter={(v) => fmtEval(Number(v))} labelFormatter={(l) => `Ply ${l}`} contentStyle={{ background: '#0d0b0b', border: '1px solid #5c0a0a', color: '#f1e9df' }} />
                <Area type="monotone" dataKey="e" stroke="#d12a2a" strokeWidth={2} fill="url(#ev)" baseValue={0} />
                <ReferenceDot x={ply} y={Math.max(-10, Math.min(10, evalNow))} r={5} fill="#d12a2a" stroke="#f1e9df" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid md:grid-cols-[1fr_1fr] gap-8">
            <div className="panel">
              <div className="px-4 py-3 border-b hair flex justify-between items-center"><span className="display text-xl">Moves</span><span className="label">Click any move</span></div>
              <div className="max-h-72 overflow-y-auto"><MoveList moves={view.sans} current={ply} onSelect={setPly} marks={view.cls.map((c) => (c === 'good' || c === 'best' ? undefined : CLS[c].color))} /></div>
            </div>
            <div className="space-y-5">
              <div className="border-l-2 pl-5" style={{ borderColor: cur ? CLS[cur].color : '#5c0a0a' }}>
                <p className="label">{ply ? `Move ${Math.ceil(ply / 2)}${ply % 2 ? '' : '…'} · ${view.sans[ply - 1]}` : 'Starting position'}{cur && <span className="ml-2" style={{ color: CLS[cur].color }}>{CLS[cur].label}</span>}</p>
                                {pgn || ply === 0 ? (
                  <CoachPanel pgn={pgn} ply={ply} lastPly={view.sans.length} summary={rp ? engineSummary(rp) : explain(view, ply)} analysed={analysed} best={best}
                    showBest={showBest} onToggleBest={() => setShowBest((b) => !b)} onNext={() => setPly((p) => Math.min(view.sans.length, p + 1))}
                    evaluation={view.evalText?.[ply - 1] ?? fmtEval(evalNow)} notice={notice} onRetry={rs === 'error' ? retry : undefined} />
                ) : (<>
                  <p className="mt-2 leading-relaxed">{explain(view, ply)}</p>
                  {view.best[ply] && <p className="mt-2 text-sm text-ash">Engine preferred: <span className="text-bone">{view.best[ply]}</span></p>}
                  <p className="mt-1 text-sm text-ash">Evaluation <span className="text-bone tabular-nums">{fmtEval(evalNow)}</span></p>
                  <div className="flex gap-2 mt-3"><button className="btn !px-4" onClick={() => setPly((p) => Math.min(view.sans.length, p + 1))} disabled={ply >= view.sans.length}>Next</button></div>
                </>)}
              </div>
              <button className="btn w-full" onClick={askCoach}>Ask AI Coach about {ply ? 'this move' : 'this game'}</button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-8 border-t hair pt-6">
            {([0, 1] as const).map((p) => (
              <div key={p}>
                <div className="flex items-baseline justify-between"><span className="flex items-center gap-2"><img src={`/pieces/${p ? 'b' : 'w'}K.svg`} alt="" className="w-6 h-6" />{p ? 'Black' : 'White'}</span><span className="display text-4xl tabular-nums">{acc(p).toFixed(1)}<span className="text-lg text-ash">%</span></span></div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm">
                  {(['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder'] as Cls[]).map((c) => <span key={c} className="text-ash"><i className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: CLS[c].color }} />{count(p, c)} {CLS[c].label.toLowerCase()}{count(p, c) === 1 ? '' : 's'}</span>)}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t hair pt-6">
            <h3 className="display italic text-2xl mb-3">Critical moments</h3>
            {critical.length === 0 ? <p className="text-ash">No critical moments — a clean game.</p> : (
              <ul className="divide-y divide-white/10">{critical.map(({ c, i }) => (
                <li key={i}><button onClick={() => setPly(i + 1)} className="w-full flex justify-between py-2.5 text-left hover:text-blood-400 transition-colors"><span>{Math.floor(i / 2) + 1}{i % 2 ? '…' : '.'} {view.sans[i]}</span><span style={{ color: CLS[c].color }}>{CLS[c].label}</span></button></li>
              ))}</ul>
            )}
          </div>

          <div className="border-t hair pt-6">
            <h3 className="display italic text-2xl mb-2">AI game summary</h3>
            <p className="leading-relaxed text-bone/85">{winner ? `${winner} won in ${Math.ceil(view.sans.length / 2)} moves.` : `The game lasted ${Math.ceil(view.sans.length / 2)} moves.`} {pgn ? 'The evaluation graph above shows where the balance shifted most; start with the critical moments listed here.' : 'White built a lead through fast development while Black spent time on early trades. The decisive mistake was ...b5, after which Morphy’s sacrifices opened every line toward the king, ending in the celebrated queen sacrifice and mate on d8.'} <span className="text-ash">(Mock summary — the coach will write this once the LLM is connected.)</span></p>
          </div>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)}>
        <h3 className="display text-3xl mb-1">Import a game</h3>
        <p className="text-ash text-sm mb-4">Paste PGN move text, or load a sample.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="1. e4 e5 2. Nf3 Nc6 …" className="w-full bg-transparent border hair p-3 text-sm outline-none focus:border-blood-500 transition-colors" />
        {err && <p className="text-sm text-blood-400 mt-2">{err}</p>}
        <div className="flex gap-3 mt-4"><button className="btn btn-solid flex-1" onClick={load}>Analyse game</button><button className="btn btn-ghost" onClick={() => setText(SAMPLE)}>Load sample</button><button className="btn btn-ghost" onClick={() => { setPgn(null); setPly(0); setOpen(false) }}>Opera Game</button></div>
      </Modal>
    </div>
  )
}
