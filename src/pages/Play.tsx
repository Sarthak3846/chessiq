import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chess, type Color } from 'chess.js'
import { AnimatePresence, motion } from 'framer-motion'
import BoardColumn from '../components/BoardColumn'
import ChessBoard from '../components/ChessBoard'
import EvalBar from '../components/EvalBar'
import MoveList from '../components/MoveList'
import { Modal, PageHead } from '../components/Ui'
import { DEFAULT_MATCH, DEPTH_MAX, DEPTH_MIN, DIFFICULTIES, MOVE_TIMES, getDifficulty, toLimit, type MatchSettings } from '../engine/config'
import { useStockfish } from '../hooks/useStockfish'
import { START_FEN, capturedPieces, fmtClock, materialEval, pieceUrl, resultText, safeChess } from '../lib/chess'
import { buildPgn, copyText, downloadText, type GameKind } from '../lib/pgn'
import { useApp } from '../store/app'

type Mode = 'stockfish' | 'practice' | 'analysis' | 'local'
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'stockfish', label: 'Vs Stockfish', hint: 'Play the computer' },
  { id: 'practice', label: 'Practice position', hint: 'Start from a custom FEN' },
  { id: 'analysis', label: 'Analysis board', hint: 'Explore with no opponent' },
  { id: 'local', label: 'Local two-player', hint: 'Share one device' },
]
const TIMES = [{ l: '3 min', s: 180 }, { l: '10 min', s: 600 }, { l: '30 min', s: 1800 }, { l: 'No clock', s: 0 }]

const levelLabel = (d: ReturnType<typeof getDifficulty>) => (d.elo ? `≈${d.elo} Elo` : 'Max strength')

function Strip({ color, name, sub, captured, diff, clock, active }: { color: Color; name: string; sub: string; captured: string[]; diff: number; clock?: number; active: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 grid place-items-center border transition-colors ${active ? 'border-blood-400 bg-blood-800/50' : 'hair'}`}><img src={`/pieces/${color}K.svg`} alt="" className="w-8 h-8" /></div>
        <div className="min-w-0">
          <div className="text-sm truncate">{name}</div>
          <div className="flex items-center h-4 text-xs text-ash">
            {captured.length === 0 ? <span>{sub}</span> : captured.map((t, i) => <img key={i} src={pieceUrl(color === 'w' ? 'b' : 'w', t as never)} alt="" className="w-4 h-4 -mr-1.5" />)}
            {diff > 0 && <span className="ml-3 text-bone">+{diff}</span>}
          </div>
        </div>
      </div>
      {clock !== undefined && (
        <div className={`tabular-nums text-xl px-3 py-1 border transition-colors ${active ? 'border-blood-500 bg-blood-700 text-bone' : 'hair text-ash'} ${clock <= 20 && clock > 0 ? 'text-blood-400' : ''}`}>{fmtClock(clock)}</div>
      )}
    </div>
  )
}

export default function Play({ variant = 'stockfish' }: { variant?: 'stockfish' | 'coach' }) {
  const coach = variant === 'coach'
  const opponent = coach ? 'AI Coach' : 'Stockfish'
  const nav = useNavigate()
  const { setAnalysisSeed, setCoachSeed, saveGame } = useApp()
  const { engine, status: engineStatus, error: engineError, retry } = useStockfish()

  const [mode, setMode] = useState<Mode>('stockfish')
  const [match, setMatch] = useState<MatchSettings>(DEFAULT_MATCH)
  const [timeIdx, setTimeIdx] = useState(1)
  const [showEval, setShowEval] = useState(false)
  const [started, setStarted] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const [playerColor, setPlayerColor] = useState<Color>('w')
  const [startFen, setStartFen] = useState(START_FEN)
  const [fenInput, setFenInput] = useState('')
  const [fenError, setFenError] = useState('')
  const [sans, setSans] = useState<string[]>([])
  const [resigned, setResigned] = useState<Color | undefined>()
  const [timedOut, setTimedOut] = useState<Color | undefined>()
  const [agreed, setAgreed] = useState(false)
  const [clocks, setClocks] = useState({ w: 600, b: 600 })
  const [thinking, setThinking] = useState(false)
  const [moveError, setMoveError] = useState('')
  const [engineEval, setEngineEval] = useState<number | null>(null) // white perspective, from Stockfish
  const [flip, setFlip] = useState(false)
  const [toast, setToast] = useState('')
  const [closed, setClosed] = useState(false)
  const [copied, setCopied] = useState(false)
  const saved = useRef(false)

  const diff = getDifficulty(match.difficulty)
  const patch = (p: Partial<MatchSettings>) => setMatch((m) => ({ ...m, ...p }))

  const chess = useMemo(() => { const c = safeChess(startFen); sans.forEach((s) => c.move(s)); return c }, [startFen, sans])
  const hist = useMemo(() => chess.history({ verbose: true }), [chess])
  const last = hist[hist.length - 1]
  const result = agreed ? 'Draw by agreement' : timedOut ? (timedOut === 'w' ? 'Black wins on time' : 'White wins on time') : resultText(chess, resigned)
  const over = !!result
  const clocked = (mode === 'stockfish' || mode === 'local') && TIMES[timeIdx].s > 0
  const active = mode === 'analysis' || mode === 'practice' ? true : started
  const orientation: Color = (mode === 'stockfish' ? playerColor : 'w') === 'w' ? (flip ? 'b' : 'w') : (flip ? 'w' : 'b')
  const caps = capturedPieces(chess)
  const mat = materialEval(chess)
  const evalNow = engineEval ?? (mat + (chess.isCheckmate() ? (chess.turn() === 'w' ? -20 : 20) : 0))

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2400) }

  const reset = (m: Mode = mode, fen = START_FEN) => {
    setSans([]); setAgreed(false); setResigned(undefined); setTimedOut(undefined); setThinking(false); setClosed(false); setMoveError(''); setEngineEval(null)
    saved.current = false
    setStartFen(fen); setFlip(false)
    const t = TIMES[timeIdx].s; setClocks({ w: t, b: t })
    setStarted(m === 'analysis' || m === 'practice' ? true : false)
  }
  const switchMode = (m: Mode) => { void engine.current?.cancel(); setMode(m); reset(m); setFenError(''); setFenInput('') }

  /** Apply the chosen settings to the real engine, then begin the match. */
  const start = async () => {
    const eng = engine.current
    if (!eng || engineStatus !== 'ready') return
    setConfiguring(true); setMoveError('')
    try {
      await eng.configure(match)
      const c: Color = match.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : match.color
      reset(mode); setPlayerColor(c); setStarted(true)
    } catch (e) {
      setMoveError((e as Error).message)
    } finally { setConfiguring(false) }
  }

  // Stockfish replies whenever it is the engine's turn. The effect cleanup cancels the search whenever
  // the position changes, the game ends, or the component unmounts, and `live` blocks stale results.
  useEffect(() => {
    const eng = engine.current
    if (mode !== 'stockfish' || !started || over || chess.turn() === playerColor || engineStatus !== 'ready' || !eng) return
    let live = true
    const fenAtRequest = chess.fen()
    const side = chess.turn()
    setThinking(true); setMoveError('')
    eng.search({
      startFen: startFen === START_FEN ? null : startFen,
      moves: hist.map((m) => m.from + m.to + (m.promotion ?? '')),
      limit: toLimit(match),
    }).then((res) => {
      if (!live) return
      setThinking(false)
      if (!res || !res.bestMove) return
      const c = new Chess(fenAtRequest)
      try {
        const m = c.move({ from: res.bestMove.slice(0, 2), to: res.bestMove.slice(2, 4), promotion: res.bestMove[4] })
        setSans((s) => [...s, m.san])
        if (res.score) {
          const pawns = res.score.mate !== undefined ? Math.sign(res.score.mate) * 12 : (res.score.cp ?? 0) / 100
          setEngineEval((side === 'w' ? 1 : -1) * pawns)
        }
      } catch {
        setMoveError(`Stockfish returned a move (${res.bestMove}) that is illegal in this position.`)
      }
    }).catch((e: Error) => { if (live) { setThinking(false); setMoveError(e.message) } })
    return () => { live = false; void eng.cancel() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, started, over, chess, playerColor, engineStatus, match.difficulty, match.searchMode, match.depth, match.movetimeMs])

  // Clocks
  useEffect(() => {
    if (!clocked || !started || over) return
    const id = setInterval(() => {
      setClocks((c) => {
        const side = chess.turn()
        const v = Math.max(0, c[side] - 1)
        if (v === 0) setTimedOut(side)
        return { ...c, [side]: v }
      })
    }, 1000)
    return () => clearInterval(id)
  }, [clocked, started, over, chess])

  // Persist finished game once
  useEffect(() => {
    if (over && !saved.current && sans.length) {
      saved.current = true
      saveGame({ id: String(Date.now()), pgn: pgnText(), result: result!, opponent: mode === 'stockfish' ? `${opponent} ${diff.label}` : 'Local', date: new Date().toISOString() })
    }
  }, [over, sans.length, chess, result, mode, diff.label, saveGame])

  const onMove = (from: string, to: string, promotion?: string) => {
    if (over || !active) return false
    try { const c = safeChess(chess.fen()); const m = c.move({ from, to, promotion }); setSans((s) => [...s, m.san]); return true } catch { return false }
  }

  const undo = () => {
    if (!sans.length || over) return
    if (mode === 'stockfish' && !match.takebacks) return say('Takebacks are disabled for this match.')
    setEngineEval(null)
    setSans((s) => s.slice(0, mode === 'stockfish' && chess.turn() === playerColor ? -2 : -1))
  }
  const resign = () => { if (started && !over) { void engine.current?.cancel(); setResigned(mode === 'local' ? chess.turn() : playerColor) } }
  const draw = () => {
    if (mode !== 'stockfish') return say('Draw claims are handled between players.')
    // Stockfish accepts only if its own evaluation says the position is about equal or worse for it.
    const engineSide = playerColor === 'w' ? -1 : 1
    if (engineEval !== null && engineEval * engineSide <= 0.2 && sans.length > 20) { setAgreed(true); say('Stockfish accepted the draw.') }
    else say('Stockfish declined the draw offer.')
  }
  const loadFen = () => {
    try { new Chess(fenInput.trim()); setFenError(''); reset('practice', fenInput.trim()) } catch { setFenError('That FEN is not valid. Check the six fields and try again.') }
  }
  const kind: GameKind = mode === 'stockfish' ? (coach ? 'coach' : 'stockfish') : mode === 'local' ? 'local' : 'free'
  const pgnText = () => buildPgn({
    startFen, sans, kind, playerColor: mode === 'stockfish' ? playerColor : 'w', resigned, timedOut, agreed,
    level: mode === 'stockfish' ? `${diff.label}${diff.elo ? ` (≈${diff.elo} Elo)` : ''}` : undefined,
  })
  const exportPgn = () => downloadText(pgnText(), `chessiq-${kind}-game.pgn`)
  const copyPgn = async () => {
    const ok = await copyText(pgnText())
    say(ok ? 'PGN copied to clipboard.' : 'Could not copy — use Export PGN instead.')
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500) }
  }
  const askCoach = () => {
    setCoachSeed({ text: sans.length ? 'Review my game so far and point out my mistakes.' : 'What should I keep in mind in this game?', fen: chess.fen(), pgn: pgnText(), context: `Game vs ${opponent}` })
    nav('/coach')
  }

  const topColor: Color = orientation === 'w' ? 'b' : 'w'
  const botColor: Color = orientation === 'w' ? 'w' : 'b'
  const nameOf = (c: Color) => mode === 'stockfish' ? (c === playerColor ? 'You' : `${opponent} · ${diff.label}`) : mode === 'local' ? (c === 'w' ? 'Player 1' : 'Player 2') : c === 'w' ? 'White' : 'Black'
  const subOf = (c: Color) => mode === 'stockfish' && c !== playerColor ? (thinking ? 'Thinking…' : engineStatus === 'loading' ? 'Loading engine…' : levelLabel(diff)) : c === 'w' ? 'White' : 'Black'
  const strip = (c: Color) => {
    const lost = c === 'w' ? caps.b : caps.w
    const d = (c === 'w' ? 1 : -1) * mat
    return <Strip color={c} name={nameOf(c)} sub={subOf(c)} captured={lost} diff={d > 0 ? d : 0} clock={clocked ? clocks[c] : undefined} active={started && !over && chess.turn() === c} />
  }
  const showBar = showEval || mode === 'analysis'

  const chip = (on: boolean) => `chip flex-1 text-center ${on ? 'chip-on' : ''}`

  return (
    <div className="max-w-[1500px] mx-auto px-5 md:px-10 pt-24 md:pt-32 pb-16">
      <PageHead title={coach ? 'Play the Coach' : 'Play'} sub={coach ? 'Match your skills against the AI Coach. Its moves are calculated by Stockfish at the strength you choose — then ask it to review the game.' : 'Play Stockfish, set up a position, or analyse freely. Every move is validated against the rules of chess.'} />
      <div className="grid xl:grid-cols-[minmax(0,640px)_minmax(0,460px)] xl:justify-center gap-8 lg:gap-12">
        {/* Board column — capped so the board never dominates the screen, and centred */}
        <BoardColumn>
          {strip(topColor)}
          <div className="flex gap-3 items-stretch">
            {showBar && <EvalBar value={evalNow} orientation={orientation} />}
            <div className="flex-1 min-w-0">
              <ChessBoard fen={chess.fen()} orientation={orientation} lastMove={last ? { from: last.from, to: last.to } : null}
                canMove={!active || over || thinking ? 'none' : mode === 'stockfish' ? playerColor : 'both'} onMove={onMove} />
            </div>
          </div>
          {strip(botColor)}
          <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 text-sm text-blood-400">{toast}</motion.p>}</AnimatePresence>
          {moveError && <p className="mt-2 text-sm text-blood-400">{moveError}</p>}
        </BoardColumn>

        <aside className="space-y-6 w-full">
          {!coach && (
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => switchMode(m.id)} className={`text-left p-3 border transition-all ${mode === m.id ? 'border-blood-500 bg-blood-800/40' : 'hair hover:border-blood-700'}`}>
                  <span className="block text-sm">{m.label}</span><span className="label">{m.hint}</span>
                </button>
              ))}
            </div>
          )}

          {mode === 'stockfish' && !started && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="panel p-5 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="display text-2xl">Match setup</h3>
                <span className="flex items-center gap-2 text-xs text-ash">
                  <i className={`w-1.5 h-1.5 rounded-full ${engineStatus === 'ready' ? 'bg-emerald-400' : engineStatus === 'error' ? 'bg-blood-400' : 'bg-ash animate-pulseDot'}`} />
                  {engineStatus === 'ready' ? 'Stockfish 19 ready' : engineStatus === 'error' ? 'Engine error' : 'Loading Stockfish…'}
                </span>
              </div>
              {coach && <p className="label -mt-2">Choose how strong the Coach plays. Its moves come from Stockfish, and you can ask it to review the game afterwards.</p>}
              {engineStatus === 'error' && (
                <div className="border border-blood-700 bg-blood-900/40 p-3 text-sm">
                  <p className="text-blood-400">{engineError}</p>
                  <button className="chip mt-2" onClick={retry}>Retry</button>
                </div>
              )}

              <div>
                <p className="label mb-2">Engine difficulty</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {DIFFICULTIES.map((d) => (
                    <button key={d.id} onClick={() => patch({ difficulty: d.id })} className={`text-left p-2.5 border transition-all ${match.difficulty === d.id ? 'border-blood-500 bg-blood-800/40' : 'hair hover:border-blood-700'}`}>
                      <span className="block text-sm">{d.label}</span><span className="label">{levelLabel(d)}</span>
                    </button>
                  ))}
                </div>
                <p className="label mt-2">Elo values are approximate. Stockfish can only limit by Elo from 1320 up, so Beginner and Easy use its Skill Level setting instead.</p>
              </div>

              <div>
                <p className="label mb-2">Search mode</p>
                <div className="flex gap-2 mb-3">
                  <button className={chip(match.searchMode === 'depth')} onClick={() => patch({ searchMode: 'depth' })}>Depth</button>
                  <button className={chip(match.searchMode === 'time')} onClick={() => patch({ searchMode: 'time' })}>Time per move</button>
                </div>
                {match.searchMode === 'depth' ? (
                  <div>
                    <div className="flex justify-between label mb-2"><span>Search depth</span><span className="text-bone">{match.depth}</span></div>
                    <input type="range" min={DEPTH_MIN} max={DEPTH_MAX} value={match.depth} onChange={(e) => patch({ depth: +e.target.value })} className="w-full accent-[#b01212]" aria-label="Search depth" />
                    <div className="flex justify-between label"><span>{DEPTH_MIN}</span><span>{DEPTH_MAX}</span></div>
                    {match.depth > 18 && <p className="label mt-1 text-blood-400">Depths above 18 can take many seconds per move in the browser.</p>}
                  </div>
                ) : (
                  <div className="flex gap-2">{MOVE_TIMES.map((t) => <button key={t} className={chip(match.movetimeMs === t)} onClick={() => patch({ movetimeMs: t })}>{t < 1000 ? `${t} ms` : `${t / 1000} s`}</button>)}</div>
                )}
              </div>

              <div><p className="label mb-2">Play as</p><div className="flex gap-2">{(['w', 'random', 'b'] as const).map((c) => <button key={c} onClick={() => patch({ color: c })} className={chip(match.color === c)}>{c === 'w' ? 'White' : c === 'b' ? 'Black' : 'Random'}</button>)}</div></div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="label mb-2">Starting position</p>
                  <select className="w-full bg-coal border hair px-3 py-2 text-sm outline-none" value="standard" onChange={() => undefined} aria-label="Starting position"><option value="standard">Standard</option></select>
                </div>
                <div>
                  <p className="label mb-2">Takebacks</p>
                  <div className="flex gap-2"><button className={chip(match.takebacks)} onClick={() => patch({ takebacks: true })}>On</button><button className={chip(!match.takebacks)} onClick={() => patch({ takebacks: false })}>Off</button></div>
                </div>
              </div>

              <div><p className="label mb-2">Time control</p><div className="flex gap-2 flex-wrap">{TIMES.map((t, i) => <button key={t.l} onClick={() => { setTimeIdx(i); setClocks({ w: t.s, b: t.s }) }} className={`chip ${timeIdx === i ? 'chip-on' : ''}`}>{t.l}</button>)}</div></div>

              <button className="btn btn-solid w-full disabled:opacity-50 disabled:cursor-not-allowed" disabled={engineStatus !== 'ready' || configuring} onClick={start}>
                {configuring ? 'Applying settings…' : engineStatus === 'loading' ? 'Loading Stockfish…' : 'Start game'}
              </button>
            </motion.div>
          )}

          {mode === 'local' && !started && (
            <div className="panel p-5 space-y-4">
              <h3 className="display text-2xl">Two players, one screen</h3>
              <div className="flex gap-2 flex-wrap">{TIMES.map((t, i) => <button key={t.l} onClick={() => { setTimeIdx(i); setClocks({ w: t.s, b: t.s }) }} className={`chip ${timeIdx === i ? 'chip-on' : ''}`}>{t.l}</button>)}</div>
              <button className="btn btn-solid w-full" onClick={() => { reset('local'); setStarted(true) }}>Start game</button>
            </div>
          )}

          {mode === 'practice' && (
            <div className="panel p-5 space-y-3">
              <h3 className="display text-2xl">Custom position</h3>
              <input value={fenInput} onChange={(e) => setFenInput(e.target.value)} placeholder="Paste a FEN, e.g. 6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1" className="w-full bg-transparent border hair px-3 py-2 text-sm outline-none focus:border-blood-500 transition-colors" />
              {fenError && <p className="text-sm text-blood-400">{fenError}</p>}
              <div className="flex gap-2"><button className="btn btn-solid flex-1" onClick={loadFen}>Load position</button><button className="btn btn-ghost" onClick={() => { reset('practice'); setFenInput('') }}>Reset</button></div>
            </div>
          )}

          {active && (
            <div className="panel">
              <div className="flex items-center justify-between px-4 py-3 border-b hair gap-3">
                <span className="display text-xl">Moves</span>
                {mode === 'stockfish' && (
                  <span className="flex items-center gap-3 text-xs text-ash">
                    <span className="flex items-center gap-2"><i className={`w-1.5 h-1.5 rounded-full ${thinking ? 'bg-blood-400 animate-pulseDot' : 'bg-ash'}`} />{thinking ? `${opponent} is thinking` : `${diff.label} · ${match.searchMode === 'depth' ? `depth ${match.depth}` : `${match.movetimeMs} ms`}`}</span>
                    {thinking && <button className="chip !py-0.5" onClick={() => engine.current?.stop()}>Move now</button>}
                  </span>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto"><MoveList moves={sans} current={sans.length} /></div>
              <div className="grid grid-cols-4 gap-px bg-white/10 border-t hair">
                {[['Undo', undo], ['Flip', () => setFlip((f) => !f)], [showEval ? 'Hide eval' : 'Show eval', () => setShowEval((v) => !v)],
                  ['Draw', draw], ['Resign', resign], ['Copy PGN', copyPgn], ['Export PGN', exportPgn], ['Ask Coach', askCoach]].map(([l, fn]) => (
                  <button key={l as string} onClick={fn as () => void} disabled={l === 'Undo' && mode === 'stockfish' && !match.takebacks}
                    className="bg-coal py-3 text-sm text-bone/80 hover:bg-blood-800 hover:text-bone transition-colors disabled:opacity-40 disabled:hover:bg-coal disabled:cursor-not-allowed">{l as string}</button>
                ))}
              </div>
            </div>
          )}
          {started && mode !== 'analysis' && mode !== 'practice' && <button className="btn btn-ghost w-full" onClick={() => { void engine.current?.cancel(); reset(mode) }}>New game</button>}
        </aside>
      </div>

      <Modal open={over && !closed && sans.length > 0} onClose={() => setClosed(true)}>
        <p className="label">Game over</p>
        <h3 className="display text-4xl md:text-5xl mt-1 mb-6">{result}</h3>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn btn-solid" onClick={() => { setAnalysisSeed(pgnText()); nav('/analysis') }}>Review game</button>
          <button className="btn" onClick={() => { setCoachSeed({ text: 'Review my game and point out the key mistakes.', fen: chess.fen(), pgn: pgnText(), context: result ?? undefined }); nav('/coach') }}>Ask AI Coach</button>
          <button className="btn btn-ghost" onClick={copyPgn}>{copied ? 'Copied ✓' : 'Copy PGN'}</button>
          <button className="btn btn-ghost" onClick={exportPgn}>Export PGN</button>
          <button className="btn btn-ghost col-span-2" onClick={() => reset(mode)}>New game</button>
        </div>
      </Modal>
    </div>
  )
}