import { createClient } from '@supabase/supabase-js'

// Only the PUBLIC project URL and anon key live in the frontend. No secret ever does.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null
export const authConfigured = supabase !== null