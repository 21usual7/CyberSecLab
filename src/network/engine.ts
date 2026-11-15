/** Pure, deterministic Ethernet/IPv4/transport teaching model. No host I/O. */
import { BROADCAST } from './types'
import type { Device, DeviceId, Frame, Interface, NetworkEvent, Packet, PacketDraft, Snapshot, World } from './types'
import { findRoute, validIp } from './topology'
export { createNetwork, defaultDraft, findRoute, contains, validIp } from './topology'
export type { DeviceId, Snapshot } from './types'

export function initialSnapshot(network: World): Snapshot {
  return { network: structuredClone(network), event: { id: 0, title: 'Мир ждёт твоего пакета', explanation: 'Выбери эксперимент или собери пакет в конструкторе. Нажимай на устройства: их таблицы изменяются по мере доставки. Пакет можно остановить прямо на линии и разобрать по слоям.', why: 'Устройства знают только своё состояние. Ни у компьютера, ни у коммутатора нет готовой карты всей сети.', tryThis: 'Начни с рабочего обмена. Затем измени одно поле и предскажи результат.', layer: 'Система', phase: 'idle' } }
}
export function validateDraft(draft: PacketDraft): string | null {
  if (!validIp(draft.destinationIp)) return 'Нужен IPv4-адрес: четыре числа от 0 до 255.'
  if (!Number.isInteger(draft.ttl) || draft.ttl < 1 || draft.ttl > 255) return 'TTL должен быть целым числом от 1 до 255.'
  for (const port of [draft.sourcePort, draft.destinationPort]) if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Порты должны быть целыми числами от 1 до 65535.'
  if (draft.destinationMac && !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(draft.destinationMac)) return 'MAC: шесть пар шестнадцатеричных цифр через двоеточие.'
  if (draft.payload.length > 512) return 'В учебном пакете не больше 512 символов данных.'
  if (draft.protocol === 'UDP' && draft.destinationPort === 53 && !/^[a-z0-9.-]{1,253}$/i.test(draft.dnsName)) return 'Имя DNS: от 1 до 253 букв, цифр, точек или дефисов.'
  if (draft.protocol === 'TCP' && !['SYN', 'ACK', 'FIN', 'SYN,ACK', 'PSH,ACK'].includes(draft.flags)) return 'Выбери поддерживаемую комбинацию TCP-флагов.'
  return null
}

export function simulate(initial: World, draft: PacketDraft): Snapshot[] {
  const error = validateDraft(draft)
  if (error) throw new Error(error)
  const world = structuredClone(initial)
  const trace: Snapshot[] = []
  const a = world.devices.a!
  const b = world.devices.b!
  const emit = (event: Omit<NetworkEvent, 'id'>) => {
    if (trace.length >= 240) throw new Error('Превышен лимит событий учебного обмена.')
    trace.push({ network: structuredClone(world), event: structuredClone({ ...event, id: trace.length + 1 }) })
  }
  const decision = (at: DeviceId, title: string, explanation: string, why: string, layer = 'IPv4', code?: string, packet?: Packet) => emit({ at, title, explanation, why, layer, phase: 'decision', code, packet })
  const drop = (at: DeviceId, title: string, explanation: string, code: string, packet?: Packet) => emit({ at, title, explanation, why: 'Найди первое решение, после которого пакет больше не может приблизиться к цели. Отсутствие ответа само по себе не доказывает причину.', layer: 'Диагностика', phase: 'drop', code, packet })
  const make = (values: Partial<Packet> = {}): Packet => ({ id: world.nextPacket++, protocol: draft.protocol, sourceIp: a.interfaces[0].ip, destinationIp: draft.destinationIp, ttl: draft.ttl, sourcePort: draft.sourcePort, destinationPort: draft.destinationPort, flags: draft.flags, seq: 1000, ack: 0, payload: draft.payload, label: draft.protocol === 'ICMP' ? 'Echo Request' : draft.protocol === 'TCP' ? draft.flags : 'UDP datagram', icmpType: draft.protocol === 'ICMP' ? 8 : undefined, ...values })
  const reverse = (packet: Packet, values: Partial<Packet> = {}) => make({ ...packet, id: world.nextPacket++, sourceIp: packet.destinationIp, destinationIp: packet.sourceIp, sourcePort: packet.destinationPort, destinationPort: packet.sourcePort, ttl: 64, ...values })

  // Ethernet delivery follows physical links. Switches inspect MACs, not IPs.
  function ethernet(source: Device, intf: Interface, frame: Frame): { device: Device; frame: Frame }[] {
    const received: { device: Device; frame: Frame }[] = []
    const queue: { from: DeviceId; to: DeviceId }[] = [{ from: source.id, to: intf.peer }]
    while (queue.length) {
      const { from, to } = queue.shift()!
      const link = world.links.find(l => (l.a === from && l.b === to) || (l.b === from && l.a === to))
      if (!link?.connected) { drop(from, 'Линия оборвана: кадр не дошёл', `Между ${world.devices[from]!.name} и ${world.devices[to]!.name} отключён кабель. Адреса верны, но физической доставки нет.`, 'cable', frame.packet); continue }
      const target = world.devices[to]!
      emit({ title: `${frame.kind === 'IP' ? frame.packet!.label : frame.kind}: ${world.devices[from]!.name} → ${target.name}`, explanation: `По линии передаётся Ethernet-кадр: ${frame.source} → ${frame.destination}. ${frame.kind === 'IP' ? `Он несёт ${frame.packet!.protocol} внутри IPv4. Данные «${frame.packet!.payload.slice(0, 70)}» остаются частью пакета.` : 'ARP вложен прямо в Ethernet: IP-заголовка здесь нет.'}`, why: 'На этом участке доставки MAC задаёт ближайшего получателя кадра. IP задаёт конечную цель пакета.', layer: frame.kind === 'IP' ? 'Ethernet → IPv4 → ' + frame.packet!.protocol : 'Ethernet → ARP', phase: 'flight', from, to, frame, packet: frame.packet })
      if (target.kind === 'switch') {
        target.fdb[frame.source] = from
        decision(to, 'Обучение по MAC источника', `${frame.source} → порт ${from.toUpperCase()}. Коммутатор запомнил, откуда пришёл кадр.`, 'Обучение пассивное: отдельный запрос к отправителю не требуется.', 'Ethernet', 'mac-learn', frame.packet)
        const known = target.fdb[frame.destination]
        const links = world.links.filter(l => l.a === to || l.b === to)
        const peers = links.map(l => l.a === to ? l.b : l.a).filter(id => id !== from)
        const outputs = frame.destination === BROADCAST || !known ? peers : peers.filter(id => id === known)
        decision(to, frame.destination === BROADCAST ? 'Broadcast: копия на остальные порты' : known ? `Unicast: выбран порт ${known.toUpperCase()}` : 'Неизвестный MAC: flood', frame.destination === BROADCAST || !known ? 'Адрес не указывает на известный выход. Копии отправляются на остальные порты локального сегмента.' : `Запись ${frame.destination} → ${known} определяет выход. IP-пакет и MAC-адреса коммутатор не изменяет.`, 'Входной порт исключён из рассылки. Это поведение L2; таблица маршрутов здесь не участвует.', 'Ethernet', 'switch-forward', frame.packet)
        outputs.forEach(id => queue.push({ from: to, to: id }))
      } else {
        const incoming = target.interfaces.find(i => i.peer === from)
        if (frame.destination !== BROADCAST && incoming?.mac !== frame.destination) {
          drop(to, 'Сетевая карта отбросила чужой MAC', `Кадр дошёл по кабелю, но ${frame.destination} не совпал с MAC входного интерфейса. До IP и ICMP он не добрался.`, 'wrong-mac', frame.packet)
        } else received.push({ device: target, frame })
      }
    }
    return received
  }

  function resolve(device: Device, intf: Interface, nextHop: string): string | undefined {
    if (device.arp[nextHop]) {
      decision(device.id, 'ARP cache hit: адрес уже известен', `${nextHop} → ${device.arp[nextHop]}. Новый ARP-обмен не нужен.`, 'ARP хранит соответствия для соседей в одном канальном сегменте, включая адрес шлюза.', 'ARP', 'arp-hit')
      return device.arp[nextHop]
    }
    decision(device.id, `Кто имеет ${nextHop}?`, `IP следующего узла известен, но его MAC отсутствует. ARP Request уходит на ff:ff:ff:ff:ff:ff. IP-пакет пока ждёт.`, 'Для удалённой сети ищут MAC шлюза, а не MAC удалённого сервера.', 'ARP', 'arp-miss')
    const request: Frame = { kind: 'ARP request', source: intf.mac, destination: BROADCAST, sourceIp: intf.ip, destinationIp: nextHop }
    const recipients = ethernet(device, intf, request)
    for (const { device: recipient } of recipients) {
      const target = recipient.interfaces.find(i => i.ip === nextHop)
      if (!target) { decision(recipient.id, 'ARP: спрашивают не меня', `${nextHop} не является адресом этого устройства. Оно не отвечает.`, 'Broadcast видят все соседи, но отвечает владелец запрошенного адреса.', 'ARP'); continue }
      recipient.arp[intf.ip] = intf.mac
      decision(recipient.id, 'ARP: мой адрес, отправляю ответ', `${intf.ip} → ${intf.mac} сохранено из запроса. В ответе отправляю собственный MAC ${target.mac}.`, 'Ответ обычно unicast: адрес отправителя уже известен из запроса.', 'ARP')
      const replies = ethernet(recipient, target, { kind: 'ARP reply', source: target.mac, destination: intf.mac, sourceIp: nextHop, destinationIp: intf.ip })
      if (replies.some(result => result.device.id === device.id)) {
        device.arp[nextHop] = target.mac
        decision(device.id, 'ARP: соответствие сохранено', `${nextHop} → ${target.mac}. Ожидающий IP-пакет теперь можно отправить.`, 'Следующая отправка воспользуется этой записью, пока она сохранена.', 'ARP', 'arp-resolved')
        return target.mac
      }
    }
    drop(device.id, 'ARP не получил ответа', `В доступном сегменте не найден ответ на запрос ${nextHop}. Без MAC следующего узла сформировать адресный кадр не удалось.`, 'arp-unanswered')
  }

  /** Routes one IP packet end-to-end, rebuilding Ethernet headers at a router. */
  function deliver(start: Device, original: Packet, manualMac = ''): { device: Device; packet: Packet } | undefined {
    let device = start
    let packet = structuredClone(original)
    for (let hop = 0; hop < 8; hop++) {
      if (device.id === 'router' && hop > 0) {
        if (packet.ttl <= 1) {
          drop('router', 'TTL исчерпан на маршрутизаторе', 'Для пересылки нужно уменьшить TTL. Получился бы ноль: исходный пакет уничтожен. Коммутаторы TTL не уменьшают.', 'ttl-expired', packet)
          const response = make({ protocol: 'ICMP', icmpType: 11, label: 'Time Exceeded', sourceIp: device.interfaces.find(i => i.name === 'lan0')!.ip, destinationIp: original.sourceIp, ttl: 64, payload: 'TTL exceeded', flags: '', sourcePort: 0, destinationPort: 0 })
          deliver(device, response)
          return
        }
        packet.ttl--
        decision('router', `TTL: ${packet.ttl + 1} → ${packet.ttl}`, 'Маршрутизатор уменьшает TTL перед пересылкой. Ethernet-заголовок предыдущего участка уже снят.', 'TTL ограничивает число переходов через маршрутизаторы и останавливает петли.', 'IPv4', 'ttl-decrement', packet)
        if (world.module === 'nat' && world.options.natEnabled) {
          const wan = device.interfaces.find(i => i.name === 'wan0')!
          if (packet.sourceIp.startsWith('192.168.1.') && !packet.destinationIp.startsWith('192.168.1.')) {
            let entry = world.nat.find(n => n.privateIp === packet.sourceIp && n.privatePort === packet.sourcePort && n.protocol === packet.protocol && n.remoteIp === packet.destinationIp && n.remotePort === packet.destinationPort)
            if (!entry) { entry = { privateIp: packet.sourceIp, privatePort: packet.sourcePort, publicIp: wan.ip, publicPort: 40000 + world.nat.length, remoteIp: packet.destinationIp, remotePort: packet.destinationPort, protocol: packet.protocol }; world.nat.push(entry) }
            const before = `${packet.sourceIp}:${packet.sourcePort}`
            packet.sourceIp = entry.publicIp; packet.sourcePort = entry.publicPort
            decision('router', 'SNAT: наружу от имени шлюза', `${before} → ${packet.sourceIp}:${packet.sourcePort}. Соответствие сохранено в NAT-таблице. Для ICMP поле номера в этой модели представляет Echo Identifier, а не порт.`, 'Сервер видит внешний адрес. Таблица позволяет направить ответ обратно нужному внутреннему отправителю.', 'NAT', 'snat', packet)
          } else if (packet.destinationIp === wan.ip) {
            const entry = world.nat.find(n => n.publicPort === packet.destinationPort && n.protocol === packet.protocol && n.remoteIp === packet.sourceIp && n.remotePort === packet.sourcePort)
            if (!entry) { drop('router', 'Нет NAT-соответствия для ответа', 'Внешний адрес принадлежит шлюзу, но записи для этого обмена нет.', 'nat-miss', packet); return }
            packet.destinationIp = entry.privateIp; packet.destinationPort = entry.privatePort
            decision('router', 'Обратный NAT: найден внутренний адрес', `${entry.publicIp}:${entry.publicPort} → ${entry.privateIp}:${entry.privatePort}. Теперь таблица маршрутов направит пакет в LAN.`, 'Трансляция адресов и выбор маршрута — разные операции.', 'NAT', 'dnat', packet)
          }
        }
      }
      const route = findRoute(device, packet.destinationIp)
      if (!route) { drop(device.id, 'Нет маршрута до назначения', `${packet.destinationIp} не совпал ни с одним маршрутом, включая маршрут по умолчанию. Устройство не отправляет ARP наугад.`, 'no-route', packet); return }
      const intf = device.interfaces.find(i => i.name === route.iface)!
      const nextHop = route.gateway || packet.destinationIp
      decision(device.id, route.gateway ? 'Выбран шлюз по умолчанию' : 'Назначение в подключённой сети', `Маршрут ${route.network}/${route.prefix} → ${route.gateway || 'напрямую'}, интерфейс ${intf.name}. Следующий узел: ${nextHop}. Конечный IP: ${packet.destinationIp}.`, 'Выбирается наиболее специфичный подходящий маршрут. Шлюз меняет ближайшего получателя Ethernet, но не конечный IP.', 'IPv4', 'route', packet)
      const mac = hop === 0 && manualMac ? manualMac.toLowerCase() : resolve(device, intf, nextHop)
      if (!mac) return
      if (hop === 0 && manualMac) decision(device.id, 'Ручной MAC: ARP пропущен', `Используем заданный адрес ${mac}, не проверяя, кому он принадлежит.`, 'Конструктор позволяет ошибиться намеренно. Смотри, какой слой первым отвергнет пакет.', 'Ethernet', 'manual-mac', packet)
      const results = ethernet(device, intf, { kind: 'IP', source: intf.mac, destination: mac, sourceIp: packet.sourceIp, destinationIp: packet.destinationIp, packet })
      const recipient = results[0]?.device
      if (!recipient) return
      emit({ at: recipient.id, title: `${recipient.name}: снимаем Ethernet-оболочку`, explanation: `MAC принят. Внутри IPv4: ${packet.sourceIp} → ${packet.destinationIp}, TTL ${packet.ttl}. Дальше решение принимает IP-слой.`, why: 'Доставка кадра к сетевой карте ещё не означает доставку пакета нужному процессу.', layer: 'Ethernet → IPv4', phase: 'receive', packet, code: 'decapsulate' })
      // A NAT reply to the WAN address must be translated before local delivery.
      const natReply = recipient.id === 'router' && world.module === 'nat' && packet.destinationIp === '203.0.113.1'
      if (recipient.interfaces.some(i => i.ip === packet.destinationIp) && !natReply) return { device: recipient, packet }
      if (recipient.kind !== 'router') { drop(recipient.id, 'IP не принадлежит получателю', `Ethernet доставлен сюда, но ${packet.destinationIp} не является адресом этого компьютера. Пересылка на обычном хосте отключена.`, 'wrong-ip', packet); return }
      device = recipient
    }
    drop(device.id, 'Остановлено ограничением переходов', 'Учебный обмен ограничен восемью переходами.', 'hop-limit', packet)
  }

  let success = false
  let finalTitle = 'Обмен не завершён'
  const original = make()
  if (original.protocol === 'TCP' && draft.mode !== 'raw') original.payload = ''
  if (draft.protocol === 'UDP' && draft.destinationPort === 53) { original.dnsName = draft.dnsName.toLowerCase(); original.payload = `A? ${original.dnsName}`; original.label = 'DNS query' }
  if (original.protocol === 'TCP' && original.flags === 'SYN' && draft.mode !== 'raw') a.sockets[`:${draft.sourcePort} → ${draft.destinationIp}:${draft.destinationPort}`] = 'SYN-SENT'
  decision('a', 'Собираем пакет из твоих полей', `${original.protocol}: ${original.sourceIp} → ${original.destinationIp}; TTL ${original.ttl}; данные «${original.payload}». ${original.protocol === 'TCP' ? `Флаги ${original.flags}, SEQ ${original.seq}.` : ''}`, 'Поля определяют поведение модели. Изменение адреса, TTL, порта или флагов изменит реальные решения устройств.', original.protocol, 'build', original)
  if (original.dnsName && a.dnsCache[original.dnsName]) {
    decision('a', 'DNS cache hit: сеть не понадобилась', `${original.dnsName} → ${a.dnsCache[original.dnsName]}. Ответ уже есть в локальном кэше.`, 'Повторное разрешение имени может не породить ни одного сетевого пакета.', 'DNS', 'dns-cache', original)
    success = true; finalTitle = 'Имя разрешено из кэша'
  } else {
    const received = deliver(a, original, draft.destinationMac)
    if (received) {
      const target = received.device
      const request = received.packet
      if (target.id !== 'b') drop(target.id, 'Пакет дошёл до другого устройства', 'Адрес принадлежит этому устройству, но в этой лабораторной сервис работает на сервере B.', 'wrong-target', request)
      else if (request.protocol === 'ICMP') {
        decision('b', 'ICMP: Echo Request → Echo Reply', `Сервер возвращает те же данные «${request.payload}». Адреса меняются местами. Для ответа маршрут выбирается заново.`, 'Echo проверяет IP-доставку и возможность получить ответ. Он не доказывает доступность TCP-сервиса.', 'ICMP', 'echo', request)
        const response = reverse(request, { icmpType: 0, label: 'Echo Reply' })
        const reply = deliver(target, response)
        success = reply?.device.id === 'a'; finalTitle = success ? 'Echo Reply вернулся с твоими данными' : 'Запрос дошёл, но ответ потерян'
      } else if (request.protocol === 'TCP') {
        const key = `${request.sourceIp}:${request.sourcePort} → :${request.destinationPort}`
        if (world.options.blockPort === request.destinationPort) {
          drop('b', 'Firewall: DROP без ответа', `Пакет к TCP/${request.destinationPort} отбрасывается до передачи сокету. Сервер не отправляет RST. Снаружи видна тишина.`, 'filtered', request)
          finalTitle = 'Ответа нет: наблюдаем filtered'
        } else if (![22, 80].includes(request.destinationPort) || request.flags !== 'SYN') {
          const flags = request.flags.includes('ACK') ? 'RST' : 'RST,ACK'
          decision('b', 'TCP: сброс соединения', `На порту ${request.destinationPort} ${[22, 80].includes(request.destinationPort) ? 'нет соединения, которому принадлежал бы сегмент с такими флагами' : 'нет слушающего сокета'}. Отправляем ${flags}.`, 'RST подтверждает достижимость TCP-стека. Только ответ на SYN к закрытому порту позволяет классифицировать этот порт как closed.', 'TCP', 'closed', request)
          const response = reverse(request, { flags, label: flags, seq: request.flags.includes('ACK') ? request.ack : 0, ack: request.seq + 1, payload: '' })
          const reply = deliver(target, response)
          if (reply?.device.id === 'a') {
            const socket = `:${draft.sourcePort} → ${draft.destinationIp}:${draft.destinationPort}`
            if (a.sockets[socket]) a.sockets[socket] = 'CLOSED'
            finalTitle = request.flags === 'SYN' ? 'Порт closed: получен RST' : 'Сегмент отвергнут: получен RST'; decision('a', finalTitle, 'Ответ сопоставлен с отправленным сегментом.', 'ACK-проверка и SYN-проверка дают разные сведения. Не переноси вывод closed на произвольный RST.', 'TCP', 'rst-received', reply.packet) }
        } else {
          target.sockets[key] = 'SYN-RECEIVED'
          decision('b', 'Слушающий сокет: SYN-RECEIVED', `TCP/${request.destinationPort} открыт. Сервер выделяет состояние и отвечает SYN,ACK: SEQ 5000, ACK ${request.seq + 1 + new TextEncoder().encode(request.payload).length}.`, 'SYN занимает один номер последовательности. SYN,ACK подтверждает SYN клиента и предлагает начальный SEQ сервера.', 'TCP', 'syn-received', request)
          const response = reverse(request, { flags: 'SYN,ACK', label: 'SYN,ACK', seq: 5000, ack: request.seq + 1 + new TextEncoder().encode(request.payload).length, payload: '' })
          const synAck = deliver(target, response)
          if (synAck?.device.id === 'a') {
            if (draft.mode === 'syn') {
              decision('a', 'SYN probe: порт open, соединение не завершаем', 'Получен SYN,ACK. Для этой SYN-проверки достаточно; клиент отправит RST и освободит состояние сервера.', 'Обнаружить слушающий порт и установить полноценное соединение — разные задачи.', 'TCP', 'open', synAck.packet)
              const reset = make({ flags: 'RST', label: 'RST', seq: 1001, payload: '' })
              if (deliver(a, reset)?.device.id === 'b') target.sockets[key] = 'CLOSED'
              a.sockets[`:${draft.sourcePort} → ${draft.destinationIp}:${draft.destinationPort}`] = 'CLOSED'
              success = true; finalTitle = 'Порт open: SYN-проверка завершена'
            } else if (draft.mode === 'raw') {
              decision('a', 'Сырой SYN: остановка после SYN,ACK', 'Ты отправил один сегмент. Автоматический ACK отключён: сервер остаётся SYN-RECEIVED.', 'Сборщик пакетов не обязан вести себя как TCP-клиент ОС. В модели повторные передачи и таймеры опущены.', 'TCP', 'half-open', synAck.packet)
              success = true; finalTitle = 'Получен SYN,ACK: соединение ещё не установлено'
            } else {
              const ack = make({ flags: 'ACK', label: 'ACK', seq: 1001, ack: 5001, payload: '' })
              a.sockets[`:${draft.sourcePort} → ${draft.destinationIp}:${draft.destinationPort}`] = 'ESTABLISHED'
              decision('a', 'Третий шаг: ACK 5001', 'Клиент подтверждает SYN сервера. Теперь нужно доставить ACK серверу.', 'Клиент и сервер меняют свои состояния в разные моменты.', 'TCP', 'ack', ack)
              if (deliver(a, ack)?.device.id === 'b') {
                target.sockets[key] = 'ESTABLISHED'
                decision('b', 'Обе стороны: ESTABLISHED', 'Сервер получил третий сегмент. Теперь приложение может обмениваться байтами.', 'Открытый порт — ещё не HTTP-ответ: протокол приложения работает поверх установленного TCP.', 'TCP', 'established', ack)
                success = true; finalTitle = 'TCP-соединение установлено'
                if (draft.mode === 'exchange' && draft.payload) {
                  const data = make({ flags: 'PSH,ACK', label: 'TCP data', seq: 1001, ack: 5001, payload: draft.payload })
                  const delivered = deliver(a, data)
                  if (delivered) {
                    const ackData = reverse(delivered.packet, { flags: 'ACK', label: 'Data ACK', seq: 5001, ack: 1001 + new TextEncoder().encode(draft.payload).length, payload: '' })
                    const response = deliver(target, ackData)
                    success = response?.device.id === 'a'
                    finalTitle = success ? 'TCP: твои байты доставлены и подтверждены' : 'Подтверждение данных не вернулось'
                  } else success = false
                }
                if (draft.mode === 'http' && request.destinationPort === 80) {
                  const http = make({ flags: 'PSH,ACK', label: 'HTTP request', seq: 1001, ack: 5001, payload: draft.payload || 'GET / HTTP/1.1\r\nHost: lab.test\r\n\r\n' })
                  const httpReceived = deliver(a, http)
                  if (httpReceived) {
                    const text = http.payload.startsWith('GET / ') ? 'HTTP/1.1 200 OK\r\n\r\nHello from the simulated server' : 'HTTP/1.1 400 Bad Request\r\n\r\nExpected GET / HTTP/1.1'
                    decision('b', 'HTTP: приложение прочитало байты', 'Теперь запрос обрабатывает HTTP-сервис. Статус зависит от содержимого запроса, а не от TCP-флагов.', 'Смена масштаба: Ethernet доставляет кадры, IP — пакеты, TCP — поток, HTTP придаёт байтам смысл.', 'HTTP', 'http', httpReceived.packet)
                    const result = deliver(target, reverse(httpReceived.packet, { label: 'HTTP response', flags: 'PSH,ACK', seq: 5001, ack: 1001 + new TextEncoder().encode(http.payload).length, payload: text }))
                    success = result?.device.id === 'a'; finalTitle = success ? text.split('\r\n')[0] : 'HTTP-ответ не вернулся'
                  } else success = false
                }
              }
            }
          }
        }
      } else if (request.destinationPort === 53 && request.dnsName && !world.options.dnsDown) {
        const answer = request.dnsName === 'lab.test' ? b.interfaces[0].ip : ''
        decision('b', answer ? 'DNS: запись A найдена' : 'DNS: NXDOMAIN', answer ? `${request.dnsName} → ${answer}. Ответ идёт UDP-датаграммой обратно на исходный порт клиента.` : `В учебной зоне имени ${request.dnsName} нет. Сервер отвечает NXDOMAIN, а не молчит.`, 'DNS разрешает имя в адрес. Доступность DNS и доступность сайта — разные свойства.', 'DNS', answer ? 'dns-answer' : 'nxdomain', request)
        const response = reverse(request, { label: answer ? 'DNS answer' : 'NXDOMAIN', dnsAnswer: answer, dnsResponse: true, payload: answer ? `${request.dnsName} A ${answer}` : 'NXDOMAIN' })
        const reply = deliver(target, response)
        if (reply?.device.id === 'a') {
          if (answer) { a.dnsCache[request.dnsName] = answer; decision('a', 'DNS: ответ записан в кэш', `${request.dnsName} → ${answer}. Повтори запрос, чтобы увидеть, как кэш меняет путь.`, 'В этом модуле кэш живёт до сброса; старение по TTL — отдельный механизм.', 'DNS', 'dns-cached', reply.packet) }
          success = !!answer; finalTitle = answer ? 'Имя разрешено: адрес сохранён' : 'DNS ответил: имя не существует'
        }
      } else {
        decision('b', 'UDP: нет обработчика на этом порту', `На UDP/${request.destinationPort} нет доступного сервиса. Отправляем ICMP Destination Unreachable, Port Unreachable.`, 'У UDP нет рукопожатия. Ошибку доставки может сообщить ICMP; отсутствие ответа не доказывает открытый порт.', 'UDP / ICMP', 'udp-closed', request)
        deliver(target, reverse(request, { protocol: 'ICMP', icmpType: 3, label: 'Port Unreachable', payload: 'ICMP type 3, code 3', flags: '' }))
        finalTitle = 'UDP-сервис недоступен'
      }
    }
  }
  if (!success && finalTitle === 'Обмен не завершён') finalTitle = trace.findLast(item => item.event.phase === 'drop')?.event.title || finalTitle
  emit({ title: finalTitle, explanation: success ? 'Проследи ответ в обратную сторону. Какие поля сохранились, какие изменились и какое состояние осталось у устройств? Меняй одно поле за раз и сравнивай обмены.' : 'Ищи первое событие с отказом. Потом раздели наблюдение («нет ответа») и причину, которую удалось увидеть внутри модели. Исправь одно условие и повтори.', why: 'Задача — предсказывать поведение устройств по их состоянию и полям пакета.', layer: 'Результат', phase: 'done', outcome: success ? 'success' : 'failure', code: success ? 'success' : 'failure' })
  return trace
}
