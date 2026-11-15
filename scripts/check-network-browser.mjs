// Optional real-browser regression check. Requires Chromium on PATH and a running Vite server.
// node scripts/check-network-browser.mjs [http://127.0.0.1:5173/#/network]
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const profile = await mkdtemp(join(tmpdir(), 'network-browser-'))
const browser = spawn('chromium', ['--headless', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, '--remote-debugging-pipe'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
let sequence = 0, buffer = ''
const pending = new Map(), exceptions = []
browser.on('error', error => { console.error(error.message); process.exitCode = 1 })
browser.stdio[4].on('data', chunk => {
  buffer += chunk.toString()
  let end
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result)
    }
  }
})
function cdp(method, params = {}, sessionId) {
  const id = ++sequence
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0') })
}
const timeout = setTimeout(() => { console.error('Browser QA timed out'); browser.kill(); process.exit(1) }, 55000)
try {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true })
  const run = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const wait = async expression => {
    for (let i = 0; i < 160; i++) {
      try { if (await run(expression)) return } catch (error) { if (!/navigated or closed|context.*destroyed|Cannot find context/i.test(error.message)) throw error }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Condition failed: ' + expression)
  }
  const click = text => run(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes(${JSON.stringify(text)})).click()`)
  const input = (label, value, tag = 'input') => run(`(() => { const el=document.querySelector(${JSON.stringify(`${tag}[aria-label="${label}"]`)}); Object.getOwnPropertyDescriptor(${tag === 'textarea' ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(String(value))}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  const finish = async () => {
    await wait("!!document.querySelector('input[aria-label=\"Шкала времени\"]')")
    const end = await run("document.querySelector('input[aria-label=\"Шкала времени\"]').max")
    await input('Шкала времени', end)
    await wait("document.querySelector('.net-stage-heading').textContent.includes('ЗАВЕРШЁН')")
  }
  const send = async () => { await click('Отправить'); await wait("!!document.querySelector('.net-forecast')"); await click('Отправить без прогноза'); await finish() }
  const tool = async text => { await run(`Array.from(document.querySelectorAll('.net-tool-nav button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`) }
  const screenshot = async name => { const data = await cdp('Page.captureScreenshot', { format: 'png' }, sessionId); await writeFile(join(tmpdir(), name), Buffer.from(data.data, 'base64')) }
  await cdp('Runtime.enable', {}, sessionId)
  await cdp('Page.enable', {}, sessionId)
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1150, deviceScaleFactor: 1, mobile: false }, sessionId)
  await cdp('Page.navigate', { url: process.argv[2] || 'http://127.0.0.1:5173/#/network' }, sessionId)
  await wait("!!document.querySelector('.net-stage')")
  assert.equal(await run("document.querySelectorAll('.net-side-column,.net-module-nav').length"), 0, 'Initial view is cluttered')
  assert(await run("document.querySelector('.net-stage').getBoundingClientRect().top < 400"), 'Scene is buried below controls')
  await screenshot('network-focus.png')
  await tool('Изменить пакет')
  await wait("!!document.querySelector('.net-builder')")
  await input('Данные пакета', 'this is my packet', 'textarea')
  await click('Запустить мой пакет')
  await wait("!!document.querySelector('.net-forecast')")
  await run("Array.from(document.querySelectorAll('.net-forecast > div button')).find(b=>b.textContent.startsWith('Сервер')).click()")
  await click('Проверить прогноз')
  await wait("!!document.querySelector('.net-flying')")
  assert.equal(await run("document.querySelectorAll('.net-side-column').length"), 0, 'Builder did not close on launch')
  await click('Пауза')
  const position = await run("document.querySelector('.net-flying > g').getAttribute('transform')")
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(await run("document.querySelector('.net-flying > g').getAttribute('transform')"), position, 'Packet moved while paused')
  await click('Продолжить')
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.notEqual(await run("document.querySelector('.net-flying > g').getAttribute('transform')"), position, 'Packet did not resume')
  await click('Пауза')
  await screenshot('network-flight.png')
  await run("document.querySelector('.net-machine').dispatchEvent(new MouseEvent('click',{bubbles:true}))")
  assert(await run("!!document.querySelector('.net-device-inspector .net-processing li.active')"), 'Device processing was not shown')
  await run("document.querySelector('button[aria-label=\"Закрыть панель\"]').click()")
  await wait("document.activeElement?.getAttribute('data-tool') === 'device'")
  await finish()
  assert((await run("document.querySelector('.net-explanation h2').textContent")).includes('Echo Reply'))
  assert(await run("!!document.querySelector('.net-forecast-result.correct')"), 'Prediction was not checked against visible evidence')
  await tool('Устройства')
  assert((await run("document.querySelector('.net-device-inspector').textContent")).includes('02:00:00:00:00:0b'))
  await tool('История')
  await run("Array.from(document.querySelectorAll('.net-events button')).findLast(b=>b.textContent.includes('Echo Reply:')).click()")
  await tool('Разобрать пакет')
  await run("document.querySelectorAll('.net-layer-stack button')[3].click()")
  assert((await run("document.querySelector('.net-payload').textContent")).includes('this is my packet'))
  await input('Шкала времени', 0)
  await tool('Устройства')
  assert(!(await run("document.querySelector('.net-device-inspector').textContent")).includes('02:00:00:00:00:0b'))
  await finish()
  await send()
  await tool('История')
  assert((await run("document.querySelector('.net-exchange-stats').textContent")).includes('ARP-запросов A 0'))

  await tool('Сравнить')
  assert((await run("document.querySelector('.net-comparison').textContent")).includes('ARP'), 'Comparison did not show learned-state divergence')

  // Exercise every lab through visible navigation and the single experiment selector.
  for (let module = 0; module < 6; module++) {
    await click('Модули')
    const title = await run(`document.querySelectorAll('.net-module-nav button strong')[${module}].textContent`)
    await run(`document.querySelectorAll('.net-module-nav button')[${module}].click()`)
    await wait(`document.querySelector('.net-heading h1').textContent === ${JSON.stringify(title)}`)
    const count = await run("document.querySelector('#net-experiment').options.length")
    for (let mission = 0; mission < count; mission++) {
      await run(`(() => { const el=document.querySelector('#net-experiment'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(String(mission))}); el.dispatchEvent(new Event('change',{bubbles:true})); })()`)
      await wait(`document.querySelector('#net-experiment').value === '${mission}'`)
      await send()
      if (module === 5 && mission === 1) await send()
      await wait("!!document.querySelector('.net-mission-success')")
      if (module === 3 && mission === 0) {
        await tool('Устройства')
        await run("Array.from(document.querySelectorAll('.net-device-tabs button')).find(b=>b.textContent.includes('Шлюз')).click()")
        assert((await run("document.querySelector('.net-nat-state').textContent")).includes('40000'))
        await screenshot('network-nat.png')
      }
    }
  }
  assert.equal(await run("JSON.parse(localStorage.getItem('network-labs-observations-v2')).length"), 17)
  // Unknown fault: a wrong repair must not pass; a correct repair needs a fresh probe.
  async function selectModule(id) {
    await click('Модули')
    await run(`document.querySelector('.net-module-nav button[data-module="${id}"]').click()`)
    await wait("!document.querySelector('.net-module-nav')")
  }
  await selectModule('diagnostic')
  await tool('Изменить пакет')
  assert(!(await run("!!document.querySelector('.net-conditions')")), 'Diagnostic exposed its hidden conditions')
  await run("document.querySelector('button[aria-label=\"Закрыть панель\"]').click()")
  await send()
  const failure = await run("document.querySelector('.net-explanation h2').textContent")
  const correct = failure.includes('маршрута') ? 0 : failure.includes('filtered') ? 2 : 1
  await run(`document.querySelectorAll('.net-diagnosis > div button')[${(correct + 1) % 3}].click()`)
  await click('Применить одно исправление')
  await send()
  assert(!(await run("!!document.querySelector('.net-mission-success')")), 'Wrong repair completed the diagnosis')
  await run(`document.querySelectorAll('.net-diagnosis > div button')[${correct}].click()`)
  await click('Применить одно исправление')
  await send()
  await wait("!!document.querySelector('.net-mission-success')")

  // Final configuration lab: actual interface changes, then a least-privilege ingress ACL.
  await selectModule('workshop')
  await tool('Проверить политику')
  await click('Проверить связность и доступ')
  assert.equal(await run("document.querySelectorAll('.net-security-audit article.passed').length"), 0)
  await tool('Консоль шлюза')
  await input('Команды шлюза', 'enable\nconfigure terminal\ninterface GigabitEthernet0/0\nip address 192.168.1.1 255.255.255.0\nno shutdown\nend', 'textarea')
  await click('Выполнить команды')
  await tool('Проверить политику')
  await click('Проверить связность и доступ')
  assert.equal(await run("document.querySelectorAll('.net-security-audit article.passed').length"), 2)
  await tool('Консоль шлюза')
  await input('Команды шлюза', 'configure terminal\naccess-list 100 permit icmp host 192.168.1.10 host 203.0.113.20\naccess-list 100 permit tcp host 192.168.1.10 host 203.0.113.20 eq 80\naccess-list 100 deny ip any any\ninterface GigabitEthernet0/0\nip access-group 100 in\nend', 'textarea')
  await click('Выполнить команды')
  await tool('Проверить политику')
  await click('Проверить связность и доступ')
  assert.equal(await run("document.querySelectorAll('.net-security-audit article.passed').length"), 5)
  await wait("!!document.querySelector('.net-mission-success')")
  await screenshot('network-workshop.png')
  await run("document.querySelector('.net-security-audit article[data-probe=\"ssh\"] details').open = true")
  await run("document.querySelector('.net-security-audit article[data-probe=\"ssh\"] button').click()")
  await finish()
  assert((await run("document.querySelector('.net-explanation h2').textContent")).includes('DENY'))
  assert.equal(await run("JSON.parse(localStorage.getItem('network-labs-observations-v2')).length"), 19)

  await tool('Изменить пакет')
  await input('TTL', 0)
  assert(await run("document.querySelector('.net-send').disabled"))
  await input('TTL', 64)
  assert(!(await run("document.querySelector('.net-send').disabled")))
  await run("document.querySelector('button[aria-label=\"Закрыть панель\"]').click()")
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId)
  assert(await run('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile page overflows horizontally')
  await screenshot('network-mobile.png')
  await tool('Изменить пакет')
  assert(await run("!!document.querySelector('.net-builder')"), 'Mobile builder unavailable')
  assert(await run('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile panel overflows horizontally')
  await run('window.__networkQAReload = true')
  await cdp('Page.reload', {}, sessionId)
  await wait("!window.__networkQAReload && !!document.querySelector('.net-progress-count strong')")
  assert((await run("document.querySelector('.net-progress-count strong').textContent")).startsWith('19'))
  assert.deepEqual(exceptions, [], 'Browser runtime exception')
  console.log('PASS: focused initial view, single tool panel, device click and focus restoration, continuous motion, forecasts, device processing, comparisons, all 19 labs, diagnosis and repair, CLI configuration and security probes, mobile layout, persisted progress, no runtime exceptions')
} finally {
  clearTimeout(timeout)
  await cdp('Browser.close').catch(() => {})
  await new Promise(resolve => { if (browser.exitCode !== null) resolve(); else browser.once('exit', resolve) })
  await rm(profile, { recursive: true, force: true })
}
