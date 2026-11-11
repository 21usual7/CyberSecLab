// memory.ts — the simulated address space.
//
// A single flat Uint8Array. It exists only inside this tab's JavaScript heap;
// it is not the host's memory and cannot reach it. Regions carry an attribute
// (user / kernel) so a later Meltdown lab can model a privilege check without
// any real protection being involved.

export type Region = 'user' | 'kernel'

export interface MemRegion {
  start: number
  end: number // exclusive
  attr: Region
}

export class Memory {
  readonly bytes: Uint8Array
  private regions: MemRegion[] = []

  constructor(size: number) {
    this.bytes = new Uint8Array(size)
  }

  mark(start: number, length: number, attr: Region) {
    this.regions.push({ start, end: start + length, attr })
  }

  attrOf(addr: number): Region {
    for (const r of this.regions)
      if (addr >= r.start && addr < r.end) return r.attr
    return 'user'
  }

  load8(addr: number): number {
    return this.bytes[addr & (this.bytes.length - 1)] ?? 0
  }

  load32(addr: number): number {
    const a = addr & (this.bytes.length - 1)
    return (
      ((this.bytes[a] ?? 0) |
        ((this.bytes[a + 1] ?? 0) << 8) |
        ((this.bytes[a + 2] ?? 0) << 16) |
        ((this.bytes[a + 3] ?? 0) << 24)) >>>
      0
    )
  }

  store8(addr: number, value: number) {
    this.bytes[addr & (this.bytes.length - 1)] = value & 0xff
  }

  store32(addr: number, value: number) {
    const a = addr & (this.bytes.length - 1)
    this.bytes[a] = value & 0xff
    this.bytes[a + 1] = (value >>> 8) & 0xff
    this.bytes[a + 2] = (value >>> 16) & 0xff
    this.bytes[a + 3] = (value >>> 24) & 0xff
  }
}
