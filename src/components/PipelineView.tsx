// PipelineView — the reorder buffer as a column of in-flight µops, coloured by
// pipeline phase and marked when they are speculative or mispredicted. This is
// the "microscope" on the out-of-order engine.

import { AnimatePresence, motion } from 'framer-motion'
import type { UopPhase, UopView } from '../engine/trace'

const PHASE_COLOR: Record<UopPhase, string> = {
  fetch: 'var(--text-dim)',
  rename: 'var(--text-dim)',
  ready: 'var(--accent-2)',
  exec: 'var(--accent)',
  done: 'var(--ok)',
  committed: 'var(--ok)',
  squashed: 'var(--danger)',
}

const PHASE_LABEL: Record<UopPhase, string> = {
  fetch: 'FETCH',
  rename: 'RENAME',
  ready: 'ISSUE',
  exec: 'EXEC',
  done: 'DONE',
  committed: 'COMMIT',
  squashed: 'SQUASH',
}

export function PipelineView({ uops }: { uops: UopView[] }) {
  return (
    <div className="panel p-3 h-full flex flex-col min-h-0">
      <div className="panel-title mb-2 flex justify-between">
        <span>Reorder buffer · µops in flight</span>
        <span style={{ color: 'var(--text-dim)' }}>{uops.length}</span>
      </div>
      <div className="scroll overflow-auto grow min-h-0 flex flex-col gap-1 pr-1">
        <AnimatePresence initial={false}>
          {uops.map((u) => (
            <motion.div
              key={u.seq}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.12 }}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs mono"
              style={{
                background: u.speculative
                  ? 'color-mix(in srgb, var(--spec) 12%, var(--panel-2))'
                  : 'var(--panel-2)',
                border: `1px solid ${
                  u.mispredicted ? 'var(--danger)' : 'var(--border)'
                }`,
              }}
            >
              <span
                className="w-14 shrink-0 text-[10px] font-bold text-center rounded px-1"
                style={{ color: PHASE_COLOR[u.phase] }}
              >
                {PHASE_LABEL[u.phase]}
              </span>
              <span className="w-12 shrink-0" style={{ color: 'var(--accent-2)' }}>
                {u.kind}
              </span>
              <span className="grow truncate" style={{ color: 'var(--text-hi)' }}>
                {u.label}
              </span>
              {u.speculative && (
                <span
                  className="text-[10px] px-1 rounded"
                  style={{ color: 'var(--spec)' }}
                  title="on an unresolved / mispredicted path"
                >
                  spec
                </span>
              )}
              {u.kind === 'BR' && u.predictedTaken !== undefined && (
                <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                  pred:{u.predictedTaken ? 'T' : 'NT'}
                  {u.actualTaken !== undefined && ` act:${u.actualTaken ? 'T' : 'NT'}`}
                </span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {uops.length === 0 && (
          <div className="text-xs" style={{ color: 'var(--text-dim)' }}>
            pipeline empty
          </div>
        )}
      </div>
    </div>
  )
}
