// RegisterFile — architectural registers and flags at the current tick.

import { REGISTERS } from '../engine/isa'
import type { Snapshot } from '../engine/trace'

function hex(n: number) {
  return '0x' + (n >>> 0).toString(16).padStart(8, '0')
}

export function RegisterFile({ snap }: { snap: Snapshot }) {
  return (
    <div className="panel p-3">
      <div className="panel-title mb-2">Architectural state</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {REGISTERS.map((r) => (
          <div key={r} className="flex justify-between mono text-xs">
            <span style={{ color: 'var(--text-dim)' }}>{r}</span>
            <span style={{ color: 'var(--text-hi)' }}>{hex(snap.arch[r])}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        {(['zf', 'cf', 'sf', 'of'] as const).map((f) => (
          <span
            key={f}
            className="mono text-xs px-2 py-0.5 rounded border"
            style={{
              borderColor: 'var(--border)',
              color: snap.flags[f] ? 'var(--accent)' : 'var(--text-dim)',
              background: snap.flags[f]
                ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                : 'transparent',
            }}
          >
            {f.toUpperCase()} {snap.flags[f] ? 1 : 0}
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-3 text-xs" style={{ color: 'var(--text-dim)' }}>
        <span>committed: <b style={{ color: 'var(--ok)' }}>{snap.committedCount}</b></span>
        <span>squashed: <b style={{ color: 'var(--danger)' }}>{snap.squashedCount}</b></span>
      </div>
    </div>
  )
}
