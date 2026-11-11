import { describe, expect, it } from 'vitest'
import { analyze } from '../analyzer'
import { assemble } from '../assembler'
import { Core } from '../core'
import { REGISTERS } from '../isa'
import { runReference } from '../reference'
import {
  MITIGATED_FENCE,
  MITIGATED_MASK,
  VULNERABLE,
} from '../../labs/lab01/lab'

// Programs that exercise the architectural behaviour the OoO core must match.
const PROGRAMS: Record<string, string> = {
  arithmetic: `
    mov rax, 5
    mov rbx, 3
    add rax, rbx
    sub rax, 1
    shl rax, 2
    xor rbx, rbx
    hlt`,
  loopSum: `
    mov rax, 0
    mov rcx, 0
  top:
    add rax, rcx
    add rcx, 1
    cmp rcx, 10
    jb top
    hlt`,
  memory: `
    .data
    v: dq 0
    .text
    mov rax, 123
    mov [v], rax
    mov rbx, [v]
    add rbx, 7
    mov [v], rbx
    hlt`,
  branchesForward: `
    mov rax, 4
    cmp rax, 10
    jae skip
    mov rbx, 1
  skip:
    mov rcx, 2
    hlt`,
  indexedLoad: `
    .data
    arr: db 10,20,30,40,50,60,70,80
    .text
    mov rsi, 3
    mov rax, [arr + rsi]
    mov rdi, 5
    mov rbx, [arr + rdi]
    add rax, rbx
    hlt`,
}

describe('out-of-order core matches the reference interpreter', () => {
  for (const [name, src] of Object.entries(PROGRAMS)) {
    it(name, () => {
      const prog = assemble(src)
      const ref = runReference(prog)
      const core = new Core(prog)
      core.run()
      expect(core.isHalted()).toBe(true)
      const arch = core.finalArch
      for (const r of REGISTERS) {
        expect(arch[r], `${name}: register ${r}`).toBe(ref.regs[r])
      }
      // Memory image must agree too.
      expect([...core.memory.subarray(0, 32)]).toEqual([
        ...ref.mem.subarray(0, 32),
      ])
    })
  }
})

describe('Spectre v1 lab', () => {
  const PROBE_LINE = 64 + 42 * 64 // probe base (64) + secret(42)*64 = 2752, set 43

  it('vulnerable program leaves the secret-dependent line in the cache', () => {
    const core = Core.fromSource(VULNERABLE)
    core.run()
    // The dependent load ran speculatively and was squashed...
    const last = core.snapshots[core.snapshots.length - 1]
    expect(last.squashedCount).toBeGreaterThan(0)
    // ...but its cache fill survives.
    expect(core.finalCache.present(PROBE_LINE)).toBe(true)
  })

  it('lfence mitigation leaves no secret-dependent line', () => {
    const core = Core.fromSource(MITIGATED_FENCE)
    core.run()
    expect(core.finalCache.present(PROBE_LINE)).toBe(false)
  })

  it('index masking leaves no secret-dependent line', () => {
    const core = Core.fromSource(MITIGATED_MASK)
    core.run()
    expect(core.finalCache.present(PROBE_LINE)).toBe(false)
  })

  it('analyzer flags the gadget and goes quiet once mitigated', () => {
    const vuln = analyze(assemble(VULNERABLE))
    expect(vuln.some((a) => a.severity === 'gadget')).toBe(true)
    const fixed = analyze(assemble(MITIGATED_FENCE))
    expect(fixed.some((a) => a.severity === 'gadget')).toBe(false)
  })
})
