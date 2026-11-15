import { useId } from 'react'
import type { DeviceId, Snapshot } from './types'

/** Continuous renderer: packet motion is driven by the same paused playhead as state. */
export function NetworkScene({ snapshot, selected, onSelect, progress }: {
  snapshot: Snapshot; selected: DeviceId; onSelect: (id: DeviceId) => void; progress: number
}) {
  const unique = useId().replaceAll(':', '')
  const { network, event } = snapshot
  const devices = Object.values(network.devices)
  const source = event.from ? network.devices[event.from] : undefined
  const target = event.to ? network.devices[event.to] : undefined
  const packet = event.packet
  const arp = event.frame?.kind.startsWith('ARP')
  const color = arp ? 'var(--spec)' : packet?.protocol === 'TCP' ? '#b49aff' : packet?.protocol === 'UDP' ? '#79b7ff' : 'var(--accent)'
  const phase = Math.min(1, Math.max(0, progress))
  const px = source && target ? source.x + (target.x - source.x) * phase : 0
  const py = source?.y || 195
  const currentDevice = event.at || event.to
  return <svg className="net-world" viewBox="0 0 960 380" role="group" aria-label="Живая схема сети. Нажми на устройство, чтобы открыть его состояние.">
    <defs>
      <pattern id={`grid-${unique}`} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="var(--border)" /></pattern>
      <filter id={`glow-${unique}`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5" /></filter>
      <linearGradient id={`screen-${unique}`} x2="1" y2="1"><stop stopColor="var(--panel)" /><stop offset="1" stopColor="var(--panel-2)" /></linearGradient>
    </defs>
    <rect width="960" height="380" fill={`url(#grid-${unique})`} />
    <text x="32" y="34" className="net-zone-label">{network.module === 'subnet' ? 'ОБЩИЙ ETHERNET · МАСКА ОПРЕДЕЛЯЕТ IP-СОСЕДСТВО' : network.devices.router ? 'LAN / 192.168.1.0/24' : 'ETHERNET / 192.168.1.0/24'}</text>
    {network.devices.router && <><path d="M 680 52 V 350" className="net-boundary" /><text x="705" y="34" className="net-zone-label">WAN / 203.0.113.0/24</text></>}
    {network.links.map(link => {
      const a = network.devices[link.a]!, b = network.devices[link.b]!
      const visibleConnected = link.connected || network.module === 'diagnostic' && event.phase === 'idle'
      const active = source && target && ((source.id === a.id && target.id === b.id) || (source.id === b.id && target.id === a.id))
      return <g key={link.a + link.b}>
        <path d={`M ${a.x} ${a.y} H ${b.x}`} className={`net-cable ${visibleConnected ? '' : 'off'}`} />
        <path d={`M ${a.x} ${a.y + 6} H ${b.x}`} className="net-cable-shadow" />
        <text x={(a.x + b.x) / 2} y={a.y + 40} className="net-wire-label">{visibleConnected ? 'Ethernet' : '✕ кабель отключён'}</text>
        {active && <><path d={`M ${source.x} ${source.y} H ${target.x}`} stroke={color} strokeWidth="3" opacity=".17" /><path d={`M ${source.x} ${source.y} H ${px}`} stroke={color} strokeWidth="3" opacity=".8" /></>}
      </g>
    })}
    {devices.map(device => {
      const x = device.x, y = device.y
      const active = currentDevice === device.id
      return <g key={device.id} className={`net-machine ${selected === device.id ? 'selected' : ''} ${active ? 'active' : ''}`} role="button" tabIndex={0} aria-label={`Состояние: ${device.name}`} onClick={() => onSelect(device.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(device.id) } }}>
        <ellipse cx={x} cy={y + 65} rx="65" ry="12" fill="var(--bg)" opacity=".65" />
        <rect className="net-machine-body" x={x - 58} y={y - 54} width="116" height="108" rx="14" fill={`url(#screen-${unique})`} />
        {active && <rect x={x - 65} y={y - 61} width="130" height="122" rx="21" fill="none" stroke={event.phase === 'drop' ? 'var(--danger)' : color} opacity=".3" strokeWidth="2" />}
        {device.kind === 'host' ? <>
          <rect x={x - 39} y={y - 37} width="78" height="51" rx="5" className="net-screen" />
          <text x={x - 30} y={y - 19} className="net-screen-text">{device.id === 'a' ? '> craft packet' : network.module === 'dns' ? ':53 DNS' : ':22 :80 LISTEN'}</text>
          <path d={`M ${x - 29} ${y - 8} h 21 M ${x - 29} ${y} h 41`} stroke="var(--accent)" opacity=".35" />
          <path d={`M ${x} ${y + 15} v 13 M ${x - 17} ${y + 29} h 34`} className="net-machine-lines" />
          <rect x={x - 18} y={y + 41} width="36" height="6" rx="2" fill="var(--border)" />
        </> : device.kind === 'switch' ? <>
          <text x={x} y={y - 26} className="net-hardware-label">L2 SWITCH</text>
          <rect x={x - 43} y={y - 12} width="86" height="36" rx="6" className="net-screen" />
          {[-29, -10, 9, 28].map((offset, index) => <g key={offset}><rect x={x + offset - 6} y={y - 1} width="12" height="13" rx="1" fill="var(--border)" /><circle cx={x + offset} cy={y + 19} r="2" fill={index < network.links.filter(l => l.a === 'switch' || l.b === 'switch').length ? 'var(--accent)' : 'var(--text-dim)'} /></g>)}
          <text x={x} y={y + 42} className="net-hardware-label">MAC → PORT</text>
        </> : <>
          <text x={x} y={y - 27} className="net-hardware-label">L3 ROUTER</text>
          <path d={`M ${x - 31} ${y - 5} h 62 m -9 -8 9 8 -9 8 M ${x + 31} ${y + 16} h -62 m 9 -8 -9 8 9 8`} className="net-machine-lines" />
          <text x={x} y={y + 43} className="net-hardware-label">LAN ↔ WAN</text>
        </>}
        <circle cx={x + 46} cy={y - 41} r="3" fill={active && event.phase === 'drop' ? 'var(--danger)' : 'var(--accent)'} />
        <text x={x} y={y + 92} className="net-device-name">{device.name}</text>
        <text x={x} y={y + 112} className="net-device-address">{device.interfaces[0]?.ip || 'обучение по кадрам'}</text>
        <text x={x} y={y + 130} className="net-device-micro">{device.kind === 'router' ? '2 интерфейса · маршрутизация' : device.kind === 'switch' ? `${Object.keys(device.fdb).length} MAC в таблице` : `${Object.keys(device.arp).length} ARP · ${Object.keys(device.sockets).length} сокетов`}</text>
      </g>
    })}
    {source && target && <g className="net-flying" style={{ color }} aria-label={`Пакет в полёте: ${event.frame?.kind === 'IP' ? packet?.label : event.frame?.kind}`}>
      {[1, 2, 3, 4, 5].map(i => { const p = Math.max(0, phase - i * .025); return <circle key={i} cx={source.x + (target.x - source.x) * p} cy={py} r={6 - i * .7} fill={color} opacity={.5 - i * .07} /> })}
      <circle cx={px} cy={py} r="13" fill={color} opacity=".55" filter={`url(#glow-${unique})`} />
      <g transform={`translate(${px},${py})`}><rect x="-11" y="-7" width="22" height="14" rx="3" fill={color} /><path d="M -8 -4 L 0 2 L 8 -4" fill="none" stroke="var(--bg)" strokeWidth="1.5" /></g>
      <g transform={`translate(${Math.min(865, Math.max(95, px))},${py - 98})`}>
        <path d="M 0 66 V 84" stroke={color} opacity=".5" />
        <rect x="-87" y="-3" width="174" height="69" rx="9" fill="var(--panel-2)" stroke={color} />
        <rect x="-80" y="5" width="4" height="52" rx="2" fill={color} />
        <text x="-66" y="20" fill={color} fontSize="12" fontFamily="var(--mono)">{arp ? event.frame!.kind : packet?.label}</text>
        <text x="-66" y="37" className="net-flying-detail">{arp ? 'Ethernet / ARP' : `IPv4 / ${packet?.protocol} · TTL ${packet?.ttl}`}</text>
        <text x="-66" y="52" className="net-flying-detail">{Math.round(phase * 100)}% участка · #{packet?.id || 'ARP'}</text>
      </g>
      <circle cx={target.x} cy={target.y} r={20 + phase * 55} fill="none" stroke={color} opacity={phase > .8 ? (1 - phase) * 3 : 0} />
    </g>}
  </svg>
}
