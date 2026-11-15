import { useEffect, useState } from 'react'
import { createNetwork, defaultDraft, initialSnapshot, simulate } from '../network/engine'
import type { DeviceId, PacketDraft, Snapshot, WorldOptions } from '../network/types'
import { DEFAULT_OPTIONS } from '../network/types'
import { MODULES, missionReached } from '../network/labs'
import { NetworkScene } from '../network/NetworkScene'
import { PacketBuilder } from '../network/PacketBuilder'
import { DeviceInspector, PacketInspector } from '../network/Inspectors'
import { usePlayback } from '../network/usePlayback'
import './network.css'

const PROGRESS_KEY = 'network-labs-observations-v2'
function loadProgress(): string[] {
  try { const data: unknown = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '[]'); return Array.isArray(data) ? data.filter((id): id is string => typeof id === 'string') : [] } catch { return [] }
}
function stats(trace: Snapshot[]) {
  return { frames: trace.filter(s => s.event.phase === 'flight').length, arp: trace.filter(s => s.event.frame?.kind === 'ARP request' && s.event.from === 'a').length, hops: trace.filter(s => s.event.code === 'ttl-decrement').length }
}
export function NetworkLab() {
  const [moduleIndex, setModuleIndex] = useState(0)
  const [missionIndex, setMissionIndex] = useState(0)
  const [options, setOptions] = useState<WorldOptions>({ ...DEFAULT_OPTIONS })
  const [draft, setDraft] = useState<PacketDraft>(() => defaultDraft('ethernet'))
  const [history, setHistory] = useState<Snapshot[]>(() => [initialSnapshot(createNetwork())])
  const [selected, setSelected] = useState<DeviceId>('a')
  const [savedProgress, setSavedProgress] = useState(loadProgress)
  const [runStart, setRunStart] = useState(1)
  const [previous, setPrevious] = useState<ReturnType<typeof stats> | null>(null)
  const [error, setError] = useState('')
  const playback = usePlayback(history)
  const module = MODULES[moduleIndex]
  const mission = module.missions[missionIndex]
  const { cursor, progress, playing, atEnd } = playback
  const snapshot = history[cursor]
  const event = snapshot.event
  const observed = history.slice(runStart, cursor + 1)
  const achieved = missionReached(mission, observed)
  const completed = achieved && !savedProgress.includes(mission.id) ? [...savedProgress, mission.id] : savedProgress
  const progressJSON = JSON.stringify(completed)
  const counts = stats(observed)
  const active = event.at || event.to

  useEffect(() => { try { localStorage.setItem(PROGRESS_KEY, progressJSON) } catch { /* Progress is optional when browser storage is unavailable. */ } }, [progressJSON])

  function remember() { if (achieved && !savedProgress.includes(mission.id)) setSavedProgress(completed) }
  function seek(value: number) { remember(); playback.seek(value) }
  function resetWorld(nextOptions = options, index = moduleIndex) {
    seek(0); setError(''); setRunStart(1); setPrevious(null)
    setHistory([initialSnapshot(createNetwork(MODULES[index].id, nextOptions))])
    setSelected('a')
  }
  function selectMission(nextModule: number, nextMission: number) {
    const chosen = MODULES[nextModule]
    const task = chosen.missions[nextMission]
    const nextOptions = { ...DEFAULT_OPTIONS, ...task.options }
    setModuleIndex(nextModule); setMissionIndex(nextMission); setOptions(nextOptions)
    setDraft({ ...defaultDraft(chosen.id), ...task.draft })
    resetWorld(nextOptions, nextModule)
  }
  function changeOptions(next: WorldOptions) { setOptions(next); resetWorld(next) }
  function send() {
    try {
      remember()
      const next = simulate(snapshot.network, draft)
      if (observed.length) setPrevious(stats(observed))
      const keep = history.slice(0, cursor + 1).slice(-500)
      setHistory([...keep, ...next]); setRunStart(keep.length)
      playback.setPosition(keep.length); playback.setPlaying(true); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось собрать пакет') }
  }
  return <div className="network-lab">
    <header className="net-heading"><div><div className="net-eyebrow">NETWORK LABS / ЖИВОЙ СЕТЕВОЙ МИР</div><h1>Понимай сеть <span>изнутри.</span></h1><p>Собери пакет. Проследи каждое решение. Измени одно условие.</p></div><div className="net-progress-count"><strong>{completed.length}<span> / {MODULES.reduce((n, m) => n + m.missions.length, 0)}</span></strong><small>механизмов наблюдал</small></div></header>
    <nav className="net-module-nav" aria-label="Сетевые модули">{MODULES.map((item, i) => <button key={item.id} aria-current={i === moduleIndex ? 'page' : undefined} className={moduleIndex === i ? 'active' : ''} onClick={() => selectMission(i, 0)}><span className="net-module-index">0{i + 1}</span><strong>{item.title}</strong><small>{item.subtitle}</small><span className="net-module-observed">{item.missions.filter(m => completed.includes(m.id)).length}/{item.missions.length}</span></button>)}</nav>
    <section className="net-module-intro"><h2>{module.question}</h2><p>{module.concept}</p></section>
    <div className="net-mission-tabs" aria-label="Практические эксперименты">{module.missions.map((item, i) => <button key={item.id} className={i === missionIndex ? 'active' : ''} aria-pressed={i === missionIndex} onClick={() => selectMission(moduleIndex, i)}><span>{completed.includes(item.id) ? '✓' : String(i + 1).padStart(2, '0')}</span>{item.title}</button>)}</div>
    <section className="net-mission"><div><span className="net-eyebrow">ТВОЙ ЭКСПЕРИМЕНТ</span><p>{mission.task}</p></div><details><summary>Нужна зацепка?</summary><p>{mission.hint}</p></details>{completed.includes(mission.id) && <span className="net-mission-success">✓ Наблюдение подтверждено</span>}</section>

    <div className="net-workspace">
      <div className="net-main-column">
        <section className="panel net-stage" aria-label="Схема сети">
          <div className="net-stage-heading"><span><i className={playing ? 'is-playing' : ''} />{playing ? 'ОБМЕН В ДВИЖЕНИИ' : event.phase === 'idle' ? 'ГОТОВ К ОТПРАВКЕ' : atEnd ? 'ОБМЕН ЗАВЕРШЁН' : 'ВРЕМЯ ОСТАНОВЛЕНО'}</span><span className="mono">{event.layer}</span></div>
          <div className="net-scene-scroll"><NetworkScene snapshot={snapshot} selected={selected} onSelect={setSelected} progress={progress} /></div>
          <div className="net-current-event"><span className={`net-phase-dot ${event.phase}`} /><span>{event.title}</span>{active && <button onClick={() => setSelected(active)}>Внутрь устройства ↗</button>}</div>
          <div className="net-controls"><button className="btn" aria-label="Предыдущее событие" disabled={cursor === 0} onClick={() => seek(cursor - 1)}>←</button><button className="btn btn-accent" disabled={history.length === 1} onClick={() => { if (atEnd) seek(1); playback.setPlaying(!playing) }}>{playing ? 'Ⅱ Пауза' : atEnd && history.length > 1 ? '↺ Смотреть снова' : '▶ Продолжить'}</button><button className="btn" aria-label="Следующее событие" disabled={atEnd} onClick={() => seek(cursor + 1)}>→</button><button className="btn" disabled={atEnd} onClick={() => seek(history.length - 1)}>К результату</button><button className="btn" onClick={() => resetWorld()}>Сброс мира</button><label>Темп <select aria-label="Темп воспроизведения" value={playback.speed} onChange={e => playback.setSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label></div>
          <div className="net-scrubber"><input aria-label="Шкала времени" type="range" min="0" max={history.length - 1} step="0.01" value={playback.position} onChange={e => seek(Number(e.target.value))} /><span>{cursor.toString().padStart(2, '0')} / {history.length - 1}</span></div>
          <div className="net-exchange-stats"><span>Кадров <b>{counts.frames}</b></span><span>ARP-запросов A <b>{counts.arp}</b></span><span>L3-пересылок <b>{counts.hops}</b></span>{previous && <span className="net-previous">Предыдущий обмен: {previous.frames} кадров / {previous.arp} ARP</span>}</div>
        </section>
        <section className={`panel net-explanation ${event.phase} ${event.outcome || ''}`} aria-live="polite" aria-atomic="true"><div className="net-eyebrow">ЧТО ПРОИСХОДИТ / {event.layer}</div><h2>{event.title}</h2><p>{event.explanation}</p><div className="net-causal"><span>ПОЧЕМУ</span><p>{event.why}</p></div>{event.tryThis && <p className="net-try">↳ {event.tryThis}</p>}</section>
        <DeviceInspector snapshot={snapshot} selected={selected} onSelect={setSelected} />
        <section className="panel net-journal"><div className="net-panel-heading"><span className="net-eyebrow">СЛЕД ЭКСПЕРИМЕНТА</span><span className="net-small-tag">Любое событие можно открыть</span></div><div className="net-events scroll">{history.map((item, i) => <button key={i} className={`${i === cursor ? 'active' : ''} ${i > cursor ? 'future' : ''} ${item.event.phase === 'drop' ? 'drop' : ''}`} aria-current={i === cursor ? 'step' : undefined} onClick={() => seek(i)}><span className="mono">{i.toString().padStart(2, '0')}</span><span className="net-event-layer">{item.event.phase === 'flight' ? '↗' : item.event.phase === 'drop' ? '✕' : '·'}</span><span>{item.event.title}</span></button>)}</div></section>
      </div>
      <aside className="net-side-column"><PacketBuilder draft={draft} onChange={setDraft} module={module.id} options={options} onOptions={changeOptions} onSend={send} disabled={!atEnd} />{error && <p role="alert" className="net-input-error">{error}</p>}<PacketInspector snapshot={snapshot} /></aside>
    </div>
    <footer className="net-footnote"><p><b>Границы модели.</b> {module.limits} Время полёта растянуто для наблюдения и не является измерением задержки. Все пакеты существуют внутри симулятора.</p><p>Темы согласованы с <a href="https://academy.hackthebox.com/path/preview/information-security-foundations" target="_blank" rel="noreferrer">HTB Information Security Foundations</a> и <a href="https://academy.hackthebox.com/path/preview/penetration-tester" target="_blank" rel="noreferrer">Penetration Tester</a>. <a href={module.source} target="_blank" rel="noreferrer">Связанный модуль HTB ↗</a> · Собственные модели и задания, без аффилиации с HTB.</p></footer>
  </div>
}
