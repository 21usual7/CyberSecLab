import { useEffect, useRef, useState } from 'react'
import { validateDraft, createNetwork, defaultDraft, initialSnapshot, simulate } from '../network/engine'
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
  const [panel, setPanel] = useState<'craft' | 'packet' | 'device' | 'history' | null>(null)
  const [showModules, setShowModules] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (panel && window.matchMedia('(max-width: 850px)').matches) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [panel])

  useEffect(() => {
    const view = sceneRef.current
    if (!playing || !view || view.scrollWidth <= view.clientWidth || !event.from || !event.to) return
    const from = snapshot.network.devices[event.from]!
    const to = snapshot.network.devices[event.to]!
    const x = from.x + (to.x - from.x) * progress
    view.scrollLeft = x * view.scrollWidth / 960 - view.clientWidth / 2
  }, [playing, event.from, event.to, snapshot.network, progress])

  function openPanel(next: typeof panel) {
    setPanel(next)
    if (next && next !== 'craft') playback.setPlaying(false)
  }
  function closePanel() {
    const previous = panel
    setPanel(null)
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`.net-tool-nav button[data-tool="${previous}"]`)?.focus())
  }
  function inspectDevice(id: DeviceId) { setSelected(id); openPanel('device') }
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
    setPanel(null); setShowModules(false)
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
      playback.setPosition(keep.length); playback.setPlaying(true); setError(''); setPanel(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось собрать пакет') }
  }
  return <div className="network-lab">
    <header className="net-heading">
      <div><div className="net-eyebrow">NETWORK LABS · 0{moduleIndex + 1} / 05</div><h1>{module.title}</h1><p>{module.question}</p></div>
      <div className="net-heading-actions"><span className="net-progress-count"><strong>{completed.length}<span> / 15</span></strong><small>наблюдений</small></span><button className="btn" aria-expanded={showModules} aria-controls="network-modules" onClick={() => setShowModules(!showModules)}>Модули {showModules ? '−' : '+'}</button></div>
    </header>
    {showModules && <nav id="network-modules" className="net-module-nav" aria-label="Сетевые модули">{MODULES.map((item, i) => <button key={item.id} aria-current={i === moduleIndex ? 'page' : undefined} className={moduleIndex === i ? 'active' : ''} onClick={() => selectMission(i, 0)}><span className="net-module-index">0{i + 1}</span><strong>{item.title}</strong><small>{item.subtitle}</small><span className="net-module-observed">{item.missions.filter(m => completed.includes(m.id)).length}/{item.missions.length}</span></button>)}</nav>}
    <section className="net-mission">
      <div className="net-mission-heading"><label htmlFor="net-experiment">Эксперимент</label><select id="net-experiment" aria-label="Эксперимент" value={missionIndex} onChange={e => selectMission(moduleIndex, Number(e.target.value))}>{module.missions.map((item, i) => <option key={item.id} value={i}>{i + 1}. {item.title}{completed.includes(item.id) ? ' ✓' : ''}</option>)}</select>{completed.includes(mission.id) && <span className="net-mission-success">✓ Наблюдение подтверждено</span>}</div>
      <p>{mission.task}</p>
      <div className="net-mission-help"><details><summary>Подсказка</summary><p>{mission.hint}</p></details><details><summary>Как это устроено</summary><p>{module.concept}</p></details></div>
    </section>

    <div className={`net-workspace ${panel ? 'has-panel' : ''}`}>
      <div className="net-main-column">
        <section className="panel net-stage" aria-label="Схема сети">
          <div className="net-stage-heading"><span><i className={playing ? 'is-playing' : ''} />{playing ? 'ОБМЕН В ДВИЖЕНИИ' : event.phase === 'idle' ? 'ГОТОВ К ОТПРАВКЕ' : atEnd ? 'ОБМЕН ЗАВЕРШЁН' : 'ПАУЗА'}</span><span>{event.layer}</span></div>
          <div ref={sceneRef} className="net-scene-scroll"><NetworkScene snapshot={snapshot} selected={selected} onSelect={inspectDevice} progress={progress} /></div><p className="net-map-hint">← Схему можно двигать · во время полёта камера следует за пакетом →</p>
          <div className="net-controls">
            {atEnd ? <button className="btn btn-accent net-primary-send" disabled={!!validateDraft(draft)} onClick={send}>↗ {history.length === 1 ? 'Отправить пакет' : 'Отправить ещё'}</button> : <button className="btn btn-accent" onClick={() => playback.setPlaying(!playing)}>{playing ? 'Ⅱ Пауза' : '▶ Продолжить'}</button>}
            {history.length > 1 && <><button className="btn" aria-label="Предыдущее событие" disabled={cursor === 0} onClick={() => seek(cursor - 1)}>←</button><button className="btn" aria-label="Следующее событие" disabled={atEnd} onClick={() => seek(cursor + 1)}>→</button></>}
            <span className="net-packet-summary">{draft.protocol} → {draft.destinationIp}{draft.protocol !== 'ICMP' ? ':' + draft.destinationPort : ''}</span>
            <details className="net-more"><summary aria-label="Дополнительные действия">···</summary><div><label>Темп <select aria-label="Темп воспроизведения" value={playback.speed} onChange={e => playback.setSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label><button disabled={atEnd} onClick={() => seek(history.length - 1)}>К результату</button><button disabled={history.length === 1} onClick={() => { seek(1); playback.setPlaying(true) }}>Смотреть снова</button><button onClick={() => resetWorld()}>Сброс мира</button></div></details>
          </div>
          {history.length > 1 && <div className="net-scrubber"><input aria-label="Шкала времени" type="range" min="0" max={history.length - 1} step="0.01" value={playback.position} onChange={e => seek(Number(e.target.value))} /><span>{cursor.toString().padStart(2, '0')} / {history.length - 1}</span></div>}
        </section>
        <nav className="net-tool-nav" aria-label="Инструменты исследования">{([['craft', 'Изменить пакет'], ['packet', 'Разобрать пакет'], ['device', 'Устройства'], ['history', 'История']] as const).map(([id, title]) => <button key={id} data-tool={id} aria-expanded={panel === id} aria-controls="net-tool-panel" className={panel === id ? 'active' : ''} onClick={() => openPanel(panel === id ? null : id)}>{title}<span>{panel === id ? '−' : '+'}</span></button>)}</nav>
        <section className={`net-explanation ${event.phase} ${event.outcome || ''}`} aria-live="polite" aria-atomic="true"><div className="net-eyebrow">{event.phase === 'idle' ? 'НАЧНИ С ОТПРАВКИ' : event.layer}</div><h2>{event.title}</h2><p>{event.explanation}</p><details className="net-causal" key={cursor}><summary>Почему?</summary><p>{event.why}</p></details>{active && <button className="net-inspect-link" onClick={() => inspectDevice(active)}>Посмотреть состояние устройства ↗</button>}</section>
        {error && <p role="alert" className="net-input-error">{error}</p>}
      </div>
      {panel && <aside id="net-tool-panel" ref={panelRef} className="net-side-column" aria-label="Панель исследования"><div className="net-tool-heading"><span>{({ craft: 'Конструктор', packet: 'Содержимое пакета', device: 'Состояние устройств', history: 'История обмена' })[panel]}</span><button aria-label="Закрыть панель" onClick={closePanel}>×</button></div>
        {panel === 'craft' && <PacketBuilder draft={draft} onChange={setDraft} module={module.id} options={options} onOptions={changeOptions} onSend={send} disabled={!atEnd} />}
        {panel === 'packet' && <PacketInspector snapshot={snapshot} />}
        {panel === 'device' && <DeviceInspector snapshot={snapshot} selected={selected} onSelect={setSelected} />}
        {panel === 'history' && <section className="net-journal"><div className="net-exchange-stats"><span>Кадров <b>{counts.frames}</b></span><span>ARP-запросов A <b>{counts.arp}</b></span><span>L3-пересылок <b>{counts.hops}</b></span>{previous && <span className="net-previous">Предыдущий обмен: {previous.frames} кадров / {previous.arp} ARP</span>}</div><div className="net-events scroll">{history.map((item, i) => <button key={i} className={`${i === cursor ? 'active' : ''} ${i > cursor ? 'future' : ''} ${item.event.phase === 'drop' ? 'drop' : ''}`} aria-current={i === cursor ? 'step' : undefined} onClick={() => seek(i)}><span className="mono">{i.toString().padStart(2, '0')}</span><span className="net-event-layer">{item.event.phase === 'flight' ? '↗' : item.event.phase === 'drop' ? '✕' : '·'}</span><span>{item.event.title}</span></button>)}</div></section>}
      </aside>}
    </div>
    <details className="net-footnote"><summary>О модели и учебных темах</summary><p><b>Границы модели.</b> {module.limits} Время полёта растянуто для наблюдения и не является измерением задержки. Все пакеты существуют внутри симулятора.</p><p>Дополнение к темам <a href="https://academy.hackthebox.com/path/preview/information-security-foundations" target="_blank" rel="noreferrer">HTB Information Security Foundations</a> и <a href="https://academy.hackthebox.com/path/preview/penetration-tester" target="_blank" rel="noreferrer">Penetration Tester</a>. <a href={module.source} target="_blank" rel="noreferrer">Связанный модуль HTB ↗</a> · Собственные модели и задания, без аффилиации с HTB.</p></details>
  </div>
}
