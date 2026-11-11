import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Chess } from 'chess.js'
import ChessBoard from '../components/ChessBoard'
import { Arrow, Bar, Section } from '../components/Ui'
import { dailyPuzzle, getStats, type PuzzleDto, type Stats } from '../lib/api'
import { fmtClock } from '../lib/chess'
import { useApp } from '../store/app'
import { useAuth } from '../store/auth'

const hud = [{ san: 'Nf3', n: 14, e: '+0.8' }, { san: 'Bxe6', n: 15, e: '+1.1' }, { san: 'Qd2', n: 16, e: '+0.6' }, { san: 'Rfd1', n: 17, e: '+1.4' }, { san: 'Nxd5', n: 18, e: '+2.0' }]

function Hero() {
  const [t, setT] = useState(412)
  const [i, setI] = useState(0)
  useEffect(() => {
    const a = setInterval(() => setT((x) => x + 1), 1000)
    const b = setInterval(() => setI((x) => (x + 1) % hud.length), 3200)
    return () => { clearInterval(a); clearInterval(b) }
  }, [])
  const h = hud[i]
  return (
    <section className="relative min-h-[100svh] split-bg overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,rgba(176,18,18,.35),transparent_60%)]" />
      <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 1.2 }}
        className="display absolute top-[16%] right-[6%] md:right-[14%] text-[28vw] md:text-[20vw] leading-none text-white/[0.07] select-none pointer-events-none">VIII</motion.span>

      {/* Knight */}
      <motion.div initial={{ opacity: 0, y: 60, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 1.4, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ x: '-50%' }} className="absolute left-1/2 bottom-[14%] md:bottom-[7%] h-[min(52svh,92vw)] md:h-[82svh] aspect-square z-20 pointer-events-none">
        <div className="w-full h-full animate-float" style={{ filter: 'drop-shadow(0 0 50px rgba(176,18,18,.55))' }}>
          <div className="w-full h-full" style={{
            WebkitMaskImage: 'url(/pieces/bN.svg)', maskImage: 'url(/pieces/bN.svg)', WebkitMaskSize: 'contain', maskSize: 'contain',
            WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center',
            background: 'linear-gradient(95deg,#000 0%,#060000 44%,#e02424 52%,#8f0d0d 62%,#2a0303 78%,#000 100%)',
          }} />
          <img src="/pieces/bN.svg" alt="" className="absolute inset-0 w-full h-full opacity-[0.14] mix-blend-screen" style={{ filter: 'grayscale(1) contrast(1.4)' }} />
        </div>
      </motion.div>

      {/* Giant wordmark */}
      <div className="absolute inset-x-0 bottom-[3%] z-10 overflow-hidden">
        <motion.h1 initial={{ y: '100%' }} animate={{ y: 0 }} transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1], delay: 0.2 }}
          className="display text-center whitespace-nowrap leading-[0.9] text-[21vw] font-normal"
          style={{ background: 'linear-gradient(90deg,#9a0f0f 50%,#050505 50%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', letterSpacing: '-0.03em' }}>
          CHESSIQ
        </motion.h1>
      </div>

      {/* Left copy */}
      <div className="absolute z-30 left-5 md:left-[7%] top-[22%] md:top-[24%] max-w-[15rem]">
        <div className="flex items-center gap-3 text-sm">
          <span className="grid place-items-center w-6 h-6 border border-dashed border-bone/60"><span className="w-2.5 h-2.5 bg-bone" style={{ clipPath: 'polygon(0 0,50% 0,50% 50%,100% 50%,100% 100%,50% 100%,50% 50%,0 50%)' }} /></span>
          Tactical play
        </div>
        <p className="mt-6 font-extralight text-lg md:text-xl leading-snug text-bone/85">The knight never chooses the obvious path.</p>
      </div>
      <div className="absolute z-30 left-5 md:left-[7%] top-[52%] md:top-[56%] w-[8.5rem] md:w-60">
        <div className="flex justify-between text-sm"><span className="text-bone/70">White</span><span className="tabular-nums">00:{fmtClock(t)}</span></div>
        <div className="h-px bg-bone/30 mt-1.5" />
      </div>

      {/* Right HUD */}
      <div className="absolute z-30 right-5 md:right-[7%] top-[24%] md:top-[18%] text-right">
        <div className="label">Move</div>
        <motion.div key={h.san} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="display italic text-3xl">{h.san}</motion.div>
        <div className="label mt-4">Move</div>
        <motion.div key={h.n} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-2xl font-extralight tabular-nums">{h.n}</motion.div>
        <div className="label mt-3">Evaluation</div>
        <motion.div key={h.e} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-2xl font-light tabular-nums">{h.e}</motion.div>
      </div>
      <Link to="/play" className="group absolute z-30 right-5 md:right-[7%] top-[56%] md:top-[48%] flex items-center gap-3 text-sm md:text-base">
        Advance
        <span className="grid place-items-center w-10 h-10 rounded-full border border-bone/70 transition-all duration-300 group-hover:bg-bone group-hover:text-blood-700 group-hover:translate-x-1"><Arrow /></span>
      </Link>
      <p className="hidden md:block absolute z-30 right-5 md:right-[7%] bottom-[1.5%] text-xs md:text-sm text-bone/60 italic display">Every mistake has a reason.</p>
    </section>
  )
}

const stat = (v: string, l: string) => (
  <div className="flex-1 min-w-[40%] md:min-w-0 px-0 md:px-8 first:md:pl-0 py-4">
    <div className="display text-5xl md:text-6xl">{v}</div>
    <div className="label mt-1">{l}</div>
  </div>
)

export default function Home() {
  const nav = useNavigate()
  const { user, loading } = useAuth()
  const [q, setQ] = useState('')
  const setSeed = useApp((s) => s.setCoachSeed)
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsError, setStatsError] = useState(false)
  const [daily, setDaily] = useState<PuzzleDto | null>(null)
  const [dailyError, setDailyError] = useState<string | null>(null)

  useEffect(() => { dailyPuzzle().then(setDaily).catch((e: Error) => setDailyError(e.message)) }, [])
  useEffect(() => {
    setStats(null); setStatsError(false)
    if (user) getStats().then(setStats).catch(() => setStatsError(true))
  }, [user])

  // Show the daily puzzle as the player sees it: after the opponent's first move
  const dailyFen = (() => { if (!daily) return null; try { const c = new Chess(daily.fen); c.move({ from: daily.moves[0].slice(0, 2), to: daily.moves[0].slice(2, 4), promotion: daily.moves[0][4] }); return { fen: c.fen(), side: c.turn() } } catch { return null } })()
  const ask = (text: string) => { if (!text.trim()) return; setSeed({ text }); nav('/coach') }
  const g = stats?.games
  const w = stats?.weaknesses

  return (
    <>
      <Hero />
      <div className="max-w-[1500px] mx-auto px-5 md:px-10 py-14">
        <Link to="/play-coach" className="group relative block overflow-hidden border border-blood-600/60 bg-gradient-to-r from-blood-800/60 via-coal to-ink p-6 md:p-10 transition-all hover:border-blood-400">
          <img src="/pieces/wN.svg" alt="" className="absolute right-4 md:right-12 top-1/2 -translate-y-1/2 h-40 md:h-56 opacity-90 transition-transform duration-500 group-hover:scale-105 group-hover:-rotate-3" />
          <p className="label">New · Play against the AI Coach</p>
          <h2 className="display text-4xl md:text-6xl mt-2 max-w-xl">Challenge the Coach</h2>
          <p className="text-ash mt-3 max-w-lg">A full game against Stockfish at the level you choose, then a move-by-move review from the Coach.</p>
          <span className="btn btn-solid mt-6 pointer-events-none">Start a game<Arrow /></span>
        </Link>

        <div className="mt-10">
          {!user ? (
            <div className="border hair p-6 flex flex-wrap items-center justify-between gap-4">
              <div><p className="display text-2xl">{loading ? 'Checking your session…' : 'Your statistics will appear here'}</p><p className="text-ash text-sm">Sign in to save games, puzzle progress and Coach conversations.</p></div>
              {!loading && <Link to="/login" className="btn">Sign in</Link>}
            </div>
          ) : statsError ? (
            <p className="text-blood-400">Couldn’t load your statistics. Refresh to try again.</p>
          ) : (
            <div className="flex flex-wrap md:flex-nowrap md:divide-x divide-white/10">
              {stat(g ? String(g.total) : '…', 'Games played')}
              {stat(g ? (g.win_rate_pct === null ? '—' : `${g.win_rate_pct}%`) : '…', 'Win rate')}
              {stat(stats ? String(stats.puzzles.puzzles_solved) : '…', 'Puzzles solved')}
              {stat(stats ? String(stats.puzzles.rating) : '…', 'Puzzle rating')}
            </div>
          )}
        </div>

        <Section title="Today’s training">
          <div className="grid lg:grid-cols-[minmax(0,420px)_1fr] gap-10">
            <div>
              {dailyFen ? <ChessBoard fen={dailyFen.fen} orientation={dailyFen.side} />
                : <div className="aspect-square grid place-items-center border hair text-ash text-center p-6 text-sm">{dailyError ?? 'Loading today’s puzzle…'}</div>}
              <div className="flex items-center justify-between mt-4 text-sm">
                <span className="text-ash">{daily ? `Daily puzzle · rated ${daily.rating}` : 'Daily puzzle'}</span>
                <Link to="/puzzles" className="btn btn-solid !py-2">Solve puzzles</Link>
              </div>
            </div>
            <div className="flex flex-col gap-8">
              <div>
                <h3 className="display text-4xl mb-1">Ask your coach</h3>
                <p className="text-ash mb-4">Questions about a move, an opening or a plan — checked by Stockfish, explained in plain language.</p>
                <form onSubmit={(e) => { e.preventDefault(); ask(q) }} className="flex border hair focus-within:border-blood-500 transition-colors">
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Why does the Sicilian work for Black?" className="flex-1 bg-transparent px-4 py-3 outline-none placeholder:text-ash/60" />
                  <button className="px-5 bg-blood-600 hover:bg-blood-500 transition-colors" aria-label="Ask"><Arrow /></button>
                </form>
                <div className="flex flex-wrap gap-2 mt-3">{['How do I spot a fork?', 'Explain the Italian Game', 'What are my weaknesses?'].map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>
              </div>
              <div>
                <h3 className="display text-4xl mb-4">Quick play</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {[['Play vs Coach', 'Adjustable strength, full game review', '/play-coach'], ['Play vs Stockfish', 'Choose a level, pick a colour', '/play'], ['Analysis board', 'Explore any position freely', '/play'], ['Review a game', 'Import a PGN and see every mistake', '/analysis']].map(([a, b, to]) => (
                    <Link key={a} to={to} className="group border hair p-4 hover:border-blood-500 hover:bg-blood-900/30 transition-all flex justify-between items-center">
                      <span><span className="block">{a}</span><span className="label">{b}</span></span>
                      <Arrow className="transition-transform group-hover:translate-x-1 text-blood-400" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Section>

        {user && stats && (
          <div className="grid lg:grid-cols-2 gap-12">
            <Section title="Recent games" right={<Link to="/profile" className="text-sm text-blood-400 hover:text-bone transition-colors">All stats</Link>}>
              {stats.recent_games.length === 0 ? <p className="text-ash">No saved games yet. Finish a match while signed in and it will show up here.</p> : (
                <div className="divide-y divide-white/10">
                  {stats.recent_games.slice(0, 4).map((r) => (
                    <Link key={r.id} to="/profile" className="flex justify-between py-3 hover:text-blood-400 transition-colors">
                      <span>{r.opponent}{r.difficulty ? <span className="text-ash"> · {r.difficulty}</span> : null}</span>
                      <span className={r.outcome === 'win' ? '' : r.outcome === 'loss' ? 'text-blood-400' : 'text-ash'}>{r.outcome}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Section>
            <Section title="Where you lose points">
              {w?.available && w.errors_by_phase ? (
                <div className="space-y-4">
                  {Object.entries(w.errors_by_phase).map(([phase, e]) => <div key={phase}><div className="flex justify-between text-sm mb-1.5"><span className="capitalize">{phase}</span><span className="text-ash">{e.blunder + e.mistake} serious errors</span></div><Bar value={Math.min(e.blunder * 3 + e.mistake * 2 + e.inaccuracy, 20)} total={20} /></div>)}
                </div>
              ) : <p className="text-ash">{w?.reason ?? 'Play and save a few games and your recurring mistakes will appear here.'}</p>}
            </Section>
          </div>
        )}
      </div>
    </>
  )
}