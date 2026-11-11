// microcode.ts — decode one architectural instruction into one or more µops.
//
// This is the "microcode" layer the UI shows: e.g. `add rax, [mem]` becomes a
// LOAD into a temporary followed by an ADD that consumes it. Memory-form ALU,
// loads, stores and branches all become explicit µops with clear data
// dependencies, which is what the out-of-order core schedules.

import type { Instruction, Operand } from './assembler'

export type UopKind =
  | 'LOAD'
  | 'STORE'
  | 'MOV'
  | 'ALU'
  | 'CMP'
  | 'BR'
  | 'FENCE'
  | 'RDTSC'
  | 'CLFLUSH'
  | 'NOP'
  | 'HLT'

export interface MemRef {
  base?: string
  index?: string
  scale: number
  disp: number
  sym?: string
  size: 1 | 4
}

export interface Uop {
  uid: number // unique id across the decoded stream
  instAddr: number // source instruction index
  seq: number // position within the instruction's µop expansion
  kind: UopKind
  src: string[] // source register names (arch or temp)
  dst?: string // destination register name (arch or temp)
  alu?: 'add' | 'sub' | 'and' | 'or' | 'xor' | 'shl' | 'shr' | 'test'
  imm?: number
  mem?: MemRef
  cond?: 'z' | 'nz' | 'b' | 'ae' | 'l' | 'ge'
  uncond?: boolean
  target?: number // branch target instruction index
  readsFlags: boolean
  writesFlags: boolean
  label: string // human-readable text for the pipeline view
}

function memRefOf(op: Extract<Operand, { kind: 'mem' }>): MemRef {
  return {
    base: op.base,
    index: op.index,
    scale: op.scale,
    disp: op.disp,
    sym: op.sym,
    size: op.size,
  }
}

function memSources(m: MemRef): string[] {
  const s: string[] = []
  if (m.base) s.push(m.base)
  if (m.index) s.push(m.index)
  return s
}

// Decode the whole program's .text into a flat µop list plus a map from each
// instruction index to its µop ids (for highlighting). Branch targets stay as
// instruction indices; the core maps them to the first µop of that instruction.
export interface DecodedProgram {
  uops: Uop[]
  firstUopOfInst: number[] // instAddr -> index into uops of its first µop
}

export function decode(
  instructions: Instruction[],
  resolveLabel: (name: string) => number,
): DecodedProgram {
  const uops: Uop[] = []
  const firstUopOfInst: number[] = []
  let uid = 0

  const emit = (u: Omit<Uop, 'uid'>): Uop => {
    const full = { ...u, uid: uid++ }
    uops.push(full)
    return full
  }

  for (const inst of instructions) {
    firstUopOfInst[inst.addr] = uops.length
    const ops = inst.operands
    const temp = `#t${inst.addr}`

    switch (inst.mnemonic) {
      case 'nop':
        emit(mk(inst, 0, 'NOP', { label: 'nop' }))
        break
      case 'hlt':
        emit(mk(inst, 0, 'HLT', { label: 'hlt' }))
        break
      case 'lfence':
      case 'mfence':
        emit(mk(inst, 0, 'FENCE', { label: inst.mnemonic }))
        break
      case 'rdtsc':
        // Returns the simulated tick counter into rax.
        emit(mk(inst, 0, 'RDTSC', { dst: 'rax', label: 'rdtsc -> rax' }))
        break
      case 'clflush': {
        const m = ops[0]
        if (m?.kind === 'mem')
          emit(
            mk(inst, 0, 'CLFLUSH', {
              mem: memRefOf(m),
              src: memSources(memRefOf(m)),
              label: `clflush ${inst.text.replace(/^clflush\s+/, '')}`,
            }),
          )
        break
      }
      case 'mov':
        decodeMov(inst, emit)
        break
      case 'cmp':
      case 'test':
        decodeCmp(inst, emit, temp)
        break
      case 'jmp': {
        const t = ops[0]
        const target = t?.kind === 'label' ? resolveLabel(t.name) : -1
        emit(
          mk(inst, 0, 'BR', {
            uncond: true,
            target,
            label: inst.text,
          }),
        )
        break
      }
      case 'jz':
      case 'je':
      case 'jnz':
      case 'jne':
      case 'jb':
      case 'jc':
      case 'jae':
      case 'jnc':
      case 'jl':
      case 'jge': {
        const t = ops[0]
        const target = t?.kind === 'label' ? resolveLabel(t.name) : -1
        emit(
          mk(inst, 0, 'BR', {
            cond: condOf(inst.mnemonic),
            target,
            readsFlags: true,
            label: inst.text,
          }),
        )
        break
      }
      default:
        decodeAlu(inst, emit, temp)
    }
  }

  return { uops, firstUopOfInst }
}

function mk(
  inst: Instruction,
  seq: number,
  kind: UopKind,
  extra: Partial<Uop>,
): Omit<Uop, 'uid'> {
  return {
    instAddr: inst.addr,
    seq,
    kind,
    src: [],
    readsFlags: false,
    writesFlags: false,
    label: inst.text,
    ...extra,
  }
}

function condOf(m: string): Uop['cond'] {
  if (m === 'jz' || m === 'je') return 'z'
  if (m === 'jnz' || m === 'jne') return 'nz'
  if (m === 'jb' || m === 'jc') return 'b'
  if (m === 'jae' || m === 'jnc') return 'ae'
  if (m === 'jl') return 'l'
  return 'ge'
}

type Emit = (u: Omit<Uop, 'uid'>) => Uop

function decodeMov(inst: Instruction, emit: Emit) {
  const [dst, srcOp] = inst.operands
  if (dst?.kind === 'mem') {
    // STORE [mem], reg/imm
    const m = memRefOf(dst)
    const src = memSources(m)
    if (srcOp?.kind === 'reg') src.push(srcOp.name)
    emit(
      mk(inst, 0, 'STORE', {
        mem: m,
        src,
        imm: srcOp?.kind === 'imm' ? srcOp.value : undefined,
        label: inst.text,
      }),
    )
    return
  }
  if (dst?.kind === 'reg') {
    if (srcOp?.kind === 'mem') {
      const m = memRefOf(srcOp)
      emit(
        mk(inst, 0, 'LOAD', {
          dst: dst.name,
          mem: m,
          src: memSources(m),
          label: inst.text,
        }),
      )
    } else if (srcOp?.kind === 'reg') {
      emit(
        mk(inst, 0, 'MOV', {
          dst: dst.name,
          src: [srcOp.name],
          label: inst.text,
        }),
      )
    } else if (srcOp?.kind === 'imm') {
      emit(
        mk(inst, 0, 'MOV', {
          dst: dst.name,
          imm: srcOp.value,
          label: inst.text,
        }),
      )
    }
  }
}

function aluKindOf(m: string): Uop['alu'] {
  return m as Uop['alu']
}

function decodeAlu(inst: Instruction, emit: Emit, temp: string) {
  const [dst, srcOp] = inst.operands
  if (dst?.kind !== 'reg') return
  const alu = aluKindOf(inst.mnemonic)
  if (srcOp?.kind === 'mem') {
    // LOAD temp, [mem] ; ALU dst = dst (op) temp
    const m = memRefOf(srcOp)
    emit(
      mk(inst, 0, 'LOAD', {
        dst: temp,
        mem: m,
        src: memSources(m),
        label: `load ${temp} <- mem`,
      }),
    )
    emit(
      mk(inst, 1, 'ALU', {
        dst: dst.name,
        alu,
        src: [dst.name, temp],
        writesFlags: true,
        label: `${inst.mnemonic} ${dst.name}, ${temp}`,
      }),
    )
    return
  }
  emit(
    mk(inst, 0, 'ALU', {
      dst: dst.name,
      alu,
      src: [dst.name, ...(srcOp?.kind === 'reg' ? [srcOp.name] : [])],
      imm: srcOp?.kind === 'imm' ? srcOp.value : undefined,
      writesFlags: true,
      label: inst.text,
    }),
  )
}

function decodeCmp(inst: Instruction, emit: Emit, temp: string) {
  const [a, b] = inst.operands
  const alu = inst.mnemonic === 'test' ? 'test' : 'sub'
  if (a?.kind === 'reg' && b?.kind === 'mem') {
    const m = memRefOf(b)
    emit(
      mk(inst, 0, 'LOAD', {
        dst: temp,
        mem: m,
        src: memSources(m),
        label: `load ${temp} <- mem`,
      }),
    )
    emit(
      mk(inst, 1, 'CMP', {
        alu,
        src: [a.name, temp],
        writesFlags: true,
        label: `${inst.mnemonic} ${a.name}, ${temp}`,
      }),
    )
    return
  }
  const src: string[] = []
  if (a?.kind === 'reg') src.push(a.name)
  if (b?.kind === 'reg') src.push(b.name)
  emit(
    mk(inst, 0, 'CMP', {
      alu,
      src,
      imm: b?.kind === 'imm' ? b.value : undefined,
      writesFlags: true,
      label: inst.text,
    }),
  )
}
