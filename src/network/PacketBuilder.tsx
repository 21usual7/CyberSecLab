import { useState } from 'react'
import type { ModuleId, PacketDraft, WorldOptions } from './types'
import { validateDraft } from './engine'

const HELP = {
  destinationIp: 'Конечный получатель IPv4. В чужую сеть пакет пойдёт через шлюз, но IP назначения сохранится.',
  ttl: 'Число допустимых переходов через маршрутизаторы. Коммутатор его не меняет. TTL 1 позволяет увидеть первый маршрутизатор.',
  destinationMac: 'Пусто → найти MAC через ARP. Ручной MAC задаёт получателя Ethernet на первом участке; он может отличаться от конечного IP.',
  sourcePort: 'Временный порт клиента. Ответ должен вернуться на него. Для ICMP это поле здесь представляет Echo Identifier.',
  destinationPort: 'Номер сервиса на сервере: TCP 22 и 80 открыты, UDP 53 обслуживает DNS. Другие TCP-порты отвечают RST.',
  payload: 'Содержимое твоего пакета. ICMP вернёт его в Echo Reply. В HTTP-режиме эти байты становятся запросом приложения.',
  flags: 'SYN начинает соединение, ACK подтверждает номера последовательности. Один произвольный ACK не создаёт соединение.',
  dnsName: 'DNS-сервер знает A-запись lab.test. Другие имена вернут NXDOMAIN; это ответ, а не отсутствие связи.',
}
export function PacketBuilder({ draft, onChange, module, options, onOptions, onSend, disabled }: {
  draft: PacketDraft; onChange: (draft: PacketDraft) => void; module: ModuleId; options: WorldOptions
  onOptions: (options: WorldOptions) => void; onSend: () => void; disabled: boolean
}) {
  const [focus, setFocus] = useState<keyof typeof HELP>('destinationIp')
  const update = <K extends keyof PacketDraft>(key: K, value: PacketDraft[K]) => onChange({ ...draft, [key]: value })
  const error = validateDraft(draft)
  return <section className="net-builder panel">
    <div className="net-panel-heading"><span className="net-eyebrow">ПАКЕТНАЯ МАСТЕРСКАЯ</span><span className="net-small-tag">Твои поля → поведение сети</span></div>
    <h2>Собери и отправь</h2>
    <div className="net-protocols" aria-label="Протокол">{(['ICMP', 'TCP', 'UDP'] as const).map(p => <button type="button" key={p} aria-pressed={draft.protocol === p} className={draft.protocol === p ? 'active' : ''} onClick={() => update('protocol', p)}>{p}</button>)}</div>
    <button className="net-send" disabled={disabled || !!error} onClick={onSend}>↗ Запустить мой пакет <span>{draft.protocol}</span></button>
    <div className="net-form-grid">
      <label className="net-wide">IP назначения<input aria-label="IP назначения" value={draft.destinationIp} onFocus={() => setFocus('destinationIp')} onChange={e => update('destinationIp', e.target.value)} spellCheck={false} /></label>
      <label>TTL<input type="number" aria-label="TTL" min="1" max="255" value={draft.ttl} onFocus={() => setFocus('ttl')} onChange={e => update('ttl', Number(e.target.value))} /></label>
      {draft.protocol === 'TCP' ? <label>Флаги<select aria-label="TCP флаги" value={draft.flags} onFocus={() => setFocus('flags')} onChange={e => update('flags', e.target.value)}>{['SYN', 'ACK', 'FIN', 'SYN,ACK', 'PSH,ACK'].map(f => <option key={f}>{f}</option>)}</select></label> : <div className="net-field-fact">{draft.protocol === 'ICMP' ? 'Type 8 → Type 0' : 'Без handshake'}</div>}
      {draft.protocol !== 'ICMP' && <><label>Порт источника<input aria-label="Порт источника" type="number" min="1" max="65535" value={draft.sourcePort} onFocus={() => setFocus('sourcePort')} onChange={e => update('sourcePort', Number(e.target.value))} /></label><label>Порт назначения<input aria-label="Порт назначения" type="number" min="1" max="65535" value={draft.destinationPort} onFocus={() => setFocus('destinationPort')} onChange={e => update('destinationPort', Number(e.target.value))} /></label></>}
      {draft.protocol === 'TCP' && <label className="net-wide">Поведение клиента<select aria-label="Режим клиента" value={draft.mode} onChange={e => update('mode', e.target.value as PacketDraft['mode'])}><option value="exchange">Полный handshake</option><option value="raw">Один сырой сегмент</option><option value="syn">SYN-проверка + RST</option><option value="http">Handshake + HTTP</option></select></label>}
      {draft.protocol === 'UDP' && draft.destinationPort === 53 && <label className="net-wide">DNS: запись A для имени<input aria-label="DNS имя" value={draft.dnsName} onFocus={() => setFocus('dnsName')} onChange={e => update('dnsName', e.target.value)} /></label>}
      <label className="net-wide">Данные <span>{draft.payload.length}/512</span><textarea aria-label="Данные пакета" rows={3} maxLength={512} value={draft.payload} onFocus={() => setFocus('payload')} onChange={e => update('payload', e.target.value)} placeholder="Напиши своё сообщение" /></label>
      <details className="net-wide"><summary>Ethernet: задать MAC вручную</summary><label>MAC назначения<input aria-label="MAC назначения" value={draft.destinationMac} placeholder="Пусто — определить через ARP" onFocus={() => setFocus('destinationMac')} onChange={e => update('destinationMac', e.target.value)} spellCheck={false} /></label></details>
    </div>
    <p className="net-field-help"><span>↳</span> {HELP[focus]}</p>
    <details className="net-conditions"><summary>Условия сети <span>вмешайся в мир</span></summary>
      <label><input type="checkbox" checked={!options.cableOff} onChange={e => onOptions({ ...options, cableOff: !e.target.checked })} /> Кабель сервера подключён</label>
      {(module === 'routing' || module === 'nat') && <label><input type="checkbox" checked={!options.noGateway} onChange={e => onOptions({ ...options, noGateway: !e.target.checked })} /> Default route у клиента</label>}
      {module === 'nat' && <label><input type="checkbox" checked={options.natEnabled} onChange={e => onOptions({ ...options, natEnabled: e.target.checked })} /> SNAT включён</label>}
      {module === 'tcp' && <label><input type="checkbox" checked={options.blockPort === 80} onChange={e => onOptions({ ...options, blockPort: e.target.checked ? 80 : -1 })} /> Firewall: DROP TCP/80</label>}
      {module === 'dns' && <label><input type="checkbox" checked={!options.dnsDown} onChange={e => onOptions({ ...options, dnsDown: !e.target.checked })} /> DNS-сервис запущен</label>}
      <p>Изменение условий создаёт новый мир и очищает таблицы. Изменение полей пакета сохраняет мир.</p>
    </details>
    {error && <p className="net-input-error" role="alert">{error}</p>}
    {disabled && <p className="net-form-note">Дождись конца или перейди к результату, чтобы отправить следующий пакет.</p>}
  </section>
}
