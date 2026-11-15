import { describe, expect, it } from 'vitest'
import { createNetwork, defaultDraft, simulate } from '../engine'
import { compareAttempts, diagnosticOptions, FAULTS, makePrediction } from '../learning'
import { contains, networkAddress } from '../topology'
import type { Attempt } from '../learning'
import type { ModuleId, PacketDraft, WorldOptions } from '../types'
function attempt(module: ModuleId, fields: Partial<PacketDraft> = {}, options: Partial<WorldOptions> = {}): Attempt {
  const world = createNetwork(module, options), draft = { ...defaultDraft(module), ...fields }
  return { world, draft, trace: simulate(world, draft) }
}
describe('predictions are grounded in observable model events', () => {
  it('distinguishes final IP from the first-hop MAC', () => {
    for (const [module, answer] of [['ethernet', '02:00:00:00:00:0b'], ['routing', '02:00:00:00:01:01']] as const) {
      const run = attempt(module), prediction = makePrediction(run.world, run.draft, run.trace)
      expect(prediction.answer).toBe(answer)
      expect(run.trace[prediction.evidence].event.frame!.destination).toBe(answer)
    }
  })
  it('does not invent a frame when no route exists', () => {
    const run = attempt('routing', {}, { noGateway: true })
    const prediction = makePrediction(run.world, run.draft, run.trace)
    expect(prediction.answer).toBe('none')
    expect(prediction.evidence).toBe(run.trace.length - 1)
  })
  it('handles manually crafted MAC choices', () => {
    const run = attempt('ethernet', { destinationMac: '02:00:00:00:00:ff' })
    const prediction = makePrediction(run.world, run.draft, run.trace)
    expect(prediction.options.some(option => option.value === prediction.answer)).toBe(true)
  })
  it('predicts SYN,ACK, RST, and silence using the returned segment', () => {
    for (const [port, blocked, expected] of [[22, -1, 'open'], [81, -1, 'reset'], [80, 80, 'silence']] as const) {
      const run = attempt('tcp', { destinationPort: port }, { blockPort: blocked })
      expect(makePrediction(run.world, run.draft, run.trace).answer).toBe(expected)
    }
  })
  it('predicts DNS network and cache outcomes separately', () => {
    const first = attempt('dns')
    expect(makePrediction(first.world, first.draft, first.trace).answer).toBe('answer')
    const world = first.trace.at(-1)!.network
    const second = simulate(world, first.draft)
    expect(makePrediction(world, first.draft, second).answer).toBe('cache')
    const missing = attempt('dns', { dnsName: 'missing.test' })
    expect(makePrediction(missing.world, missing.draft, missing.trace).answer).toBe('missing')
  })
})
describe('comparison explains changed decisions', () => {
  it('locates TTL expiration rather than an irrelevant packet ID', () => {
    const comparison = compareAttempts(attempt('routing'), attempt('routing', { ttl: 1 }))
    expect(comparison.before!.snapshot.event.code).toBe('ttl-decrement')
    expect(comparison.after!.snapshot.event.code).toBe('ttl-expired')
    expect(comparison.changes).toContain('TTL: 64 → 1')
  })
  it('identifies the effect of a warm ARP cache', () => {
    const first = attempt('ethernet')
    const world = first.trace.at(-1)!.network
    const second = { world, draft: first.draft, trace: simulate(world, first.draft) }
    const comparison = compareAttempts(first, second)
    expect(comparison.before!.snapshot.event.code).toBe('arp-miss')
    expect(comparison.after!.snapshot.event.code).toBe('arp-hit')
  })
  it('ignores synthetic packet numbers for otherwise identical attempts', () => {
    const first = attempt('ethernet'), second = attempt('ethernet')
    second.world.nextPacket = 99; second.trace = simulate(second.world, second.draft)
    expect(compareAttempts(first, second).equal).toBe(true)
  })
})
describe('subnet experiments and diagnosis', () => {
  it('/24 and /25 change next-hop decisions despite the same cable', () => {
    const wide = attempt('subnet'), narrow = attempt('subnet', {}, { clientPrefix: 25 })
    expect(wide.trace.at(-1)!.event.outcome).toBe('success')
    expect(narrow.trace.some(s => s.event.code === 'no-route')).toBe(true)
    expect(narrow.trace.some(s => s.event.phase === 'flight')).toBe(false)
    expect(networkAddress('192.168.1.200', 25)).toBe('192.168.1.128')
    expect(contains('192.168.1.200', '192.168.1.10', 25)).toBe(false)
    expect(contains('203.0.113.20', '0.0.0.0', 0)).toBe(true)
    expect(() => createNetwork('subnet', { clientPrefix: 33 })).toThrow()
  })
  for (const fault of FAULTS) it(`diagnostic ${fault} can be proven and repaired with one change`, () => {
    const bad = attempt('diagnostic', {}, diagnosticOptions(fault))
    expect(bad.trace.at(-1)!.event.outcome).toBe('failure')
    const good = attempt('diagnostic', {}, { noGateway: false, cableOff: false, blockPort: -1 })
    expect(good.trace.at(-1)!.event.outcome).toBe('success')
    expect(good.trace.some(s => s.event.code === 'established')).toBe(true)
  })
})
