import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getMe, patchMe, type Difficulty, type Profile } from '../lib/api'
import { authConfigured, supabase } from '../lib/supabase'

export interface AuthUser { id: string; email: string | null; name: string | null; avatar: string | null }
interface AuthState {
  user: AuthUser | null
  profile: Profile | null
  loading: boolean // true until the stored session has been checked
  configured: boolean
  signInWithGoogle: () => Promise<string | null> // returns an error message, or null when the redirect started
  signOut: () => Promise<void>
  setPreferredDifficulty: (d: Difficulty) => void
}

const Ctx = createContext<AuthState>({ user: null, profile: null, loading: false, configured: false, signInWithGoogle: async () => 'Not configured', signOut: async () => undefined, setPreferredDifficulty: () => undefined })
export const useAuth = () => useContext(Ctx)

const toUser = (s: Session | null): AuthUser | null => s ? {
  id: s.user.id, email: s.user.email ?? null,
  name: (s.user.user_metadata?.full_name ?? s.user.user_metadata?.name ?? null) as string | null,
  avatar: (s.user.user_metadata?.avatar_url ?? s.user.user_metadata?.picture ?? null) as string | null,
} : null

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(authConfigured)
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    if (!uid) { setProfile(null); return }
    let live = true
    getMe().then((p) => { if (live) setProfile(p) }).catch(() => { if (live) setProfile(null) })
    return () => { live = false }
  }, [uid])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return 'Sign-in is not configured on this deployment.'
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/profile` } })
    return error ? error.message : null
  }, [])
  const signOut = useCallback(async () => { await supabase?.auth.signOut(); setProfile(null) }, [])
  const setPreferredDifficulty = useCallback((d: Difficulty) => {
    setProfile((p) => (p ? { ...p, preferred_difficulty: d } : p))
    patchMe({ preferred_difficulty: d }).catch(() => undefined)
  }, [])

  const value = useMemo<AuthState>(() => ({ user: toUser(session), profile, loading, configured: authConfigured, signInWithGoogle, signOut, setPreferredDifficulty }), [session, profile, loading, signInWithGoogle, signOut, setPreferredDifficulty])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}