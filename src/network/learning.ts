import type { PacketDraft, Snapshot, World } from './types'
export interface Prediction { question: string; options: { value: string; title: string }[]; answer: string; evidence: number; explanation: string }
export interface Attempt { world: World; draft: PacketDraft; trace: Snapshot[]; prediction?: Prediction; choice?: string }
export function makePrediction(world: World, draft: PacketDraft, trace: Snapshot[]): Prediction {
  if (draft.protocol === 'TCP' && draft.flags === 'SYN') {
    const evidence = trace.findIndex(s => s.event.to === 'a' && s.event.packet?.protocol === 'TCP')
    const packet = trace[evidence]?.event.packet
    const answer = packet?.flags === 'SYN,ACK' ? 'open' : packet?.flags.includes('RST') ? 'reset' : 'silence'
    return { question: 'Что клиент получит в ответ на SYN?', options: [{ value: 'open', title: 'SYN,ACK' }, { value: 'reset', title: 'RST' }, { value: 'silence', title: 'TCP-ответа не будет' }], answer, evidence: evidence < 0 ? trace.length - 1 : evidence, explanation: answer === 'open' ? 'Ответил слушающий TCP-сокет. Соединение ещё требует третьего ACK.' : answer === 'reset' ? 'TCP-стек ответил сбросом. Запрос и обратный ответ прошли сеть.' : 'TCP-ответ не вернулся. Причину нужно искать по первому отказу, а не угадывать по тишине.' }
  }
  if (draft.protocol === 'UDP' && draft.destinationPort === 53) {
    const codes = trace.map(s => s.event.code)
    const answer = codes.includes('dns-cache') ? 'cache' : codes.includes('dns-cached') ? 'answer' : codes.includes('nxdomain') ? 'missing' : 'failure'
    const code = { cache: 'dns-cache', answer: 'dns-cached', missing: 'nxdomain', failure: 'failure' }[answer]
    const evidence = trace.findIndex(s => s.event.code === code)
    return { question: 'Как разрешится это DNS-имя?', options: [{ value: 'cache', title: 'Из кэша, без сети' }, { value: 'answer', title: 'Сервер вернёт адрес' }, { value: 'missing', title: 'Ответит NXDOMAIN' }, { value: 'failure', title: 'Ответ DNS не придёт' }], answer, evidence: Math.max(0, evidence), explanation: trace[evidence]?.event.explanation || 'Проверь путь запроса и ответа.' }
  }
  const index = trace.findIndex(s => s.event.phase === 'flight' && s.event.from === 'a' && s.event.frame?.kind === 'IP')
  const mac = trace[index]?.event.frame?.destination
  const choices = Object.values(world.devices).flatMap(d => d.interfaces.map(i => ({ value: i.mac, title: `${d.name} · ${i.mac}` })))
  if (draft.destinationMac && !choices.some(c => c.value === draft.destinationMac.toLowerCase())) choices.push({ value: draft.destinationMac.toLowerCase(), title: `Ручной MAC · ${draft.destinationMac}` })
  choices.push({ value: 'none', title: 'IP-кадр не будет отправлен' })
  return { question: 'Кому адресован первый Ethernet-кадр с IP-пакетом?', options: choices, answer: mac || 'none', evidence: index < 0 ? trace.length - 1 : index, explanation: mac ? `На первом участке выбран MAC ${mac}. Конечный IP остаётся ${draft.destinationIp}. ARP-кадры до этого события — отдельный обмен.` : 'Не получилось отправить IP-кадр: сначала должны сработать выбор маршрута и разрешение адреса следующего узла.' }
}
const significant = new Set(['route', 'arp-hit', 'arp-miss', 'manual-mac', 'wrong-mac', 'wrong-ip', 'no-route', 'ttl-expired', 'ttl-decrement', 'snat', 'dnat', 'filtered', 'closed', 'syn-received', 'open', 'established', 'http', 'echo', 'dns-cache', 'dns-answer', 'nxdomain', 'acl-deny', 'acl-permit', 'success', 'failure'])
export function compareAttempts(before: Attempt, after: Attempt) {
  const decisions = (attempt: Attempt) => attempt.trace.map((snapshot, index) => ({ snapshot, index })).filter(item => significant.has(item.snapshot.event.code || ''))
  const left = decisions(before), right = decisions(after)
  const signature = (item: typeof left[number] | undefined) => item ? JSON.stringify([item.snapshot.event.code, item.snapshot.event.at, item.snapshot.event.title, item.snapshot.event.explanation]) : ''
  let index = 0
  while (index < Math.max(left.length, right.length) && signature(left[index]) === signature(right[index])) index++
  const changes: string[] = []
  const labels: Partial<Record<keyof PacketDraft, string>> = { ttl: 'TTL', protocol: 'Протокол', destinationIp: 'IP назначения', destinationMac: 'MAC назначения', sourcePort: 'Порт клиента', destinationPort: 'Порт сервера', payload: 'Данные', mode: 'Режим клиента', flags: 'Флаги', dnsName: 'DNS-имя' }
  const value = (input: unknown) => { const text = String(input || 'авто'); return text.length > 80 ? text.slice(0, 80) + '…' : text }
  for (const key of Object.keys(before.draft) as (keyof PacketDraft)[]) if (before.draft[key] !== after.draft[key]) changes.push(`${labels[key] || key}: ${value(before.draft[key])} → ${value(after.draft[key])}`)
  if (before.world.options.clientPrefix !== after.world.options.clientPrefix) changes.push(`Маска клиента: /${before.world.options.clientPrefix} → /${after.world.options.clientPrefix}`)
  if (JSON.stringify({ ...before.world.options, clientPrefix: 24 }) !== JSON.stringify({ ...after.world.options, clientPrefix: 24 })) changes.push('Изменены условия сети')
  if (JSON.stringify(before.world.devices.a?.arp) !== JSON.stringify(after.world.devices.a?.arp)) changes.push('Изменился ARP-кэш клиента')
  if (JSON.stringify(before.world.devices.router?.interfaces) !== JSON.stringify(after.world.devices.router?.interfaces) || JSON.stringify(before.world.acls, (key, value) => key === 'hits' ? undefined : value) !== JSON.stringify(after.world.acls, (key, value) => key === 'hits' ? undefined : value) || JSON.stringify(before.world.devices.router?.routes) !== JSON.stringify(after.world.devices.router?.routes)) changes.push('Изменена конфигурация шлюза')
  return { changes, before: left[index], after: right[index], equal: index >= Math.max(left.length, right.length) }
}
export type Fault = 'route' | 'cable' | 'filter'
export const FAULTS: Fault[] = ['route', 'cable', 'filter']
export function diagnosticOptions(fault: Fault) { return { noGateway: fault === 'route', cableOff: fault === 'cable', blockPort: fault === 'filter' ? 80 : -1 } }
