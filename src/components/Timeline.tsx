// Timeline — a Gantt chart of µops (rows) across ticks (columns). Each cell is
// coloured by the phase that µop was in on that tick; squashed µops show in red.
// The current tick is highlighted so stepping lines up with the pipeline view.

import { useMemo } from 'react'
import type { Snapshot, UopPhase } from '../engine/trace'

const CELL: Record<UopPhase, string> = {
  fetch: '#3a455c',
  rename: '#49557060',
  ready: 'var(--accent-2)',
  exec: 'var(--accent)',
  done: 'var(--ok)',
  committed: 'var(--ok)',
  squashed: 'var(--danger)',
}

interface Row {
  seq: number
  label: string
  cells: (UopPhase | null)[]
}

export function Timeline({
  snapshots,
  index,
}: {
  snapshots: Snapshot[]
  index: number
}) {
  const rows = useMemo<Row[]>(() => {
    const bySeq = new Map<number, Row>()
    snapshots.forEach((snap, t) => {
      for (const u of snap.uops) {
        let row = bySeq.get(u.seq)
        if (!row) {
          row = { seq: u.seq, label: u.label, cells: [] }
          bySeq.set(u.seq, row)
        }
        row.cells[t] = u.phase
      }
    })
    return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  }, [snapshots])

  if (rows.length === 0) {
    return (
      <div className="panel p-3 text-xs" style={{ color: 'var(--text-dim)' }}>
        Timeline appears after you run a program.
      </div>
    )
  }

  const ticks = snapshots.length
  const colW = 7

  return (
    <div className="panel p-3">
      <div className="panel-title mb-2">Timeline · µop × tick</div>
      <div className="scroll overflow-auto" style={{ maxHeight: 220 }}>
        <div style={{ minWidth: 120 + ticks * colW }}>
          {rows.map((row) => (
            <div key={row.seq} className="flex items-center" style={{ height: 14 }}>
              <div
                className="mono text-[10px] truncate shrink-0 pr-2"
                style={{ width: 120, color: 'var(--text-dim)' }}
                title={row.label}
              >
                {row.label}
              </div>
              <div className="flex">
                {Array.from({ length: ticks }).map((_, t) => {
                  const ph = row.cells[t]
                  return (
                    <div
                      key={t}
                      style={{
                        width: colW - 1,
                        height: 10,
                        marginRight: 1,
                        background: ph ? CELL[ph] : 'transparent',
                        outline:
                          t === index ? '1px solid var(--text-hi)' : 'none',
                        outlineOffset: -1,
                      }}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
