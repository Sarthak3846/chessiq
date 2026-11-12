import { supabase } from './supabase'

// Frontend client for the ChessIQ backend. The browser only talks to /api/*; LLM keys, the database URL and the
// Stockfish path live in backend/.env. The signed-in user's Supabase access token is sent as a Bearer token and
// verified by the backend — the backend never trusts a user id sent by the browser.
const API = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function authHeader(): Promise<Record<string, string>> {
  if (!supabase) return {}
  const { data } = await supabase.auth.getSession()
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const j = await res.json()
    if (typeof j.detail === 'string') return j.detail
    if (Array.isArray(j.detail)) return j.detail[0]?.msg ?? `Request failed (HTTP ${res.status}).`
  } catch { /* not JSON */ }
  return res.status === 401 ? 'Please sign in again.' : `The server returned an error (HTTP ${res.status}).`
}

export async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(await authHeader()) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Could not reach the ChessIQ server. Check that the backend is running.')
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

// ───── types ─────
export type Difficulty = 'beginner' | 'easy' | 'intermediate' | 'advanced' | 'expert' | 'max'
export interface Profile { id: string; email: string | null; display_name: string | null; avatar_url: string | null; preferred_difficulty: Difficulty; puzzle_rating: number; created_at: string }
export interface GameRow { id: string; played_at: string; mode: string; opponent: string; difficulty: string | null; outcome: 'win' | 'loss' | 'draw'; result: string; termination: string | null; moves_count: number }
export interface Stats {
  profile: Profile
  games: { total: number; wins: number; losses: number; draws: number; win_rate_pct: number | null }
  by_difficulty: { mode: string; difficulty: string | null; games: number; wins: number }[]
  recent_games: GameRow[]
  puzzles: { attempts: number; puzzles_solved: number; accuracy_pct: number | null; avg_solve_seconds: number; rating: number }
  streak_days: number
  weaknesses: { available: boolean; reason?: string; games_analysed?: number; average_cp_loss?: number; phase_with_most_errors?: string
    errors_by_phase?: Record<string, { inaccuracy: number; mistake: number; blunder: number }>; weakest_puzzle_themes: { theme: string; attempts: number; success_rate_pct: number }[] }
}
export interface PuzzleDto { id: string; fen: string; moves: string[]; rating: number; popularity: number | null; nb_plays: number | null; themes: string[]; game_url: string | null; source_url: string; attribution: string }
export interface SaveGameBody { pgn: string; mode: 'coach' | 'stockfish' | 'local'; opponent: string; difficulty?: Difficulty; player_color: 'w' | 'b'; result: '1-0' | '0-1' | '1/2-1/2'; termination?: string }

// ───── endpoints ─────
export const getMe = () => request<Profile>('/api/me')
export const patchMe = (b: { display_name?: string; preferred_difficulty?: Difficulty }) => request<Profile>('/api/me', { method: 'PATCH', body: b })
export const getStats = () => request<Stats>('/api/me/stats')
export const saveGame = (b: SaveGameBody) => request<{ id: string }>('/api/games', { method: 'POST', body: b })
export const getGame = (id: string) => request<{ pgn: string }>(`/api/games/${id}`)
export const nextPuzzle = (q: { themes?: string; min?: number; max?: number; exclude?: string[] }) => {
  const p = new URLSearchParams()
  if (q.themes) p.set('themes', q.themes)
  if (q.min !== undefined) p.set('min_rating', String(q.min))
  if (q.max !== undefined) p.set('max_rating', String(q.max))
  if (q.exclude?.length) p.set('exclude', q.exclude.join(','))
  return request<PuzzleDto>(`/api/puzzles/next?${p}`)
}
export const dailyPuzzle = () => request<PuzzleDto>('/api/puzzles/daily')
export const puzzleThemes = () => request<{ theme: string; count: number }[]>('/api/puzzles/themes')
export const recordAttempt = (id: string, b: { solved: boolean; hints_used: number; mistakes: number; time_ms: number }) =>
  request<{ rating: number; delta: number }>(`/api/puzzles/${id}/attempts`, { method: 'POST', body: b })

// ───── coach ─────
export interface CoachMsg { role: 'user' | 'assistant'; content: string }
export interface CoachRequest { messages: CoachMsg[]; fen?: string; move?: { san: string; fen_before: string }; pgn?: string; conversation_id?: string; retry?: boolean }
export interface PositionFacts { fen: string; side_to_move: string; evaluation: string; best_move: string | null; best_line: string; depth: number }
export interface MoveFacts { played_move: string; played_by: string; evaluation_before: string; evaluation_after: string; centipawn_loss: number; classification: 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'; engine_best_move: string | null; engine_best_line: string }
export interface ReviewFacts { plies_reviewed: number; average_cp_loss: { White: number; Black: number }; biggest_errors: { move_number: string; move: string; by: string; classification: string; cp_loss: number; engine_preferred: string | null }[] }
export interface Facts { position?: PositionFacts; move?: MoveFacts; game_review?: ReviewFacts; player_profile?: { available: boolean }; engine?: string }
export interface StreamHandlers {
  onAnalysis?: (facts: Facts, suggestions: string[]) => void
  onMeta?: (m: { provider?: string; notice?: string }) => void
  onToken?: (t: string) => void
  onWarning?: (message: string) => void
  onError?: (message: string) => void
  onDone?: () => void
}
export interface ConvoSummary { id: string; title: string; updated_at: string }
export interface StoredMsg { id: string; role: 'user' | 'assistant'; content: string; facts: Facts | null; provider: string | null }
export const listConversations = () => request<ConvoSummary[]>('/api/coach/conversations')
export const createConversation = () => request<ConvoSummary>('/api/coach/conversations', { method: 'POST', body: {} })
export const conversationMessages = (id: string) => request<StoredMsg[]>(`/api/coach/conversations/${id}/messages`)
export const deleteConversation = (id: string) => request<void>(`/api/coach/conversations/${id}`, { method: 'DELETE' })

/** POSTs to /api/coach/chat and parses the SSE stream: analysis → meta → token… → done | error. */
export async function streamCoach(req: CoachRequest, h: StreamHandlers, signal?: AbortSignal): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${API}/api/coach/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify(req), signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    h.onError?.('Could not reach the Coach service. Check that the backend is running.')
    return
  }
  if (!res.ok || !res.body) { h.onError?.(await errorMessage(res)); return }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', finished = false
  const dispatch = (block: string) => {
    let event = 'message', data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (!data) return
    const p = JSON.parse(data)
    if (event === 'analysis') h.onAnalysis?.(p.facts ?? {}, p.suggestions ?? [])
    else if (event === 'meta') h.onMeta?.(p)
    else if (event === 'token') h.onToken?.(p.t)
    else if (event === 'warning') h.onWarning?.(p.message)
    else if (event === 'error') { finished = true; h.onError?.(p.message) }
    else if (event === 'done') { finished = true; h.onDone?.() }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n\n')) >= 0) { dispatch(buf.slice(0, i)); buf = buf.slice(i + 2) }
    }
    if (!finished) h.onError?.('The connection to the Coach ended unexpectedly.')
  } catch (e) {
    if ((e as Error).name !== 'AbortError') h.onError?.('The connection to the Coach was interrupted.')
  }
}

export interface Health { status: string; stockfish: boolean; llm: { providers: string[]; order: string[] }; database: boolean; auth: boolean }
export async function getHealth(): Promise<Health | null> {
  try { const r = await fetch(`${API}/api/health`); return r.ok ? await r.json() : null } catch { return null }
}