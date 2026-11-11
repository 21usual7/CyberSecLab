// isa.ts — instruction set of the educational CPU.
//
// This is an INVENTED, x86-flavoured teaching ISA. Mnemonics and Intel-style
// syntax are borrowed so the assembly looks familiar, but the encoding,
// timings and semantics are our own and do not match any real processor.
// Programs written here run only inside the in-browser simulator.

export const REGISTERS = [
  'rax',
  'rbx',
  'rcx',
  'rdx',
  'rsi',
  'rdi',
  'r8',
  'r9',
] as const

export type RegName = (typeof REGISTERS)[number]

export function isReg(name: string): name is RegName {
  return (REGISTERS as readonly string[]).includes(name)
}

// Architectural flags.
export interface Flags {
  zf: boolean // zero
  cf: boolean // carry / unsigned-below
  sf: boolean // sign
  of: boolean // signed overflow
}

export function zeroFlags(): Flags {
  return { zf: false, cf: false, sf: false, of: false }
}

// Each mnemonic maps to a kind the decoder understands.
export type OpKind =
  | 'mov'
  | 'alu' // add, sub, and, or, xor, shl, shr
  | 'cmp' // cmp, test (sets flags, no writeback)
  | 'jmp' // unconditional
  | 'jcc' // conditional branch
  | 'clflush'
  | 'fence' // lfence / mfence
  | 'rdtsc'
  | 'nop'
  | 'hlt'

export interface OpInfo {
  kind: OpKind
  // For alu/cmp: the arithmetic operation.
  alu?: 'add' | 'sub' | 'and' | 'or' | 'xor' | 'shl' | 'shr' | 'test'
  // For jcc: predicate over flags.
  cond?: 'z' | 'nz' | 'b' | 'ae' | 'l' | 'ge'
  // Whether a memory operand is permitted and in which position.
  operands: number // expected operand count (-1 = variadic/none)
}

// The whole instruction table. Adding a new instruction = one entry here.
export const INSTRUCTIONS: Record<string, OpInfo> = {
  mov: { kind: 'mov', operands: 2 },
  add: { kind: 'alu', alu: 'add', operands: 2 },
  sub: { kind: 'alu', alu: 'sub', operands: 2 },
  and: { kind: 'alu', alu: 'and', operands: 2 },
  or: { kind: 'alu', alu: 'or', operands: 2 },
  xor: { kind: 'alu', alu: 'xor', operands: 2 },
  shl: { kind: 'alu', alu: 'shl', operands: 2 },
  shr: { kind: 'alu', alu: 'shr', operands: 2 },
  cmp: { kind: 'cmp', alu: 'sub', operands: 2 },
  test: { kind: 'cmp', alu: 'test', operands: 2 },
  jmp: { kind: 'jmp', operands: 1 },
  jz: { kind: 'jcc', cond: 'z', operands: 1 },
  je: { kind: 'jcc', cond: 'z', operands: 1 },
  jnz: { kind: 'jcc', cond: 'nz', operands: 1 },
  jne: { kind: 'jcc', cond: 'nz', operands: 1 },
  jb: { kind: 'jcc', cond: 'b', operands: 1 },
  jc: { kind: 'jcc', cond: 'b', operands: 1 },
  jae: { kind: 'jcc', cond: 'ae', operands: 1 },
  jnc: { kind: 'jcc', cond: 'ae', operands: 1 },
  jl: { kind: 'jcc', cond: 'l', operands: 1 },
  jge: { kind: 'jcc', cond: 'ge', operands: 1 },
  clflush: { kind: 'clflush', operands: 1 },
  lfence: { kind: 'fence', operands: 0 },
  mfence: { kind: 'fence', operands: 0 },
  rdtsc: { kind: 'rdtsc', operands: 0 },
  nop: { kind: 'nop', operands: 0 },
  hlt: { kind: 'hlt', operands: 0 },
}

export function lookup(mnemonic: string): OpInfo | undefined {
  return INSTRUCTIONS[mnemonic.toLowerCase()]
}

// Evaluate a branch predicate against the flags.
export function testCond(cond: NonNullable<OpInfo['cond']>, f: Flags): boolean {
  switch (cond) {
    case 'z':
      return f.zf
    case 'nz':
      return !f.zf
    case 'b':
      return f.cf
    case 'ae':
      return !f.cf
    case 'l':
      return f.sf !== f.of
    case 'ge':
      return f.sf === f.of
  }
}

// 64-bit wrap using BigInt-free math kept in the safe-integer range for
// teaching. Values are masked to 32 bits so everything stays exact in JS.
export const WORD_MASK = 0xffffffff

export function toWord(n: number): number {
  return n >>> 0
}
