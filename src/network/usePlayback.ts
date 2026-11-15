import { useEffect, useRef, useState } from 'react'
import type { Snapshot } from './types'

export function usePlayback(history: Snapshot[]) {
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const frame = useRef(0)
  const cursor = Math.min(Math.floor(position), history.length - 1)
  const progress = position - cursor
  const atEnd = cursor === history.length - 1
  useEffect(() => {
    if (!playing || atEnd) return
    let last = 0
    const tick = (now: number) => {
      const elapsed = last ? Math.min(now - last, 80) : 0
      last = now
      setPosition(current => {
        const index = Math.min(Math.floor(current), history.length - 1)
        const duration = history[index].event.phase === 'flight' ? 2200 : 1050
        return Math.min(history.length - 1, current + elapsed * speed / duration)
      })
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [playing, speed, history, atEnd])
  function seek(value: number) { setPlaying(false); setPosition(Math.max(0, Math.min(history.length - 1, value))) }
  return { position, cursor, progress: reducedMotion ? 1 : progress, playing: playing && !atEnd, setPlaying, speed, setSpeed, atEnd, seek, setPosition }
}
