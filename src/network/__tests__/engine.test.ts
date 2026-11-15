import { describe, expect, it } from 'vitest'
import { createNetwork, initialSnapshot, simulatePing } from '../engine'

describe('Ethernet / ARP / ICMP teaching network', () => {
  it('resolves ARP, learns switch ports and completes an ICMP round trip', () => {
    const initial = createNetwork()
    const trace = simulatePing(initial)
    const last = trace.at(-1)!
    expect(last.event.outcome).toBe('success')
    expect(last.network.hosts.a.arp).toEqual({ '192.168.1.20': initial.hosts.b.mac })
    expect(last.network.hosts.b.arp).toEqual({ '192.168.1.10': initial.hosts.a.mac })
    expect(last.network.macTable).toEqual({ [initial.hosts.a.mac]: 'a', [initial.hosts.b.mac]: 'b' })
    expect(trace.filter(s => s.event.from === 'a').map(s => s.event.frame?.kind)).toEqual(['ARP request', 'ICMP request'])
    expect(trace.find(s => s.event.frame?.kind === 'ARP request')!.event.frame!.destination).toBe('ff:ff:ff:ff:ff:ff')
    expect(trace.find(s => s.event.frame?.kind === 'ARP reply')!.event.frame!.destination).toBe(initial.hosts.a.mac)
    expect(initial.hosts.a.arp).toEqual({})
    expect(initial.macTable).toEqual({})
  })

  it('uses learned ARP entries on subsequent pings', () => {
    const warm = simulatePing(createNetwork()).at(-1)!.network
    const trace = simulatePing(warm)
    expect(trace.at(-1)!.event.outcome).toBe('success')
    expect(trace.some(s => s.event.frame?.kind.startsWith('ARP'))).toBe(false)
    expect(trace.filter(s => s.event.from === 'switch').map(s => s.event.to)).toEqual(['b', 'a'])
  })

  it('keeps history isolated and is deterministic for replay', () => {
    const initial = createNetwork()
    const first = simulatePing(initial)
    expect(first).toEqual(simulatePing(initial))
    expect(initialSnapshot(initial).network).toEqual(initial)
    expect(first[0].network.hosts.a.arp).toEqual({})
    expect(first[0].network.macTable).toEqual({})
    first.at(-1)!.network.hosts.a.arp['test'] = 'changed'
    expect(first[0].network.hosts.a.arp).toEqual({})
  })

  it('cannot deliver ARP over a disconnected cable', () => {
    const trace = simulatePing(createNetwork({ disconnected: true }))
    expect(trace.at(-1)!.event.outcome).toBe('failure')
    expect(trace.some(s => s.event.to === 'b')).toBe(false)
    expect(trace.at(-1)!.network.hosts.a.arp).toEqual({})
    expect(trace.at(-1)!.network.macTable).toHaveProperty('02:00:00:00:00:0a', 'a')
    expect(trace.at(-1)!.network.macTable).not.toHaveProperty('02:00:00:00:00:0b')
  })

  it('does not ARP for a remote subnet when no gateway exists', () => {
    const trace = simulatePing(createNetwork({ remoteSubnet: true }))
    expect(trace.at(-1)!.event.outcome).toBe('failure')
    expect(trace.some(s => s.event.frame)).toBe(false)
    expect(trace.at(-1)!.network.macTable).toEqual({})
  })

  it('floods unknown unicast if only the host ARP cache is warm', () => {
    const initial = createNetwork()
    initial.hosts.a.arp[initial.hosts.b.ip] = initial.hosts.b.mac
    initial.hosts.b.arp[initial.hosts.a.ip] = initial.hosts.a.mac
    const trace = simulatePing(initial)
    expect(trace.some(s => s.event.title === 'Неизвестный MAC: рассылка')).toBe(true)
    expect(trace.at(-1)!.event.outcome).toBe('success')
  })
})
