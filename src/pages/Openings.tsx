import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Chess } from 'chess.js'
import ChessBoard from '../components/ChessBoard'
import MoveList from '../components/MoveList'
import { Bar, PageHead } from '../components/Ui'
import { openings, type Opening } from '../data/mock'
import { safeChess } from '../lib/chess'
import { useApp } from '../store/app'
import BoardColumn from '../components/BoardColumn'

type Tab = 'learn' | 'train'

function fenAt(moves: string[], n: number) { const c = new Chess(); moves.slice(0, n).forEach((m) => c.move(m)); return c }

export default function Openings() {
  const nav = useNavigate()
  const setSeed = useApp((s) => s.setCoachSeed)
  const [q, setQ] = useState('')
  const [side, setSide] = useState<'All' | 'White' | 'Black'>('All')
  const [sel, setSel] = useState<Opening>(openings[0])
  const [line, setLine] = useState(0) // 0 = main, n = variation n-1
  const [ply, setPly] = useState(0)
  const [tab, setTab] = useState<Tab>('learn')
  const [auto, setAuto] = useState(false)
  const [familiar, setFamiliar] = useState<Record<string, number>>({ italian: 70, sicilian: 40, caro: 25 })
  const [tr, setTr] = useState({ ply: 0, msg: '', ok: 0, miss: 0, hints: true, wrong: false })

  const moves = line === 0 ? sel.main : sel.variations[line - 1].moves
  const filtered = openings.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()) && (side === 'All' || o.side === side))
  const userSide = sel.side === 'White' ? 0 : 1 // parity of plies the user plays

  useEffect(() => { setPly(0); setAuto(false); setLine(0); setTr({ ply: 0, msg: '', ok: 0, miss: 0, hints: true, wrong: false }) }, [sel.id])
  useEffect(() => { setPly(0); setAuto(false); setTr((t) => ({ ...t, ply: 0, msg: '', wrong: false })) }, [line, tab])
  useEffect(() => {
    if (!auto) return
    if (ply >= moves.length) { setAuto(false); return }
    const id = setTimeout(() => setPly((p) => p + 1), 900)
    return () => clearTimeout(id)
  }, [auto, ply, moves.length])

  // Trainer: auto-play opponent's moves
  useEffect(() => {
    if (tab !== 'train' || tr.ply >= moves.length) return
    if (tr.ply % 2 !== userSide) {
      const id = setTimeout(() => setTr((t) => ({ ...t, ply: t.ply + 1, msg: '', wrong: false })), 600)
      return () => clearTimeout(id)
    }
  }, [tab, tr.ply, moves, userSide])

  const learnChess = useMemo(() => fenAt(moves, ply), [moves, ply])
  const trainChess = useMemo(() => fenAt(moves, tr.ply), [moves, tr.ply])
  const lastOf = (c: Chess) => { const h = c.history({ verbose: true }); const m = h[h.length - 1]; return m ? { from: m.from, to: m.to } : null }

  const onTrainMove = (from: string, to: string, promotion?: string) => {
    if (tr.ply >= moves.length || tr.ply % 2 !== userSide) return false
    const c = safeChess(trainChess.fen())
    let san = ''
    try { san = c.move({ from, to, promotion }).san } catch { return false }
    if (san === moves[tr.ply]) {
      const finished = tr.ply + 1 >= moves.length
      setTr((t) => ({ ...t, ply: t.ply + 1, ok: t.ok + 1, msg: finished ? 'Line complete. Well played.' : 'Correct.', wrong: false }))
      if (finished) setFamiliar((f) => ({ ...f, [sel.id]: Math.min(100, (f[sel.id] ?? 0) + 15) }))
      return true
    }
    setTr((t) => ({ ...t, miss: t.miss + 1, wrong: true, msg: `${san} is a legal move, but the main line continues ${moves[tr.ply]}.` }))
    return false
  }
  const nextHint = tr.hints && tr.ply < moves.length && tr.ply % 2 === userSide ? safeChess(trainChess.fen()).moves({ verbose: true }).find((m) => m.san === moves[tr.ply]) : undefined
  const complete = tr.ply >= moves.length

  return (
    <div className="max-w-[1500px] mx-auto px-5 md:px-10 pt-24 md:pt-32 pb-16">
      <PageHead title="Openings" sub="Learn the ideas first, then the moves. Pick an opening, step through it, and test yourself without hints." />
      <div className="grid lg:grid-cols-[300px_1fr] gap-8 lg:gap-12">
        <aside>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search openings" className="w-full bg-transparent border hair px-4 py-2.5 outline-none focus:border-blood-500 transition-colors mb-3" aria-label="Search openings" />
          <div className="flex gap-2 mb-4">{(['All', 'White', 'Black'] as const).map((s) => <button key={s} onClick={() => setSide(s)} className={`chip ${side === s ? 'chip-on' : ''}`}>{s}</button>)}</div>
          <ul className="max-h-[32rem] overflow-y-auto divide-y divide-white/10 border-y hair">
            {filtered.map((o) => (
              <li key={o.id}><button onClick={() => setSel(o)} className={`w-full text-left py-3 px-3 transition-all border-l-2 ${sel.id === o.id ? 'border-blood-500 bg-blood-800/30' : 'border-transparent hover:bg-white/5 hover:pl-4'}`}>
                <div className="flex justify-between"><span>{o.name}</span><span className="label">{o.eco}</span></div>
                <div className="mt-2"><Bar value={familiar[o.id] ?? 0} /></div>
              </button></li>
            ))}
            {filtered.length === 0 && <li className="p-4 label">No opening matches “{q}”.</li>}
          </ul>
        </aside>

        <div>
          <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
            <div>
              <p className="label">{sel.eco} · Play as {sel.side} · {sel.popularity}% popularity · {sel.winRate}% White score</p>
              <h2 className="display text-4xl md:text-6xl">{sel.name}</h2>
            </div>
            <div className="flex border hair">{(['learn', 'train'] as Tab[]).map((t) => <button key={t} onClick={() => setTab(t)} className={`px-5 py-2 text-sm transition-colors ${tab === t ? 'bg-blood-700' : 'hover:bg-white/5 text-ash'}`}>{t === 'learn' ? 'Learn' : 'Train'}</button>)}</div>
          </div>

          <div className="grid xl:grid-cols-[minmax(0,640px)_1fr] gap-8">
            <BoardColumn>
              {tab === 'learn'
                ? <ChessBoard fen={learnChess.fen()} orientation={sel.side === 'White' ? 'w' : 'b'} lastMove={lastOf(learnChess)} />
                : <ChessBoard fen={trainChess.fen()} orientation={sel.side === 'White' ? 'w' : 'b'} lastMove={lastOf(trainChess)} hint={nextHint ? { from: nextHint.from, to: nextHint.to } : null} canMove={complete ? 'none' : sel.side === 'White' ? 'w' : 'b'} onMove={onTrainMove} />}
              {tab === 'learn' ? (
                <div className="flex gap-2 mt-4">
                  {[['⏮', () => setPly(0)], ['◀', () => setPly((p) => Math.max(0, p - 1))], [auto ? 'Pause' : 'Play', () => { if (ply >= moves.length) setPly(0); setAuto((a) => !a) }], ['▶', () => setPly((p) => Math.min(moves.length, p + 1))], ['⏭', () => setPly(moves.length)]].map(([l, fn], i) => (
                    <button key={i} onClick={fn as () => void} className="btn btn-ghost flex-1 !px-2" aria-label={String(l)}>{l as string}</button>
                  ))}
                </div>
              ) : (
                <div className="mt-4 flex items-center justify-between text-sm">
                  <label className="flex items-center gap-2 text-ash cursor-pointer"><input type="checkbox" className="accent-[#b01212]" checked={tr.hints} onChange={(e) => setTr({ ...tr, hints: e.target.checked })} />Show hints</label>
                  <span className="text-ash">Correct {tr.ok} · Missed {tr.miss}</span>
                </div>
              )}
            </BoardColumn>

            <div className="space-y-6">
              <div className="border-l-2 border-blood-500 pl-5">
                <p className="label mb-1">The idea</p>
                <p className="text-lg font-light leading-relaxed">{sel.idea}</p>
                <p className="text-ash mt-2">{sel.blurb}</p>
              </div>

              <div>
                <p className="label mb-2">Line</p>
                <div className="flex flex-wrap gap-2">
                  {['Main line', ...sel.variations.map((v) => v.name)].map((n, i) => <button key={n} onClick={() => setLine(i)} className={`chip ${line === i ? 'chip-on' : ''}`}>{n}</button>)}
                </div>
              </div>

              {tab === 'learn' ? (
                <div className="panel max-h-56 overflow-y-auto"><MoveList moves={moves} current={ply} onSelect={(p) => { setAuto(false); setPly(p) }} /></div>
              ) : (
                <div className="panel p-5 min-h-[9rem]">
                  <AnimatePresence mode="wait">
                    <motion.p key={tr.msg + tr.ply} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`text-lg ${tr.wrong ? 'text-blood-400' : ''}`}>
                      {complete ? tr.msg || 'Line complete.' : tr.ply % 2 === userSide ? (tr.msg || `Your move. Play the ${sel.side === 'White' ? 'White' : 'Black'} move from the line.`) : 'Opponent is replying…'}
                    </motion.p>
                  </AnimatePresence>
                  <div className="flex gap-3 mt-4"><button className="btn btn-ghost" onClick={() => setTr({ ply: 0, msg: '', ok: 0, miss: 0, hints: tr.hints, wrong: false })}>Restart line</button>
                    {!tr.hints && <button className="btn btn-ghost" onClick={() => setTr({ ...tr, hints: true })}>Show hint</button>}</div>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button className="btn" onClick={() => { setSeed({ text: `Explain the strategic ideas behind the ${sel.name}, not just the moves.` }); nav('/coach') }}>Ask AI Coach about this opening</button>
              </div>
              <div><div className="flex justify-between label mb-1.5"><span>Familiarity</span><span>{familiar[sel.id] ?? 0}%</span></div><Bar value={familiar[sel.id] ?? 0} /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
