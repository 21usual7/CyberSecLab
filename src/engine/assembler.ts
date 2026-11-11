// assembler.ts — turns source text into a program the core can run.
//
// Two sections: `.data` (bytes placed in simulated memory) and `.text`
// (instructions). Intel-style operands. Everything is checked with friendly
// line/column errors; nothing here touches real memory or real machine code.

import { isReg, lookup, type RegName } from './isa'

export const LIMITS = {
  maxInstructions: 512,
  maxDataBytes: 64 * 1024,
}

export type Operand =
  | { kind: 'reg'; name: RegName }
  | { kind: 'imm'; value: number }
  | { kind: 'label'; name: string }
  | {
      kind: 'mem'
      base?: RegName
      index?: RegName
      scale: number
      disp: number
      sym?: string // symbolic displacement from a .data label
      size: 1 | 4 // byte ptr / qword(word) ptr
    }

export interface Instruction {
  mnemonic: string
  operands: Operand[]
  line: number // 1-based source line
  text: string // original trimmed source
  addr: number // instruction index in .text
}

export interface DataSymbol {
  name: string
  offset: number // byte offset in the data image
  length: number
}

export interface Program {
  instructions: Instruction[]
  labels: Record<string, number> // label -> instruction index
  data: Uint8Array
  dataSymbols: Record<string, DataSymbol>
}

export interface AsmError {
  line: number
  message: string
}

export class AssembleError extends Error {
  errors: AsmError[]
  constructor(errors: AsmError[]) {
    super(errors.map((e) => `line ${e.line}: ${e.message}`).join('\n'))
    this.name = 'AssembleError'
    this.errors = errors
  }
}

const NUM = /^(0x[0-9a-f]+|0b[01]+|\d+)$/i

function parseNumber(tok: string): number | null {
  if (!NUM.test(tok)) return null
  if (/^0x/i.test(tok)) return parseInt(tok.slice(2), 16)
  if (/^0b/i.test(tok)) return parseInt(tok.slice(2), 2)
  return parseInt(tok, 10)
}

// Split a line into comment-free source. `;` and `//` start comments.
function stripComment(line: string): string {
  let out = ''
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ';') break
    if (line[i] === '/' && line[i + 1] === '/') break
    out += line[i]
  }
  return out
}

interface ParsedMem {
  base?: RegName
  index?: RegName
  scale: number
  disp: number
  sym?: string
}

// Parse the inside of `[ ... ]`: base + index*scale + disp, any order.
function parseMemBody(
  body: string,
  symbols: Set<string>,
  err: (m: string) => void,
): ParsedMem {
  const m: ParsedMem = { scale: 1, disp: 0 }
  // Normalise `-` into `+-` so we can split on `+`.
  const terms = body
    .replace(/-/g, '+-')
    .split('+')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  for (const term of terms) {
    const scaled = term.match(/^(-?)(\w+)\*(\d+)$/)
    if (scaled) {
      const name = scaled[2]
      if (!isReg(name)) {
        err(`'${name}' is not a register in scaled index`)
        continue
      }
      m.index = name
      m.scale = parseInt(scaled[3], 10)
      continue
    }
    const neg = term.startsWith('-')
    const bare = neg ? term.slice(1) : term
    if (isReg(bare)) {
      if (m.base === undefined) m.base = bare
      else m.index = bare
      continue
    }
    const n = parseNumber(bare)
    if (n !== null) {
      m.disp += neg ? -n : n
      continue
    }
    if (symbols.has(bare)) {
      m.sym = bare
      continue
    }
    err(`cannot parse memory term '${term}'`)
  }
  return m
}

function parseOperand(
  raw: string,
  symbols: Set<string>,
  err: (m: string) => void,
): Operand | null {
  let tok = raw.trim()
  if (tok === '') {
    err('empty operand')
    return null
  }
  // Size prefix: `byte ptr [..]` / `qword ptr [..]` / `word ptr [..]`.
  let size: 1 | 4 = 4
  const ptr = tok.match(/^(byte|word|qword)\s+ptr\s+(.*)$/i)
  if (ptr) {
    size = ptr[1].toLowerCase() === 'byte' ? 1 : 4
    tok = ptr[2].trim()
  }
  if (tok.startsWith('[') && tok.endsWith(']')) {
    const mem = parseMemBody(tok.slice(1, -1), symbols, err)
    return { kind: 'mem', ...mem, size }
  }
  if (isReg(tok)) return { kind: 'reg', name: tok }
  const n = parseNumber(tok)
  if (n !== null) return { kind: 'imm', value: n }
  // Otherwise a symbol: either a code label (resolved later) or a data symbol
  // used as a bare address.
  if (symbols.has(tok)) return { kind: 'imm', value: -1 } // patched below via sym
  return { kind: 'label', name: tok }
}

export function assemble(source: string): Program {
  const lines = source.split('\n')
  const errors: AsmError[] = []
  const instructions: Instruction[] = []
  const labels: Record<string, number> = {}
  const dataSymbols: Record<string, DataSymbol> = {}
  const dataBytes: number[] = []

  type Section = 'text' | 'data'
  let section: Section = 'text'
  const dataNames = new Set<string>()

  // First pass over .data so symbols are known while parsing .text operands.
  // We interleave in one pass but collect data symbol names up front.
  for (const rawLine of lines) {
    const s = stripComment(rawLine).trim()
    const dm = s.match(/^(\w+):?\s+(db|dq|times)\b/i)
    if (dm) dataNames.add(dm[1])
  }

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1
    const err = (m: string) => errors.push({ line: lineNo, message: m })
    const s = stripComment(rawLine).trim()
    if (s === '') return

    if (/^\.(text|data)$/i.test(s)) {
      section = s.toLowerCase() === '.data' ? 'data' : 'text'
      return
    }

    if (section === 'data') {
      // `name: db 1,2,3`  /  `name: times 256 db 0`  /  `name: dq 0x10`
      const m = s.match(/^(\w+):?\s+(.*)$/)
      if (!m) {
        err(`cannot parse data line`)
        return
      }
      const name = m[1]
      const start = dataBytes.length
      const rest = m[2].trim()
      const times = rest.match(/^times\s+(\w+)\s+(db|dq)\s+(.*)$/i)
      if (times) {
        const count = parseNumber(times[1]) ?? 0
        const unit = times[2].toLowerCase() === 'dq' ? 4 : 1
        const val = parseNumber(times[3].trim()) ?? 0
        for (let k = 0; k < count; k++)
          pushValue(dataBytes, val, unit as 1 | 4)
      } else {
        const dd = rest.match(/^(db|dq)\s+(.*)$/i)
        if (!dd) {
          err(`expected db/dq/times in data`)
          return
        }
        const unit = dd[1].toLowerCase() === 'dq' ? 4 : 1
        for (const part of dd[2].split(',')) {
          const t = part.trim()
          const n = parseNumber(t)
          if (n === null) {
            err(`'${t}' is not a numeric data value`)
            continue
          }
          pushValue(dataBytes, n, unit as 1 | 4)
        }
      }
      dataSymbols[name] = {
        name,
        offset: start,
        length: dataBytes.length - start,
      }
      return
    }

    // .text
    // Standalone label: `loop:`
    const labelOnly = s.match(/^(\w+):$/)
    if (labelOnly) {
      labels[labelOnly[1]] = instructions.length
      return
    }
    // Inline label + instruction: `loop: mov ...`
    let body = s
    const inline = s.match(/^(\w+):\s+(.*)$/)
    if (inline) {
      labels[inline[1]] = instructions.length
      body = inline[2].trim()
    }

    const sp = body.indexOf(' ')
    const mnemonic = (sp === -1 ? body : body.slice(0, sp)).toLowerCase()
    const argStr = sp === -1 ? '' : body.slice(sp + 1).trim()
    const info = lookup(mnemonic)
    if (!info) {
      err(`unknown instruction '${mnemonic}'`)
      return
    }
    const operands: Operand[] = []
    if (argStr !== '') {
      for (const part of splitOperands(argStr)) {
        const op = parseOperand(part, dataNames, err)
        if (op) {
          // Patch a bare data symbol used as immediate address.
          if (op.kind === 'imm' && op.value === -1 && dataNames.has(part.trim())) {
            operands.push({
              kind: 'mem',
              scale: 1,
              disp: 0,
              sym: part.trim(),
              size: 4,
            })
          } else {
            operands.push(op)
          }
        }
      }
    }
    if (info.operands >= 0 && operands.length !== info.operands) {
      err(
        `'${mnemonic}' expects ${info.operands} operand(s), got ${operands.length}`,
      )
    }
    instructions.push({
      mnemonic,
      operands,
      line: lineNo,
      text: body,
      addr: instructions.length,
    })
  })

  // Resolve code labels referenced by branches.
  for (const inst of instructions) {
    for (const op of inst.operands) {
      if (op.kind === 'label' && !(op.name in labels)) {
        errors.push({
          line: inst.line,
          message: `undefined label '${op.name}'`,
        })
      }
    }
  }

  if (instructions.length > LIMITS.maxInstructions)
    errors.push({
      line: 0,
      message: `program too large: ${instructions.length} > ${LIMITS.maxInstructions} instructions`,
    })
  if (dataBytes.length > LIMITS.maxDataBytes)
    errors.push({
      line: 0,
      message: `data too large: ${dataBytes.length} > ${LIMITS.maxDataBytes} bytes`,
    })

  if (errors.length) throw new AssembleError(errors)

  return {
    instructions,
    labels,
    data: new Uint8Array(dataBytes),
    dataSymbols,
  }
}

function pushValue(out: number[], value: number, unit: 1 | 4) {
  if (unit === 1) {
    out.push(value & 0xff)
  } else {
    out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
  }
}

// Split `a, [b+c], 5` respecting brackets.
function splitOperands(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '[') depth++
    if (ch === ']') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim() !== '') parts.push(cur)
  return parts.map((p) => p.trim())
}
