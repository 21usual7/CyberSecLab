import { useEffect, useState } from 'react'
import { createNetwork, initialSnapshot, simulatePing } from '../network/engine'
import type { DeviceId, Snapshot } from '../network/engine'
import { NetworkScene } from '../network/NetworkScene'
import './network.css'

const names: Record<DeviceId, string> = { a: 'Компьютер A', switch: 'Коммутатор', b: 'Компьютер B' }
const scenarios = [
  { title: 'Рабочая сеть', description: 'Проследи первый ping, затем повтори его. Какие события исчезли?', options: {} },
  { title: 'Отключён кабель B', description: 'IP-адреса верные. Найди событие, после которого доставка невозможна.', options: { disconnected: true } },
  { title: 'B в другой подсети', description: 'Кабель подключён. Почему компьютер даже не отправляет ARP-запрос?', options: { remoteSubnet: true } },
]

export function NetworkLab() {
  const [scenario, setScenario] = useState(0)
  const [history, setHistory] = useState<Snapshot[]>(() => [initialSnapshot(createNetwork())])
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1400)
  const [selected, setSelected] = useState<DeviceId>('a')
  const snapshot = history[cursor]
  const { event, network } = snapshot
  const atEnd = cursor === history.length - 1

  useEffect(() => {
    if (!playing) return
    if (cursor >= history.length - 1) return
    const timer = window.setTimeout(() => setCursor(value => value + 1), speed)
    return () => window.clearTimeout(timer)
  }, [playing, cursor, history.length, speed])

  function reset(index = scenario) {
    setPlaying(false)
    setScenario(index)
    setCursor(0)
    setHistory([initialSnapshot(createNetwork(scenarios[index].options))])
  }
  function ping() {
    const next = simulatePing(network)
    setHistory([...history.slice(0, cursor + 1), ...next])
    setCursor(cursor + 1)
    setPlaying(true)
  }
  const host = selected === 'switch' ? undefined : network.hosts[selected]

  return <div className="network-lab">
    <div className="net-heading">
      <div><div className="net-eyebrow">СЕТИ / МОДУЛЬ 01</div><h1>Почувствуй путь пакета<span>.</span></h1><p>От намерения отправить ping до ответа. Каждое решение оставляет след.</p></div>
      <span className="net-badge">Живая модель · Ethernet / ARP / ICMP</span>
    </div>

    <div className="net-scenarios" aria-label="Сценарии">
      {scenarios.map((item, i) => <button key={item.title} className={scenario === i ? 'active' : ''} aria-pressed={scenario === i} onClick={() => reset(i)}><span>0{i + 1}</span>{item.title}</button>)}
    </div>
    <p className="net-question">{scenarios[scenario].description}</p>

    <div className="net-workspace">
      <section className="panel net-stage" aria-label="Схема сети">
        <div className="net-stage-heading"><span className="panel-title">Локальная сеть</span><span className="mono">192.168.1.0/24</span></div>
        <NetworkScene snapshot={snapshot} selected={selected} onSelect={setSelected} speed={speed} cursor={cursor} revision={history.length} />
        <div className="net-controls">
          <button className="btn btn-accent" disabled={!atEnd} onClick={ping}>{history.length === 1 ? '▶ Отправить ping' : '↗ Повторить ping'}</button>
          <button className="btn" disabled={cursor === 0} onClick={() => { setPlaying(false); setCursor(cursor - 1) }} aria-label="Предыдущее событие">←</button>
          <button className="btn" disabled={atEnd} onClick={() => setPlaying(!playing)}>{playing && !atEnd ? 'Ⅱ Пауза' : '▶ Продолжить'}</button>
          <button className="btn" disabled={atEnd} onClick={() => { setPlaying(false); setCursor(cursor + 1) }} aria-label="Следующее событие">→</button>
          <button className="btn" onClick={() => reset()}>Сброс</button>
          <label className="net-speed">Темп <select aria-label="Скорость воспроизведения" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={2400}>Медленно</option><option value={1400}>Обычно</option><option value={600}>Быстро</option></select></label>
        </div>
        <div className="net-scrubber"><input aria-label="Перейти к событию" type="range" min="0" max={history.length - 1} value={cursor} onChange={e => { setPlaying(false); setCursor(Number(e.target.value)) }} /><span className="mono">{cursor} / {history.length - 1}</span></div>
      </section>

      <aside className="panel net-inspector">
        <div className="panel-title">Внутри устройства</div>
        <div className="net-device-tabs">{(['a', 'switch', 'b'] as DeviceId[]).map(id => <button className={selected === id ? 'active' : ''} key={id} aria-pressed={selected === id} onClick={() => setSelected(id)}>{id === 'switch' ? 'Коммутатор' : id.toUpperCase()}</button>)}</div>
        <h2>{names[selected]}</h2>
        {host ? <>
          <dl className="net-facts"><dt>Интерфейс</dt><dd>eth0 · {host.connected ? 'подключён' : 'отключён'}</dd><dt>IPv4</dt><dd>{host.ip}/24</dd><dt>MAC</dt><dd>{host.mac}</dd></dl>
          <h3>Маршрут</h3><div className="net-table mono">{host.ip.split('.').slice(0, 3).join('.')}.0/24 → eth0<br /><span>Шлюз по умолчанию отсутствует</span></div>
          <h3>ARP-таблица <span>IP → MAC</span></h3>
          <div className="net-table">{Object.entries(host.arp).length ? Object.entries(host.arp).map(([ip, mac]) => <div key={ip} className="mono">{ip}<br /><b>{mac}</b></div>) : <p>Пусто. Компьютер ещё не узнал MAC соседей.</p>}</div>
        </> : <>
          <p className="net-muted">Изучает MAC источника каждого входящего кадра и выбирает выходной порт.</p>
          <h3>Таблица MAC <span>MAC → порт</span></h3>
          <div className="net-table">{Object.entries(network.macTable).length ? Object.entries(network.macTable).map(([mac, port]) => <div className="mono" key={mac}>{mac} <b>→ {port.toUpperCase()}</b></div>) : <p>Пусто. Таблица заполнится при поступлении кадров.</p>}</div>
          <p className="net-muted">IP-адрес для пересылки кадров не требуется. Широковещательные кадры уходят на все подключённые порты, кроме входного.</p>
        </>}
      </aside>

      <section className={`panel net-explanation ${event.outcome || ''}`} aria-live="polite">
        <div className="net-eyebrow">{event.layer} / СОБЫТИЕ {cursor.toString().padStart(2, '0')}</div>
        <h2>{event.title}</h2><p>{event.explanation}</p>
        {event.frame && <div className="net-frame"><span>Ethernet <b>{event.frame.source} → {event.frame.destination}</b></span><span>{event.frame.kind.startsWith('ARP') ? 'ARP: адреса отправителя и цели' : 'IP: источник и назначение'} <b>{event.frame.sourceIp} → {event.frame.destinationIp}</b></span><span className="net-frame-kind">{event.frame.kind}</span></div>}
      </section>
      <section className="panel net-journal"><div className="panel-title">След эксперимента · нажми, чтобы вернуться</div><div className="net-events scroll">{history.map((item, i) => <button key={i} aria-current={i === cursor ? 'step' : undefined} className={`${i === cursor ? 'active' : ''} ${i > cursor ? 'future' : ''}`} onClick={() => { setPlaying(false); setCursor(i) }}><span className="mono">{i.toString().padStart(2, '0')}</span><span>{item.event.title}</span></button>)}</div></section>
    </div>
    <p className="net-footnote">Учебная модель: IPv4 /24, один коммутатор, без VLAN, старения таблиц и повторных запросов. Шаг — событие, а не реальное время. Все пакеты существуют только внутри симулятора.</p>
  </div>
}
