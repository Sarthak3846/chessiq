
interface Props {
  moves: string[]
  current?: number
  onSelect?: (ply: number) => void
  marks?: (string | undefined)[]
}

export default function MoveList({ moves, current, onSelect, marks }: Props) {
  const rows: number[] = []

  for (let i = 0; i < moves.length; i += 2) {
    rows.push(i)
  }

  if (!moves.length) {
    return <p className="label p-4">No moves yet. Make the first move on the board.</p>
  }

  const cell = (ply: number) => (
    <button
      disabled={!onSelect}
      onClick={() => onSelect?.(ply + 1)}
      className={`text-left px-2 py-1 transition-colors flex items-center gap-1.5 ${
        current === ply + 1
          ? 'bg-blood-700 text-bone'
          : 'hover:bg-white/5 text-bone/80'
      }`}
    >
      {moves[ply]}
      {marks?.[ply] && (
        <span className="text-[10px]" style={{ color: marks[ply] }}>
          ●
        </span>
      )}
    </button>
  )

  return (
    <div className="grid grid-cols-[2.2rem_1fr_1fr] text-sm">
      {rows.map((i) => (
        <div key={i} className="contents">
          <span className="text-ash py-1 pl-2">
            {i / 2 + 1}.
          </span>
          {cell(i)}
          {moves[i + 1] ? cell(i + 1) : <span />}
        </div>
      ))}
    </div>
  )
}
