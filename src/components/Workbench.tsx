// Workbench — the editor + transport + all the visualisation panels wired to
// one simulator instance. Shared by the lab pages and the sandbox.

import { useEffect, useRef, useState } from 'react'
import { useSimulator } from '../hooks/useSimulator'
import { AnalyzerPanel } from './AnalyzerPanel'
import { CacheView } from './CacheView'
import { CodeEditor } from './CodeEditor'
import { Controls } from './Controls'
import { PipelineView } from './PipelineView'
import { PredictorView } from './PredictorView'
import { RegisterFile } from './RegisterFile'
import { Timeline } from './Timeline'

export function Workbench({ initialSource }: { initialSource: string }) {
  const [source, setSource] = useState(initialSource)
  const sim = useSimulator()

  // Run once on mount so the panels start populated; the user re-runs on edits.
  const ran = useRef(false)
  const run = sim.compileAndRun
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    run(initialSource)
  }, [initialSource, run])

  const { state, current } = sim
  const fetchLine =
    current && current.fetchInst >= 0
      ? (state.instLines[current.fetchInst] ?? -1)
      : -1

  return (
    <div className="flex flex-col gap-3">
      <div className="panel p-2">
        <Controls
          compiled={state.compiled}
          playing={state.playing}
          index={state.index}
          total={state.snapshots.length}
          speed={sim.speed}
          onRun={() => sim.compileAndRun(source)}
          onStep={sim.step}
          onStepBack={sim.stepBack}
          onPlay={sim.play}
          onPause={sim.pause}
          onReset={sim.reset}
          onScrub={sim.goTo}
          onSpeed={sim.setSpeed}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Left: editor + register/predictor */}
        <div className="flex flex-col gap-3">
          <div
            className="panel overflow-hidden"
            style={{ height: 340, minHeight: 240 }}
          >
            <CodeEditor
              value={source}
              onChange={setSource}
              fetchLine={fetchLine}
              annotations={state.annotations}
            />
          </div>
          {state.errors.length > 0 && (
            <div
              className="panel p-3 text-xs mono"
              style={{ color: 'var(--danger)' }}
            >
              {state.errors.map((e, i) => (
                <div key={i}>
                  {e.line > 0 ? `line ${e.line}: ` : ''}
                  {e.message}
                </div>
              ))}
            </div>
          )}
          {current && (
            <div className="grid sm:grid-cols-2 gap-3">
              <RegisterFile snap={current} />
              <PredictorView snap={current} />
            </div>
          )}
        </div>

        {/* Right: pipeline + cache */}
        <div className="flex flex-col gap-3">
          <div style={{ height: 340 }}>
            <PipelineView uops={current?.uops ?? []} />
          </div>
          {current && <CacheView snap={current} />}
        </div>
      </div>

      {current && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Timeline snapshots={state.snapshots} index={state.index} />
          <AnalyzerPanel annotations={state.annotations} snap={current} />
        </div>
      )}
      {!current && (
        <AnalyzerPanel annotations={state.annotations} snap={undefined} />
      )}
    </div>
  )
}
