import type { DeviceId, Snapshot } from './engine'

const positions: Record<DeviceId, [number, number]> = { a: [145, 180], switch: [450, 180], b: [755, 180] }
const names: Record<DeviceId, string> = { a: 'Компьютер A', switch: 'Коммутатор', b: 'Компьютер B' }

/** A replaceable 2D renderer. All decisions and state belong to the engine. */
export function NetworkScene({ snapshot, selected, onSelect, speed, cursor, revision }: {
  snapshot: Snapshot
  selected: DeviceId
  onSelect: (id: DeviceId) => void
  speed: number
  cursor: number
  revision: number
}) {
  const { network, event } = snapshot
  const flight = event.from && event.to ? { start: positions[event.from], end: positions[event.to] } : null
  return (
<svg viewBox="0 0 900 340" role="img" aria-label="Компьютер A соединён с коммутатором, коммутатор — с компьютером B">
          <defs><pattern id="net-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--border)" /></pattern></defs>
          <rect width="900" height="340" fill="url(#net-grid)" />
          <path d="M 145 180 H 450" className="net-wire" />
          <path d="M 450 180 H 755" className={`net-wire ${network.hosts.b.connected ? '' : 'disconnected'}`} />
          <text x="295" y="156" className="net-wire-label">Ethernet</text>
          <text x="605" y="156" className="net-wire-label">{network.hosts.b.connected ? 'Ethernet' : 'Кабель отключён'}</text>
          {(['a', 'switch', 'b'] as DeviceId[]).map(id => {
            const [x, y] = positions[id]
            const active = event.to === id || event.from === id
            return <g key={id} className={`net-device ${selected === id ? 'selected' : ''} ${active ? 'involved' : ''}`} role="button" tabIndex={0} aria-label={`Посмотреть состояние: ${names[id]}`} onClick={() => onSelect(id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id) } }}>
              <rect x={x - 53} y={y - 43} width="106" height="86" rx="16" />
              {id === 'switch' ? <g className="net-icon"><path d={`M ${x - 27} ${y - 13} h 54 v 26 h -54 Z`} />{[-18, -6, 6, 18].map(offset => <path key={offset} d={`M ${x + offset} ${y - 4} v 8`} />)}</g> : <g className="net-icon"><path d={`M ${x - 23} ${y - 20} h 46 v 30 h -46 Z M ${x} ${y + 10} v 11 M ${x - 14} ${y + 21} h 28`} /></g>}
              <text x={x} y={y + 70} className="net-device-name">{names[id]}</text>
              <text x={x} y={y + 92} className="net-device-address">{id === 'switch' ? 'L2 · порты A / B' : network.hosts[id].ip + '/24'}</text>
            </g>
          })}
          {flight && <g key={`${cursor}-${revision}`} className="net-packet" pointerEvents="none">
            <rect x="-24" y="-12" width="48" height="24" rx="6" />
            <text textAnchor="middle" y="4">{event.frame?.kind.startsWith('ARP') ? 'ARP' : 'ICMP'}</text>
            <animateMotion dur={`${speed * 0.8}ms`} fill="freeze" path={`M ${flight.start[0]} ${flight.start[1]} L ${flight.end[0]} ${flight.end[1]}`} />
          </g>}
        </svg>
  )
}
