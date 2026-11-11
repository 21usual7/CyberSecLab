// analyzer.ts — static, read-only analysis of the assembly.
//
// Its job is EDUCATIONAL: it recognises the classic speculative-execution
// "gadget" shape (a bounds-checked branch guarding a load whose result indexes
// a second load) and the cache timing probe, then explains them and points at
// the standard defences. It never blocks or rewrites code — the gadget is the
// very thing the lab teaches. Because the whole machine is a synthetic in-tab
// simulation, none of this can be used to characterise real hardware.

import type { Instruction, Operand, Program } from './assembler'

export type Severity = 'gadget' | 'mitigation' | 'info'

export interface Annotation {
  line: number
  severity: Severity
  title: string
  detail: string
}

function memIndexReg(op: Operand | undefined): string | undefined {
  if (op?.kind === 'mem') return op.index ?? op.base
  return undefined
}

function loadDest(inst: Instruction): string | undefined {
  // A load is `mov reg, [mem]` (or an ALU/cmp with a memory source, but the
  // v1 gadget uses mov loads).
  if (inst.mnemonic !== 'mov') return undefined
  const [d, s] = inst.operands
  if (d?.kind === 'reg' && s?.kind === 'mem') return d.name
  return undefined
}

function loadIndex(inst: Instruction): string | undefined {
  if (inst.mnemonic !== 'mov') return undefined
  const [d, s] = inst.operands
  if (d?.kind === 'reg' && s?.kind === 'mem') return memIndexReg(s)
  return undefined
}

export function analyze(program: Program): Annotation[] {
  const out: Annotation[] = []
  const insts = program.instructions

  // 1) Spectre-v1-style gadget: load into R, then a later load indexed by R,
  //    with a conditional branch somewhere before the pair.
  for (let i = 0; i < insts.length; i++) {
    const dest = loadDest(insts[i])
    if (!dest) continue
    // find a dependent indexed load using `dest` further on, before `dest` is
    // overwritten.
    for (let j = i + 1; j < insts.length; j++) {
      const w = writesReg(insts[j])
      const idx = loadIndex(insts[j])
      if (idx === dest) {
        const branchBefore = findPrecedingCondBranch(insts, i)
        if (branchBefore >= 0) {
          const mitigated = mitigationBetween(insts, branchBefore, j)
          out.push({
            line: insts[i].line,
            severity: mitigated ? 'mitigation' : 'gadget',
            title: mitigated
              ? 'Bounds-checked load — mitigated'
              : 'Speculative load gadget (first load)',
            detail: mitigated
              ? 'A load guarded by a bounds-check branch, but a serialising fence or an index mask is present, so a mispredicted branch cannot leave an attacker-chosen line in the cache.'
              : 'This load reads memory indexed by a value that, on a mispredicted bounds-check branch, could be out of range. On this simulator you can watch the load run speculatively and fill a cache line that survives the squash.',
          })
          out.push({
            line: insts[j].line,
            severity: mitigated ? 'mitigation' : 'gadget',
            title: mitigated
              ? 'Dependent load — mitigated'
              : 'Speculative load gadget (dependent load)',
            detail:
              'The address here depends on the previous load. The set it touches is what a timing probe would later measure. Add `lfence` after the branch, or mask the index (`and idx, size-1`), to close the gadget.',
          })
        }
      }
      if (w === dest) break // dest overwritten; stop tracking
    }
  }

  // 2) Timing probe: clflush of a line, later a rdtsc-bracketed load of it.
  const hasClflush = insts.some((x) => x.mnemonic === 'clflush')
  const hasRdtsc = insts.some((x) => x.mnemonic === 'rdtsc')
  if (hasClflush && hasRdtsc) {
    const line = insts.find((x) => x.mnemonic === 'rdtsc')!.line
    out.push({
      line,
      severity: 'info',
      title: 'Cache timing probe',
      detail:
        'rdtsc here reads the SIMULATED cycle counter (not any host timer). Bracketing a load with it lets you see hit vs miss latency and infer which line was filled. This is how a side channel reads out the speculative state in the simulation.',
    })
  }

  // De-duplicate by (line, title).
  const seen = new Set<string>()
  return out.filter((a) => {
    const k = `${a.line}:${a.title}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function writesReg(inst: Instruction): string | undefined {
  const d = inst.operands[0]
  if (
    d?.kind === 'reg' &&
    ['mov', 'add', 'sub', 'and', 'or', 'xor', 'shl', 'shr'].includes(
      inst.mnemonic,
    )
  )
    return d.name
  return undefined
}

function findPrecedingCondBranch(insts: Instruction[], i: number): number {
  for (let k = i - 1; k >= 0 && k >= i - 12; k--) {
    if (/^j(z|e|nz|ne|b|c|ae|nc|l|ge)$/.test(insts[k].mnemonic)) return k
  }
  return -1
}

// A serialising fence or an index-masking `and` between the branch and the
// dependent load counts as mitigation.
function mitigationBetween(
  insts: Instruction[],
  from: number,
  to: number,
): boolean {
  for (let k = from + 1; k < to; k++) {
    const m = insts[k].mnemonic
    if (m === 'lfence' || m === 'mfence') return true
    if (m === 'and') return true
  }
  return false
}
