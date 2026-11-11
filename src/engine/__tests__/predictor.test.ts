import { describe, expect, it } from 'vitest'
import { TwoBitPredictor } from '../predictor'

describe('2-bit predictor', () => {
  it('trains towards taken and resists a single flip', () => {
    const p = new TwoBitPredictor()
    // starts weak-not-taken (1) => predicts not taken
    expect(p.predict(10)).toBe(false)
    p.update(10, true) // -> 2 weak taken
    expect(p.predict(10)).toBe(true)
    p.update(10, true) // -> 3 strong taken
    p.update(10, true) // saturate at 3
    // one not-taken shouldn't immediately flip the prediction
    p.update(10, false) // -> 2
    expect(p.predict(10)).toBe(true)
    p.update(10, false) // -> 1
    expect(p.predict(10)).toBe(false)
  })

  it('exposes per-PC state for the UI', () => {
    const p = new TwoBitPredictor()
    p.update(5, true)
    p.update(5, true)
    const s = p.state().find((x) => x.pc === 5)
    expect(s?.label).toBe('strong T')
  })
})
