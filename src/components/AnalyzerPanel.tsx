// AnalyzerPanel — static findings (gadgets / mitigations) plus the live note
// from the current tick (e.g. a misprediction). It explains; it never blocks.

import type { Annotation } from '../engine/analyzer'
import type { Snapshot } from '../engine/trace'

const BADGE: Record<Annotation['severity'], { c: string; t: string }> = {
  gadget: { c: 'var(--danger)', t: 'gadget' },
  mitigation: { c: 'var(--ok)', t: 'mitigated' },
  info: { c: 'var(--accent-2)', t: 'info' },
}

export function AnalyzerPanel({
  annotations,
  snap,
}: {
  annotations: Annotation[]
  snap?: Snapshot
}) {
  return (
    <div className="panel p-3 flex flex-col gap-2">
      <div className="panel-title">Analyzer</div>

      {snap?.note && (
        <div
          className="text-xs rounded px-2 py-1"
          style={{
            background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
            color: 'var(--danger)',
          }}
        >
          ⚡ {snap.note}
        </div>
      )}

      {annotations.length === 0 ? (
        <div className="text-xs" style={{ color: 'var(--text-dim)' }}>
          No speculative gadgets detected.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {annotations.map((a, i) => {
            const b = BADGE[a.severity]
            return (
              <div key={i} className="text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase"
                    style={{ color: b.c, border: `1px solid ${b.c}` }}
                  >
                    {b.t}
                  </span>
                  <span style={{ color: 'var(--text-hi)' }}>line {a.line} — {a.title}</span>
                </div>
                <div className="mt-0.5" style={{ color: 'var(--text-dim)' }}>
                  {a.detail}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div
        className="text-[10px] mt-1 pt-2"
        style={{ color: 'var(--text-dim)', borderTop: '1px solid var(--border)' }}
      >
        Safety: code runs only on this synthetic in-browser CPU. Its timings,
        cache and micro-ops are invented and do not match real hardware, so
        nothing here can be tuned into a real-world exploit. The analyzer
        teaches the pattern and its defences instead of hiding them.
      </div>
    </div>
  )
}
