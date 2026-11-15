import { describe, expect, it } from 'vitest'
import { auditNetwork, executeCli, freshWorkshop, INITIAL_CLI, maskPrefix, runningConfig } from '../workshop'
export const CONNECT = `enable
configure terminal
interface GigabitEthernet0/0
ip address 192.168.1.1 255.255.255.0
no shutdown
end`
export const SECURE = `${CONNECT}
configure terminal
access-list 100 permit icmp host 192.168.1.10 host 203.0.113.20
access-list 100 permit tcp host 192.168.1.10 host 203.0.113.20 eq 80
access-list 100 deny ip any any
interface GigabitEthernet0/0
ip access-group 100 in
end`
function configure(script: string) { return executeCli(freshWorkshop(), INITIAL_CLI, script) }
describe('Cisco-style teaching configuration and policy verification', () => {
  it('a disconnected network cannot pass negative security checks', () => {
    expect(auditNetwork(freshWorkshop()).filter(r => r.passed)).toHaveLength(0)
  })
  it('address and no shutdown restore connectivity without claiming protection', () => {
    const result = configure(CONNECT)
    expect(result.output.some(line => line.startsWith('%'))).toBe(false)
    expect(auditNetwork(result.world).filter(r => r.passed).map(r => r.id)).toEqual(['icmp', 'http'])
  })
  it('attached least-privilege ACL passes all five actual packet probes', () => {
    const result = configure(SECURE)
    expect(result.output.some(line => line.startsWith('%'))).toBe(false)
    const tests = auditNetwork(result.world)
    expect(tests.every(test => test.passed)).toBe(true)
    expect(tests.find(t => t.id === 'http')!.trace.at(-1)!.event.title).toBe('HTTP/1.1 200 OK')
    for (const test of tests.filter(t => ['ssh', 'udp', 'other-client'].includes(t.id))) expect(test.trace.some(s => s.event.code === 'acl-deny')).toBe(true)
  })
  it('defining an ACL without attaching it does not filter traffic', () => {
    const result = configure(SECURE.replace('ip access-group 100 in', ''))
    expect(auditNetwork(result.world).filter(r => r.passed)).toHaveLength(2)
  })
  it('an earlier broad permit shadows later deny rules', () => {
    const result = configure(SECURE.replace('access-list 100 permit icmp', 'access-list 100 permit ip any any\naccess-list 100 permit icmp'))
    expect(auditNetwork(result.world).filter(r => r.passed)).toHaveLength(2)
  })
  it('implicit deny blocks unmatched requests', () => {
    const result = configure(SECURE.replace('access-list 100 deny ip any any\n', ''))
    expect(auditNetwork(result.world).every(r => r.passed)).toBe(true)
    expect(auditNetwork(result.world).find(t => t.id === 'ssh')!.reason).toContain('implicit deny')
  })
  it('blocking return traffic is not mistaken for protecting the server', () => {
    const result = configure(`${CONNECT}\nconfigure terminal\naccess-list 100 deny ip any any\ninterface GigabitEthernet0/1\nip access-group 100 in\nend`)
    expect(auditNetwork(result.world).filter(r => r.passed)).toHaveLength(0)
  })
  it('matching a whole subnet does not enforce the single-client policy', () => {
    const result = configure(SECURE.replaceAll('host 192.168.1.10', '192.168.1.0 0.0.0.255'))
    expect(auditNetwork(result.world).find(r => r.id === 'other-client')!.passed).toBe(false)
  })
  it('show running-config reflects state and can recreate a configuration', () => {
    const first = configure(SECURE)
    const text = runningConfig(first.world)
    expect(text).toContain('ip access-group 100 in')
    const second = configure(text)
    expect(auditNetwork(second.world).every(r => r.passed)).toBe(true)
  })
  it('ping uses the simulation and records actual ACL matches', () => {
    const first = configure(SECURE)
    const result = executeCli(first.world, first.context, 'ping 203.0.113.20')
    expect(result.trace!.at(-1)!.event.outcome).toBe('success')
    expect(result.world.acls['100'][0].hits).toBe(1)
    expect(first.world.acls['100'][0].hits).toBe(0)
    const denied = executeCli(first.world, first.context, 'probe tcp 203.0.113.20 22')
    expect(denied.trace!.some(s => s.event.code === 'acl-deny')).toBe(true)
  })
  it('audits do not mutate the configured network', () => {
    const first = configure(SECURE).world
    const before = structuredClone(first)
    auditNetwork(first)
    expect(first).toEqual(before)
  })
  it('validates contiguous masks and preserves config on an invalid IP command', () => {
    expect(maskPrefix('255.255.255.128')).toBe(25)
    expect(maskPrefix('0.0.0.0')).toBe(0)
    expect(() => maskPrefix('255.0.255.0')).toThrow()
    const result = configure('enable\nconfigure terminal\ninterface lan0\nip address 192.168.1.1 255.0.255.0')
    expect(result.world.devices.router!.interfaces[0].ip).toBe('192.168.99.1')
    expect(result.output.at(-1)).toContain('%')
  })
  it('requires mode and a defined ACL before attachment', () => {
    const result = configure('ip address 1.2.3.4 255.255.255.0\nenable\nconfigure terminal\ninterface lan0\nip access-group 100 in')
    expect(result.world.devices.router!.interfaces[0].aclIn).toBeUndefined()
    expect(result.output.filter(line => line.startsWith('%'))).toHaveLength(2)
  })
  it('does not remove an ACL still attached to an interface', () => {
    const first = configure(SECURE)
    const result = executeCli(first.world, first.context, 'configure terminal\nno access-list 100')
    expect(result.world.acls['100']).toHaveLength(3)
    expect(result.output.at(-1)).toContain('Сначала сними')
  })
  it('interface shutdown changes forwarding and show route state', () => {
    const first = configure(CONNECT)
    const result = executeCli(first.world, first.context, 'configure terminal\ninterface wan0\nshutdown\nend\nshow ip route\nping 203.0.113.20')
    expect(result.world.devices.router!.routes.some(r => r.iface === 'wan0')).toBe(false)
    expect(result.trace!.at(-1)!.event.outcome).toBe('failure')
  })
})
