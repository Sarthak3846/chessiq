import { motion } from 'framer-motion'
import { fmtEval } from '../lib/chess'

export default function EvalBar({ value, orientation = 'w' }: { value: number; orientation?: 'w' | 'b' }) {
  const pct = 50 + 50 * (2 / (1 + Math.exp(-0.55 * value)) - 1) // white share, 0-100
  const whiteShare = Math.max(4, Math.min(96, pct))
  return (
    <div className={`relative w-7 sm:w-8 self-stretch overflow-hidden border hair bg-ink flex ${orientation === 'w' ? 'flex-col-reverse' : 'flex-col'}`} aria-label={`Evaluation ${fmtEval(value)}`}>
      <motion.div className="bg-bone w-full" animate={{ height: `${whiteShare}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
      <span className={`absolute left-0 right-0 text-center text-[10px] font-medium ${value >= 0 ? (orientation === 'w' ? 'bottom-1 text-ink' : 'top-1 text-ink') : (orientation === 'w' ? 'top-1 text-bone' : 'bottom-1 text-bone')}`}>
        {fmtEval(value).replace('+', '')}
      </span>
    </div>
  )
}
