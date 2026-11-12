import { useCallback, useEffect, useState } from 'react'
import { EngineApiError, fetchEngineHealth, type EngineHealth } from '../lib/engineApi'

export type ChessIqStatus = 'idle' | 'loading' | 'ready' | 'error'

const WAKE_WINDOW_MS = 90_000 // free hosting plans sleep when idle and can take about a minute to wake up
const RETRY_EVERY_MS = 3_000

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
})

/**
 * Checks that the CHESS-IQ engine API is reachable and its model is loaded. While the server is waking up it keeps
 * retrying for up to 90 seconds, so the page shows "loading" instead of an error. `health` carries the server's
 * default and maximum search depth.
 */
export function useChessIq(enabled: boolean) {
  const [status, setStatus] = useState<ChessIqStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<EngineHealth | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) { setStatus('idle'); setError(null); return }
    const ctl = new AbortController()
    setStatus('loading'); setError(null)
    void (async () => {
      const deadline = Date.now() + WAKE_WINDOW_MS
      for (;;) {
        try {
          const h = await fetchEngineHealth(ctl.signal)
          if (ctl.signal.aborted) return
          setHealth(h); setStatus('ready')
          return
        } catch (e) {
          if (ctl.signal.aborted) return
          const err = e as EngineApiError
          if (err.permanent || Date.now() > deadline) { setStatus('error'); setError(err.message); return }
          await sleep(RETRY_EVERY_MS, ctl.signal)
          if (ctl.signal.aborted) return
        }
      }
    })()
    return () => ctl.abort()
  }, [enabled, attempt])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  return { status, error, health, retry }
}