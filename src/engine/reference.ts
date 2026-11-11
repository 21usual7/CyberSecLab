// reference.ts — a plain in-order interpreter.
//
// It defines the architectural "ground truth": run instructions one at a time,
// no speculation, no cache. The out-of-order core must agree with this on the
// final register/memory state for any program. Used by the differential tests.

import type { Program } from './assembler'
import {
  REGISTERS,
  testCond,
  toWord,
  zeroFlags,
  type Flags,
  type RegName,
} from './isa'

export interface RefResult {
  regs: Record<RegName, number>
  flags: Flags
  mem: Uint8Array
  steps: number
}

export function runReference(program: Program, memSize = 1 << 16): RefResult {
  const regs = {} as Record<RegName, number>
  for (const r of REGISTERS) regs[r] = 0
  const flags = zeroFlags()
  const mem = new Uint8Array(memSize)
  mem.set(program.data.subarray(0, Math.min(program.data.length, memSize)))

  const sym = (name?: string) =>
    name ? (program.dataSymbols[name]?.offset ?? 0) : 0

  const addrOf = (op: Extract<import('./assembler').Operand, { kind: 'mem' }>) => {
    let a = op.disp + sym(op.sym)
    if (op.base) a += regs[op.base]
    if (op.index) a += regs[op.index] * op.scale
    return a >>> 0
  }
  const load = (a: number, size: 1 | 4) => {
    const i = a & (mem.length - 1)
    if (size === 1) return mem[i] ?? 0
    return (
      ((mem[i] ?? 0) |
        ((mem[i + 1] ?? 0) << 8) |
        ((mem[i + 2] ?? 0) << 16) |
        ((mem[i + 3] ?? 0) << 24)) >>>
      0
    )
  }
  const store = (a: number, v: number, size: 1 | 4) => {
    const i = a & (mem.length - 1)
    if (size === 1) mem[i] = v & 0xff
    else {
      mem[i] = v & 0xff
      mem[i + 1] = (v >>> 8) & 0xff
      mem[i + 2] = (v >>> 16) & 0xff
      mem[i + 3] = (v >>> 24) & 0xff
    }
  }

  let pc = 0
  let steps = 0
  const guard = 2_000_000
  while (pc >= 0 && pc < program.instructions.length && steps < guard) {
    steps++
    const inst = program.instructions[pc]
    const ops = inst.operands
    const rv = (name: string) => regs[name as RegName] ?? 0

    const src = (i: number): number => {
      const o = ops[i]
      if (!o) return 0
      if (o.kind === 'reg') return regs[o.name]
      if (o.kind === 'imm') return toWord(o.value)
      if (o.kind === 'mem') return load(addrOf(o), o.size)
      return 0
    }

    let next = pc + 1
    switch (inst.mnemonic) {
      case 'mov': {
        const d = ops[0]
        if (d.kind === 'reg') regs[d.name] = toWord(src(1))
        else if (d.kind === 'mem') store(addrOf(d), src(1), d.size)
        break
      }
      case 'add':
      case 'sub':
      case 'and':
      case 'or':
      case 'xor':
      case 'shl':
      case 'shr': {
        const d = ops[0]
        if (d.kind === 'reg') {
          const { value } = alu(inst.mnemonic, rv(d.name), src(1))
          const f = alu(inst.mnemonic, rv(d.name), src(1)).flags
          regs[d.name] = value
          Object.assign(flags, f)
        }
        break
      }
      case 'cmp':
      case 'test': {
        const a = src(0)
        const b = src(1)
        const { flags: f } = alu(inst.mnemonic === 'test' ? 'test' : 'sub', a, b)
        Object.assign(flags, f)
        break
      }
      case 'jmp':
        next = resolve(ops[0])
        break
      case 'jz':
      case 'je':
        if (testCond('z', flags)) next = resolve(ops[0])
        break
      case 'jnz':
      case 'jne':
        if (testCond('nz', flags)) next = resolve(ops[0])
        break
      case 'jb':
      case 'jc':
        if (testCond('b', flags)) next = resolve(ops[0])
        break
      case 'jae':
      case 'jnc':
        if (testCond('ae', flags)) next = resolve(ops[0])
        break
      case 'jl':
        if (testCond('l', flags)) next = resolve(ops[0])
        break
      case 'jge':
        if (testCond('ge', flags)) next = resolve(ops[0])
        break
      case 'hlt':
        next = -1
        break
      // clflush / lfence / mfence / rdtsc / nop have no architectural effect
      // here, except rdtsc which we define as returning 0 in the reference.
      case 'rdtsc':
        regs.rax = 0
        break
      default:
        break
    }
    pc = next
  }

  function resolve(o: import('./assembler').Operand | undefined): number {
    if (o?.kind === 'label') return program.labels[o.name] ?? -1
    return -1
  }

  return { regs, flags, mem, steps }
}

function alu(
  op: string,
  a: number,
  b: number,
): { value: number; flags: Flags } {
  a >>>= 0
  b >>>= 0
  let r = 0
  const f = zeroFlags()
  switch (op) {
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
  if (op === 'add') {
    const sa = a & 0x80000000,
      sb = b & 0x80000000,
      sr = r & 0x80000000
    f.of = sa === sb && sa !== sr
  } else if (op === 'sub') {
    const sa = a & 0x80000000,
      sb = b & 0x80000000,
      sr = r & 0x80000000
    f.of = sa !== sb && sa !== sr
  }
  return { value: r, flags: f }
}
