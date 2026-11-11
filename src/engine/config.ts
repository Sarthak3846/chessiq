export type DifficultyId = 'beginner' | 'easy' | 'intermediate' | 'advanced' | 'expert' | 'max'
export type SearchMode = 'depth' | 'time'
export type ColorPref = 'w' | 'b' | 'random'

export interface Difficulty {
  id: DifficultyId
  label: string
  /** Approximate Elo, or null for unrestricted. */
  elo: number | null
  /** Stockfish "Skill Level" (0–20). */
  skill: number
  /** true => use UCI_LimitStrength + UCI_Elo (Stockfish only supports Elo >= 1320). */
  useElo: boolean
}

// Stockfish's UCI_Elo range starts at 1320, so the two lowest levels use "Skill Level" instead.
export const DIFFICULTIES: Difficulty[] = [
  { id: 'beginner', label: 'Beginner', elo: 800, skill: 0, useElo: false },
  { id: 'easy', label: 'Easy', elo: 1000, skill: 3, useElo: false },
  { id: 'intermediate', label: 'Intermediate', elo: 1400, skill: 0, useElo: true },
  { id: 'advanced', label: 'Advanced', elo: 1800, skill: 0, useElo: true },
  { id: 'expert', label: 'Expert', elo: 2200, skill: 0, useElo: true },
  { id: 'max', label: 'Maximum', elo: null, skill: 20, useElo: false },
]

export interface MatchSettings {
  difficulty: DifficultyId
  searchMode: SearchMode
  depth: number // 5–25
  movetimeMs: number // 500 | 1000 | 2000 | 5000
  color: ColorPref
  startPosition: 'standard'
  takebacks: boolean
}

export const DEPTH_MIN = 5
export const DEPTH_MAX = 25
export const MOVE_TIMES = [500, 1000, 2000, 5000]

export const DEFAULT_MATCH: MatchSettings = {
  difficulty: 'intermediate', searchMode: 'depth', depth: 12, movetimeMs: 1000, color: 'w', startPosition: 'standard', takebacks: true,
}

export type SearchLimit = { depth: number } | { movetime: number }

export const getDifficulty = (id: DifficultyId) => DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[2]

export const toLimit = (s: MatchSettings): SearchLimit =>
  s.searchMode === 'depth' ? { depth: Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, s.depth)) } : { movetime: s.movetimeMs }

/** UCI `setoption` commands that implement a difficulty level. */
export function difficultyCommands(d: Difficulty): string[] {
  const cmds = [`setoption name Skill Level value ${d.skill}`]
  if (d.useElo && d.elo) {
    cmds.push('setoption name UCI_LimitStrength value true', `setoption name UCI_Elo value ${d.elo}`)
  } else {
    cmds.push('setoption name UCI_LimitStrength value false')
  }
  return cmds
}