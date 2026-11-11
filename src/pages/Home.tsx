// Home — landing page: what this is, the safety stance, and the lab list.

import { LABS } from '../labs'

export function Home({ navigate }: { navigate: (hash: string) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h1
          className="text-2xl font-bold"
          style={{ color: 'var(--text-hi)' }}
        >
          CPU Labs — microarchitecture under a microscope
        </h1>
        <p style={{ color: 'var(--text)' }} className="max-w-3xl">
          Write assembly for a small, invented out-of-order CPU and watch, tick
          by tick, what the pipeline, branch predictor, reorder buffer and L1
          cache actually do. Step forward and back in time to see speculation,
          mispredictions and the cache residue they leave behind — the
          mechanism behind speculative-execution vulnerabilities.
        </p>
        <div
          className="panel p-3 text-sm max-w-3xl"
          style={{ color: 'var(--text-dim)' }}
        >
          <b style={{ color: 'var(--accent)' }}>Why this is safe to learn on.</b>{' '}
          Your code never becomes real machine code and never runs on a real
          CPU. The timings, cache behaviour and micro-ops are synthetic teaching
          numbers that do not match any physical processor, and nothing here can
          read a real clock, the network or host memory. You can study the
          gadget and its defences without any way to characterise real hardware.
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="panel-title">Labs</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {LABS.map((lab) => (
            <button
              key={lab.id}
              onClick={() => navigate(`#/lab/${lab.id}`)}
              className="panel p-4 text-left hover:border-[var(--accent-2)] transition-colors"
            >
              <div className="font-semibold" style={{ color: 'var(--text-hi)' }}>
                {lab.title}
              </div>
              <div className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>
                {lab.summary}
              </div>
            </button>
          ))}
          <button
            onClick={() => navigate('#/sandbox')}
            className="panel p-4 text-left hover:border-[var(--accent-2)] transition-colors"
          >
            <div className="font-semibold" style={{ color: 'var(--text-hi)' }}>
              Sandbox
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>
              A blank workbench. Write any program and inspect the pipeline
              freely.
            </div>
          </button>
        </div>
      </section>
    </div>
  )
}
