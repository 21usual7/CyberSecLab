// Sandbox — a blank workbench with a short starter program.

import { Workbench } from '../components/Workbench'

const STARTER = `.text
        mov rax, 0
        mov rcx, 0
loop:
        add rax, rcx      ; accumulate
        add rcx, 1
        cmp rcx, 8
        jb loop           ; the predictor learns this loop branch
        hlt
`

export function Sandbox({ navigate }: { navigate: (hash: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <button
          className="text-xs"
          style={{ color: 'var(--text-dim)' }}
          onClick={() => navigate('#/')}
        >
          ← home
        </button>
        <h1 className="text-xl font-bold mt-1" style={{ color: 'var(--text-hi)' }}>
          Sandbox
        </h1>
      </div>
      <Workbench initialSource={STARTER} />
    </div>
  )
}
