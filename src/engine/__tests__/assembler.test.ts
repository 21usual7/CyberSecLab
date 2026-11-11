import { describe, expect, it } from 'vitest'
import { AssembleError, assemble } from '../assembler'

describe('assembler', () => {
  it('parses registers, immediates and memory operands', () => {
    const p = assemble(`
      .data
      arr: db 1,2,3,4
      .text
      mov rax, 10
      mov rbx, arr
      mov rcx, [rbx + rax*4 + 8]
      add rcx, [arr]
      hlt
    `)
    expect(p.instructions).toHaveLength(5)
    expect(p.dataSymbols.arr.length).toBe(4)
    expect([...p.data.subarray(0, 4)]).toEqual([1, 2, 3, 4])
    const mov3 = p.instructions[2].operands[1]
    expect(mov3).toMatchObject({ kind: 'mem', base: 'rbx', index: 'rax', scale: 4, disp: 8 })
  })

  it('resolves labels and sections', () => {
    const p = assemble(`
      .text
      mov rax, 0
      loop:
      add rax, 1
      cmp rax, 4
      jb loop
      hlt
    `)
    expect(p.labels.loop).toBe(1)
  })

  it('reports errors with line numbers', () => {
    try {
      assemble('mov rax\nfoo rbx, 1\njmp nowhere')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AssembleError)
      const err = e as AssembleError
      expect(err.errors.some((x) => x.message.includes("unknown instruction 'foo'"))).toBe(true)
      expect(err.errors.some((x) => x.message.includes("undefined label 'nowhere'"))).toBe(true)
    }
  })

  it('supports times directive and byte ptr', () => {
    const p = assemble(`
      .data
      probe: times 256 db 0
      .text
      mov byte ptr [probe], 7
      hlt
    `)
    expect(p.dataSymbols.probe.length).toBe(256)
    expect(p.instructions[0].operands[0]).toMatchObject({ kind: 'mem', size: 1 })
  })
})
