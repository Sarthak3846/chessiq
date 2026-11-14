import { useCallback, useEffect, useState } from 'react'
import { reviewGame, type GameReview } from '../lib/api'

export type ReviewStatus = 'idle' | 'loading' | 'ready' | 'error'
const done = new Map<string, GameReview>() // finished reviews, so switching games back and forth never repeats the request

/** Real Stockfish review of every move of `pgn` (computed once by the backend and cached there too). */
export function useGameReview(pgn: string | null) {
  const [state, setState] = useState<{ status: ReviewStatus; review: GameReview | null; error: string | null }>({ status: 'idle', review: null, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!pgn) { setState({ status: 'idle', review: null, error: null }); return }
    const hit = done.get(pgn)
    if (hit) { setState({ status: 'ready', review: hit, error: null }); return }
    let stale = false
    setState({ status: 'loading', review: null, error: null })
    reviewGame(pgn)
      .then((r) => { done.set(pgn, r); if (!stale) setState({ status: 'ready', review: r, error: null }) })
      .catch((e: Error) => { if (!stale) setState({ status: 'error', review: null, error: e.message }) })
    return () => { stale = true }
  }, [pgn, attempt])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  return { ...state, retry }
}