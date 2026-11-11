// LabPage — theory + guided steps alongside the interactive workbench.

import { Workbench } from '../components/Workbench'
import { labById } from '../labs'

export function LabPage({
  id,
  navigate,
}: {
  id: string
  navigate: (hash: string) => void
}) {
  const lab = labById(id)
  if (!lab) {
    return (
      <div className="panel p-4">
        <p>Unknown lab.</p>
        <button className="btn mt-2" onClick={() => navigate('#/')}>
          ← Back
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <button
          className="text-xs"
          style={{ color: 'var(--text-dim)' }}
          onClick={() => navigate('#/')}
        >
          ← all labs
        </button>
        <h1 className="text-xl font-bold mt-1" style={{ color: 'var(--text-hi)' }}>
          {lab.title}
        </h1>
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-3">
          <div className="panel p-3">
            <div className="panel-title mb-2">How it works</div>
            <p className="text-sm whitespace-pre-line" style={{ color: 'var(--text)' }}>
              {lab.theory}
            </p>
          </div>
          <div className="panel p-3">
            <div className="panel-title mb-2">Steps</div>
            <ol className="flex flex-col gap-3">
              {lab.steps.map((s, i) => (
                <li key={i}>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-hi)' }}>
                    {s.title}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--text-dim)' }}>
                    {s.body}
                  </div>
                  {s.goal && (
                    <div
                      className="text-xs mt-1 pl-2"
                      style={{ color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }}
                    >
                      goal: {s.goal}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <main className="min-w-0">
          <Workbench key={lab.id} initialSource={lab.starter} />
        </main>
      </div>
    </div>
  )
}
