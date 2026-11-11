// CacheView — the L1 data cache as a grid of sets. A set lights up when it
// holds a valid line; amber means a line that was filled on a speculative path
// and never evicted — the residue a timing side channel reads. This is where
// the speculative leak becomes visible.

import type { CacheLineView, Snapshot } from '../engine/trace'

function setState(ways: CacheLineView[]): 'empty' | 'valid' | 'spec' {
  if (ways.some((w) => w.valid && w.speculative)) return 'spec'
  if (ways.some((w) => w.valid)) return 'valid'
  return 'empty'
}

const COLOR = {
  empty: 'var(--panel-2)',
  valid: 'var(--accent-2)',
  spec: 'var(--spec)',
}

export function CacheView({ snap }: { snap: Snapshot }) {
  const specSets = snap.cache
    .map((ways, i) => ({ i, s: setState(ways) }))
    .filter((x) => x.s === 'spec')
  return (
    <div className="panel p-3">
      <div className="panel-title mb-2 flex justify-between">
        <span>L1D cache · {snap.cache.length} sets × {snap.cache[0]?.length ?? 0} ways</span>
      </div>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}
      >
        {snap.cache.map((ways, i) => {
          const s = setState(ways)
          return (
            <div
              key={i}
              title={`set ${i}: ${s}`}
              className="aspect-square rounded-[2px]"
              style={{
                background: COLOR[s],
                boxShadow:
                  s === 'spec'
                    ? '0 0 4px 1px color-mix(in srgb, var(--spec) 70%, transparent)'
                    : 'none',
              }}
            />
          )
        })}
      </div>
      <div className="mt-3 flex gap-3 text-[10px]" style={{ color: 'var(--text-dim)' }}>
        <Legend c={COLOR.valid} label="resident" />
        <Legend c={COLOR.spec} label="speculative fill (leak)" />
      </div>
      {specSets.length > 0 && (
        <div className="mt-2 text-xs" style={{ color: 'var(--spec)' }}>
          speculative residue in set{specSets.length > 1 ? 's' : ''}{' '}
          {specSets.map((x) => x.i).join(', ')}
        </div>
      )}
    </div>
  )
}

function Legend({ c, label }: { c: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-3 h-3 rounded-[2px]" style={{ background: c }} />
      {label}
    </span>
  )
}
