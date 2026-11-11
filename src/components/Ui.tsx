import { type ReactNode } from 'react'
import { motion } from 'framer-motion'

export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8 md:mb-10">
      <div>
        <h1 className="display text-5xl sm:text-6xl md:text-7xl text-bone leading-[0.95]">{title}</h1>
        {sub && <p className="mt-3 text-ash max-w-xl">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="py-8 border-t hair">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="display text-2xl md:text-3xl italic">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Bar({ value, total = 100, tone = 'red' }: { value: number; total?: number; tone?: 'red' | 'bone' }) {
  return (
    <div className="h-[3px] bg-white/10 w-full overflow-hidden">
      <motion.div initial={{ width: 0 }} whileInView={{ width: `${(value / total) * 100}%` }} viewport={{ once: true }} transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }}
        className={tone === 'red' ? 'h-full bg-blood-500' : 'h-full bg-bone'} />
    </div>
  )
}

export function Arrow({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`w-4 h-4 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  )
}

export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="panel w-full max-w-lg p-6 md:p-8 border-blood-700" onClick={(e) => e.stopPropagation()}>
        {children}
      </motion.div>
    </motion.div>
  )
}
