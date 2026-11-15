import { useState } from 'react'
import type { DeviceId, Snapshot } from './types'
import { ProcessingView } from './LearningPanels'
const LAYERS = [
  { id: 'ethernet', title: 'Ethernet', question: 'Кому на этом участке?', description: 'Кадр адресован соседнему интерфейсу. Коммутатор использует MAC назначения; на маршрутизаторе эта оболочка заменяется.' },
  { id: 'ip', title: 'IPv4', question: 'Куда в итоге?', description: 'Конечные IP-адреса определяют маршрут. TTL меняется на маршрутизаторе. NAT отдельно может изменить адреса.' },
  { id: 'transport', title: 'Транспорт', question: 'Какой разговор?', description: 'TCP использует порты, флаги и номера последовательности. UDP адресует датаграмму сервису. ICMP сообщает состояние IP-доставки.' },
  { id: 'data', title: 'Данные', question: 'Что передаём?', description: 'Полезная нагрузка получает смысл на уровне приложения. Те же байты вложены в транспорт, IP и Ethernet.' },
]
export function PacketInspector({ snapshot }: { snapshot: Snapshot }) {
  const [layer, setLayer] = useState('ethernet')
  const event = snapshot.event
  const packet = event.packet || event.frame?.packet
  const arp = event.frame?.kind.startsWith('ARP')
  const info = LAYERS.find(l => l.id === layer)!
  return <section className="panel net-packet-inspector">
    <div className="net-panel-heading"><span className="net-eyebrow">РАЗРЕЗ ПАКЕТА</span><span className="mono">{packet ? '#' + packet.id : arp ? 'ARP' : 'ожидание'}</span></div>
    <div className="net-layer-stack">{LAYERS.map((item, i) => <button key={item.id} className={`${item.id === layer ? 'active' : ''} layer-${i}`} onClick={() => setLayer(item.id)} aria-pressed={item.id === layer}><span>{arp && i === 1 ? 'ARP' : item.title}</span><small>{arp && i === 1 ? 'IP → MAC соседа' : item.question}</small></button>)}</div>
    <p className="net-inspector-context">{arp ? 'У ARP нет IP- и транспортного заголовка: он передаётся прямо внутри Ethernet.' : info.description}</p>
    {layer === 'ethernet' ? <dl className="net-packet-fields"><dt>MAC источника</dt><dd>{event.frame?.source || 'определится при отправке'}</dd><dt>MAC назначения</dt><dd>{event.frame?.destination || 'зависит от следующего узла'}</dd><dt>Содержимое</dt><dd>{event.frame?.kind === 'IP' ? 'IPv4' : event.frame?.kind || '—'}</dd></dl>
      : layer === 'ip' ? <dl className="net-packet-fields"><dt>{arp ? 'ARP: отправитель' : 'IP источника'}</dt><dd>{packet?.sourceIp || event.frame?.sourceIp || '—'}</dd><dt>{arp ? 'ARP: искомый IP' : 'IP назначения'}</dt><dd>{packet?.destinationIp || event.frame?.destinationIp || '—'}</dd>{!arp && <><dt>TTL</dt><dd>{packet?.ttl ?? '—'}</dd></>}</dl>
      : layer === 'transport' ? <dl className="net-packet-fields"><dt>Протокол</dt><dd>{arp ? 'Нет: ARP' : packet?.protocol || '—'}</dd>{packet?.protocol === 'ICMP' ? <><dt>ICMP Type</dt><dd>{packet.icmpType}</dd><dt>Сообщение</dt><dd>{packet.label}</dd>{[0, 8].includes(packet.icmpType ?? -1) && <><dt>Echo Identifier</dt><dd>{packet.icmpType === 0 ? packet.destinationPort : packet.sourcePort}</dd></>}</> : packet && <><dt>Порты</dt><dd>{packet.sourcePort} → {packet.destinationPort}</dd>{packet.protocol === 'TCP' && <><dt>Флаги</dt><dd>{packet.flags}</dd><dt>SEQ / ACK</dt><dd>{packet.seq} / {packet.ack}</dd></>}</>}</dl>
      : <pre className="net-payload">{packet?.payload || (arp ? 'ARP сообщает пару IP/MAC, а не пользовательские данные.' : 'Выбери событие с пакетом или отправь свой.')}</pre>}
  </section>
}
function Table({ rows, empty }: { rows: [string, string][]; empty: string }) {
  return <div className="net-state-table">{rows.length ? rows.map(([key, value]) => <div key={key}><span>{key}</span><b>{value}</b></div>) : <p>{empty}</p>}</div>
}
export function DeviceInspector({ snapshot, selected, onSelect }: { snapshot: Snapshot; selected: DeviceId; onSelect: (id: DeviceId) => void }) {
  const { network } = snapshot
  const device = network.devices[selected] || network.devices.a!
  return <section className="panel net-device-inspector">
    <div className="net-panel-heading"><span className="net-eyebrow">ПАМЯТЬ УСТРОЙСТВА</span><span className="net-small-tag">Состояние в выбранный момент</span></div>
    <div className="net-device-tabs">{Object.values(network.devices).map(d => <button key={d.id} className={d.id === device.id ? 'active' : ''} aria-pressed={d.id === device.id} onClick={() => onSelect(d.id)}>{d.name}</button>)}</div>
    <ProcessingView snapshot={snapshot} selected={device.id} />
    <details className="net-device-tables"><summary>Таблицы и интерфейсы</summary><div className="net-state-grid">
      {device.kind !== 'switch' && <><div><h3>Интерфейсы</h3><Table rows={device.interfaces.map(i => [`${i.name} · ${i.ip}/${i.prefix}`, i.mac])} empty="Нет интерфейсов" /></div><div><h3>Маршруты <span>наиболее специфичный первым</span></h3><Table rows={[...device.routes].sort((a, b) => b.prefix - a.prefix).map(r => [`${r.network}/${r.prefix}`, `${r.gateway || 'напрямую'} → ${r.iface}`])} empty="Маршрутов нет" /></div><div><h3>ARP <span>IP → MAC</span></h3><Table rows={Object.entries(device.arp)} empty="Пусто: соседей ещё не узнали." /></div></>}
      {device.kind === 'switch' && <div><h3>Таблица MAC <span>MAC → порт</span></h3><Table rows={Object.entries(device.fdb).map(([mac, port]) => [mac, port.toUpperCase()])} empty="Пока ни один кадр не научил коммутатор расположению MAC." /></div>}
      {device.kind === 'router' && network.module === 'nat' && <div className="net-nat-state"><h3>NAT <span>внутренний ↔ внешний</span></h3><Table rows={network.nat.map(n => [`${n.privateIp}:${n.privatePort}`, `${n.publicIp}:${n.publicPort} · ${n.protocol}`])} empty="Пока нет исходящих соответствий." /></div>}
      {network.module === 'tcp' && device.kind === 'host' && <div><h3>Состояния TCP</h3><Table rows={Object.entries(device.sockets)} empty={device.id === 'b' ? 'LISTEN TCP/22, TCP/80. Соединений пока нет.' : 'Соединений пока нет.'} /></div>}
      {network.module === 'dns' && device.id === 'a' && <div><h3>DNS-кэш</h3><Table rows={Object.entries(device.dnsCache)} empty="Имена ещё не разрешены." /></div>}
      {device.kind === 'switch' && <p className="net-muted">Коммутатор читает MAC-адреса Ethernet. IP, TTL, TCP-порты и данные он при обычной L2-пересылке не изменяет.</p>}
    </div></details>
  </section>
}
