// core.ts — the out-of-order core.
//
// A deliberately small, deterministic Tomasulo-style machine:
//   Fetch (follows the branch predictor) -> Rename (RAT + physical registers)
//   -> ROB + issue queue -> Execute (ALU 1 tick, loads via the cache)
//   -> Commit in program order.
//
// The one micro-architectural effect the labs hinge on: a load on a
// mispredicted path still runs and fills the cache, and squashing the
// misprediction does NOT undo that cache fill. Everything is synthetic and
// in-tab; no real instructions execute and no host timer is ever read.

import { assemble, type Program } from './assembler'
import { Cache, DEFAULT_CACHE, type CacheConfig, type CacheEvent } from './cache'
import {
  REGISTERS,
  testCond,
  toWord,
  zeroFlags,
  type Flags,
  type RegName,
} from './isa'
import { decode, type Uop } from './microcode'
import { makePredictor, type Predictor, type PredictorKind } from './predictor'
import { Trace, type Snapshot, type UopPhase, type UopView } from './trace'

export interface CoreConfig {
  fetchWidth: number
  robSize: number
  issueWidth: number
  physRegs: number
  memSize: number // power of two
  cache: CacheConfig
  predictor: PredictorKind
  maxTicks: number
}

export const DEFAULT_CONFIG: CoreConfig = {
  fetchWidth: 2,
  robSize: 32,
  issueWidth: 2,
  physRegs: 96,
  memSize: 1 << 16, // 64 KiB
  cache: DEFAULT_CACHE,
  predictor: '2bit',
  maxTicks: 8000,
}

const FLAGS_REG = '#flags'

interface Phys {
  value: number
  ready: boolean
}

interface Dyn {
  seq: number
  uop: Uop
  // rename results
  srcPhys: number[]
  dstPhys?: number
  oldDstPhys?: number
  flagsSrc?: number
  flagsDst?: number
  oldFlagsPhys?: number
  // branch recovery snapshot
  ratSnap?: Map<string, number>
  freeSnap?: number[]
  // state
  phase: UopPhase
  execRemaining: number
  addr?: number
  result?: number
  flagsResult?: Flags
  // branch
  predictedTaken?: boolean
  actualTaken?: boolean
  mispredicted?: boolean
  speculative: boolean
}

export class Core {
  readonly cfg: CoreConfig
  readonly program: Program
  readonly trace: Trace
  private uopsByInst: Uop[][]
  private phys: Phys[]
  private freeList: number[]
  private rat: Map<string, number>
  private cache: Cache
  private predictor: Predictor
  private mem: Uint8Array

  private rob: Dyn[] = []
  private fetchBuf: Dyn[] = []
  private fetchInst = 0
  private seqCounter = 0
  private committedCount = 0
  private squashedCount = 0
  private committedInst = -1
  private halted = false
  private tick = 0
  private pendingNote?: string

  constructor(program: Program, cfg: CoreConfig = DEFAULT_CONFIG) {
    this.program = program
    this.cfg = cfg
    this.trace = new Trace(cfg.maxTicks + 2)
    this.cache = new Cache(cfg.cache)
    this.predictor = makePredictor(cfg.predictor)
    this.mem = new Uint8Array(cfg.memSize)
    this.mem.set(program.data.subarray(0, Math.min(program.data.length, cfg.memSize)))

    // Group static µops by instruction address for fetch.
    const decoded = decode(program.instructions, (name) => program.labels[name] ?? -1)
    this.uopsByInst = []
    for (const inst of program.instructions) this.uopsByInst[inst.addr] = []
    for (const u of decoded.uops) this.uopsByInst[u.instAddr].push(u)

    // Physical register file + free list + RAT seeded with architectural regs.
    this.phys = Array.from({ length: cfg.physRegs }, () => ({
      value: 0,
      ready: true,
    }))
    this.freeList = []
    for (let i = cfg.physRegs - 1; i >= 0; i--) this.freeList.push(i)
    this.rat = new Map()
    for (const r of REGISTERS) this.rat.set(r, this.alloc(0, true))
    this.rat.set(FLAGS_REG, this.alloc(0, true))

    this.record() // initial snapshot (tick 0)
  }

  static fromSource(source: string, cfg?: CoreConfig): Core {
    return new Core(assemble(source), cfg)
  }

  private alloc(value: number, ready: boolean): number {
    const p = this.freeList.pop()
    if (p === undefined) throw new Error('physical register file exhausted')
    this.phys[p] = { value, ready }
    return p
  }

  private freePhys(p: number | undefined) {
    if (p === undefined) return
    this.freeList.push(p)
  }

  // ---- memory helpers (simulated address space only) ----
  private memLoad(addr: number, size: 1 | 4): number {
    const a = addr & (this.mem.length - 1)
    if (size === 1) return this.mem[a] ?? 0
    return (
      ((this.mem[a] ?? 0) |
        ((this.mem[a + 1] ?? 0) << 8) |
        ((this.mem[a + 2] ?? 0) << 16) |
        ((this.mem[a + 3] ?? 0) << 24)) >>>
      0
    )
  }

  private memStore(addr: number, value: number, size: 1 | 4) {
    const a = addr & (this.mem.length - 1)
    if (size === 1) {
      this.mem[a] = value & 0xff
    } else {
      this.mem[a] = value & 0xff
      this.mem[a + 1] = (value >>> 8) & 0xff
      this.mem[a + 2] = (value >>> 16) & 0xff
      this.mem[a + 3] = (value >>> 24) & 0xff
    }
  }

  private effectiveAddr(d: Dyn): number {
    const m = d.uop.mem!
    let a = m.disp
    if (m.sym) a += this.program.dataSymbols[m.sym]?.offset ?? 0
    if (m.base) a += this.readSrcByName(d, m.base)
    if (m.index) a += this.readSrcByName(d, m.index) * m.scale
    return a >>> 0
  }

  // Read a renamed source value for a given arch/temp name used by this µop.
  private readSrcByName(d: Dyn, name: string): number {
    const i = d.uop.src.indexOf(name)
    if (i >= 0) return this.phys[d.srcPhys[i]].value
    const p = this.rat.get(name)
    return p !== undefined ? this.phys[p].value : 0
  }

  // ===================== the per-tick pipeline =====================

  step(): boolean {
    if (this.halted) return false
    this.tick++
    this.pendingNote = undefined

    this.commitStage()
    this.completeStage()
    this.issueStage()
    this.renameStage()
    this.fetchStage()

    this.record()

    if (
      this.rob.length === 0 &&
      this.fetchBuf.length === 0 &&
      (this.fetchInst < 0 || this.fetchInst >= this.program.instructions.length)
    ) {
      this.halted = true
    }
    if (this.tick >= this.cfg.maxTicks) this.halted = true
    return !this.halted
  }

  run(): void {
    let guard = this.cfg.maxTicks + 4
    while (this.step() && guard-- > 0) {
      /* advance */
    }
  }

  // ---- fetch ----
  private fetchStage() {
    let fetched = 0
    while (
      fetched < this.cfg.fetchWidth &&
      this.rob.length + this.fetchBuf.length < this.cfg.robSize &&
      this.fetchInst >= 0 &&
      this.fetchInst < this.program.instructions.length
    ) {
      const group = this.uopsByInst[this.fetchInst] ?? []
      let branchTaken: boolean | undefined
      let branchPred: boolean | undefined
      for (const u of group) {
        const d: Dyn = {
          seq: this.seqCounter++,
          uop: u,
          srcPhys: [],
          phase: 'fetch',
          execRemaining: 0,
          speculative: this.hasUnresolvedBranch(),
        }
        if (u.kind === 'BR') {
          if (u.uncond) {
            d.predictedTaken = true
            branchTaken = true
          } else {
            const p = this.predictor.predict(u.instAddr)
            d.predictedTaken = p
            branchPred = p
            branchTaken = p
          }
        }
        this.fetchBuf.push(d)
        fetched++
      }
      void branchPred
      // Next instruction to fetch.
      if (branchTaken !== undefined) {
        const brUop = group.find((g) => g.kind === 'BR')!
        this.fetchInst = branchTaken ? brUop.target ?? -1 : this.fetchInst + 1
      } else {
        this.fetchInst = this.fetchInst + 1
      }
      if (group.some((g) => g.kind === 'HLT')) {
        this.fetchInst = -1
        break
      }
    }
  }

  private hasUnresolvedBranch(): boolean {
    return this.rob.some(
      (d) => d.uop.kind === 'BR' && d.phase !== 'done' && d.phase !== 'committed',
    )
  }

  // ---- rename ----
  private renameStage() {
    let renamed = 0
    while (renamed < this.cfg.fetchWidth && this.fetchBuf.length > 0) {
      if (this.rob.length >= this.cfg.robSize) break
      const d = this.fetchBuf.shift()!
      const u = d.uop
      // Resolve sources via RAT.
      d.srcPhys = u.src.map((name) => this.rat.get(name) ?? this.zeroReg())
      if (u.readsFlags) d.flagsSrc = this.rat.get(FLAGS_REG)
      // Snapshot for branch recovery (captured BEFORE allocating this µop's
      // own destination; we restore to the state younger instructions saw).
      if (u.kind === 'BR') {
        d.ratSnap = new Map(this.rat)
        d.freeSnap = [...this.freeList]
      }
      // Allocate destination(s).
      if (u.dst) {
        d.oldDstPhys = this.rat.get(u.dst)
        d.dstPhys = this.alloc(0, false)
        this.rat.set(u.dst, d.dstPhys)
      }
      if (u.writesFlags) {
        d.oldFlagsPhys = this.rat.get(FLAGS_REG)
        d.flagsDst = this.alloc(0, false)
        this.rat.set(FLAGS_REG, d.flagsDst)
      }
      d.phase = 'ready'
      this.rob.push(d)
      renamed++
    }
  }

  private zeroReg(): number {
    // A read of a never-written name: return a ready zero register.
    const p = this.freeList.length ? this.freeList[this.freeList.length - 1] : 0
    this.phys[p] = { value: 0, ready: true }
    return p
  }

  // ---- issue: start executing ready µops whose operands are available ----
  private issueStage() {
    let issued = 0
    for (const d of this.rob) {
      if (issued >= this.cfg.issueWidth) break
      if (d.phase !== 'ready') continue
      if (!this.operandsReady(d)) continue
      if (!this.memoryOrderOk(d)) continue
      // lfence/mfence is a dispatch barrier: it only executes once older µops
      // are done, and nothing younger may execute while it is pending. This is
      // exactly what makes `lfence` a usable defence against the v1 gadget.
      if (d.uop.kind === 'FENCE') {
        if (!this.fenceClear(d)) continue
      } else if (this.blockedByOlderFence(d)) {
        continue
      }
      this.beginExecute(d)
      issued++
    }
  }

  private operandsReady(d: Dyn): boolean {
    for (const p of d.srcPhys) if (!this.phys[p].ready) return false
    if (d.flagsSrc !== undefined && !this.phys[d.flagsSrc].ready) return false
    return true
  }

  // Conservative memory ordering: a load/store waits until all older stores
  // have committed. Keeps architectural results correct without a store buffer,
  // while still letting loads run speculatively past branches.
  private memoryOrderOk(d: Dyn): boolean {
    if (d.uop.kind !== 'LOAD' && d.uop.kind !== 'STORE') return true
    for (const o of this.rob) {
      if (o.seq >= d.seq) break
      if (o.uop.kind === 'STORE') return false
    }
    return true
  }

  // lfence/mfence: do not execute until all older µops are done.
  private fenceClear(d: Dyn): boolean {
    for (const o of this.rob) {
      if (o.seq >= d.seq) break
      if (o.phase !== 'done') return false
    }
    return true
  }

  // A µop is held back while an older, not-yet-retired fence sits ahead of it.
  private blockedByOlderFence(d: Dyn): boolean {
    for (const o of this.rob) {
      if (o.seq >= d.seq) break
      if (o.uop.kind === 'FENCE' && o.phase !== 'done') return true
    }
    return false
  }

  private beginExecute(d: Dyn) {
    const u = d.uop
    d.phase = 'exec'
    switch (u.kind) {
      case 'LOAD': {
        d.addr = this.effectiveAddr(d)
        const spec = this.isSpeculative(d)
        d.speculative = spec
        const lat = this.cache.access(d.addr, this.tick, spec)
        d.result = this.memLoad(d.addr, u.mem!.size)
        d.execRemaining = lat
        break
      }
      case 'STORE': {
        d.addr = this.effectiveAddr(d)
        d.execRemaining = 1 // committed to memory at retire, not now
        break
      }
      case 'CLFLUSH': {
        d.addr = this.effectiveAddr(d)
        d.execRemaining = 1
        break
      }
      case 'ALU':
      case 'CMP': {
        const { value, flags } = this.computeAlu(d)
        d.result = value
        d.flagsResult = flags
        d.execRemaining = 1
        break
      }
      case 'MOV': {
        d.result =
          u.imm !== undefined ? toWord(u.imm) : this.phys[d.srcPhys[0]].value
        d.execRemaining = 1
        break
      }
      case 'RDTSC': {
        d.result = this.tick // simulated cycle counter
        d.execRemaining = 1
        break
      }
      case 'BR': {
        d.actualTaken = u.uncond
          ? true
          : testCond(u.cond!, this.flagsFromPhys(d.flagsSrc))
        d.execRemaining = 1
        break
      }
      case 'FENCE':
      case 'NOP':
        d.execRemaining = 1
        break
      case 'HLT':
        d.execRemaining = 1
        break
    }
  }

  private isSpeculative(d: Dyn): boolean {
    for (const o of this.rob) {
      if (o.seq >= d.seq) break
      if (o.uop.kind === 'BR' && o.phase !== 'done' && o.phase !== 'committed')
        return true
    }
    return false
  }

  private flagsFromPhys(p: number | undefined): Flags {
    if (p === undefined) return zeroFlags()
    const v = this.phys[p].value
    return {
      zf: (v & 1) !== 0,
      cf: (v & 2) !== 0,
      sf: (v & 4) !== 0,
      of: (v & 8) !== 0,
    }
  }

  private flagsToWord(f: Flags): number {
    return (f.zf ? 1 : 0) | (f.cf ? 2 : 0) | (f.sf ? 4 : 0) | (f.of ? 8 : 0)
  }

  private computeAlu(d: Dyn): { value: number; flags: Flags } {
    const u = d.uop
    const a = this.phys[d.srcPhys[0]].value >>> 0
    const b =
      u.imm !== undefined
        ? toWord(u.imm)
        : (this.phys[d.srcPhys[1]]?.value ?? 0) >>> 0
    let r = 0
    const f = zeroFlags()
    switch (u.alu) {
      case 'add':
        r = (a + b) >>> 0
        f.cf = a + b > 0xffffffff
        break
      case 'sub':
        r = (a - b) >>> 0
        f.cf = a < b
        break
      case 'and':
      case 'test':
        r = (a & b) >>> 0
        break
      case 'or':
        r = (a | b) >>> 0
        break
      case 'xor':
        r = (a ^ b) >>> 0
        break
      case 'shl':
        r = (a << (b & 31)) >>> 0
        break
      case 'shr':
        r = a >>> (b & 31)
        break
    }
    f.zf = r === 0
    f.sf = (r & 0x80000000) !== 0
    // Signed overflow for add/sub (teaching approximation).
    if (u.alu === 'add') {
      const sa = a & 0x80000000,
        sb = b & 0x80000000,
        sr = r & 0x80000000
      f.of = sa === sb && sa !== sr
    } else if (u.alu === 'sub') {
      const sa = a & 0x80000000,
        sb = b & 0x80000000,
        sr = r & 0x80000000
      f.of = sa !== sb && sa !== sr
    }
    return { value: r, flags: f }
  }

  // ---- complete: advance executing µops, write back on completion ----
  private completeStage() {
    for (const d of this.rob) {
      if (d.phase !== 'exec') continue
      d.execRemaining--
      if (d.execRemaining > 0) continue
      d.phase = 'done'
      if (d.dstPhys !== undefined) {
        this.phys[d.dstPhys].value = d.result ?? 0
        this.phys[d.dstPhys].ready = true
      }
      if (d.flagsDst !== undefined && d.flagsResult) {
        this.phys[d.flagsDst].value = this.flagsToWord(d.flagsResult)
        this.phys[d.flagsDst].ready = true
      }
      if (d.uop.kind === 'BR') this.resolveBranch(d)
    }
  }

  private resolveBranch(d: Dyn) {
    const predicted = d.predictedTaken ?? false
    const actual = d.actualTaken ?? false
    if (!d.uop.uncond) this.predictor.update(d.uop.instAddr, actual)
    if (predicted === actual) return
    // Misprediction: squash everything younger, restore maps, redirect fetch.
    d.mispredicted = true
    this.squashYoungerThan(d)
    if (d.ratSnap) this.rat = new Map(d.ratSnap)
    if (d.freeSnap) this.freeList = [...d.freeSnap]
    this.fetchBuf = []
    this.fetchInst = actual ? d.uop.target ?? -1 : d.uop.instAddr + 1
    this.pendingNote = `misprediction on branch @${d.uop.instAddr} (predicted ${
      predicted ? 'taken' : 'not-taken'
    }, actually ${actual ? 'taken' : 'not-taken'}) — squashed speculative µops; cache fills remain`
  }

  private squashYoungerThan(br: Dyn) {
    const survivors: Dyn[] = []
    for (const d of this.rob) {
      if (d.seq <= br.seq) {
        survivors.push(d)
        continue
      }
      d.phase = 'squashed'
      this.squashedCount++
      // The RAT was restored from the branch snapshot, so these destinations
      // are no longer referenced; return them to the pool.
      this.freePhys(d.dstPhys)
      this.freePhys(d.flagsDst)
    }
    this.rob = survivors
  }

  // ---- commit: retire the ROB head in program order ----
  private commitStage() {
    let committed = 0
    while (committed < this.cfg.issueWidth && this.rob.length > 0) {
      const d = this.rob[0]
      if (d.phase !== 'done') break
      // Apply architectural side effects that must not be speculative.
      if (d.uop.kind === 'STORE') {
        const val =
          d.uop.imm !== undefined
            ? toWord(d.uop.imm)
            : this.phys[d.srcPhys[d.srcPhys.length - 1]].value
        this.memStore(d.addr!, val, d.uop.mem!.size)
      } else if (d.uop.kind === 'CLFLUSH') {
        this.cache.flush(d.addr!, this.tick)
      }
      // Free the physical register this µop overwrote.
      this.freePhys(d.oldDstPhys)
      this.freePhys(d.oldFlagsPhys)
      d.phase = 'committed'
      this.committedCount++
      this.committedInst = d.uop.instAddr
      this.rob.shift()
      committed++
      if (d.uop.kind === 'HLT') {
        this.halted = true
        break
      }
    }
  }

  // ===================== snapshot for the UI =====================

  private archRegs(): Record<RegName, number> {
    const out = {} as Record<RegName, number>
    for (const r of REGISTERS) {
      const p = this.rat.get(r)
      out[r] = p !== undefined && this.phys[p].ready ? this.phys[p].value : (p !== undefined ? this.phys[p].value : 0)
    }
    return out
  }

  private record() {
    const before = this.cache.events.length
    // Events accumulate in the cache; slice out those from this tick.
    const events: CacheEvent[] = this.cache.events.filter(
      (e) => e.tick === this.tick,
    )
    void before

    const uops: UopView[] = this.rob.map((d) => this.viewOf(d))

    this.trace.push({
      tick: this.tick,
      halted: this.halted,
      fetchInst: this.fetchInst,
      committedInst: this.committedInst,
      arch: this.archRegs(),
      flags: this.flagsFromPhys(this.rat.get(FLAGS_REG)),
      uops,
      committedCount: this.committedCount,
      squashedCount: this.squashedCount,
      predictor: this.predictor.state(),
      cache: this.cache.snapshotLines().map((set) =>
        set.map((l) => ({ valid: l.valid, tag: l.tag, speculative: l.speculative })),
      ),
      cacheEvents: events,
      note: this.pendingNote,
    })
  }

  private viewOf(d: Dyn): UopView {
    const phaseMap: Record<string, UopPhase> = {
      fetch: 'fetch',
      rename: 'rename',
      ready: 'ready',
      exec: 'exec',
      done: 'done',
      committed: 'committed',
      squashed: 'squashed',
    }
    return {
      seq: d.seq,
      uid: d.uop.uid,
      instAddr: d.uop.instAddr,
      line: this.program.instructions[d.uop.instAddr]?.line ?? 0,
      kind: d.uop.kind,
      label: d.uop.label,
      phase: phaseMap[d.phase],
      speculative: this.isSpeculative(d),
      predictedTaken: d.predictedTaken,
      actualTaken: d.actualTaken,
      mispredicted: d.mispredicted,
      addr: d.addr,
    }
  }

  // Convenience for tests / headless use.
  get snapshots(): Snapshot[] {
    return this.trace.snapshots
  }
  get finalArch(): Record<RegName, number> {
    return this.archRegs()
  }
  get finalCache(): Cache {
    return this.cache
  }
  get memory(): Uint8Array {
    return this.mem
  }
  isHalted(): boolean {
    return this.halted
  }
}
