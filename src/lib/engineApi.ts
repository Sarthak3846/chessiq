// Client for the CHESS-IQ engine API (chessengine/api). Separate from lib/api.ts because the engine is its own
// service: in production it runs on Render/Railway while the rest of the site talks to the main backend.
//
//   VITE_ENGINE_API_URL  e.g. https://chessiq-engine.onrender.com   (no trailing slash needed)
//
// In development it defaults to http://localhost:8001.
const BASE = ((import.meta.env.VITE_ENGINE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:8001' : '')).replace(/\/+$/, '')

export const engineConfigured = BASE !== ''

export class EngineApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** true when retrying will not help (e.g. the server could not load the model). */
    public permanent = false,
  ) { super(message) }
}

export interface EngineScore { cp: number | null; mate: number | null }
export interface PositionStatus { game_over: boolean; result: string; termination: string | null; check: boolean; turn: 'w' | 'b' }
export interface EngineMove {
  best_move: string | null // UCI, e.g. "e7e5" or "e7e8q"; null when the game is already finished
  san: string | null
  fen: string
  depth: number
  nodes: number
  tt_hits: number
  elapsed_ms: number
  score: EngineScore | null // White's point of view
  status: PositionStatus
}
export interface EngineHealth {
  status: string
  ready: boolean
  model: { name: string; device: string | null; checkpoint: string; checkpoint_epoch: number | null }
  default_depth: number
  max_depth: number
  max_concurrent_searches: number
  queued_or_running: number
  searches_completed: number
  error: string | null
}

const REQUEST_TIMEOUT_MS = 150_000

function notConfigured(): EngineApiError {
  return new EngineApiError(0, 'The CHESS-IQ engine URL is not configured. Set VITE_ENGINE_API_URL and redeploy.', true)
}

async function detail(res: Response): Promise<string> {
  try {
    const j = await res.json()
    if (typeof j.detail === 'string') return j.detail
    if (Array.isArray(j.detail)) return String(j.detail[0]?.msg ?? `Request failed (HTTP ${res.status}).`)
  } catch { /* not JSON */ }
  if (res.status === 429) return 'Too many requests. Please wait a few seconds.'
  if (res.status === 502 || res.status === 503 || res.status === 504) return 'The CHESS-IQ engine is not responding. It may be starting up — try again in a moment.'
  return `The engine returned an error (HTTP ${res.status}).`
}

async function send<T>(path: string, init: RequestInit, external?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  if (!engineConfigured) throw notConfigured()
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctl.abort() }, timeoutMs)
  const onAbort = () => ctl.abort()
  if (external) { if (external.aborted) ctl.abort(); else external.addEventListener('abort', onAbort) }
  try {
    let res: Response
    try {
      res = await fetch(`${BASE}${path}`, { ...init, signal: ctl.signal })
    } catch (e) {
      if (external?.aborted) throw e // caller cancelled on purpose; let it see the AbortError
      throw new EngineApiError(0, timedOut ? 'The engine took too long to answer.' : 'Could not reach the CHESS-IQ engine. Check your connection, or try again in a moment.')
    }
    if (!res.ok) {
      let permanent = false
      if (path === '/api/health' && res.status === 503) {
        // JSON body = the server is up but the model failed to load; a cold-start proxy page is not JSON.
        try { const j = await res.clone().json(); permanent = j && j.ready === false; if (permanent && j.error) throw new EngineApiError(503, `The engine could not load its model: ${j.error}`, true) } catch (e) { if (e instanceof EngineApiError) throw e }
      }
      throw new EngineApiError(res.status, await detail(res), permanent)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onAbort)
  }
}

export const fetchEngineHealth = (signal?: AbortSignal) => send<EngineHealth>('/api/health', { method: 'GET' }, signal, 20_000)

export interface EngineMoveRequest {
  /** FEN the game started from; null/undefined = standard start position. */
  start_fen?: string | null
  /** Every move played since start_fen, in UCI notation. */
  moves: string[]
  depth?: number
}

/** Ask CHESS-IQ for its move. The server replays and validates `moves`, so it never trusts the client's board. */
export const requestEngineMove = (body: EngineMoveRequest, signal?: AbortSignal) =>
  send<EngineMove>('/api/engine/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal)