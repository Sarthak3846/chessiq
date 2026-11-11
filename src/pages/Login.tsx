import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { PageHead } from '../components/Ui'
import { useAuth } from '../store/auth'

export default function Login() {
  const { user, loading, configured, signInWithGoogle } = useAuth()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(params.get('error_description'))
  useEffect(() => { setError(params.get('error_description')) }, [params])

  if (user) return <Navigate to="/profile" replace />

  const go = async () => {
    setBusy(true); setError(null)
    const err = await signInWithGoogle() // on success the browser leaves for Google
    if (err) { setError(err); setBusy(false) }
  }

  return (
    <div className="max-w-xl mx-auto px-5 md:px-10 pt-28 md:pt-40 pb-20">
      <PageHead title="Sign in" sub="Save your games, puzzle progress and Coach conversations to your own private account. Creating an account happens automatically the first time you continue with Google." />
      {!configured && (
        <div className="border border-blood-700 bg-blood-900/40 p-4 mb-6 text-sm">
          <p className="text-blood-400">Sign-in is not configured on this deployment.</p>
          <p className="text-ash mt-1">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example). You can still play, solve puzzles and use the Coach as a guest.</p>
        </div>
      )}
      {error && <p role="alert" className="border border-blood-700 bg-blood-900/40 p-3 mb-6 text-sm text-blood-400">{error}</p>}
      <button onClick={go} disabled={!configured || busy || loading} className="btn btn-solid w-full !py-3.5 disabled:opacity-50 disabled:cursor-not-allowed">
        {busy ? 'Redirecting to Google…' : loading ? 'Checking your session…' : 'Continue with Google'}
      </button>
      <p className="label mt-4">We only receive your name, email and avatar from Google. Your data is private to your account and you can sign out at any time.</p>
    </div>
  )
}