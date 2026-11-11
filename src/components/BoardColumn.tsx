import type { ReactNode } from 'react'

/** Shared board width cap so the board is the same size on every page (matches the Play page). */
export const BOARD_MAX = 'max(500px, min(640px, calc(100svh - 16rem)))'

export default function BoardColumn({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`w-full mx-auto ${className}`} style={{ maxWidth: BOARD_MAX }}>{children}</div>
}