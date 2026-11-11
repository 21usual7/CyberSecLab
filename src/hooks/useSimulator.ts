// useSimulator — drives the engine from React.
//
// Compiling and running happen on demand (on "Run"); after that, stepping just
// walks the recorded per-tick snapshots, so forward/back/scrub are instant.

import { useCallback, useEffect, useRef, useState } from 'react'
import { analyze, type Annotation } from '../engine/analyzer'
import { AssembleError, assemble } from '../engine/assembler'
import { Core, DEFAULT_CONFIG, type CoreConfig } from '../engine/core'
import type { Snapshot } from '../engine/trace'

export interface SimState {
  snapshots: Snapshot[]
  index: number
  annotations: Annotation[]
  errors: { line: number; message: string }[]
  instLines: number[] // instruction index -> source line
  playing: boolean
  compiled: boolean
}

const EMPTY: SimState = {
  snapshots: [],
  index: 0,
  annotations: [],
  errors: [],
  instLines: [],
  playing: false,
  compiled: false,
}

export function useSimulator(initialConfig: Partial<CoreConfig> = {}) {
  const [state, setState] = useState<SimState>(EMPTY)
  const [speed, setSpeed] = useState(6) // ticks per second
  const configRef = useRef<CoreConfig>({ ...DEFAULT_CONFIG, ...initialConfig })
  const timerRef = useRef<number | null>(null)

  const setConfig = useCallback((patch: Partial<CoreConfig>) => {
    configRef.current = { ...configRef.current, ...patch }
  }, [])

  const compileAndRun = useCallback((source: string) => {
    try {
      const program = assemble(source)
      const annotations = analyze(program)
      const core = new Core(program, configRef.current)
      core.run()
      const instLines: number[] = []
      for (const inst of program.instructions) instLines[inst.addr] = inst.line
      setState({
        snapshots: core.snapshots.slice(),
        index: 0,
        annotations,
        errors: [],
        instLines,
        playing: false,
        compiled: true,
      })
    } catch (e) {
      if (e instanceof AssembleError) {
        setState({ ...EMPTY, errors: e.errors })
      } else {
        setState({
          ...EMPTY,
          errors: [{ line: 0, message: (e as Error).message }],
        })
      }
    }
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const goTo = useCallback((i: number) => {
    setState((s) => ({
      ...s,
      index: Math.max(0, Math.min(i, s.snapshots.length - 1)),
    }))
  }, [])

  const step = useCallback(() => goTo0(setState, +1), [])
  const stepBack = useCallback(() => goTo0(setState, -1), [])

  const reset = useCallback(() => {
    stopTimer()
    setState((s) => ({ ...s, index: 0, playing: false }))
  }, [stopTimer])

  const play = useCallback(() => {
    setState((s) => ({ ...s, playing: true }))
  }, [])
  const pause = useCallback(() => {
    stopTimer()
    setState((s) => ({ ...s, playing: false }))
  }, [stopTimer])

  // Playback loop.
  useEffect(() => {
    if (!state.playing) {
      stopTimer()
      return
    }
    stopTimer()
    timerRef.current = window.setInterval(() => {
      setState((s) => {
        if (s.index >= s.snapshots.length - 1) {
          return { ...s, playing: false }
        }
        return { ...s, index: s.index + 1 }
      })
    }, 1000 / speed)
    return stopTimer
  }, [state.playing, speed, stopTimer])

  const current = state.snapshots[state.index]

  return {
    state,
    current,
    speed,
    setSpeed,
    setConfig,
    compileAndRun,
    step,
    stepBack,
    goTo,
    reset,
    play,
    pause,
  }
}

type Setter = React.Dispatch<React.SetStateAction<SimState>>
function goTo0(setState: Setter, delta: number) {
  setState((s) => ({
    ...s,
    playing: false,
    index: Math.max(0, Math.min(s.index + delta, s.snapshots.length - 1)),
  }))
}
