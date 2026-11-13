import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Bar, PageHead, Section } from '../components/Ui'
import { getGame, getStats, type Difficulty, type Stats } from '../lib/api'
import { useApp } from '../store/app'
import { useAuth } from '../store/auth'

const LEVELS: { id: Difficulty; label: string }[] = [
  { id: 'beginner', label: 'Beginner' }, { id: 'easy', label: 'Easy' }, { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' }, { id: 'expert', label: 'Expert' }, { id: 'max', label: 'Maximum' },
]
const label = (s: string) => s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())

export default function Profile() {
  const { user, loading, signOut, setPreferredDifficulty } = useAuth()
  const nav = useNavigate()
  const setAnalysisSeed = useApp((s) => s.setAnalysisSeed)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  const load = useCallback(() => {
    setBusy(true); setError(null)
    getStats().then(setStats).catch((e: Error) => setError(e.message)).finally(() => setBusy(false))
  }, [])
  useEffect(() => { if (user) load() }, [user, load])

  if (loading) return <div className="pt-40 text-center text-ash">Checking your session…</div>
  if (!user) return <Navigate to="/login" replace />

  const review = async (id: string) => { try { setAnalysisSeed((await getGame(id)).pgn); nav('/analysis') } catch (e) { setError((e as Error).message) } }
  const g = stats?.games
  const w = stats?.weaknesses

  return (
    <div className="max-w-[1100px] mx-auto px-5 md:px-10 pt-24 md:pt-32 pb-20">
      <PageHead title={user.name ?? 'Your profile'} sub={user.email ?? undefined}
        right={<button className="btn btn-ghost" onClick={() => void signOut().then(() => nav('/'))}>Sign out</button>} />

      {error && <div className="border border-blood-700 bg-blood-900/40 p-3 mb-6 text-sm"><p className="text-blood-400">{error}</p><button className="chip mt-2" onClick={load}>Try again</button></div>}
      {busy && !stats && <p className="text-ash">Loading your statistics…</p>}

      {stats && g && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-y-6 md:divide-x divide-white/10">
            {[[String(g.total), 'Games played'], [g.win_rate_pct === null ? '—' : `${g.win_rate_pct}%`, 'Win rate'], [String(stats.puzzles.puzzles_solved), 'Puzzles solved'],
              [stats.puzzles.accuracy_pct === null ? '—' : `${stats.puzzles.accuracy_pct}%`, 'Puzzle accuracy'], [String(stats.puzzles.rating), 'Puzzle rating']].map(([v, l]) => (
              <div key={l} className="md:px-6 first:md:pl-0"><div className="display text-4xl md:text-5xl">{v}</div><div className="label mt-1">{l}</div></div>
            ))}
          </div>
          <p className="label mt-4">{g.wins} wins · {g.draws} draws · {g.losses} losses · {stats.streak_days}-day activity streak</p>

          <Section title="Preferred difficulty">
            <div className="flex flex-wrap gap-2">
              {LEVELS.map((l) => <button key={l.id} onClick={() => { setPreferredDifficulty(l.id); setStats({ ...stats, profile: { ...stats.profile, preferred_difficulty: l.id } }) }} className={`chip ${stats.profile.preferred_difficulty === l.id ? 'chip-on' : ''}`}>{l.label}</button>)}
            </div>
            <p className="label mt-2">Used as the default when you start a match against Stockfish or my custom engine.</p>
          </Section>

          <Section title="Recent games" right={<Link to="/play-coach" className="text-sm text-blood-400 hover:text-bone transition-colors">Play My Custom Engine</Link>}>
            {stats.recent_games.length === 0 ? <p className="text-ash">No saved games yet. Finish a match against Stockfish or my custom engine while signed in and it will appear here.</p> : (
              <div className="divide-y divide-white/10">
                {stats.recent_games.map((r) => (
                  <button key={r.id} onClick={() => void review(r.id)} className="w-full grid grid-cols-[1fr_auto] md:grid-cols-[2fr_1fr_1fr_auto] gap-3 py-3 px-2 -mx-2 text-left items-center hover:bg-white/[0.03] transition-colors">
                    <span>{r.opponent}{r.difficulty ? <span className="text-ash"> · {r.difficulty}</span> : null}</span>
                    <span className={r.outcome === 'win' ? 'text-bone' : r.outcome === 'loss' ? 'text-blood-400' : 'text-ash'}>{r.outcome} <span className="text-ash">· {r.termination ?? r.result}</span></span>
                    <span className="hidden md:block text-ash">{r.moves_count} plies</span>
                    <span className="text-ash text-sm">{new Date(r.played_at).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section title="Where you lose points">
            {!w?.available && (w?.weakest_puzzle_themes.length ?? 0) === 0 ? <p className="text-ash">{w?.reason ?? 'Play and save a few games and the Coach will find your recurring mistakes.'}</p> : (
              <div className="grid md:grid-cols-2 gap-10">
                {w?.available && w.errors_by_phase && (
                  <div className="space-y-4">
                    <p className="label">Errors per phase across {w.games_analysed} analysed game(s) · average loss {w.average_cp_loss} cp per move</p>
                    {Object.entries(w.errors_by_phase).map(([phase, e]) => {
                      const n = e.inaccuracy + e.mistake * 2 + e.blunder * 3
                      return <div key={phase}><div className="flex justify-between text-sm mb-1.5"><span className="capitalize">{phase}</span><span className="text-ash">{e.blunder} blunders · {e.mistake} mistakes · {e.inaccuracy} inaccuracies</span></div><Bar value={Math.min(n, 20)} total={20} /></div>
                    })}
                  </div>
                )}
                {(w?.weakest_puzzle_themes.length ?? 0) > 0 && (
                  <div className="space-y-4">
                    <p className="label">Weakest puzzle themes (3+ attempts)</p>
                    {w!.weakest_puzzle_themes.map((t) => <div key={t.theme}><div className="flex justify-between text-sm mb-1.5"><span>{label(t.theme)}</span><span className="text-ash">{t.success_rate_pct}% of {t.attempts}</span></div><Bar value={t.success_rate_pct} /></div>)}
                  </div>
                )}
              </div>
            )}
            <button className="btn mt-6" onClick={() => nav('/coach')}>Ask the Coach about your weaknesses</button>
          </Section>

          {stats.by_difficulty.length > 0 && (
            <Section title="Results by opponent level">
              <div className="divide-y divide-white/10">
                {stats.by_difficulty.map((d) => <div key={d.mode + (d.difficulty ?? '')} className="flex justify-between py-2.5 text-sm"><span>{d.mode === 'coach' ? 'AI Coach' : 'Stockfish'} · <span className="capitalize">{d.difficulty ?? 'CHESS-IQ'}</span></span><span className="text-ash">{d.wins} wins in {d.games} games</span></div>)}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  )
}