import { useState } from 'react'
import type { CliContext, AuditResult } from './workshop'
import { CLI_HELP, executeCli, prompt } from './workshop'
import type { World } from './types'
export function NetworkConsole({ world, context, onExecute }: { world: World; context: CliContext; onExecute: (result: ReturnType<typeof executeCli>) => void }) {
  const [script, setScript] = useState('show ip interface brief')
  const [log, setLog] = useState<string[]>(['Настрой шлюз. Команды изменяют ту же сеть, по которой летают пакеты.', 'GigabitEthernet0/0 → LAN; GigabitEthernet0/1 → WAN.'])
  function submit() {
    const result = executeCli(world, context, script)
    setLog(old => [...old, ...result.output].slice(-160))
    onExecute(result)
    setScript('')
  }
  return <section className="net-learning-panel net-console"><h3>Шлюз · {prompt(context)}</h3><pre className="scroll" role="log" aria-label="Вывод консоли">{log.join('\n')}</pre><form onSubmit={event => { event.preventDefault(); submit() }}><label htmlFor="network-cli">Команда или несколько строк</label><textarea id="network-cli" aria-label="Команды шлюза" value={script} onChange={e => setScript(e.target.value)} rows={5} maxLength={20000} spellCheck={false} placeholder="enable" /><button className="btn btn-accent" disabled={!script.trim()} type="submit">Выполнить команды</button></form><details><summary>Справка и синтаксис</summary><pre>{CLI_HELP}</pre><p>Сначала настрой IP и no shutdown. ACL создаётся в configure terminal, затем применяется на LAN-интерфейсе. После конфигурации выполни end и проверь сеть.</p><a href="https://www.cisco.com/c/en/us/support/docs/security/ios-firewall/23602-confaccesslists.html" target="_blank" rel="noreferrer">Документация Cisco по ACL ↗</a></details></section>
}
export function SecurityAudit({ results, onRun, onReplay }: { results: AuditResult[]; onRun: () => void; onReplay: (result: AuditResult) => void }) {
  return <section className="net-learning-panel net-security-audit"><h3>Докажи политику пакетами</h3><p>Разрешить клиенту 192.168.1.10 ICMP и HTTP к 203.0.113.20. Запретить SSH, UDP/53 и HTTP от другого клиента. Выключенная сеть не проходит проверку.</p><button className="btn btn-accent" onClick={onRun}>Проверить связность и доступ</button>{results.length > 0 && <><p className="net-audit-score">{results.filter(r => r.passed).length} / {results.length} проверок</p>{results.map(result => <article key={result.id} data-probe={result.id} className={result.passed ? 'passed' : 'failed'}><h4>{result.passed ? '✓' : '×'} {result.title}</h4><p>{result.expected}</p><details><summary>Результат и доказательство</summary><p>{result.reason}</p><button className="btn" onClick={() => onReplay(result)}>Проследить эту пробу</button></details></article>)}</>}<p className="net-form-note">Пять независимых проб с холодными таблицами. Это проверка заданной политики модели, а не сертификат безопасности реальной сети.</p></section>
}
