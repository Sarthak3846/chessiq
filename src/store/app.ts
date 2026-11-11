import { create } from 'zustand'

export interface CoachSeed { text: string; fen?: string; context?: string; move?: { san: string; fen_before: string }; pgn?: string }

// Cross-page hand-offs only. All persistent user data (games, puzzles, conversations) lives in the backend database.
interface AppState {
  coachSeed: CoachSeed | null
  setCoachSeed: (s: CoachSeed | null) => void
  analysisSeed: string | null
  setAnalysisSeed: (pgn: string | null) => void
}

export const useApp = create<AppState>((set) => ({
  coachSeed: null,
  setCoachSeed: (coachSeed) => set({ coachSeed }),
  analysisSeed: null,
  setAnalysisSeed: (analysisSeed) => set({ analysisSeed }),
}))