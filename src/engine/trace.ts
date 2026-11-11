// trace.ts — the shapes the UI reads, plus a bounded history of per-tick
// snapshots so the user can step forward and backward through time.

import type { CacheEvent } from './cache'
import type { Flags, RegName } from './isa'
import type { UopKind } from './microcode'

export type UopPhase =
  | 'fetch'
  | 'rename'
  | 'ready' // waiting for operands / in issue queue
  | 'exec'
  | 'done' // finished executing, awaiting commit
  | 'committed'
  | 'squashed'

// A single in-flight µop as the pipeline/ROB views need it.
export interface UopView {
  seq: number
  uid: number
  instAddr: number
  line: number
  kind: UopKind
  label: string
  phase: UopPhase
  speculative: boolean // on an unresolved/mispredicted path
  predictedTaken?: boolean
  actualTaken?: boolean
  mispredicted?: boolean
  addr?: number // resolved memory address
}

export interface CacheLineView {
  valid: boolean
  tag: number
  speculative: boolean
}

export interface Snapshot {
  tick: number
  halted: boolean
  fetchInst: number // next instruction to fetch (-1 if none)
  committedInst: number // last committed instruction index (-1 none)
  arch: Record<RegName, number>
  flags: Flags
  uops: UopView[] // in-flight (not yet committed/squashed drop off next tick)
  committedCount: number
  squashedCount: number
  predictor: { pc: number; value: number; label: string }[]
  cache: CacheLineView[][] // [set][way]
  cacheEvents: CacheEvent[] // events generated during this tick
  note?: string // short human note, e.g. "misprediction on branch @7"
}

// Ring-buffer-ish history with a hard cap. For teaching-sized programs the cap
// is generous; past it we stop recording detailed snapshots.
export class Trace {
  snapshots: Snapshot[] = []
  readonly cap: number
  constructor(cap: number) {
    this.cap = cap
  }

  push(s: Snapshot) {
    if (this.snapshots.length < this.cap) this.snapshots.push(s)
  }

  get length() {
    return this.snapshots.length
  }

  at(i: number): Snapshot | undefined {
    return this.snapshots[Math.max(0, Math.min(i, this.snapshots.length - 1))]
  }

  last(): Snapshot | undefined {
    return this.snapshots[this.snapshots.length - 1]
  }
}
