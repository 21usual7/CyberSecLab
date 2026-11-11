// predictor.ts — branch direction predictor.
//
// Pluggable behind a tiny interface so a lab can swap it (static, 1-bit,
// 2-bit saturating counters). The 2-bit counter is the default and is what
// makes a branch keep predicting "taken" for a while after the pattern that
// trained it changes — the essence of training a predictor.

export interface Predictor {
  readonly name: string
  // Predict taken/not-taken for the branch at instruction index `pc`.
  predict(pc: number): boolean
  // Update with the resolved outcome.
  update(pc: number, taken: boolean): void
  // Read-only view for the UI.
  state(): { pc: number; value: number; label: string }[]
  reset(): void
}

// 2-bit saturating counters: 0..3. >=2 => predict taken.
export class TwoBitPredictor implements Predictor {
  readonly name = '2-bit saturating'
  private counters = new Map<number, number>()

  predict(pc: number): boolean {
    return (this.counters.get(pc) ?? 1) >= 2
  }

  update(pc: number, taken: boolean) {
    let c = this.counters.get(pc) ?? 1
    c = taken ? Math.min(3, c + 1) : Math.max(0, c - 1)
    this.counters.set(pc, c)
  }

  state() {
    const labels = ['strong NT', 'weak NT', 'weak T', 'strong T']
    return [...this.counters.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pc, value]) => ({ pc, value, label: labels[value] }))
  }

  reset() {
    this.counters.clear()
  }
}

// 1-bit: remembers only the last outcome.
export class OneBitPredictor implements Predictor {
  readonly name = '1-bit last-outcome'
  private bits = new Map<number, boolean>()

  predict(pc: number): boolean {
    return this.bits.get(pc) ?? false
  }

  update(pc: number, taken: boolean) {
    this.bits.set(pc, taken)
  }

  state() {
    return [...this.bits.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pc, t]) => ({ pc, value: t ? 1 : 0, label: t ? 'T' : 'NT' }))
  }

  reset() {
    this.bits.clear()
  }
}

// Always predicts not-taken (forward) — a baseline with no training effect.
export class StaticPredictor implements Predictor {
  readonly name = 'static not-taken'
  predict() {
    return false
  }
  update() {}
  state() {
    return []
  }
  reset() {}
}

export type PredictorKind = '2bit' | '1bit' | 'static'

export function makePredictor(kind: PredictorKind): Predictor {
  if (kind === '1bit') return new OneBitPredictor()
  if (kind === 'static') return new StaticPredictor()
  return new TwoBitPredictor()
}
