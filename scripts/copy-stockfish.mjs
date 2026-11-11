// Copies the single-threaded "lite" Stockfish WASM build from node_modules into public/stockfish/
// so it can be served as a static Web Worker script (no COOP/COEP headers required).
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const bin = path.join(path.dirname(require.resolve('stockfish/package.json')), 'bin')
const out = path.resolve('public', 'stockfish')
mkdirSync(out, { recursive: true })

for (const ext of ['js', 'wasm']) {
  const file = readdirSync(bin).find((f) => new RegExp(`^stockfish-[\\d.]+-lite-single\\.${ext}$`).test(f))
  if (!file) throw new Error(`Stockfish lite-single .${ext} not found in ${bin}`)
  copyFileSync(path.join(bin, file), path.join(out, `stockfish-lite-single.${ext}`))
  console.log(`[stockfish] ${file} -> public/stockfish/stockfish-lite-single.${ext}`)
}
try { copyFileSync(path.join(bin, '..', 'Copying.txt'), path.join(out, 'LICENSE-GPL-3.0.txt')) } catch { /* optional */ }