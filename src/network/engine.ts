/** Deterministic teaching Ethernet/ARP/ICMP model. No host network or clocks. */
export type HostId = 'a' | 'b'
export type DeviceId = HostId | 'switch'
export interface Host {
  id: HostId
  name: string
  ip: string
  mac: string
  connected: boolean
  arp: Record<string, string>
}
export interface Network {
  hosts: Record<HostId, Host>
  macTable: Record<string, HostId>
}
export interface Frame {
  kind: 'ARP request' | 'ARP reply' | 'ICMP request' | 'ICMP reply'
  source: string
  destination: string
  sourceIp: string
  destinationIp: string
}
export interface NetworkEvent {
  id: number
  title: string
  explanation: string
  layer: 'Ethernet' | 'ARP' | 'IP / ICMP' | 'Система'
  from?: DeviceId
  to?: DeviceId
  frame?: Frame
  outcome?: 'success' | 'failure'
}
export interface Snapshot {
  network: Network
  event: NetworkEvent
}
const BROADCAST = 'ff:ff:ff:ff:ff:ff'
export function createNetwork(options: { disconnected?: boolean; remoteSubnet?: boolean } = {}): Network {
  return {
    hosts: {
      a: { id: 'a', name: 'Твой компьютер', ip: '192.168.1.10', mac: '02:00:00:00:00:0a', connected: true, arp: {} },
      b: { id: 'b', name: 'Соседний компьютер', ip: options.remoteSubnet ? '192.168.2.20' : '192.168.1.20', mac: '02:00:00:00:00:0b', connected: !options.disconnected, arp: {} },
    },
    macTable: {},
  }
}
export function initialSnapshot(network: Network): Snapshot {
  return { network: structuredClone(network), event: { id: 0, title: 'Сеть готова к эксперименту', explanation: 'Два компьютера подключены к коммутатору. ARP-таблицы и таблица MAC пусты. Отправь ping и проследи, как устройства узнают друг о друге.', layer: 'Система' } }
}

/** One event per observable decision or frame transit; snapshots own all state. */
export function simulatePing(initial: Network): Snapshot[] {
  const network = structuredClone(initial)
  const snapshots: Snapshot[] = []
  const a = network.hosts.a
  const b = network.hosts.b
  const queue: { from: DeviceId; to: DeviceId; frame: Frame }[] = []
  let pending = false
  let success = false
  const emit = (event: Omit<NetworkEvent, 'id'>) => snapshots.push({ network: structuredClone(network), event: { ...event, id: snapshots.length + 1 } })
  const send = (host: Host, kind: Frame['kind'], target: Host, destination: string) => {
    queue.push({ from: host.id, to: 'switch', frame: { kind, source: host.mac, destination, sourceIp: host.ip, destinationIp: target.ip } })
  }
  emit({ title: `ping ${b.ip}`, explanation: `Компьютер A хочет получить ICMP Echo Reply от ${b.ip}. Сначала он определяет маршрут, затем адрес получателя Ethernet-кадра.`, layer: 'IP / ICMP' })
  // This first module deliberately has fixed /24 routes and no default gateway.
  if (a.ip.split('.').slice(0, 3).join('.') !== b.ip.split('.').slice(0, 3).join('.')) {
    emit({ title: 'Нет маршрута до другой сети', explanation: `${b.ip} не входит в локальную сеть ${a.ip.split('.').slice(0, 3).join('.')}.0/24. Маршрут по умолчанию отсутствует. Нужен шлюз: коммутатор не маршрутизирует IP-пакеты. ARP-запрос к удалённому компьютеру не отправляется.`, layer: 'IP / ICMP', outcome: 'failure' })
    return snapshots
  }
  emit({ title: 'Получатель находится в локальной сети', explanation: 'Маршрут 192.168.1.0/24 → eth0: пакет можно доставить напрямую. Для Ethernet нужен MAC получателя; одного IP недостаточно.', layer: 'IP / ICMP' })
  if (a.arp[b.ip]) {
    emit({ title: 'MAC уже есть в ARP-таблице', explanation: `${b.ip} → ${a.arp[b.ip]}. Повторный ARP-обмен не нужен: сразу формируем кадр с ICMP Echo Request.`, layer: 'ARP' })
    send(a, 'ICMP request', b, a.arp[b.ip])
  } else {
    pending = true
    emit({ title: 'Нужен MAC: запускаем ARP', explanation: `Записи для ${b.ip} нет. ICMP ждёт разрешения адреса. ARP спрашивает всю локальную сеть: «У кого ${b.ip}? Сообщите ${a.ip}».`, layer: 'ARP' })
    send(a, 'ARP request', b, BROADCAST)
  }
  while (queue.length) {
    const transit = queue.shift()!
    const { from, to, frame } = transit
    emit({ title: `${frame.kind}: ${from === 'switch' ? 'коммутатор' : from.toUpperCase()} → ${to === 'switch' ? 'коммутатор' : to.toUpperCase()}`, explanation: `Ethernet: ${frame.source} → ${frame.destination}. ${frame.kind.startsWith('ARP') ? 'ARP передаётся прямо внутри Ethernet, без IP-заголовка.' : `Внутри кадра IP-пакет ${frame.sourceIp} → ${frame.destinationIp}, внутри IP — ICMP.`}`, layer: 'Ethernet', ...transit })
    if (to === 'switch') {
      const port = from as HostId
      network.macTable[frame.source] = port
      emit({ title: `Коммутатор запомнил MAC на порту ${port.toUpperCase()}`, explanation: `Источник ${frame.source} доступен через порт ${port.toUpperCase()}. Таблица обучается по MAC источника входящего кадра; ARP и IP коммутатору для этого не нужны.`, layer: 'Ethernet' })
      const known = network.macTable[frame.destination]
      const ports: HostId[] = frame.destination === BROADCAST || !known ? (['a', 'b'] as HostId[]).filter(id => id !== port) : known === port ? [] : [known]
      emit({ title: frame.destination === BROADCAST ? 'Широковещательный кадр: рассылка' : known ? `Известный MAC: только порт ${known.toUpperCase()}` : 'Неизвестный MAC: рассылка', explanation: frame.destination === BROADCAST || !known ? 'Коммутатор отправляет копию на остальные подключённые порты, кроме входного. В этой топологии другой порт только один.' : 'Таблица MAC определяет выходной порт. Адреса кадра остаются прежними.', layer: 'Ethernet' })
      for (const id of ports) {
        if (network.hosts[id].connected) queue.push({ from: 'switch', to: id, frame })
        else emit({ title: `Порт ${id.toUpperCase()}: кабель отключён`, explanation: 'На отключённый интерфейс кадр доставить невозможно. Исправный адрес не заменяет физическое соединение.', layer: 'Ethernet' })
      }
    } else {
      const host = network.hosts[to]
      if (frame.destination !== BROADCAST && frame.destination !== host.mac) continue
      if (frame.kind === 'ARP request' && frame.destinationIp === host.ip) {
        host.arp[frame.sourceIp] = frame.source
        emit({ title: `${to.toUpperCase()} узнал MAC отправителя`, explanation: `ARP-запрос содержит пару ${frame.sourceIp} → ${frame.source}. Получатель сохраняет её и отвечает своим MAC напрямую отправителю.`, layer: 'ARP' })
        send(host, 'ARP reply', a, frame.source)
      } else if (frame.kind === 'ARP reply' && frame.destinationIp === host.ip) {
        host.arp[frame.sourceIp] = frame.source
        emit({ title: 'ARP завершён: IP связан с MAC', explanation: `${frame.sourceIp} → ${frame.source}. Теперь ожидавший ICMP Echo Request можно поместить в Ethernet-кадр.`, layer: 'ARP' })
        if (pending && to === 'a') { pending = false; send(a, 'ICMP request', b, frame.source) }
      } else if (frame.kind === 'ICMP request' && frame.destinationIp === host.ip) {
        emit({ title: 'B получил Echo Request', explanation: 'MAC совпал с интерфейсом, IP — с адресом компьютера. ICMP формирует Echo Reply. MAC компьютера A уже известен из ARP-запроса.', layer: 'IP / ICMP' })
        send(host, 'ICMP reply', a, host.arp[a.ip])
      } else if (frame.kind === 'ICMP reply' && to === 'a' && frame.destinationIp === a.ip) success = true
    }
  }
  emit({ title: success ? 'Ответ получен — связь работает' : 'Ответ не получен — ожидание завершено', explanation: success ? 'Echo Reply вернулся в A. Сравни ARP-таблицы компьютеров и таблицу MAC коммутатора. Повтори ping: изученные адреса сохраняются, и ARP-обмен исчезнет.' : 'В этой учебной модели отправляется одна попытка без повторов и реального таймера. Вернись по событиям и найди, где доставка остановилась.', layer: 'IP / ICMP', outcome: success ? 'success' : 'failure' })
  return snapshots
}
