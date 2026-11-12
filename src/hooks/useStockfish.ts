import { useCallback, useEffect, useRef, useState } from 'react'
import { StockfishEngine, type EngineStatus } from '../engine/StockfishEngine'

/** Owns the Stockfish worker for a component's lifetime: loads on mount, terminates on unmount.
 *  With `enabled = false` (Play the Coach uses CHESS-IQ instead) no worker is created. */
export function useStockfish(enabled = true) {
  const engine = useRef<StockfishEngine | null>(null)
  const [status, setStatus] = useState<EngineStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) { setStatus('idle'); setError(null); return }
    const e = new StockfishEngine()
    engine.current = e
    setStatus('loading'); setError(null)
    e.init().then(() => { if (engine.current === e) setStatus('ready') })
      .catch((err: Error) => { if (engine.current === e && !e.disposed) { setStatus('error'); setError(err.message) } })
    return () => { e.terminate(); if (engine.current === e) engine.current = null }
  }, [attempt, enabled])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  return { engine, status, error, retry }
}