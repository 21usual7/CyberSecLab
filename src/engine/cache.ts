// cache.ts — a small set-associative L1 data cache.
//
// This is the component the speculative-execution labs revolve around: a load
// performed on a mispredicted path still fills a line here, and that line is
// NOT removed when the misprediction is squashed. The timings are synthetic
// teaching numbers (hit vs miss), deliberately unlike any real CPU.

export interface CacheConfig {
  sets: number // number of sets (power of two)
  ways: number // associativity
  lineBytes: number // bytes per line (power of two)
  hitLatency: number // ticks
  missLatency: number // ticks
}

export const DEFAULT_CACHE: CacheConfig = {
  sets: 64,
  ways: 4,
  lineBytes: 64,
  hitLatency: 4,
  missLatency: 120,
}

export interface CacheLine {
  tag: number
  valid: boolean
  lru: number // higher = more recently used
  speculative: boolean // filled by a load that later got squashed
}

export type CacheEventKind = 'hit' | 'miss' | 'fill' | 'evict' | 'flush'

export interface CacheEvent {
  tick: number
  kind: CacheEventKind
  addr: number
  set: number
  speculative: boolean
}

export class Cache {
  readonly cfg: CacheConfig
  readonly lines: CacheLine[][] // [set][way]
  events: CacheEvent[] = []
  private clock = 0

  constructor(cfg: CacheConfig = DEFAULT_CACHE) {
    this.cfg = cfg
    this.lines = Array.from({ length: cfg.sets }, () =>
      Array.from({ length: cfg.ways }, () => ({
        tag: 0,
        valid: false,
        lru: 0,
        speculative: false,
      })),
    )
  }

  private setIndex(addr: number): number {
    return Math.floor(addr / this.cfg.lineBytes) % this.cfg.sets
  }

  private tag(addr: number): number {
    return Math.floor(addr / this.cfg.lineBytes / this.cfg.sets)
  }

  // Probe for presence without changing state (used by timing/analysis views).
  present(addr: number): boolean {
    const set = this.lines[this.setIndex(addr)]
    const tag = this.tag(addr)
    return set.some((l) => l.valid && l.tag === tag)
  }

  // Perform an access. Returns the latency in ticks and records events.
  // `speculative` marks a fill done on an unresolved/mispredicted path.
  access(addr: number, tick: number, speculative: boolean): number {
    const si = this.setIndex(addr)
    const set = this.lines[si]
    const tag = this.tag(addr)
    this.clock++

    const hitLine = set.find((l) => l.valid && l.tag === tag)
    if (hitLine) {
      hitLine.lru = this.clock
      // A demand (non-speculative) hit confirms the line is really resident.
      if (!speculative) hitLine.speculative = false
      this.events.push({ tick, kind: 'hit', addr, set: si, speculative })
      return this.cfg.hitLatency
    }

    // Miss: choose an LRU victim and fill.
    let victim = set[0]
    for (const l of set) {
      if (!l.valid) {
        victim = l
        break
      }
      if (l.lru < victim.lru) victim = l
    }
    if (victim.valid)
      this.events.push({
        tick,
        kind: 'evict',
        addr: 0,
        set: si,
        speculative: false,
      })
    victim.valid = true
    victim.tag = tag
    victim.lru = this.clock
    victim.speculative = speculative
    this.events.push({ tick, kind: 'miss', addr, set: si, speculative })
    this.events.push({ tick, kind: 'fill', addr, set: si, speculative })
    return this.cfg.missLatency
  }

  // Explicit line invalidation (clflush).
  flush(addr: number, tick: number) {
    const si = this.setIndex(addr)
    const tag = this.tag(addr)
    for (const l of this.lines[si]) {
      if (l.valid && l.tag === tag) {
        l.valid = false
        l.speculative = false
        this.events.push({
          tick,
          kind: 'flush',
          addr,
          set: si,
          speculative: false,
        })
      }
    }
  }

  snapshotLines(): CacheLine[][] {
    return this.lines.map((set) => set.map((l) => ({ ...l })))
  }
}
