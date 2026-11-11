import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { AnimatePresence, motion } from 'framer-motion'
import ChessBoard from '../components/ChessBoard'
import { Arrow } from '../components/Ui'
import { conversationMessages, createConversation, deleteConversation, getHealth, listConversations, streamCoach, type Facts, type Health } from '../lib/api'
import { safeChess } from '../lib/chess'
import { useApp } from '../store/app'
import { useAuth } from '../store/auth'

interface Msg { id: string; role: 'user' | 'coach'; text: string; facts?: Facts; streaming?: boolean; follow?: string[]; error?: string; warning?: string; provider?: string; notice?: string }
interface Convo { id: string; title: string; msgs: Msg[]; remote?: boolean; loaded?: boolean }
interface Ctx { fen: string; label: string; move?: { san: string; fen_before: string }; pgn?: string }

const uid = () => Math.random().toString(36).slice(2, 9)
const FEN_RE = /(?:[rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+\s[wb]\s(?:[KQkq]+|-)\s(?:[a-h][36]|-)(?:\s\d+\s\d+)?/

const CLS_COLOR: Record<string, string> = { best: '#a3e635', good: '#9a908a', inaccuracy: '#f5c451', mistake: '#f08a3c', blunder: '#e23b3b' }
const STARTERS = ['Explain the Italian Game', 'How do I spot a fork?', 'What are my weaknesses?']

function Rich({ text }: { text: string }) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') ? <strong key={i} className="font-medium text-bone">{p.slice(2, -2)}</strong> : p)
  return (
    <div className="space-y-3 leading-relaxed">
      {text.split('\n\n').map((para, i) => para.split('\n').every((l) => l.trim().startsWith('- '))
        ? <ul key={i} className="space-y-1.5">{para.split('\n').map((l, j) => <li key={j} className="flex gap-3"><span className="text-blood-400 mt-[0.6em] w-1.5 h-1.5 bg-blood-500 shrink-0 rotate-45" /><span>{bold(l.trim().slice(2))}</span></li>)}</ul>
        : <p key={i}>{bold(para)}</p>)}
    </div>
  )
}

function FactsBlock({ facts }: { facts: Facts }) {
  const m = facts.move, p = facts.position, r = facts.game_review
  if (!m && !p && !r) return null
  return (
    <div className="mt-4 border-l-2 border-blood-500 pl-4 text-sm space-y-1">
      <p className="text-bone">Engine-backed analysis · Stockfish{p ? ` depth ${p.depth}` : ''}</p>
      {m && <p className="text-ash"><span className="text-bone">{m.played_move}</span> · <span style={{ color: CLS_COLOR[m.classification] }}>{m.classification}</span> · {m.evaluation_before} → <span className="text-bone tabular-nums">{m.evaluation_after}</span>{m.engine_best_move && m.engine_best_move !== m.played_move && <> · engine prefers <span className="text-bone">{m.engine_best_move}</span></>}</p>}
      {p && <p className="text-ash">Position: evaluation <span className="text-bone tabular-nums">{p.evaluation}</span> · best move <span className="text-bone">{p.best_move ?? '—'}</span>{p.best_line && <> · line <span className="text-bone">{p.best_line}</span></>}</p>}
      {r && <p className="text-ash">Game review: {r.plies_reviewed} plies · average loss White {r.average_cp_loss.White} cp, Black {r.average_cp_loss.Black} cp{r.biggest_errors.length > 0 && <> · biggest: {r.biggest_errors.slice(0, 3).map((e) => `${e.move_number}${e.move}`).join(', ')}</>}</p>}
    </div>
  )
}

export default function Coach() {
  const { coachSeed, setCoachSeed } = useApp()
  const { user } = useAuth()
  const [loadError, setLoadError] = useState<string | null>(null)
  const [convos, setConvos] = useState<Convo[]>([{ id: 'c0', title: 'New conversation', msgs: [] }])
  const [active, setActive] = useState('c0')
  const [input, setInput] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [useCtx, setUseCtx] = useState(true)
  const [copied, setCopied] = useState('')
  const [drawer, setDrawer] = useState(false)
  const [health, setHealth] = useState<Health | null | undefined>(undefined) // undefined = checking, null = backend unreachable
  const endRef = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)
  const seeded = useRef(false)
  const convo = convos.find((c) => c.id === active) ?? convos[0]

  const checkHealth = () => { setHealth(undefined); getHealth().then(setHealth) }
  useEffect(() => { checkHealth(); return () => abort.current?.abort() }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [convo?.msgs, waiting])

  // Signed-in users get their saved conversations; guests keep an in-memory session
  useEffect(() => {
    if (!user) {
      setConvos((cs) => { const local = cs.filter((c) => !c.remote); return local.length ? local : [{ id: uid(), title: 'New conversation', msgs: [] }] })
      setActive((a) => (convos.find((c) => c.id === a)?.remote ? 'c0' : a))
      return
    }
    let live = true
    listConversations().then((list) => { if (live) setConvos((cs) => [...cs.filter((c) => !c.remote), ...list.map((r) => ({ id: r.id, title: r.title, msgs: [] as Msg[], remote: true, loaded: false }))]) })
      .catch((e: Error) => { if (live) setLoadError(e.message) })
    return () => { live = false }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const openConvo = async (id: string) => {
    setActive(id); setDrawer(false); setLoadError(null)
    const c = convos.find((x) => x.id === id)
    if (c?.remote && !c.loaded) {
      try {
        const rows = await conversationMessages(id)
        patch(id, (x) => ({ ...x, loaded: true, msgs: rows.map((r) => ({ id: r.id, role: r.role === 'user' ? 'user' as const : 'coach' as const, text: r.content, facts: r.facts ?? undefined, provider: r.provider ?? undefined })) }))
      } catch (e) { setLoadError((e as Error).message) }
    }
  }

  const patch = (cid: string, fn: (c: Convo) => Convo) => setConvos((cs) => cs.map((c) => (c.id === cid ? fn(c) : c)))
  const patchMsg = (cid: string, mid: string, fn: (m: Msg) => Msg) => patch(cid, (c) => ({ ...c, msgs: c.msgs.map((m) => (m.id === mid ? fn(m) : m)) }))

  /** Sends the conversation (plus optional position context) to the backend and streams the Coach's reply. */
  const send = async (text: string, opts: { cid?: string; ctx?: Ctx | null; attach?: boolean; retryOf?: string } = {}) => {
    const clean = text.trim()
    if (!clean || waiting) return
    let cid = opts.cid ?? convo?.id ?? newConvo()
    const target = convos.find((c) => c.id === cid)
    const existing = target?.msgs ?? []
    let context = opts.ctx !== undefined ? opts.ctx : ctx
    const fm = clean.match(FEN_RE)
    if (fm) { try { new Chess(fm[0]); context = { fen: fm[0], label: 'Your FEN position' }; setCtx(context); setUseCtx(true) } catch { /* ignore invalid FEN */ } }
    const attach = fm ? true : opts.attach ?? useCtx

    // Signed-in: create the server-side conversation on the first question so the exchange is saved to this user's history
    let remoteId = target?.remote ? cid : undefined
    if (user && !target?.remote) {
      try { const r = await createConversation(); const oldId = cid; remoteId = r.id; setConvos((cs) => cs.map((c) => (c.id === oldId ? { ...c, id: r.id, remote: true, loaded: true } : c))); setActive(r.id); cid = r.id } catch { /* keep this chat local-only */ }
    }
    const coachId = uid()
    const history = existing.filter((m) => !m.error && m.text.trim() && m.id !== opts.retryOf).map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.text }))
    const userMsg: Msg = { id: uid(), role: 'user', text: clean }
    patch(cid, (c) => ({ ...c, title: c.msgs.length ? c.title : clean.slice(0, 38), msgs: [...c.msgs.filter((m) => m.id !== opts.retryOf).map((m) => ({ ...m, follow: undefined })), ...(opts.retryOf ? [] : [userMsg]), { id: coachId, role: 'coach', text: '', streaming: true }] }))
    if (!opts.retryOf) history.push({ role: 'user', content: clean })
    setInput(''); setWaiting(true)

    abort.current?.abort()
    const ctl = new AbortController(); abort.current = ctl
    let suggestions: string[] = []
    await streamCoach(
      { messages: history, conversation_id: remoteId, retry: !!opts.retryOf, ...(attach && context ? { fen: context.fen, move: context.move, pgn: context.pgn } : {}) },
      {
        onAnalysis: (facts, s) => { suggestions = s; patchMsg(cid, coachId, (m) => ({ ...m, facts })) },
        onMeta: (m) => patchMsg(cid, coachId, (x) => ({ ...x, provider: m.provider ?? x.provider, notice: m.notice ?? x.notice })),
        onToken: (t) => { setWaiting(false); patchMsg(cid, coachId, (m) => ({ ...m, text: m.text + t })) },
        onWarning: (w) => patchMsg(cid, coachId, (m) => ({ ...m, warning: w })),
        onError: (e) => { setWaiting(false); patchMsg(cid, coachId, (m) => ({ ...m, streaming: false, error: e })); checkHealth() },
        onDone: () => { setWaiting(false); patchMsg(cid, coachId, (m) => ({ ...m, streaming: false, follow: suggestions })) },
      },
      ctl.signal,
    )
    setWaiting(false)
  }

  const newConvo = () => { const id = uid(); setConvos((cs) => [{ id, title: 'New conversation', msgs: [] }, ...cs]); setActive(id); setDrawer(false); return id }

  // Opened from Play / Analysis with a position, move or game attached
  useEffect(() => {
    if (!coachSeed || seeded.current) return
    seeded.current = true
    const seed = coachSeed; setCoachSeed(null)
    const id = uid()
    setConvos((cs) => [{ id, title: 'New conversation', msgs: [] }, ...cs]); setActive(id)
    const c: Ctx | null = seed.fen ? { fen: seed.fen, label: seed.context ?? 'Selected position', move: seed.move, pgn: seed.pgn } : null
    setCtx(c); setUseCtx(!!c)
    setTimeout(() => send(seed.text, { cid: id, ctx: c, attach: !!c }), 150)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachSeed])

  const copy = (m: Msg) => { navigator.clipboard?.writeText(m.text); setCopied(m.id); setTimeout(() => setCopied(''), 1500) }
  const del = async (id: string) => {
    if (convos.find((c) => c.id === id)?.remote) { try { await deleteConversation(id) } catch (e) { setLoadError((e as Error).message); return } }
    setConvos((cs) => { const n = cs.filter((c) => c.id !== id); if (active === id) setActive(n[0]?.id ?? ''); return n })
  }
  const ctxBoard = useMemo(() => safeChess(ctx?.fen).fen(), [ctx])
  const lastUser = (c?: Convo) => [...(c?.msgs ?? [])].reverse().find((m) => m.role === 'user')?.text

  const status = health === undefined ? { dot: 'bg-ash animate-pulseDot', text: 'Connecting to the Coach…' }
    : health === null ? { dot: 'bg-blood-400', text: 'Coach service offline' }
    : health.llm.providers.length === 0 ? { dot: 'bg-amber-400', text: 'No language model configured · engine analysis only' }
    : !health.stockfish ? { dot: 'bg-amber-400', text: 'Stockfish unavailable on the backend' }
    : { dot: 'bg-emerald-400', text: `Stockfish + ${health.llm.providers.join(' → ')}` }

  const Sidebar = (
    <div className="h-full flex flex-col">
      <button onClick={newConvo} className="btn btn-solid w-full mb-4">New conversation</button>
      <p className="label mb-2">{user ? 'Saved conversations' : 'This session'}</p>
      {loadError && <p className="text-xs text-blood-400 mb-2">{loadError}</p>}
      <ul className="space-y-1 overflow-y-auto flex-1">
        {convos.map((c) => (
          <li key={c.id} className="group flex items-center">
            <button onClick={() => void openConvo(c.id)} className={`flex-1 text-left px-3 py-2 text-sm truncate transition-colors border-l-2 ${active === c.id ? 'border-blood-500 bg-blood-800/30 text-bone' : 'border-transparent text-ash hover:text-bone hover:bg-white/5'}`}>{c.title}</button>
            <button aria-label="Delete conversation" onClick={() => void del(c.id)} className="px-2 text-ash opacity-0 group-hover:opacity-100 hover:text-blood-400 transition-all">×</button>
          </li>
        ))}
        {convos.length === 0 && <li className="label px-3">No conversations. Start a new one.</li>}
      </ul>
    </div>
  )

  return (
    <div className="max-w-[1500px] mx-auto px-5 md:px-10 pt-24 md:pt-28 pb-6 h-[100svh] flex flex-col">
      <div className="flex items-end justify-between mb-5">
        <h1 className="display text-4xl md:text-6xl leading-none">AI Coach</h1>
        <div className="flex items-center gap-3">
          <button onClick={checkHealth} title="Recheck connection" className="hidden sm:flex items-center gap-2 text-xs text-ash hover:text-bone transition-colors"><i className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />{status.text}</button>
          <button className="lg:hidden chip" onClick={() => setDrawer(true)}>History</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid lg:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_340px] gap-6">
        <aside className="hidden lg:block min-h-0 border-r hair pr-5">{Sidebar}</aside>

        <section className="min-h-0 flex flex-col border hair bg-coal/50">
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-8">
            {convo?.msgs.length === 0 && (
              <div className="h-full grid place-items-center text-center">
                <div className="max-w-md">
                  <img src="/pieces/bN.svg" alt="" className="w-20 mx-auto mb-4 opacity-90 animate-float" />
                  <h2 className="display text-3xl mb-2">What would you like to understand?</h2>
                  <p className="text-ash mb-5">Ask about a move, an opening or a tactic, paste a FEN, or open a game from Play or Analysis. Stockfish checks the position; the Coach explains it.</p>
                  <div className="flex flex-wrap gap-2 justify-center">{STARTERS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}</div>
                </div>
              </div>
            )}
            {convo?.msgs.map((m) => (
              <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={m.role === 'user' ? 'flex justify-end' : 'flex gap-4'}>
                {m.role === 'coach' && <div className="w-9 h-9 shrink-0 bg-blood-700 grid place-items-center"><img src="/pieces/wN.svg" alt="" className="w-7 h-7" /></div>}
                <div className={m.role === 'user' ? 'max-w-[85%] bg-blood-700 px-4 py-3' : 'max-w-[46rem] flex-1'}>
                  {m.role === 'user' ? m.text : (
                    <>
                      {m.warning && <p className="mb-3 text-sm text-amber-400">{m.warning}</p>}
                      {m.text && <Rich text={m.text} />}
                      {m.streaming && m.text && <span className="inline-block w-2 h-4 bg-blood-400 ml-1 align-middle animate-blink" />}
                      {m.facts && <FactsBlock facts={m.facts} />}
                      {m.error && (
                        <div className="mt-3 border border-blood-700 bg-blood-900/40 p-3 text-sm">
                          <p className="text-blood-400">{m.error}</p>
                          <button className="chip mt-2" onClick={() => { const q = lastUser(convo); if (q) send(q, { retryOf: m.id }) }}>Try again</button>
                        </div>
                      )}
                      {!m.streaming && !m.error && m.text && !(m.facts && (m.facts.move || m.facts.position || m.facts.game_review)) && <p className="mt-3 text-xs text-ash">General chess advice — not engine-checked.</p>}
                      {m.provider && !m.streaming && <p className="mt-2 text-xs text-ash">Answered by {m.provider[0].toUpperCase() + m.provider.slice(1)}{m.notice ? ` · ${m.notice}` : ''}</p>}
                      {!m.streaming && m.text && <button onClick={() => copy(m)} className="mt-2 text-xs text-ash hover:text-bone transition-colors">{copied === m.id ? 'Copied' : 'Copy response'}</button>}
                      {m.follow && m.follow.length > 0 && <div className="flex flex-wrap gap-2 mt-4">{m.follow.map((f) => <button key={f} className="chip" onClick={() => send(f)}>{f}</button>)}</div>}
                    </>
                  )}
                </div>
              </motion.div>
            ))}
            <AnimatePresence>
              {waiting && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-4 items-center text-ash text-sm">
                  <div className="w-9 h-9 bg-blood-800 grid place-items-center"><img src="/pieces/wN.svg" alt="" className="w-7 h-7 opacity-70" /></div>
                  Analysing with Stockfish <span className="flex gap-1">{[0, 1, 2].map((i) => <i key={i} className="w-1 h-1 rounded-full bg-blood-400 animate-pulseDot" style={{ animationDelay: `${i * 0.2}s` }} />)}</span>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={endRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="border-t hair p-3 md:p-4 flex gap-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about a move, an opening, or paste a FEN…" className="flex-1 bg-transparent outline-none px-2 placeholder:text-ash/60" aria-label="Message the coach" />
            <button disabled={!input.trim() || waiting} className="btn btn-solid disabled:opacity-40 disabled:cursor-not-allowed">Send<Arrow /></button>
          </form>
        </section>

        <aside className="hidden xl:block space-y-4">
          <div className="panel p-4">
            <p className="label mb-3">Game context</p>
            <ChessBoard fen={ctxBoard} />
            <p className="mt-3 text-sm">{ctx?.label ?? 'No position attached — open a game from Play or Analysis, or paste a FEN.'}</p>
            {ctx && (
              <>
                <label className="mt-3 flex items-center gap-2 text-sm text-ash cursor-pointer"><input type="checkbox" className="accent-[#b01212]" checked={useCtx} onChange={(e) => setUseCtx(e.target.checked)} />Use this position in my questions</label>
                <button className="mt-3 chip" disabled={waiting} onClick={() => send(ctx.move ? `Was ${ctx.move.san} a good move?` : 'What is going on in this position?', { attach: true })}>{ctx.move ? `Was ${ctx.move.san} a good move?` : 'Ask about this position'}</button>
              </>
            )}
          </div>
          <p className="label">Stockfish analyses the position; the language model explains it. The Coach only quotes engine numbers it was given and never invents evaluations.</p>
          {!user && <p className="label">Sign in to save conversations and let the Coach study your own games and puzzle history.</p>}
        </aside>
      </div>

      <AnimatePresence>
        {drawer && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[65] bg-black/70" onClick={() => setDrawer(false)}>
            <motion.div initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', stiffness: 300, damping: 32 }} className="w-72 h-full bg-coal p-5 pt-20" onClick={(e) => e.stopPropagation()}>{Sidebar}</motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}