import { describe, expect, it } from 'vitest'
import { Cache } from '../cache'

describe('cache', () => {
  it('misses then hits', () => {
    const c = new Cache({ sets: 4, ways: 2, lineBytes: 64, hitLatency: 4, missLatency: 100 })
    expect(c.access(0, 1, false)).toBe(100) // miss fill
    expect(c.access(0, 2, false)).toBe(4) // hit
    expect(c.present(0)).toBe(true)
  })

  it('evicts LRU within a set', () => {
    const c = new Cache({ sets: 1, ways: 2, lineBytes: 64, hitLatency: 4, missLatency: 100 })
    c.access(0, 1, false) // way for line 0
    c.access(64, 2, false) // line 1
    c.access(0, 3, false) // touch line 0 (now MRU)
    c.access(128, 4, false) // line 2 evicts LRU (line 1)
    expect(c.present(0)).toBe(true)
    expect(c.present(64)).toBe(false)
    expect(c.present(128)).toBe(true)
  })

  it('flush removes a line', () => {
    const c = new Cache({ sets: 4, ways: 2, lineBytes: 64, hitLatency: 4, missLatency: 100 })
    c.access(256, 1, false)
    expect(c.present(256)).toBe(true)
    c.flush(256, 2)
    expect(c.present(256)).toBe(false)
  })

  it('marks speculative fills', () => {
    const c = new Cache({ sets: 4, ways: 2, lineBytes: 64, hitLatency: 4, missLatency: 100 })
    c.access(512, 1, true)
    const fill = c.events.find((e) => e.kind === 'fill')
    expect(fill?.speculative).toBe(true)
  })
})
