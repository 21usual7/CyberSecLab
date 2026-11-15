import type { Attempt, Prediction } from './learning'
import { compareAttempts } from './learning'
import type { DeviceId, Snapshot, World } from './types'
import { contains, networkAddress, prefixMask, validIp } from './topology'

export function Forecast({ prediction, choice, onChoice, onLaunch }: { prediction: Prediction; choice: string; onChoice: (choice: string) => void; onLaunch: (skip?: boolean) => void }) {
  return <section className="net-forecast" aria-label="Прогноз перед отправкой"><h3>{prediction.question}</h3><div role="group" aria-label="Варианты прогноза">{prediction.options.map(option => <button key={option.value} aria-pressed={choice === option.value} onClick={() => onChoice(option.value)}>{option.title}</button>)}</div><footer><button className="btn btn-accent" disabled={!choice} onClick={() => onLaunch()}>Проверить прогноз</button><button className="net-text-button" onClick={() => onLaunch(true)}>Отправить без прогноза</button></footer></section>
}
export function ForecastResult({ attempt, visible }: { attempt: Attempt; visible: number }) {
  if (!attempt.prediction || !attempt.choice || visible < attempt.prediction.evidence) return null
  const right = attempt.choice === attempt.prediction.answer
  return <details className={`net-forecast-result ${right ? 'correct' : 'different'}`}><summary>{right ? '✓ Прогноз подтвердился' : '↳ Получилось иначе, чем ты ожидал'}</summary><p>{attempt.prediction.explanation}</p></details>
}
export function Comparison({ before, after, onSeek }: { before: Attempt | null; after: Attempt | null; onSeek: (index: number) => void }) {
  if (!before || !after) return <div className="net-learning-panel"><h3>Меняй одно условие</h3><p>Сначала выполни обмен, затем измени пакет или условия и отправь ещё раз. Здесь появится первая разница в решениях устройств.</p></div>
  const comparison = compareAttempts(before, after)
  return <section className="net-learning-panel net-comparison"><h3>Что изменилось?</h3>{comparison.changes.length ? <ul>{comparison.changes.map(change => <li key={change}>{change}</li>)}</ul> : <p>Поля те же. Проверяем, повлияло ли сохранённое состояние.</p>}{comparison.equal ? <p>Значимые решения совпали. Изменение не поменяло путь или результат этого обмена.</p> : <><h3>Первая разница в решениях</h3><div>{[comparison.before, comparison.after].map((item, index) => <article key={index}><span>{index === 0 ? 'Предыдущая попытка' : 'Текущая попытка'}</span><h4>{item?.snapshot.event.title || 'Обмен уже завершён'}</h4><p>{item?.snapshot.event.explanation}</p></article>)}</div>{comparison.after && <button className="btn" onClick={() => onSeek(comparison.after!.index)}>Открыть это событие</button>}</>}</section>
}
export function SubnetLens({ world, destination }: { world: World; destination: string }) {
  if (!validIp(destination)) return <div className="net-learning-panel"><p>Укажи корректный IPv4 назначения в конструкторе.</p></div>
  const intf = world.devices.a!.interfaces[0]
  const local = contains(destination, intf.ip, intf.prefix)
  const bits = (ip: string) => ip.split('.').map(part => Number(part).toString(2).padStart(8, '0')).join('')
  return <section className="net-learning-panel net-subnet-lens"><h3>Граница — первые {intf.prefix} бит</h3><p>{intf.ip}/{intf.prefix} · маска {prefixMask(intf.prefix)}</p>{[intf.ip, destination].map(ip => <div key={ip}><span>{ip}</span><code><b>{bits(ip).slice(0, intf.prefix)}</b><i>|</i>{bits(ip).slice(intf.prefix)}</code><small>Сеть: {networkAddress(ip, intf.prefix)}</small></div>)}<p>{local ? 'Префиксы совпали: получатель считается локальным.' : 'Префиксы различаются: нужен маршрут через шлюз, даже если кабель общий.'}</p></section>
}
export function ProcessingView({ snapshot, selected }: { snapshot: Snapshot; selected: DeviceId }) {
  const device = snapshot.network.devices[selected]!
  const event = snapshot.event
  const receiving = event.to === selected || ['decapsulate', 'ip-local', 'echo', 'syn-received', 'closed', 'filtered', 'http', 'dns-answer', 'nxdomain'].includes(event.code || '')
  const steps = device.kind === 'switch' ? ['Входной порт', 'MAC источника → обучение', 'MAC назначения → таблица', 'Выходной порт'] : device.kind === 'router' ? ['Снять Ethernet', 'Входная ACL', 'Проверить TTL', 'NAT / маршрут', 'ARP следующего узла', 'Новый Ethernet'] : receiving ? ['Линия → сетевая карта', 'Проверка MAC', 'Проверка IP', 'ICMP / TCP / UDP', 'Приложение'] : ['Приложение', 'ICMP / TCP / UDP', 'Выбор IP-маршрута', 'ARP следующего узла', 'Сборка Ethernet', 'Линия']
  let active = -1
  const relevant = event.at === selected || event.from === selected || event.to === selected
  if (relevant && event.phase !== 'idle' && event.phase !== 'done') {
    if (device.kind === 'switch') active = event.phase === 'flight' ? (event.from === selected ? 3 : 0) : event.code === 'mac-learn' ? 1 : 2
    else if (device.kind === 'router') active = event.phase === 'flight' ? (event.from === selected ? 5 : 0) : event.code?.startsWith('acl-') ? 1 : event.code?.startsWith('ttl-') ? 2 : event.layer === 'ARP' ? 4 : event.code === 'decapsulate' ? 0 : 3
    else if (receiving) active = event.phase === 'flight' ? 0 : event.code === 'wrong-mac' ? 1 : ['decapsulate', 'ip-local', 'wrong-ip'].includes(event.code || '') ? 2 : ['http', 'dns-answer', 'nxdomain', 'dns-cached'].includes(event.code || '') ? 4 : 3
    else active = event.phase === 'flight' ? 5 : event.layer === 'ARP' ? 3 : event.code === 'manual-mac' ? 4 : event.code === 'build' ? 1 : 2
  }
  return <section className="net-processing"><h3>Путь внутри · {device.name}</h3><ol>{steps.map((step, index) => <li key={step} className={index === active ? `active ${event.phase === 'drop' ? 'stopped' : ''}` : ''}><span>{String(index + 1).padStart(2, '0')}</span>{step}{index === active && <b>{event.phase === 'drop' ? 'отказ' : 'сейчас'}</b>}</li>)}</ol>{active >= 0 ? <p>{event.explanation}</p> : <p>Выбери в истории событие этого устройства. Подсветка показывает текущую обработку, а не все уже выполненные стадии.</p>}</section>
}
