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
  const finish = async () => { await wait("document.querySelectorAll('.net-events button').length > 1"); await click('К результату'); await wait("document.querySelector('.net-stage-heading').textContent.includes('ЗАВЕРШЁН')") }
  const send = async () => { await click('Запустить мой пакет'); await finish() }
  const screenshot = async name => { const data = await cdp('Page.captureScreenshot', { format: 'png' }, sessionId); await writeFile(join(tmpdir(), name), Buffer.from(data.data, 'base64')) }
  await cdp('Runtime.enable', {}, sessionId)
  await cdp('Page.enable', {}, sessionId)
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1150, deviceScaleFactor: 1, mobile: false }, sessionId)
  await cdp('Page.navigate', { url: process.argv[2] || 'http://127.0.0.1:5173/#/network' }, sessionId)
  await wait("!!document.querySelector('.net-builder')")
  await input('Данные пакета', 'this is my packet', 'textarea')
  await click('Запустить мой пакет')
  await wait("!!document.querySelector('.net-flying')")
  await click('Пауза')
  const position = await run("document.querySelector('.net-flying > g').getAttribute('transform')")
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(await run("document.querySelector('.net-flying > g').getAttribute('transform')"), position, 'Packet moved while paused')
  await click('Продолжить')
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.notEqual(await run("document.querySelector('.net-flying > g').getAttribute('transform')"), position, 'Packet did not resume')
  await click('Пауза')
  await screenshot('network-flight.png')
  await finish()
  assert((await run("document.querySelector('.net-explanation h2').textContent")).includes('Echo Reply'))
  assert((await run("document.querySelector('.net-device-inspector').textContent")).includes('02:00:00:00:00:0b'))
  await run("Array.from(document.querySelectorAll('.net-events button')).findLast(b=>b.textContent.includes('Echo Reply:')).click()")
  await run("document.querySelectorAll('.net-layer-stack button')[3].click()")
  assert((await run("document.querySelector('.net-payload').textContent")).includes('this is my packet'))
  await run("document.querySelector('.net-events button:first-child').click()")
  await wait("!document.querySelector('.net-device-inspector').textContent.includes('02:00:00:00:00:0b')")
  await click('К результату')
  await send()
  assert((await run("document.querySelector('.net-exchange-stats').textContent")).includes('ARP-запросов A 0'))

  // Exercise every lab through the UI, including the second DNS lookup.
  for (let module = 0; module < 5; module++) {
    await run(`document.querySelectorAll('.net-module-nav button')[${module}].click()`)
    await wait(`document.querySelectorAll('.net-module-nav button')[${module}].getAttribute('aria-current') === 'page'`)
    const count = await run("document.querySelectorAll('.net-mission-tabs button').length")
    for (let mission = 0; mission < count; mission++) {
      await run(`document.querySelectorAll('.net-mission-tabs button')[${mission}].click()`)
      await wait(`document.querySelectorAll('.net-mission-tabs button')[${mission}].getAttribute('aria-pressed') === 'true'`)
      await send()
      if (module === 4 && mission === 1) await send()
      await wait("!!document.querySelector('.net-mission-success')")
      if (module === 2 && mission === 0) {
        await run("Array.from(document.querySelectorAll('.net-device-tabs button')).find(b=>b.textContent.includes('Шлюз')).click()")
        assert((await run("document.querySelector('.net-nat-state').textContent")).includes('40000'))
        await screenshot('network-nat.png')
      }
    }
  }
  assert.equal(await run("JSON.parse(localStorage.getItem('network-labs-observations-v2')).length"), 15)
  // Invalid data is rejected before sending, then usable again after correction.
  await input('TTL', 0)
  assert(await run("document.querySelector('.net-send').disabled"))
  await input('TTL', 64)
  assert(!(await run("document.querySelector('.net-send').disabled")))
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId)
  assert(await run('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile page overflows horizontally')
  await screenshot('network-mobile.png')
  await cdp('Page.reload', {}, sessionId)
  await wait("!!document.querySelector('.net-builder')")
  assert((await run("document.querySelector('.net-progress-count strong').textContent")).startsWith('15'))
  assert.deepEqual(exceptions, [], 'Browser runtime exception')
  console.log('PASS: continuous motion, pause/resume, custom payload, rewind, warm ARP, all 15 labs, NAT state, validation, mobile layout, persisted progress, no runtime exceptions')
} finally {
  clearTimeout(timeout)
  await cdp('Browser.close').catch(() => {})
  await new Promise(resolve => { if (browser.exitCode !== null) resolve(); else browser.once('exit', resolve) })
  await rm(profile, { recursive: true, force: true })
}
