// Controls — transport bar: compile+run, step back/forward, play/pause, reset,
// a scrubber over ticks, and a speed control.

export interface ControlsProps {
  compiled: boolean
  playing: boolean
  index: number
  total: number
  speed: number
  onRun: () => void
  onStep: () => void
  onStepBack: () => void
  onPlay: () => void
  onPause: () => void
  onReset: () => void
  onScrub: (i: number) => void
  onSpeed: (s: number) => void
}

export function Controls(p: ControlsProps) {
  const atEnd = p.index >= p.total - 1
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn btn-accent" onClick={p.onRun}>
        ⟳ Assemble &amp; Run
      </button>
      <div className="flex items-center gap-1">
        <button className="btn" disabled={!p.compiled} onClick={p.onReset} title="Reset to tick 0">
          ⤒
        </button>
        <button className="btn" disabled={!p.compiled || p.index <= 0} onClick={p.onStepBack} title="Step back">
          ◀
        </button>
        {p.playing ? (
          <button className="btn" disabled={!p.compiled} onClick={p.onPause} title="Pause">
            ❚❚
          </button>
        ) : (
          <button className="btn" disabled={!p.compiled || atEnd} onClick={p.onPlay} title="Play">
            ▶
          </button>
        )}
        <button className="btn" disabled={!p.compiled || atEnd} onClick={p.onStep} title="Step forward">
          ▶|
        </button>
      </div>

      <div className="flex items-center gap-2 grow min-w-[180px]">
        <span className="mono text-xs" style={{ color: 'var(--text-dim)' }}>
          tick
        </span>
        <input
          type="range"
          className="grow accent-[var(--accent)]"
          min={0}
          max={Math.max(0, p.total - 1)}
          value={p.index}
          disabled={!p.compiled}
          onChange={(e) => p.onScrub(Number(e.target.value))}
        />
        <span className="mono text-xs tabular-nums" style={{ color: 'var(--text-hi)' }}>
          {p.index}/{Math.max(0, p.total - 1)}
        </span>
      </div>

      <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-dim)' }}>
        speed
        <input
          type="range"
          min={1}
          max={30}
          value={p.speed}
          onChange={(e) => p.onSpeed(Number(e.target.value))}
        />
      </label>
    </div>
  )
}
