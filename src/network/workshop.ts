import { createNetwork, defaultDraft, simulate } from './engine'
import { contains, ipNumber, networkAddress, prefixMask, validIp } from './topology'
import type { ACLRule, AddressMatch, PacketDraft, Snapshot, World } from './types'
export interface CliContext { mode: 'user' | 'privileged' | 'config' | 'interface'; iface?: string; hostname: string }
export const INITIAL_CLI: CliContext = { mode: 'user', hostname: 'Router' }
export function prompt(context: CliContext) { return context.hostname + ({ user: '>', privileged: '#', config: '(config)#', interface: '(config-if)#' })[context.mode] }
export function maskPrefix(mask: string): number {
  if (!validIp(mask)) throw new Error('Некорректная IPv4-маска.')
  const bits = ipNumber(mask).toString(2).padStart(32, '0')
  if (!/^1*0*$/.test(bits)) throw new Error('Биты маски должны быть непрерывными.')
  return bits.indexOf('0') < 0 ? 32 : bits.indexOf('0')
}
export function clearLearned(world: World) {
  for (const device of Object.values(world.devices)) { device.arp = {}; device.fdb = {}; device.sockets = {}; device.dnsCache = {} }
  world.nat = []
}
function rebuild(world: World) {
  const router = world.devices.router!
  router.routes = [...router.interfaces.filter(i => i.up !== false).map(i => ({ network: networkAddress(i.ip, i.prefix), prefix: i.prefix, iface: i.name })), ...router.routes.filter(r => r.gateway)]
  clearLearned(world)
}
function address(words: string[], index: number): { value: AddressMatch; next: number } {
  if (words[index] === 'any') return { value: { ip: '0.0.0.0', wildcard: '255.255.255.255' }, next: index + 1 }
  if (words[index] === 'host' && validIp(words[index + 1] || '')) return { value: { ip: words[index + 1], wildcard: '0.0.0.0' }, next: index + 2 }
  if (validIp(words[index] || '') && validIp(words[index + 1] || '')) return { value: { ip: words[index], wildcard: words[index + 1] }, next: index + 2 }
  throw new Error('Адрес ACL: any, host <IP> или <IP> <wildcard>.')
}
function matchText(match: AddressMatch) { return match.wildcard === '255.255.255.255' ? 'any' : match.wildcard === '0.0.0.0' ? 'host ' + match.ip : match.ip + ' ' + match.wildcard }
export function aclText(rule: ACLRule) { return `${rule.action} ${rule.protocol} ${matchText(rule.source)} ${matchText(rule.destination)}${rule.port === undefined ? '' : ' eq ' + rule.port}` }
export function runningConfig(world: World, hostname = 'Router') {
  const router = world.devices.router!
  return ['enable', 'configure terminal', `hostname ${hostname}`, ...Object.entries(world.acls).flatMap(([name, rules]) => rules.map(rule => `access-list ${name} ${aclText(rule)}`)), ...router.interfaces.flatMap(i => [`interface ${i.name === 'lan0' ? 'GigabitEthernet0/0' : 'GigabitEthernet0/1'}`, ` ip address ${i.ip} ${prefixMask(i.prefix)}`, i.up === false ? ' shutdown' : ' no shutdown', ...(i.aclIn ? [` ip access-group ${i.aclIn} in`] : []), 'exit']), ...router.routes.filter(r => r.gateway).map(r => `ip route ${r.network} ${prefixMask(r.prefix)} ${r.gateway}`), 'end'].join('\n')
}
export const CLI_HELP = `Учебное подмножество CLI в стиле IOS (не эмулятор Cisco):
enable / configure terminal / exit / end
hostname <имя>
interface GigabitEthernet0/0 (LAN) или GigabitEthernet0/1 (WAN)
ip address <IPv4> <маска> / shutdown / no shutdown
ip route <сеть> <маска> <next-hop>
access-list <100..199> permit|deny ip|tcp|udp|icmp <source> <destination> [eq <порт>]
  Адрес: any | host <IP> | <IP> <wildcard>
ip access-group <100..199> in   (в режиме интерфейса)
no ip access-group <100..199> in / no access-list <100..199>
show ip interface brief / show ip route / show access-lists / show running-config
ping <IPv4>  (проба от клиента A) / probe tcp <IPv4> <порт>`
export function executeCli(initial: World, previous: CliContext, script: string) {
  const world = structuredClone(initial)
  const context = { ...previous }
  const output: string[] = []
  let changed = false
  let trace: Snapshot[] | undefined
  let probeDraft: PacketDraft | undefined
  const router = world.devices.router!
  const mutate = () => { changed = true; trace = undefined; rebuild(world) }
  const config = () => { if (!['config', 'interface'].includes(context.mode)) throw new Error('Сначала enable, затем configure terminal.') }
  if (script.length > 20000 || script.split('\n').length > 100) return { world, context, output: ['% Не больше 100 строк и 20000 символов за раз.'], changed }
  for (const raw of script.split('\n')) {
    const line = raw.trim().replace(/\s+/g, ' ')
    if (!line || line.startsWith('!')) continue
    output.push(prompt(context) + ' ' + line)
    try {
      const words = line.toLowerCase().split(' ')
      if (line.length > 400) throw new Error('Слишком длинная команда.')
      if (line === '?' || words[0] === 'help') { output.push(CLI_HELP); continue }
      if (words.join(' ') === 'enable') { context.mode = 'privileged'; continue }
      if (['configure terminal', 'conf t'].includes(words.join(' '))) { if (context.mode === 'user') throw new Error('Сначала enable.'); context.mode = 'config'; continue }
      if (words[0] === 'end') { context.mode = 'privileged'; context.iface = undefined; continue }
      if (words[0] === 'exit') { context.mode = context.mode === 'interface' ? 'config' : context.mode === 'config' ? 'privileged' : 'user'; context.iface = undefined; continue }
      if (words[0] === 'show') {
        const command = words.join(' ')
        if (command === 'show ip interface brief') output.push('Interface      IP address       Admin state / ACL in', ...router.interfaces.map(i => `${i.name.padEnd(14)} ${i.ip.padEnd(16)} ${i.up === false ? 'down' : 'up'} / ${i.aclIn || 'none'}`))
        else if (command === 'show ip route') output.push(...router.routes.map(r => `${r.gateway ? 'S' : 'C'} ${r.network}/${r.prefix} via ${r.gateway || r.iface}`))
        else if (command === 'show access-lists') output.push(...Object.entries(world.acls).flatMap(([name, rules]) => [`Extended IP access list ${name}`, ...rules.map((rule, i) => ` ${i + 1}. ${aclText(rule)} (${rule.hits} matches)`) ]), 'Применение: ' + router.interfaces.map(i => `${i.name}: ${i.aclIn || 'none'}`).join(', '))
        else if (command === 'show running-config') output.push(runningConfig(world, context.hostname))
        else throw new Error('Неизвестная show-команда. Введи ? для справки.')
        continue
      }
      if (words[0] === 'ping' || words[0] === 'probe') {
        if (!['user', 'privileged'].includes(context.mode)) throw new Error('Выйди из конфигурации командой end.')
        const tcp = words[0] === 'probe'
        if (tcp && (words[1] !== 'tcp' || words.length !== 4)) throw new Error('probe tcp <IPv4> <порт>')
        if (!tcp && words.length !== 2) throw new Error('ping <IPv4>')
        probeDraft = { ...defaultDraft('workshop'), protocol: tcp ? 'TCP' : 'ICMP', destinationIp: words[tcp ? 2 : 1], destinationPort: tcp ? Number(words[3]) : 80, payload: '', mode: tcp ? 'syn' : 'exchange' }
        trace = simulate(world, probeDraft)
        const final = trace.at(-1)!
        Object.assign(world, structuredClone(final.network))
        output.push('Проба от клиента A: ' + final.event.title)
        continue
      }
      config()
      if (words[0] === 'hostname' && words.length === 2 && /^[a-z][a-z0-9-]{0,30}$/i.test(words[1])) { context.hostname = line.split(' ')[1]; continue }
      if (words[0] === 'interface' && words.length === 2) {
        const name = ({ 'gigabitethernet0/0': 'lan0', 'g0/0': 'lan0', 'lan0': 'lan0', 'gigabitethernet0/1': 'wan0', 'g0/1': 'wan0', 'wan0': 'wan0' } as Record<string, string>)[words[1]]
        if (!name) throw new Error('Доступны GigabitEthernet0/0 (lan0) и GigabitEthernet0/1 (wan0).')
        context.mode = 'interface'; context.iface = name; continue
      }
      const intf = context.mode === 'interface' ? router.interfaces.find(i => i.name === context.iface) : undefined
      if ((words[0] === 'shutdown' && words.length === 1) || words.join(' ') === 'no shutdown') {
        if (!intf) throw new Error('Выбери interface.')
        intf.up = words[0] === 'no'; mutate(); continue
      }
      if (words[0] === 'ip' && words[1] === 'address' && words.length === 4) {
        if (!intf) throw new Error('Выбери interface.')
        if (!validIp(words[2])) throw new Error('Некорректный IPv4-адрес.')
        const prefix = maskPrefix(words[3])
        if (router.interfaces.some(i => i !== intf && i.ip === words[2])) throw new Error('Другой интерфейс уже использует этот IP.')
        intf.ip = words[2]; intf.prefix = prefix; mutate(); continue
      }
      if (words[0] === 'ip' && words[1] === 'route' && words.length === 5) {
        if (!validIp(words[2]) || !validIp(words[4])) throw new Error('Некорректный IPv4-адрес маршрута.')
        const prefix = maskPrefix(words[3])
        const iface = router.interfaces.find(i => contains(words[4], i.ip, i.prefix))
        if (!iface) throw new Error('Next hop должен находиться в сети одного из интерфейсов.')
        const network = networkAddress(words[2], prefix)
        router.routes = router.routes.filter(r => !r.gateway || r.network !== network || r.prefix !== prefix)
        if (router.routes.length >= 32) throw new Error('Лимит 32 маршрута.')
        router.routes.push({ network, prefix, gateway: words[4], iface: iface.name }); mutate(); continue
      }
      if (words[0] === 'access-list') {
        if (!/^1\d\d$/.test(words[1]) || !['permit', 'deny'].includes(words[2]) || !['ip', 'tcp', 'udp', 'icmp'].includes(words[3])) throw new Error('Нужен extended ACL 100..199: permit|deny ip|tcp|udp|icmp ...')
        const source = address(words, 4), destination = address(words, source.next)
        let port: number | undefined
        if (destination.next < words.length) {
          if (!['tcp', 'udp'].includes(words[3]) || words[destination.next] !== 'eq' || words.length !== destination.next + 2) throw new Error('После адресов поддерживается только eq <порт> для TCP/UDP.')
          port = Number(words[destination.next + 1]); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Порт должен быть от 1 до 65535.')
        }
        const rules = world.acls[words[1]] || []
        if (rules.length >= 100) throw new Error('Лимит 100 правил.')
        const rule: ACLRule = { action: words[2] as ACLRule['action'], protocol: words[3] as ACLRule['protocol'], source: source.value, destination: destination.value, port, hits: 0 }
        world.acls[words[1]] = [...rules, rule]; mutate(); continue
      }
      const remove = words[0] === 'no'
      const args = remove ? words.slice(1) : words
      if (args[0] === 'ip' && args[1] === 'access-group' && args.length === 4 && args[3] === 'in') {
        if (!intf) throw new Error('Выбери interface для применения ACL.')
        if (remove) { if (intf.aclIn === args[2]) delete intf.aclIn }
        else { if (!world.acls[args[2]]) throw new Error('Сначала создай ACL.'); intf.aclIn = args[2] }
        mutate(); continue
      }
      if (remove && args[0] === 'access-list' && args.length === 2) {
        if (router.interfaces.some(i => i.aclIn === args[1])) throw new Error('Сначала сними ACL с интерфейса: no ip access-group <номер> in.')
        delete world.acls[args[1]]; mutate(); continue
      }
      throw new Error('Команда не поддерживается учебной моделью. Введи ? для списка.')
    } catch (error) { output.push('% ' + (error instanceof Error ? error.message : 'Ошибка команды')) }
  }
  return { world, context, output, changed, trace, probeDraft }
}
export interface AuditResult { id: string; title: string; expected: string; passed: boolean; reason: string; trace: Snapshot[]; draft: PacketDraft }
export function auditNetwork(initial: World): AuditResult[] {
  const tests: { id: string; title: string; expected: string; protocol: PacketDraft['protocol']; port: number; blocked?: boolean; otherClient?: boolean; mode?: PacketDraft['mode'] }[] = [
    { id: 'icmp', title: 'Клиент .10 → ICMP', expected: 'Echo Reply должен вернуться', protocol: 'ICMP', port: 80 },
    { id: 'http', title: 'Клиент .10 → HTTP/80', expected: 'Полный handshake и HTTP 200', protocol: 'TCP', port: 80, mode: 'http' },
    { id: 'ssh', title: 'Клиент .10 → SSH/22', expected: 'Остановить на ACL шлюза', protocol: 'TCP', port: 22, blocked: true },
    { id: 'other-client', title: 'Другой клиент .30 → HTTP/80', expected: 'Остановить на ACL шлюза', protocol: 'TCP', port: 80, blocked: true, otherClient: true },
    { id: 'udp', title: 'Клиент .10 → UDP/53', expected: 'Остановить на ACL шлюза', protocol: 'UDP', port: 53, blocked: true },
  ]
  return tests.map(test => {
    const world = structuredClone(initial); clearLearned(world)
    if (test.otherClient) world.devices.a!.interfaces[0].ip = '192.168.1.30'
    const draft = { ...defaultDraft('workshop'), protocol: test.protocol, destinationIp: world.devices.b!.interfaces[0].ip, destinationPort: test.port, mode: test.mode || 'exchange', payload: test.mode === 'http' ? 'GET / HTTP/1.1\r\nHost: lab.test\r\n\r\n' : '' }
    const trace = simulate(world, draft)
    const blocked = trace.find(s => s.event.code === 'acl-deny' && s.event.at === 'router' && s.event.packet?.sourceIp === world.devices.a!.interfaces[0].ip && s.event.packet.destinationIp === world.devices.b!.interfaces[0].ip && s.event.packet.protocol === test.protocol && s.event.packet.destinationPort === test.port)
    const success = trace.at(-1)!.event.outcome === 'success'
    const passed = test.blocked ? !!blocked : success && (test.mode !== 'http' || trace.at(-1)!.event.title === 'HTTP/1.1 200 OK')
    return { id: test.id, title: test.title, expected: test.expected, passed, reason: blocked?.event.explanation || trace.find(s => s.event.phase === 'drop')?.event.explanation || trace.at(-1)!.event.title, trace, draft }
  })
}
export function freshWorkshop(): World { return createNetwork('workshop') }
