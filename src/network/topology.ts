import type { Device, DeviceId, Interface, ModuleId, PacketDraft, Route, World, WorldOptions } from './types'
import { DEFAULT_OPTIONS } from './types'

export function ipNumber(ip: string): number {
  return ip.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0)
}
export function validIp(ip: string): boolean { return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(part => Number(part) <= 255) }
export function contains(ip: string, network: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return ((ipNumber(ip) & mask) >>> 0) === ((ipNumber(network) & mask) >>> 0)
}
export function findRoute(device: Device, ip: string): Route | undefined {
  return device.routes.filter(route => contains(ip, route.network, route.prefix)).sort((a, b) => b.prefix - a.prefix)[0]
}
const iface = (name: string, ip: string, mac: string, peer: DeviceId): Interface => ({ name, ip, mac, peer, prefix: 24 })
function device(id: DeviceId, name: string, kind: Device['kind'], x: number, interfaces: Interface[]): Device {
  const routes = interfaces.map(i => ({ network: i.ip.split('.').slice(0, 3).join('.') + '.0', prefix: 24, iface: i.name }))
  return { id, name, kind, x, y: 195, interfaces, routes, arp: {}, fdb: {}, sockets: {}, dnsCache: {} }
}
export function createNetwork(module: ModuleId = 'ethernet', options: Partial<WorldOptions> = {}): World {
  const config = { ...DEFAULT_OPTIONS, ...options }
  const routed = module === 'routing' || module === 'nat'
  const a = device('a', 'Твой компьютер', 'host', 105, [iface('eth0', '192.168.1.10', '02:00:00:00:00:0a', 'switch')])
  const sw = device('switch', 'Коммутатор', 'switch', routed ? 320 : 480, [])
  const b = device('b', module === 'dns' ? 'DNS-сервер' : 'Сервер', 'host', 855, [iface('eth0', routed ? '203.0.113.20' : '192.168.1.20', '02:00:00:00:00:0b', routed ? 'router' : 'switch')])
  const world: World = { module, devices: { a, switch: sw, b }, links: [{ a: 'a', b: 'switch', connected: true }], nat: [], nextPacket: 1, options: config }
  if (routed) {
    const router = device('router', 'Шлюз', 'router', 580, [iface('lan0', '192.168.1.1', '02:00:00:00:01:01', 'switch'), iface('wan0', '203.0.113.1', '02:00:00:00:02:01', 'b')])
    world.devices.router = router
    world.links.push({ a: 'switch', b: 'router', connected: true }, { a: 'router', b: 'b', connected: !config.cableOff })
    if (!config.noGateway) a.routes.push({ network: '0.0.0.0', prefix: 0, gateway: '192.168.1.1', iface: 'eth0' })
    if (module === 'routing') b.routes.push({ network: '192.168.1.0', prefix: 24, gateway: '203.0.113.1', iface: 'eth0' })
  } else world.links.push({ a: 'switch', b: 'b', connected: !config.cableOff })
  return world
}
export function defaultDraft(module: ModuleId): PacketDraft {
  return { protocol: module === 'tcp' ? 'TCP' : module === 'dns' ? 'UDP' : 'ICMP', destinationIp: module === 'routing' || module === 'nat' ? '203.0.113.20' : '192.168.1.20', ttl: 64, sourcePort: 49152, destinationPort: module === 'dns' ? 53 : 80, flags: 'SYN', payload: module === 'tcp' ? '' : 'hello, network', destinationMac: '', dnsName: 'lab.test', mode: 'exchange' }
}
