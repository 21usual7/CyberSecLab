export type DeviceId = 'a' | 'switch' | 'router' | 'b'
export type ModuleId = 'ethernet' | 'routing' | 'nat' | 'tcp' | 'dns' | 'subnet' | 'diagnostic' | 'workshop'
export type Protocol = 'ICMP' | 'TCP' | 'UDP'
export interface Interface { name: string; ip: string; prefix: number; mac: string; peer: DeviceId; up?: boolean; aclIn?: string }
export interface Route { network: string; prefix: number; gateway?: string; iface: string }
export interface Device {
  id: DeviceId; name: string; kind: 'host' | 'switch' | 'router'; x: number; y: number
  interfaces: Interface[]; routes: Route[]; arp: Record<string, string>; fdb: Record<string, DeviceId>
  sockets: Record<string, string>; dnsCache: Record<string, string>
}
export interface AddressMatch { ip: string; wildcard: string }
export interface ACLRule { action: 'permit' | 'deny'; protocol: 'ip' | 'tcp' | 'udp' | 'icmp'; source: AddressMatch; destination: AddressMatch; port?: number; hits: number }
export interface NatEntry { privateIp: string; privatePort: number; publicIp: string; publicPort: number; remoteIp: string; remotePort: number; protocol: Protocol }
export interface World {
  module: ModuleId; devices: Partial<Record<DeviceId, Device>>
  links: { a: DeviceId; b: DeviceId; connected: boolean }[]
  acls: Record<string, ACLRule[]>; nat: NatEntry[]; nextPacket: number; options: WorldOptions
}
export interface WorldOptions { cableOff: boolean; noGateway: boolean; natEnabled: boolean; blockPort: number; dnsDown: boolean; clientPrefix: number }
export interface Packet {
  id: number; protocol: Protocol; sourceIp: string; destinationIp: string; ttl: number
  sourcePort: number; destinationPort: number; flags: string; seq: number; ack: number
  payload: string; label: string; icmpType?: number; dnsName?: string; dnsAnswer?: string; dnsResponse?: boolean
}
export interface Frame {
  kind: 'ARP request' | 'ARP reply' | 'IP'
  source: string; destination: string; sourceIp: string; destinationIp: string; packet?: Packet
}
export interface NetworkEvent {
  id: number; title: string; explanation: string; why: string; tryThis?: string
  layer: string; at?: DeviceId; from?: DeviceId; to?: DeviceId; frame?: Frame; packet?: Packet
  phase: 'idle' | 'build' | 'decision' | 'flight' | 'receive' | 'drop' | 'done'
  outcome?: 'success' | 'failure'; code?: string
}
export interface Snapshot { network: World; event: NetworkEvent }
export interface PacketDraft {
  protocol: Protocol; destinationIp: string; ttl: number; sourcePort: number; destinationPort: number
  flags: string; payload: string; destinationMac: string; dnsName: string
  mode: 'exchange' | 'raw' | 'syn' | 'http'
}
export const BROADCAST = 'ff:ff:ff:ff:ff:ff'
export const DEFAULT_OPTIONS: WorldOptions = { cableOff: false, noGateway: false, natEnabled: true, blockPort: -1, dnsDown: false, clientPrefix: 24 }
