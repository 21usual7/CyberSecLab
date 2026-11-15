import type { Device, DeviceId, Interface, ModuleId, PacketDraft, Route, World, WorldOptions } from './types'
import { DEFAULT_OPTIONS } from './types'

export function ipNumber(ip: string): number {
  return ip.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0)
}
export function validIp(ip: string): boolean { return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(part => Number(part) <= 255) }
export function numberIp(value: number): string { return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.') }
export function prefixMask(prefix: number): string { return numberIp(prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0) }
export function networkAddress(ip: string, prefix: number): string { return numberIp((ipNumber(ip) & ipNumber(prefixMask(prefix))) >>> 0) }
export function contains(ip: string, network: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return ((ipNumber(ip) & mask) >>> 0) === ((ipNumber(network) & mask) >>> 0)
}
export function findRoute(device: Device, ip: string): Route | undefined {
  return device.routes.filter(route => contains(ip, route.network, route.prefix)).sort((a, b) => b.prefix - a.prefix)[0]
}
const iface = (name: string, ip: string, mac: string, peer: DeviceId): Interface => ({ name, ip, mac, peer, prefix: 24, up: true })
function device(id: DeviceId, name: string, kind: Device['kind'], x: number, interfaces: Interface[]): Device {
  const routes = interfaces.map(i => ({ network: networkAddress(i.ip, i.prefix), prefix: i.prefix, iface: i.name }))
  return { id, name, kind, x, y: 195, interfaces, routes, arp: {}, fdb: {}, sockets: {}, dnsCache: {} }
}
export function createNetwork(module: ModuleId = 'ethernet', options: Partial<WorldOptions> = {}): World {
  const config = { ...DEFAULT_OPTIONS, ...options }
  if (!Number.isInteger(config.clientPrefix) || config.clientPrefix < 0 || config.clientPrefix > 32) throw new Error('Префикс должен быть от 0 до 32.')
  const routed = ['routing', 'nat', 'diagnostic', 'workshop'].includes(module)
  const a = device('a', 'Твой компьютер', 'host', 105, [iface('eth0', '192.168.1.10', '02:00:00:00:00:0a', 'switch')])
  a.interfaces[0].prefix = config.clientPrefix
  a.routes = [{ network: networkAddress(a.interfaces[0].ip, config.clientPrefix), prefix: config.clientPrefix, iface: 'eth0' }]
  const sw = device('switch', 'Коммутатор', 'switch', routed ? 320 : 480, [])
  const b = device('b', module === 'dns' ? 'DNS-сервер' : 'Сервер', 'host', 855, [iface('eth0', routed ? '203.0.113.20' : module === 'subnet' ? '192.168.1.200' : '192.168.1.20', '02:00:00:00:00:0b', routed ? 'router' : 'switch')])
  const world: World = { module, devices: { a, switch: sw, b }, links: [{ a: 'a', b: 'switch', connected: true }], acls: {}, nat: [], nextPacket: 1, options: config }
  if (routed) {
    const router = device('router', 'Шлюз', 'router', 580, [iface('lan0', '192.168.1.1', '02:00:00:00:01:01', 'switch'), iface('wan0', '203.0.113.1', '02:00:00:00:02:01', 'b')])
    world.devices.router = router
    world.links.push({ a: 'switch', b: 'router', connected: true }, { a: 'router', b: 'b', connected: !config.cableOff })
    if (!config.noGateway) a.routes.push({ network: '0.0.0.0', prefix: 0, gateway: '192.168.1.1', iface: 'eth0' })
    if (module !== 'nat') b.routes.push({ network: '192.168.1.0', prefix: 24, gateway: '203.0.113.1', iface: 'eth0' })
  } else world.links.push({ a: 'switch', b: 'b', connected: !config.cableOff })
  if (module === 'workshop') {
    const lan = world.devices.router!.interfaces[0]
    lan.ip = '192.168.99.1'; lan.up = false
    world.devices.router!.routes = world.devices.router!.routes.filter(r => r.iface !== 'lan0')
  }
  return world
}
export function defaultDraft(module: ModuleId): PacketDraft {
  return { protocol: ['tcp', 'diagnostic', 'workshop'].includes(module) ? 'TCP' : module === 'dns' ? 'UDP' : 'ICMP', destinationIp: ['routing', 'nat', 'diagnostic', 'workshop'].includes(module) ? '203.0.113.20' : module === 'subnet' ? '192.168.1.200' : '192.168.1.20', ttl: 64, sourcePort: 49152, destinationPort: module === 'dns' ? 53 : 80, flags: 'SYN', payload: ['tcp', 'diagnostic', 'workshop'].includes(module) ? '' : 'hello, network', destinationMac: '', dnsName: 'lab.test', mode: 'exchange' }
}
