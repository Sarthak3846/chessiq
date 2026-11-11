import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../store/auth'

const links = [
  { to: '/', label: 'Home' }, { to: '/play', label: 'Play' }, { to: '/play-coach', label: 'Play Coach' },
  { to: '/analysis', label: 'Analysis' }, { to: '/puzzles', label: 'Puzzles' }, { to: '/openings', label: 'Openings' }, { to: '/coach', label: 'AI Coach' },
]

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `relative text-[13px] tracking-wide py-1 whitespace-nowrap transition-colors ${isActive ? 'text-bone' : 'text-bone/70 hover:text-bone'} after:absolute after:left-0 after:-bottom-0.5 after:h-px after:bg-blood-400 after:transition-all after:duration-300 ${isActive ? 'after:w-full' : 'after:w-0 hover:after:w-full'}`

export function Logo() {
  return (
    <Link to="/" aria-label="ChessIQ home" className="group flex items-center gap-2">
      <span className="display text-3xl italic leading-none transition-transform duration-500 group-hover:scale-110">I<span className="text-blood-400">Q</span></span>
    </Link>
  )
}

function AccountMenu() {
  const { user, loading, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  if (loading) return <span className="w-8 h-8 rounded-full border hair animate-pulseDot" aria-label="Checking sign-in" />
  if (!user) return <NavLink to="/login" className={linkCls}>Sign in</NavLink>
  const initial = (user.name ?? user.email ?? '?').charAt(0).toUpperCase()
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open} className="w-8 h-8 rounded-full overflow-hidden border border-blood-500/70 grid place-items-center text-sm bg-blood-800/60 hover:border-blood-400 transition-colors">
        {user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" /> : initial}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute right-0 mt-3 w-44 panel text-sm py-1" onMouseLeave={() => setOpen(false)}>
            <p className="px-4 py-2 text-xs text-ash truncate">{user.email}</p>
            <Link to="/profile" onClick={() => setOpen(false)} className="block px-4 py-2 hover:bg-white/5">Profile</Link>
            <button onClick={() => { setOpen(false); void signOut() }} className="w-full text-left px-4 py-2 hover:bg-white/5 text-blood-400">Sign out</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Layout() {
  const loc = useLocation()
  // Capture the outlet element per render so the exiting page keeps ITS content during the transition
  // (a bare <Outlet /> would mount the next page inside the old one and then mount it again).
  const outlet = useOutlet()
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [solid, setSolid] = useState(false)
  useEffect(() => { setOpen(false); window.scrollTo({ top: 0 }) }, [loc.pathname])
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 30)
    on(); window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  const home = loc.pathname === '/'
  return (
    <div className="grain min-h-screen flex flex-col">
      <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${solid && !home ? 'bg-ink/80 backdrop-blur-md border-b hair' : solid ? 'bg-ink/40 backdrop-blur-sm' : ''}`}>
        <nav className="max-w-[1500px] mx-auto px-5 md:px-10 h-16 md:h-20 grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="justify-self-start"><Logo /></div>
          <div className="hidden lg:flex gap-7 justify-self-center">{links.map((l) => <NavLink key={l.to} to={l.to} end={l.to === '/'} className={linkCls}>{l.label}</NavLink>)}</div>
          <div className="justify-self-end flex items-center gap-5">
            <div className="hidden lg:block"><AccountMenu /></div>
            <button className="lg:hidden p-2 -mr-2" aria-label="Menu" onClick={() => setOpen(true)}>
              <span className="block w-6 h-px bg-bone mb-1.5" /><span className="block w-4 h-px bg-bone ml-auto" />
            </button>
          </div>
        </nav>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ clipPath: 'circle(0% at 90% 5%)' }} animate={{ clipPath: 'circle(150% at 90% 5%)' }} exit={{ clipPath: 'circle(0% at 90% 5%)' }} transition={{ duration: 0.6, ease: [0.7, 0, 0.2, 1] }}
            className="fixed inset-0 z-[55] bg-blood-700 flex flex-col justify-center px-8 overflow-y-auto">
            <button className="absolute top-5 right-6 text-3xl font-light" onClick={() => setOpen(false)} aria-label="Close menu">×</button>
            {links.map((l, i) => (
              <motion.div key={l.to} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 + i * 0.05 }}>
                <NavLink to={l.to} end className="display block text-4xl py-1.5 hover:italic transition-all">{l.label}</NavLink>
              </motion.div>
            ))}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="mt-6 text-lg">
              {user ? <><Link to="/profile" className="mr-6 underline underline-offset-4">Profile</Link><button onClick={() => { setOpen(false); void signOut() }}>Sign out</button></> : <Link to="/login" className="underline underline-offset-4">Sign in</Link>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.main key={loc.pathname} initial={{ opacity: 0, filter: 'blur(6px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} className="flex-1">
          {outlet}
        </motion.main>
      </AnimatePresence>

      <footer className="border-t hair px-5 md:px-10 py-8 text-sm text-ash flex flex-wrap gap-4 justify-between max-w-[1500px] mx-auto w-full">
        <span className="display italic text-bone/80 text-lg">ChessIQ</span>
        <span>Play. Analyze. Learn. Improve.</span>
        <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noreferrer" className="hover:text-bone transition-colors">Puzzles: Lichess database (CC0)</a>
      </footer>
    </div>
  )
}