import { useEffect, useRef, useState } from 'react'
import { validateDraft, createNetwork, defaultDraft, initialSnapshot, simulate } from '../network/engine'
import type { DeviceId, PacketDraft, Snapshot, World, WorldOptions } from '../network/types'
import { DEFAULT_OPTIONS } from '../network/types'
import { MODULES, missionReached } from '../network/labs'
import { NetworkScene } from '../network/NetworkScene'
import { PacketBuilder } from '../network/PacketBuilder'
import { DeviceInspector, PacketInspector } from '../network/Inspectors'
import { usePlayback } from '../network/usePlayback'
import { makePrediction, FAULTS, diagnosticOptions } from '../network/learning'
import type { Attempt, Fault, Prediction } from '../network/learning'
import { Forecast, ForecastResult, Comparison, SubnetLens } from '../network/LearningPanels'
import { executeCli, INITIAL_CLI, auditNetwork } from '../network/workshop'
import type { AuditResult } from '../network/workshop'
import { NetworkConsole, SecurityAudit } from '../network/WorkshopPanels'
import './network.css'

const TOOL_TITLES = { craft: 'Конструктор', packet: 'Содержимое пакета', device: 'Состояние устройств', history: 'История обмена', compare: 'Сравнение попыток', subnet: 'Граница подсети', cli: 'Консоль шлюза', audit: 'Проверка политики' }
type Tool = keyof typeof TOOL_TITLES
const TOTAL_MISSIONS = MODULES.reduce((total, module) => total + module.missions.length, 0)
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
  const [panel, setPanel] = useState<Tool | null>(null)
  const [showModules, setShowModules] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<{ attempt: Attempt; prediction: Prediction } | null>(null)
  const [forecastChoice, setForecastChoice] = useState('')
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [priorAttempt, setPriorAttempt] = useState<Attempt | null>(null)
  const [fault, setFault] = useState<Fault>('route')
  const [diagnosisChoice, setDiagnosisChoice] = useState<Fault | ''>('')
  const [diagnosisFixed, setDiagnosisFixed] = useState(false)
  const [diagnosisMessage, setDiagnosisMessage] = useState('')
  const [workshopWorld, setWorkshopWorld] = useState<World | null>(null)
  const [cliContext, setCliContext] = useState(INITIAL_CLI)
  const [audit, setAudit] = useState<AuditResult[]>([])
  const playback = usePlayback(history)
  const module = MODULES[moduleIndex]
  const mission = module.missions[missionIndex]
  const { cursor, progress, playing, atEnd } = playback
  const snapshot = history[cursor]
  const event = snapshot.event
  const observed = history.slice(runStart, cursor + 1)
  const achieved = module.id === 'workshop' ? audit.length === 5 && audit.every(result => result.passed) : missionReached(mission, observed) && (module.id !== 'diagnostic' || diagnosisFixed && attempt?.draft.protocol === 'TCP' && attempt.draft.destinationPort === 80)
  const completed = achieved && !savedProgress.includes(mission.id) ? [...savedProgress, mission.id] : savedProgress
  const progressJSON = JSON.stringify(completed)
  const counts = stats(observed)
  const active = event.at || event.to
  const tools: [Tool, string][] = [['craft', 'Изменить пакет'], ['packet', 'Разобрать пакет'], ['device', 'Устройства'], ['history', 'История']]
  if (priorAttempt && attempt) tools.push(['compare', 'Сравнить'])
  if (module.id === 'subnet') tools.push(['subnet', 'Маска подсети'])
  if (module.id === 'workshop') tools.unshift(['cli', 'Консоль шлюза'], ['audit', 'Проверить политику'])

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
  function seek(value: number) { remember(); setPending(null); setForecastChoice(''); playback.seek(value) }
  function resetWorld(nextOptions = options, index = moduleIndex, preserveAttempts = false) {
    seek(0); setError(''); setRunStart(1); setPrevious(null)
    const world = createNetwork(MODULES[index].id, nextOptions)
    setHistory([initialSnapshot(world)])
    setPending(null); setForecastChoice('')
    if (!preserveAttempts) { setAttempt(null); setPriorAttempt(null) }
    if (MODULES[index].id === 'workshop') { setWorkshopWorld(world); setCliContext(INITIAL_CLI); setAudit([]) }
    setSelected('a')
  }
  function selectMission(nextModule: number, nextMission: number) {
    const chosen = MODULES[nextModule]
    const task = chosen.missions[nextMission]
    const nextFault = FAULTS[(FAULTS.indexOf(fault) + 1 + Math.floor(Math.random() * 2)) % FAULTS.length]
    setFault(nextFault); setDiagnosisChoice(''); setDiagnosisFixed(false); setDiagnosisMessage('')
    const nextOptions = { ...DEFAULT_OPTIONS, ...task.options, ...(chosen.id === 'diagnostic' ? diagnosticOptions(nextFault) : {}) }
    setPanel(null); setShowModules(false)
    setModuleIndex(nextModule); setMissionIndex(nextMission); setOptions(nextOptions)
    setDraft({ ...defaultDraft(chosen.id), ...task.draft })
    resetWorld(nextOptions, nextModule)
  }
  function changeOptions(next: WorldOptions) { setOptions(next); resetWorld(next, moduleIndex, true) }
  function startAttempt(nextAttempt: Attempt) {
    remember()
    if (attempt) { setPrevious(stats(attempt.trace)); setPriorAttempt(attempt) }
    const keep = history.slice(0, cursor + 1).slice(-500)
    setHistory([...keep, ...nextAttempt.trace]); setRunStart(keep.length); setAttempt(nextAttempt)
    playback.setPosition(keep.length); playback.setPlaying(true)
    setError(''); setPanel(null); setPending(null); setForecastChoice('')
  }
  function send() {
    try {
      const world = module.id === 'workshop' ? workshopWorld || snapshot.network : snapshot.network
      const trace = simulate(world, draft)
      const prediction = makePrediction(world, draft, trace)
      setPending({ attempt: { world: structuredClone(world), draft: { ...draft }, trace, prediction }, prediction })
      setForecastChoice(''); setPanel(null); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось собрать пакет') }
  }
  function launch(skip = false) { if (pending && (skip || forecastChoice)) startAttempt({ ...pending.attempt, choice: skip ? undefined : forecastChoice }) }
  function repair() {
    if (!diagnosisChoice) return
    setDiagnosisFixed(diagnosisChoice === fault)
    const next = { ...options }
    if (diagnosisChoice === 'route') next.noGateway = false
    if (diagnosisChoice === 'cable') next.cableOff = false
    if (diagnosisChoice === 'filter') next.blockPort = -1
    changeOptions(next)
    setDiagnosisMessage('Изменено одно условие. Повтори ту же пробу: результат проверит твоё объяснение.')
  }
  function applyConsole(result: ReturnType<typeof executeCli>) {
    setCliContext(result.context)
    if (result.changed || result.trace) setWorkshopWorld(result.world)
    if (result.changed) {
      remember(); seek(0); setPending(null); setAudit([]); setError(''); setRunStart(1)
      setHistory([initialSnapshot(result.world)])
    }
    if (result.trace && result.probeDraft) { setDraft(result.probeDraft); startAttempt({ world: result.trace[0].network, draft: result.probeDraft, trace: result.trace }) }
  }
  function runAudit() { if (workshopWorld) { setAudit(auditNetwork(workshopWorld)); playback.setPlaying(false); setPanel('audit') } }
  return <div className="network-lab">
    <header className="net-heading">
      <div><div className="net-eyebrow">NETWORK LABS · 0{moduleIndex + 1} / {String(MODULES.length).padStart(2, '0')}</div><h1>{module.title}</h1><p>{module.question}</p></div>
      <div className="net-heading-actions"><span className="net-progress-count"><strong>{completed.length}<span> / {TOTAL_MISSIONS}</span></strong><small>наблюдений</small></span><button className="btn" aria-expanded={showModules} aria-controls="network-modules" onClick={() => setShowModules(!showModules)}>Модули {showModules ? '−' : '+'}</button></div>
    </header>
    {showModules && <nav id="network-modules" className="net-module-nav" aria-label="Сетевые модули">{MODULES.map((item, i) => <button key={item.id} data-module={item.id} aria-current={i === moduleIndex ? 'page' : undefined} className={moduleIndex === i ? 'active' : ''} onClick={() => selectMission(i, 0)}><span className="net-module-index">0{i + 1}</span><strong>{item.title}</strong><small>{item.subtitle}</small><span className="net-module-observed">{item.missions.filter(m => completed.includes(m.id)).length}/{item.missions.length}</span></button>)}</nav>}
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
          {pending && <Forecast prediction={pending.prediction} choice={forecastChoice} onChoice={setForecastChoice} onLaunch={launch} />}
          <div className="net-controls">
            {atEnd ? <button className="btn btn-accent net-primary-send" disabled={!!validateDraft(draft) || !!pending} onClick={send}>↗ {history.length === 1 ? 'Отправить пакет' : 'Отправить ещё'}</button> : <button className="btn btn-accent" onClick={() => playback.setPlaying(!playing)}>{playing ? 'Ⅱ Пауза' : '▶ Продолжить'}</button>}
            {history.length > 1 && <><button className="btn" aria-label="Предыдущее событие" disabled={cursor === 0} onClick={() => seek(cursor - 1)}>←</button><button className="btn" aria-label="Следующее событие" disabled={atEnd} onClick={() => seek(cursor + 1)}>→</button></>}
            <span className="net-packet-summary">{draft.protocol} → {draft.destinationIp}{draft.protocol !== 'ICMP' ? ':' + draft.destinationPort : ''}</span>
            <details className="net-more"><summary aria-label="Дополнительные действия">···</summary><div><label>Темп <select aria-label="Темп воспроизведения" value={playback.speed} onChange={e => playback.setSpeed(Number(e.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label><button disabled={atEnd} onClick={() => seek(history.length - 1)}>К результату</button><button disabled={history.length === 1} onClick={() => { seek(1); playback.setPlaying(true) }}>Смотреть снова</button><button onClick={() => resetWorld()}>Сброс мира</button></div></details>
          </div>
          {history.length > 1 && <div className="net-scrubber"><input aria-label="Шкала времени" type="range" min="0" max={history.length - 1} step="0.01" value={playback.position} onChange={e => seek(Number(e.target.value))} /><span>{cursor.toString().padStart(2, '0')} / {history.length - 1}</span></div>}
        </section>
        <nav className="net-tool-nav" aria-label="Инструменты исследования">{tools.map(([id, title]) => <button key={id} data-tool={id} aria-expanded={panel === id} aria-controls="net-tool-panel" className={panel === id ? 'active' : ''} onClick={() => openPanel(panel === id ? null : id)}>{title}<span>{panel === id ? '−' : '+'}</span></button>)}</nav>
        <section className={`net-explanation ${event.phase} ${event.outcome || ''}`} aria-live="polite" aria-atomic="true"><div className="net-eyebrow">{event.phase === 'idle' ? 'НАЧНИ С ОТПРАВКИ' : event.layer}</div><h2>{event.title}</h2><p>{event.explanation}</p>{attempt && history.length > 1 && <ForecastResult attempt={attempt} visible={cursor - runStart} />}<details className="net-causal" key={cursor}><summary>Почему?</summary><p>{event.why}</p></details>{active && <button className="net-inspect-link" onClick={() => inspectDevice(active)}>Посмотреть состояние устройства ↗</button>}</section>
        {module.id === 'diagnostic' && <section className="net-diagnosis">
          {atEnd && event.outcome === 'failure' && <><h3>Какую причину проверишь исправлением?</h3><div>{([['route', 'Восстановить маршрут клиента'], ['cable', 'Подключить линию сервера'], ['filter', 'Снять фильтр TCP/80']] as const).map(([value, title]) => <button key={value} aria-pressed={diagnosisChoice === value} onClick={() => setDiagnosisChoice(value)}>{title}</button>)}</div><button className="btn" disabled={!diagnosisChoice} onClick={repair}>Применить одно исправление</button></>}
          {diagnosisMessage && <p>{diagnosisMessage}</p>}<button className="net-text-button" onClick={() => selectMission(moduleIndex, 0)}>Новая неизвестная неисправность</button>
        </section>}
        {error && <p role="alert" className="net-input-error">{error}</p>}
      </div>
      {panel && <aside id="net-tool-panel" ref={panelRef} className="net-side-column" aria-label="Панель исследования"><div className="net-tool-heading"><span>{TOOL_TITLES[panel]}</span><button aria-label="Закрыть панель" onClick={closePanel}>×</button></div>
        {panel === 'craft' && <PacketBuilder draft={draft} onChange={next => { setDraft(next); setPending(null) }} module={module.id} options={options} onOptions={changeOptions} onSend={send} disabled={!atEnd} hideConditions={module.id === 'diagnostic' || module.id === 'workshop'} />}
        {panel === 'compare' && (!atEnd ? <div className="net-learning-panel"><p>Дождись результата текущей попытки. Затем здесь можно сравнить решения.</p></div> : <Comparison before={priorAttempt} after={attempt} onSeek={index => seek(runStart + index)} />)}
        {panel === 'subnet' && <SubnetLens world={snapshot.network} destination={draft.destinationIp} />}
        {panel === 'cli' && <NetworkConsole world={workshopWorld || snapshot.network} context={cliContext} onExecute={applyConsole} />}
        {panel === 'audit' && <SecurityAudit results={audit} onRun={runAudit} onReplay={result => { setDraft(result.draft); startAttempt({ world: result.trace[0].network, draft: result.draft, trace: result.trace }) }} />}
        {panel === 'packet'  && <PacketInspector snapshot={snapshot} />}
        {panel === 'device' && <DeviceInspector snapshot={snapshot} selected={selected} onSelect={setSelected} />}
        {panel === 'history' && <section className="net-journal"><div className="net-exchange-stats"><span>Кадров <b>{counts.frames}</b></span><span>ARP-запросов A <b>{counts.arp}</b></span><span>L3-пересылок <b>{counts.hops}</b></span>{previous && <span className="net-previous">Предыдущий обмен: {previous.frames} кадров / {previous.arp} ARP</span>}</div><div className="net-events scroll">{history.map((item, i) => <button key={i} className={`${i === cursor ? 'active' : ''} ${i > cursor ? 'future' : ''} ${item.event.phase === 'drop' ? 'drop' : ''}`} aria-current={i === cursor ? 'step' : undefined} onClick={() => seek(i)}><span className="mono">{i.toString().padStart(2, '0')}</span><span className="net-event-layer">{item.event.phase === 'flight' ? '↗' : item.event.phase === 'drop' ? '✕' : '·'}</span><span>{item.event.title}</span></button>)}</div></section>}
      </aside>}
    </div>
    <details className="net-footnote"><summary>О модели и учебных темах</summary><p><b>Границы модели.</b> {module.limits} Время полёта растянуто для наблюдения и не является измерением задержки. Все пакеты существуют внутри симулятора.</p><p>Дополнение к темам <a href="https://academy.hackthebox.com/path/preview/information-security-foundations" target="_blank" rel="noreferrer">HTB Information Security Foundations</a> и <a href="https://academy.hackthebox.com/path/preview/penetration-tester" target="_blank" rel="noreferrer">Penetration Tester</a>. <a href={module.source} target="_blank" rel="noreferrer">Связанный модуль HTB ↗</a> · Собственные модели и задания, без аффилиации с HTB.</p></details>
  </div>
}
