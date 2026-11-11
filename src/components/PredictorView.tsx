// PredictorView — the branch predictor's per-PC state, so you can watch a
// branch get "trained" and keep its prediction after the pattern changes.

import type { Snapshot } from '../engine/trace'

const COLORS = ['var(--danger)', 'var(--spec)', 'var(--accent-2)', 'var(--accent)']

export function PredictorView({ snap }: { snap: Snapshot }) {
  return (
    <div className="panel p-3">
      <div className="panel-title mb-2">Branch predictor</div>
      {snap.predictor.length === 0 ? (
        <div className="text-xs" style={{ color: 'var(--text-dim)' }}>
          no branches resolved yet
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {snap.predictor.map((e) => (
            <div key={e.pc} className="flex items-center gap-2 text-xs mono">
              <span style={{ color: 'var(--text-dim)' }}>br@{e.pc}</span>
              <div className="flex gap-0.5">
                {[0, 1, 2, 3].map((v) => (
                  <span
                    key={v}
                    className="w-4 h-3 rounded-sm"
                    style={{
                      background:
                        v === e.value ? COLORS[v] : 'var(--panel-2)',
                      border: '1px solid var(--border)',
                    }}
                  />
                ))}
              </div>
              <span style={{ color: 'var(--text-hi)' }}>{e.label}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 text-[10px]" style={{ color: 'var(--text-dim)' }}>
        2-bit saturating counter · ≥2 ⇒ predict taken
      </div>
    </div>
  )
}
