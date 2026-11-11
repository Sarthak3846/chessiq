import { difficultyCommands, getDifficulty, type MatchSettings, type SearchLimit } from './config'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SearchRequest {
  /** FEN the game started from; null/undefined = standard start position. */
  startFen?: string | null
  /** Moves played since startFen in UCI notation (e2e4, e7e8q, e1g1 …). */
  moves: string[]
  limit: SearchLimit
}

export interface SearchResult {
  /** UCI move, or null when the position has no legal moves (checkmate / stalemate). */
  bestMove: string | null
  ponder: string | null
  /** Score from the side-to-move's point of view. */
  score: { cp?: number; mate?: number } | null
  depth: number
  pv: string[]
  /** true when the search was ended early through stop(). */
  stopped: boolean
}

interface ActiveSearch {
  cancelled: boolean
  stopped: boolean
  depth: number
  score: SearchResult['score']
  pv: string[]
  resolve: (r: SearchResult | null) => void
  reject: (e: Error) => void
  done: Promise<void>
  finish: () => void
}

const WORKER_PATH = 'stockfish/stockfish-lite-single.js'

const debugOn = () => {
  try { return import.meta.env.DEV || new URLSearchParams(location.search).has('sfdebug') } catch { return false }
}

/**
 * Thin, promise-based wrapper around a Stockfish WASM Web Worker speaking UCI.
 * One search at a time; a new search first stops (and discards) the previous one,
 * so a stale `bestmove` can never be returned for an outdated position.
 */
export class StockfishEngine {
  status: EngineStatus = 'idle'
  disposed = false
  private worker: Worker | null = null
  private lineListeners = new Set<(line: string) => void>()
  private initPromise: Promise<void> | null = null
  private active: ActiveSearch | null = null
  private requestSeq = 0
  private failure: Error | null = null

  private log(dir: '>' | '<', text: string) {
    if (!debugOn()) return
    const w = window as unknown as { __sfLog?: string[] }
    ;(w.__sfLog ??= []).push(`${dir} ${text}`)
  }

  private send(cmd: string) {
    this.log('>', cmd)
    this.worker?.postMessage(cmd)
  }

  private waitFor(match: (line: string) => boolean, ms: number, what: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.lineListeners.delete(fn); reject(new Error(`Stockfish timed out waiting for ${what}.`)) }, ms)
      const fn = (line: string) => { if (match(line)) { clearTimeout(timer); this.lineListeners.delete(fn); resolve(line) } }
      this.lineListeners.add(fn)
      if (this.failure) { clearTimeout(timer); this.lineListeners.delete(fn); reject(this.failure) }
    })
  }

  /** Start the worker and complete the UCI handshake. Safe to call repeatedly. */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.status = 'loading'
    this.initPromise = (async () => {
      const base = import.meta.env.BASE_URL
      const jsUrl = new URL(`${base}${WORKER_PATH}`, location.href)
      const wasmUrl = new URL(`${base}${WORKER_PATH.replace(/\.js$/, '.wasm')}`, location.href)
      try {
        this.worker = new Worker(`${jsUrl.href}#${encodeURIComponent(wasmUrl.href)}`)
      } catch (e) {
        throw this.fail(new Error(`Could not start the Stockfish worker: ${(e as Error).message}`))
      }
      this.worker.onmessage = (ev: MessageEvent) => {
        const line = typeof ev.data === 'string' ? ev.data : String(ev.data?.data ?? ev.data ?? '')
        this.log('<', line)
        this.handleLine(line)
      }
      this.worker.onerror = (ev) => { this.fail(new Error(ev.message || 'The Stockfish worker crashed or its files failed to load.')) }
      this.send('uci')
      await this.waitFor((l) => l === 'uciok', 30000, 'the engine to start')
      this.send('isready')
      await this.waitFor((l) => l === 'readyok', 15000, 'the engine to become ready')
      if (this.disposed) throw new Error('Engine disposed')
      this.status = 'ready'
    })().catch((e) => { if (!this.disposed) this.fail(e); throw e })
    return this.initPromise
  }

  private fail(e: Error): Error {
    this.failure = e
    this.status = 'error'
    const a = this.active
    this.active = null
    a?.reject(e); a?.finish()
    this.lineListeners.forEach((fn) => fn(''))
    return e
  }

  private handleLine(line: string) {
    this.lineListeners.forEach((fn) => fn(line))
    const a = this.active
    if (!a) return
    if (line.startsWith('info ') && line.includes(' score ') && !/ (upper|lower)bound/.test(line)) {
      const d = line.match(/ depth (\d+)/); if (d) a.depth = +d[1]
      const cp = line.match(/ score cp (-?\d+)/); const mate = line.match(/ score mate (-?\d+)/)
      if (cp) a.score = { cp: +cp[1] }; else if (mate) a.score = { mate: +mate[1] }
      const pv = line.match(/ pv (.+)$/); if (pv) a.pv = pv[1].trim().split(/\s+/)
    } else if (line.startsWith('bestmove')) {
      const m = line.match(/^bestmove (\S+)(?: ponder (\S+))?/)
      const best = m && m[1] !== '(none)' && m[1] !== '0000' ? m[1] : null
      this.active = null
      a.resolve(a.cancelled ? null : { bestMove: best, ponder: m?.[2] ?? null, score: a.score, depth: a.depth, pv: a.pv, stopped: a.stopped })
      a.finish()
    }
  }

  private async ready() {
    await this.init()
    if (this.failure) throw this.failure
  }

  /** Apply a match's strength settings to the engine and start a fresh game. Resolves once the engine confirms (readyok). */
  async configure(settings: MatchSettings): Promise<void> {
    await this.ready()
    await this.cancel()
    this.send('ucinewgame')
    for (const c of difficultyCommands(getDifficulty(settings.difficulty))) this.send(c)
    this.send('isready')
    await this.waitFor((l) => l === 'readyok', 15000, 'the engine to apply settings')
  }

  /** Search a position. Resolves null if the search was superseded or cancelled. Rejects on engine failure. */
  async search(req: SearchRequest): Promise<SearchResult | null> {
    const mine = ++this.requestSeq
    await this.ready()
    await this.cancel()
    if (mine !== this.requestSeq || this.disposed) return null // a newer request arrived while we waited
    return new Promise<SearchResult | null>((resolve, reject) => {
      let finish!: () => void
      const done = new Promise<void>((r) => { finish = r })
      this.active = { cancelled: false, stopped: false, depth: 0, score: null, pv: [], resolve, reject, done, finish }
      const pos = req.startFen ? `fen ${req.startFen}` : 'startpos'
      this.send(`position ${pos}${req.moves.length ? ` moves ${req.moves.join(' ')}` : ''}`)
      this.send(`go ${'depth' in req.limit ? `depth ${req.limit.depth}` : `movetime ${req.limit.movetime}`}`)
    })
  }

  /** Stop the running search and DISCARD its result (position changed / game ended). */
  async cancel(): Promise<void> {
    const a = this.active
    if (!a) return
    a.cancelled = true
    this.send('stop')
    await a.done
  }

  /** Ask the running search to finish now and KEEP its best move ("move now"). */
  stop() {
    if (!this.active) return
    this.active.stopped = true
    this.send('stop')
  }

  terminate() {
    this.disposed = true
    this.requestSeq++
    const a = this.active
    this.active = null
    a?.resolve(null); a?.finish()
    this.lineListeners.clear()
    this.worker?.terminate()
    this.worker = null
    this.status = 'idle'
  }
}