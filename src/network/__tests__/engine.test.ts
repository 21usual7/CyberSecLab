import { describe, expect, it } from 'vitest'
import { createNetwork, defaultDraft, findRoute, initialSnapshot, simulate, validateDraft } from '../engine'
import { MODULES, missionReached } from '../labs'
import type { ModuleId, PacketDraft, Snapshot, WorldOptions } from '../types'
function run(module: ModuleId, fields: Partial<PacketDraft> = {}, options: Partial<WorldOptions> = {}) { return simulate(createNetwork(module, options), { ...defaultDraft(module), ...fields }) }
const last = (trace: Snapshot[]) => trace.at(-1)!
const has = (trace: Snapshot[], code: string) => trace.some(s => s.event.code === code)
const flights = (trace: Snapshot[]) => trace.filter(s => s.event.phase === 'flight')

describe('live network model', () => {
  it('resolves ARP and echoes user data without mutating the input', () => {
    const initial = createNetwork()
    const draft = { ...defaultDraft('ethernet'), payload: 'мой пакет' }
    const trace = simulate(initial, draft)
    expect(last(trace).event.outcome).toBe('success')
    expect(last(trace).network.devices.a!.arp['192.168.1.20']).toBe('02:00:00:00:00:0b')
    expect(last(trace).network.devices.b!.arp['192.168.1.10']).toBe('02:00:00:00:00:0a')
    expect(last(trace).network.devices.switch!.fdb).toEqual({ '02:00:00:00:00:0a': 'a', '02:00:00:00:00:0b': 'b' })
    expect(flights(trace).filter(s => s.event.packet?.label === 'Echo Reply').every(s => s.event.packet?.payload === 'мой пакет')).toBe(true)
    expect(initial.devices.a!.arp).toEqual({})
    expect(trace).toEqual(simulate(initial, draft))
    expect(initialSnapshot(initial).network).toEqual(initial)
    last(trace).network.devices.a!.arp.test = 'mutation'
    expect(trace[0].network.devices.a!.arp).toEqual({})
  })
  it('warm ARP cache eliminates ARP frames', () => {
    const first = run('ethernet')
    const second = simulate(last(first).network, defaultDraft('ethernet'))
    expect(last(second).event.outcome).toBe('success')
    expect(flights(second).some(s => s.event.frame?.kind.startsWith('ARP'))).toBe(false)
    expect(flights(second).length).toBeLessThan(flights(first).length)
  })
  it('detects wrong Ethernet address before IP processing', () => {
    const trace = run('ethernet', { destinationMac: '02:00:00:00:00:ff' })
    expect(has(trace, 'wrong-mac')).toBe(true)
    expect(has(trace, 'echo')).toBe(false)
    expect(last(trace).event.outcome).toBe('failure')
  })
  it('a correct hand-crafted MAC skips outbound ARP and returns an echo', () => {
    const trace = run('ethernet', { destinationMac: '02:00:00:00:00:0b' })
    expect(has(trace, 'manual-mac')).toBe(true)
    expect(last(trace).event.outcome).toBe('success')
    expect(flights(trace).some(s => s.event.frame?.kind === 'ARP request' && s.event.from === 'a')).toBe(false)
  })
  it('stops at a disconnected physical link', () => {
    const trace = run('ethernet', {}, { cableOff: true })
    expect(has(trace, 'cable')).toBe(true)
    expect(flights(trace).some(s => s.event.to === 'b')).toBe(false)
    expect(last(trace).event.outcome).toBe('failure')
  })
  it('unresolved neighbor never receives an IP packet', () => {
    const trace = run('ethernet', { destinationIp: '192.168.1.99' })
    expect(has(trace, 'arp-unanswered')).toBe(true)
    expect(flights(trace).some(s => s.event.packet)).toBe(false)
  })
})

describe('routing and NAT', () => {
  it('rebuilds MAC headers at the router and preserves destination IP', () => {
    const trace = run('routing')
    expect(last(trace).event.outcome).toBe('success')
    const outbound = flights(trace).filter(s => s.event.packet?.label === 'Echo Request')
    expect(outbound.every(s => s.event.packet?.destinationIp === '203.0.113.20')).toBe(true)
    expect(outbound.find(s => s.event.from === 'a')!.event.frame!.destination).toBe('02:00:00:00:01:01')
    const wan = outbound.find(s => s.event.from === 'router')!
    expect(wan.event.frame!.source).toBe('02:00:00:00:02:01')
    expect(wan.event.frame!.destination).toBe('02:00:00:00:00:0b')
    expect(wan.event.packet!.ttl).toBe(63)
    expect(outbound.find(s => s.event.from === 'a')!.event.packet!.ttl).toBe(64)
    expect(has(trace, 'snat')).toBe(false)
    const arpFromA = flights(trace).filter(s => s.event.from === 'a' && s.event.frame?.kind === 'ARP request')
    expect(arpFromA.every(s => s.event.frame?.destinationIp === '192.168.1.1')).toBe(true)
  })
  it('TTL 1 returns Time Exceeded, with no echo reaching the server', () => {
    const trace = run('routing', { ttl: 1 })
    expect(has(trace, 'ttl-expired')).toBe(true)
    expect(has(trace, 'echo')).toBe(false)
    expect(flights(trace).some(s => s.event.to === 'a' && s.event.packet?.icmpType === 11)).toBe(true)
    expect(last(trace).event.outcome).toBe('failure')
  })
  it('no default route means no ARP or Ethernet frame', () => {
    const trace = run('routing', {}, { noGateway: true })
    expect(has(trace, 'no-route')).toBe(true)
    expect(flights(trace)).toEqual([])
  })
  it('selects longest-prefix matching route', () => {
    const host = createNetwork('routing').devices.a!
    host.routes.push({ network: '203.0.113.0', prefix: 24, gateway: '192.168.1.2', iface: 'eth0' })
    expect(findRoute(host, '203.0.113.20')!.gateway).toBe('192.168.1.2')
    expect(findRoute(host, '198.51.100.20')!.gateway).toBe('192.168.1.1')
  })
  it('SNAT translates outbound identity and reverse mapping delivers the reply', () => {
    const trace = run('nat')
    expect(last(trace).event.outcome).toBe('success')
    expect(has(trace, 'snat')).toBe(true)
    expect(has(trace, 'dnat')).toBe(true)
    const atServer = trace.find(s => s.event.code === 'echo')!.event.packet!
    expect(atServer.sourceIp).toBe('203.0.113.1')
    const beforeNat = flights(trace).find(s => s.event.from === 'a' && s.event.packet?.label === 'Echo Request')!
    expect(beforeNat.event.packet!.sourceIp).toBe('192.168.1.10')
    expect(beforeNat.event.packet!.ttl).toBe(64)
    expect(beforeNat.event.frame!.sourceIp).toBe(beforeNat.event.packet!.sourceIp)
    const reply = flights(trace).find(s => s.event.to === 'a' && s.event.packet?.label === 'Echo Reply')!
    expect(reply.event.packet!.destinationIp).toBe('192.168.1.10')
    expect(last(trace).network.nat).toHaveLength(1)
  })
  it('without NAT the request succeeds but the server has no return route', () => {
    const trace = run('nat', {}, { natEnabled: false })
    expect(has(trace, 'echo')).toBe(true)
    expect(trace.find(s => s.event.code === 'no-route')!.event.at).toBe('b')
    expect(last(trace).event.outcome).toBe('failure')
  })
  it('NAT can carry a complete TCP handshake and reuses the mapping', () => {
    const fields: Partial<PacketDraft> = { protocol: 'TCP', mode: 'exchange', payload: '', destinationPort: 80 }
    const first = run('nat', fields)
    expect(last(first).event.outcome).toBe('success')
    expect(has(first, 'established')).toBe(true)
    const second = simulate(last(first).network, { ...defaultDraft('nat'), ...fields })
    expect(last(second).network.nat).toHaveLength(1)
  })
})

describe('TCP, UDP and applications', () => {
  it('completes a three-way handshake with correct sequence numbers', () => {
    const trace = run('tcp')
    expect(last(trace).event.outcome).toBe('success')
    const ack = trace.find(s => s.event.code === 'ack')!.event.packet!
    expect([ack.seq, ack.ack, ack.flags]).toEqual([1001, 5001, 'ACK'])
    expect(Object.values(last(trace).network.devices.a!.sockets)).toEqual(['ESTABLISHED'])
    expect(Object.values(last(trace).network.devices.b!.sockets)).toEqual(['ESTABLISHED'])
  })
  it('a SYN probe detects open and resets the half-open connection', () => {
    const trace = run('tcp', { mode: 'syn', destinationPort: 22 })
    expect(has(trace, 'open')).toBe(true)
    expect(has(trace, 'established')).toBe(false)
    expect(Object.values(last(trace).network.devices.b!.sockets)).toEqual(['CLOSED'])
  })
  it('raw SYN leaves the server half-open', () => {
    const trace = run('tcp', { mode: 'raw' })
    expect(has(trace, 'half-open')).toBe(true)
    expect(Object.values(last(trace).network.devices.b!.sockets)).toEqual(['SYN-RECEIVED'])
  })
  it('closed port returns RST while filtered silently drops', () => {
    const closed = run('tcp', { destinationPort: 81 })
    expect(has(closed, 'rst-received')).toBe(true)
    expect(Object.values(last(closed).network.devices.a!.sockets)).toEqual(['CLOSED'])
    const filtered = run('tcp', {}, { blockPort: 80 })
    expect(has(filtered, 'filtered')).toBe(true)
    expect(has(filtered, 'rst-received')).toBe(false)
    expect(flights(filtered).some(s => s.event.packet?.flags.includes('RST'))).toBe(false)
  })
  it('an unsolicited ACK does not establish a connection', () => {
    const trace = run('tcp', { flags: 'ACK', mode: 'raw' })
    expect(has(trace, 'rst-received')).toBe(true)
    expect(has(trace, 'established')).toBe(false)
    expect(last(trace).event.title).not.toContain('Порт closed')
  })
  it('TCP data is sent after handshake and acknowledged by byte count', () => {
    const trace = run('tcp', { payload: 'привет' })
    const dataIndex = trace.findIndex(s => s.event.packet?.label === 'TCP data')
    const establishedIndex = trace.findIndex(s => s.event.code === 'established')
    expect(dataIndex).toBeGreaterThan(establishedIndex)
    expect(flights(trace).find(s => s.event.packet?.label === 'Data ACK')!.event.packet!.ack).toBe(1013)
  })
  it('HTTP content changes the response after TCP handshake', () => {
    const good = run('tcp', { mode: 'http', payload: 'GET / HTTP/1.1\r\n\r\n' })
    expect(last(good).event.title).toBe('HTTP/1.1 200 OK')
    const bad = run('tcp', { mode: 'http', payload: 'not http' })
    expect(last(bad).event.title).toBe('HTTP/1.1 400 Bad Request')
    expect(has(good, 'established')).toBe(true)
    expect(flights(good).find(s => s.event.packet?.flags === 'SYN')!.event.packet!.payload).toBe('')
  })
  it('DNS swaps UDP ports, caches results and suppresses repeated traffic', () => {
    const first = run('dns')
    expect(last(first).network.devices.a!.dnsCache['lab.test']).toBe('192.168.1.20')
    const answer = flights(first).find(s => s.event.packet?.dnsResponse)!.event.packet!
    expect([answer.sourcePort, answer.destinationPort]).toEqual([53, 49152])
    const second = simulate(last(first).network, defaultDraft('dns'))
    expect(has(second, 'dns-cache')).toBe(true)
    expect(flights(second)).toEqual([])
  })
  it('NXDOMAIN is a delivered DNS response, unlike an unavailable service', () => {
    const missing = run('dns', { dnsName: 'missing.test' })
    expect(has(missing, 'nxdomain')).toBe(true)
    expect(flights(missing).some(s => s.event.to === 'a' && s.event.packet?.label === 'NXDOMAIN')).toBe(true)
    const down = run('dns', {}, { dnsDown: true })
    expect(has(down, 'udp-closed')).toBe(true)
    expect(flights(down).some(s => s.event.packet?.label === 'Port Unreachable')).toBe(true)
  })
})

describe('practical labs and input bounds', () => {
  for (const module of MODULES) for (const mission of module.missions) {
    it(`${module.id}: ${mission.id} is achievable with real model events`, () => {
      let trace = run(module.id, mission.draft, mission.options)
      if (mission.id === 'dns-cache') trace = simulate(last(trace).network, { ...defaultDraft(module.id), ...mission.draft })
      expect(missionReached(mission, trace)).toBe(true)
      expect(missionReached(mission, trace.slice(0, -1))).toBe(false)
    })
  }
  it('rejects invalid inputs instead of inventing a simulation', () => {
    const draft = defaultDraft('ethernet')
    for (const change of [{ destinationIp: '999.1.1.1' }, { ttl: 0 }, { ttl: 2.5 }, { destinationPort: 65536 }, { destinationMac: 'bad' }, { payload: 'x'.repeat(513) }]) {
      expect(validateDraft({ ...draft, ...change })).not.toBe(null)
      expect(() => simulate(createNetwork(), { ...draft, ...change })).toThrow()
    }
  })
})
