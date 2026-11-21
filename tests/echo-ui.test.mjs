/**
 * Integration of the real preview host, bundled plugin, ReactDOM, and HTTP life
 * service. This is a DOM/interaction test, not a screenshot or audio test:
 * jsdom cannot lay out SVG or play sound. Only browser fetch, media lifecycle,
 * and the download URL boundary are adapted below. No plugin UI/service is
 * replaced, and no audio samples, FFT results, or listening time are invented.
 *
 * Run after `npm run build`: node --test tests/echo-ui.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'

const repo = fileURLToPath(new URL('..', import.meta.url))
const libraryTrack = 'ec00000000000001'
const name = '小岚'
const memoryTitle = '窗边的第一段旋律'
const memoryNote = '这是一段主动留下的记忆。'

async function until(check, description, timeout = 7000) {
  const end = Date.now() + timeout
  let lastError
  while (Date.now() < end) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) { lastError = error }
    await delay(20)
  }
  assert.fail(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`)
}

async function startPreview(t) {
  const directory = await mkdtemp(join(tmpdir(), 'echo-ui-preview-'))
  const process = spawn(globalThis.process.execPath, [resolve(repo, 'scripts/echo-preview.mjs'), '--data-dir', directory], {
    cwd: repo,
    env: { ...globalThis.process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const record = chunk => { output = (output + chunk.toString()).slice(-10000) }
  process.stdout.on('data', record)
  process.stderr.on('data', record)
  let spawnError
  process.once('error', error => { spawnError = error })
  t.after(async () => {
    if (process.exitCode == null && process.signalCode == null) {
      process.kill('SIGTERM')
      const deadline = Date.now() + 3000
      while (process.exitCode == null && process.signalCode == null && Date.now() < deadline) await delay(20)
      if (process.exitCode == null && process.signalCode == null) process.kill('SIGKILL')
    }
    await rm(directory, { recursive: true, force: true })
  })
  const base = await until(() => {
    if (spawnError) throw spawnError
    const match = output.match(/ECHO preview: (http:\/\/127\.0\.0\.1:\d+)/)
    if (match) return match[1]
    if (process.exitCode != null) throw new Error(output || `Preview exited ${process.exitCode}`)
    return null
  }, 'isolated preview HTTP server', 15000)
  const json = async path => {
    const response = await fetch(base + path)
    assert.equal(response.status, 200, `${path}: HTTP ${response.status}`)
    return response.json()
  }
  return { base, directory, json, log: () => output }
}

async function openPreview(base) {
  const errors = []
  const requests = []
  const downloads = []
  const blobs = new Map()
  const media = { plays: 0, pauses: 0, loads: 0 }
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')))
  const dom = await JSDOM.fromURL(base + '/', {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : String(input), window.location.href)
        const request = { url: url.href, method: init?.method || 'GET', body: init?.body, status: 'pending' }
        requests.push(request)
        let options = init
        // Node's fetch checks its own AbortSignal brand. Bridge cancellation
        // from jsdom's browser realm instead of removing the client's signal.
        if (init?.signal) {
          const controller = new AbortController()
          if (init.signal.aborted) controller.abort(init.signal.reason)
          else init.signal.addEventListener('abort', () => controller.abort(init.signal.reason), { once: true })
          options = { ...init, signal: controller.signal }
        }
        return fetch(url, options).then(response => {
          request.status = response.status
          return response
        }, error => {
          request.status = `${error.name}: ${error.message}`
          throw error
        })
      }

      // Native media implementations are outside jsdom. Dispatch the normal
      // state events; currentTime remains unchanged and AudioContext is absent.
      const proto = window.HTMLMediaElement.prototype
      proto.load = function () {
        media.loads++
        Object.defineProperty(this, 'paused', { configurable: true, value: true })
        Object.defineProperty(this, 'readyState', { configurable: true, value: this.src ? 4 : 0 })
        Object.defineProperty(this, 'duration', { configurable: true, value: this.src ? 90 : NaN })
        this.currentTime = 0
        if (this.src) {
          this.dispatchEvent(new window.Event('loadedmetadata'))
          this.dispatchEvent(new window.Event('canplay'))
        }
      }
      proto.play = function () {
        media.plays++
        Object.defineProperty(this, 'paused', { configurable: true, value: false })
        this.dispatchEvent(new window.Event('play'))
        this.dispatchEvent(new window.Event('playing'))
        return Promise.resolve()
      }
      proto.pause = function () {
        media.pauses++
        Object.defineProperty(this, 'paused', { configurable: true, value: true })
        this.dispatchEvent(new window.Event('pause'))
      }

      // Capture the real archive Blob at the browser download boundary.
      window.URL.createObjectURL = blob => {
        const url = `blob:${base}/echo-test-${blobs.size}`
        blobs.set(url, blob)
        return url
      }
      window.URL.revokeObjectURL = url => blobs.delete(url)
      window.document.addEventListener('click', event => {
        const anchor = event.target.closest?.('a[download]')
        if (!anchor) return
        event.preventDefault()
        const blob = blobs.get(anchor.href)
        const content = new Promise((resolve, reject) => {
          if (!blob) { reject(new Error('Download has no Blob')); return }
          const reader = new window.FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(reader.error)
          reader.readAsText(blob)
        })
        downloads.push({ filename: anchor.download, content })
      }, true)
    },
  })
  const { window } = dom
  const document = window.document
  const query = (selector, within = document) => within.querySelector(selector)
  const byText = (text, within = document) => [...within.querySelectorAll('button')].find(button => button.textContent.trim() === text)
  const byLabel = (label, within = document) => [...within.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === label)
  function click(node) {
    assert.ok(node, 'interactive target exists')
    assert.notEqual(node.disabled, true, 'interactive target is enabled')
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  }
  function field(node, value) {
    assert.ok(node, 'form field exists')
    const proto = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
    node.dispatchEvent(new window.Event('input', { bubbles: true }))
    node.dispatchEvent(new window.Event('change', { bubbles: true }))
  }
  const close = () => {
    window.dispatchEvent(new window.PageTransitionEvent('pagehide', { persisted: false }))
    window.close()
  }
  try {
    await until(() => query('.echo-home .echo-creature-svg'), 'actual plugin life stage')
    assert.equal(query('.preview-error'), null, errors.join('\n'))
  } catch (error) {
    const pageText = document.body?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 5000)
    const pendingScripts = [...document.scripts].map(script => script.src)
    close()
    throw new Error(`${error.message}\nPage text: ${pageText || '(empty)'}\nBrowser errors: ${errors.join('\n') || '(none)'}\nScripts: ${JSON.stringify(pendingScripts)}\nLast requests: ${JSON.stringify(requests.slice(-20))}`, { cause: error })
  }
  return { dom, window, document, query, byText, byLabel, click, field, close, errors, requests, media, downloads }
}

function geometry(page) {
  return [...page.document.querySelectorAll('.echo-specimen-card')].map(card => ({
    structure: card.querySelector('.echo-creature').dataset.structure,
    paths: [...card.querySelectorAll('.echo-creature-surface path')].map(path => path.getAttribute('d')),
  }))
}

test('actual ECHO plugin works through preview slots, HTTP persistence and DOM interactions', { timeout: 45000 }, async t => {
  const host = await startPreview(t)
  let page = await openPreview(host.base)
  t.after(() => page?.close())
  let identity
  let savedGreeting

  await t.test('mounts the real home SVG, translated navigation and unique SVG resources', async () => {
    const snapshot = await host.json('/dsh-music/api/life')
    identity = snapshot.life.id
    assert.ok(identity)
    assert.equal(page.query('.echo-home .echo-creature').dataset.structure, snapshot.morphology.structure)
    assert.ok(page.byText('相处', page.query('.dshm-tabs')))
    assert.equal(page.query('.echo-mini'), null, 'main dock owns music controls while the panel is open')
    const ids = [...page.document.querySelectorAll('svg [id]')].map(node => node.id)
    assert.equal(ids.length, new Set(ids).size)
    assert.ok(page.document.querySelector('script[src="/client/index.js"]'))
    assert.equal(page.errors.length, 0, page.errors.join('\n'))
  })

  await t.test('names the persistent individual, saves a memory and opens its body mark with mouse and keyboard', async () => {
    page.click(page.byLabel('给生命命名'))
    let dialog = await until(() => page.query('[role="dialog"]'), 'name dialog')
    page.field(dialog.querySelector('input'), name)
    await until(() => !page.byText('就叫这个名字', dialog)?.disabled, 'enabled name submit')
    page.click(page.byText('就叫这个名字', dialog))
    await until(async () => (await host.json('/dsh-music/api/life')).life.name === name && !page.query('[role="dialog"]'), 'saved name')
    assert.equal(page.query('.echo-name-row h3').textContent, name)

    page.click(page.byText('留住这一刻'))
    dialog = await until(() => page.query('[role="dialog"]'), 'memory dialog')
    page.field(dialog.querySelector('input'), memoryTitle)
    page.field(dialog.querySelector('textarea'), memoryNote)
    await until(() => !page.byText('保存这一刻', dialog)?.disabled, 'enabled memory submit')
    page.click(page.byText('保存这一刻', dialog))
    await until(() => !page.query('[role="dialog"]') && page.byLabel(`回看记忆：${memoryTitle}`), 'memory body mark')
    const snapshot = await host.json('/dsh-music/api/life')
    assert.equal(snapshot.life.id, identity)
    assert.equal(snapshot.life.memories.length, 1)
    assert.equal(snapshot.life.memories[0].note, memoryNote)
    assert.equal(snapshot.morphology.marks[0].id, snapshot.life.memories[0].id)

    page.click(page.byLabel(`回看记忆：${memoryTitle}`))
    dialog = await until(() => page.query('[role="dialog"]'), 'read memory dialog')
    assert.equal(dialog.getAttribute('aria-label'), memoryTitle)
    assert.ok(dialog.textContent.includes(memoryNote))
    page.click(page.byLabel('关闭', dialog))
    await until(() => !page.query('[role="dialog"]'), 'memory dialog closed')
    const marker = page.byLabel(`回看记忆：${memoryTitle}`)
    assert.equal(marker.getAttribute('role'), 'button')
    assert.equal(marker.getAttribute('tabindex'), '0')
    marker.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    dialog = await until(() => page.query('[role="dialog"]'), 'keyboard memory activation')
    page.click(page.byLabel('关闭', dialog))
    assert.equal((await host.json('/dsh-music/api/life')).life.stats.interactions, snapshot.life.stats.interactions, 'memory activation does not also touch the body')
  })

  await t.test('learns three taps as two private intervals and responds through the renderer', async () => {
    page.click(page.byText('教它一个招呼'))
    const dialog = await until(() => page.query('[role="dialog"]'), 'greeting dialog')
    assert.equal(page.byText('记住这个招呼', dialog).disabled, true)
    const pad = page.byLabel('敲击节奏', dialog)
    page.click(pad)
    await delay(90)
    page.click(pad)
    await delay(150)
    page.click(pad)
    await until(() => !page.byText('记住这个招呼', dialog).disabled, 'three captured taps')
    assert.ok(page.byLabel('已记录 2 个间隔', dialog))
    page.click(page.byText('记住这个招呼', dialog))
    const snapshot = await until(async () => {
      const state = await host.json('/dsh-music/api/life')
      return state.life.greeting && !page.query('[role="dialog"]') && state
    }, 'durable greeting')
    savedGreeting = snapshot.life.greeting.pattern
    assert.equal(savedGreeting.length, 2)
    assert.ok(savedGreeting.every(ms => Number.isInteger(ms) && ms >= 50 && ms <= 5000))
    page.click(page.byText('打个招呼'))
    await until(() => page.query('.echo-home .echo-creature[data-responding="true"]'), 'greeting body response')
    await until(async () => (await host.json('/dsh-music/api/life')).life.greeting.recognitions === 1, 'recognized greeting')
  })

  await t.test('shows nine distinct individuals and changes geometry without writing simulations to the user archive', async () => {
    const archiveBefore = await readFile(join(host.directory, 'echo-life.json'), 'utf8')
    page.click(page.byText('看看不同的生命'))
    await until(() => page.document.querySelectorAll('.echo-specimen-card').length === 9, 'nine gallery lives')
    const born = geometry(page)
    assert.deepEqual(born.map(item => item.structure).sort(), ['fold', 'fold', 'fold', 'ribbon', 'ribbon', 'ribbon', 'shell', 'shell', 'shell'])
    assert.equal(new Set(born.map(item => JSON.stringify(item.paths))).size, 9, 'individual silhouettes do not collapse to recolors')
    page.click(page.byText('柔和的声音'))
    await until(() => page.byText('柔和的声音').getAttribute('aria-pressed') === 'true', 'gentle simulation')
    const gentle = geometry(page)
    page.click(page.byText('鲜明的节奏'))
    await until(() => page.byText('鲜明的节奏').getAttribute('aria-pressed') === 'true', 'dynamic simulation')
    const dynamic = geometry(page)
    for (let index = 0; index < 9; index++) {
      assert.notDeepEqual(gentle[index].paths, born[index].paths, `individual ${index + 1} grows with gentle input`)
      assert.notDeepEqual(dynamic[index].paths, gentle[index].paths, `individual ${index + 1} responds to different input`)
      assert.equal(dynamic[index].structure, born[index].structure, 'identity structure remains stable')
    }
    const compact = [...page.document.querySelectorAll('.echo-study-controls label')].find(label => label.textContent === '收拢身体')?.querySelector('input')
    page.click(compact)
    await until(() => page.document.querySelectorAll('.echo-specimen-card .echo-creature[data-compact="true"]').length === 9, 'compact gallery')
    const ids = [...page.document.querySelectorAll('svg [id]')].map(node => node.id)
    assert.equal(ids.length, new Set(ids).size, 'gallery resources are unique across nine instances')
    assert.equal(await readFile(join(host.directory, 'echo-life.json'), 'utf8'), archiveBefore, 'gallery changes never write the real archive')
    page.click(page.byText('回到自己的生命'))
    await until(() => page.query('.echo-home .echo-creature'), 'personal life restored')
  })

  await t.test('uses the real music player and overlay across workspace, collapse, hide, restore and navigation', async () => {
    page.click(page.byText('一起听音乐'))
    const row = await until(() => page.query('.dshm-row[role="button"]'), 'actual library track')
    page.click(row)
    await until(() => page.byLabel('暂停', page.query('.echo-dock')), 'main player playing state')
    assert.ok(page.media.plays > 0, 'real player called media.play')
    await until(async () => (await host.json('/dsh-music/api/playback')).trackId === libraryTrack, 'real playback route updated')
    page.click(page.query('[data-testid="preview-workspace"]'))
    let mini = await until(() => page.query('.echo-mini'), 'persistent companion after leaving music')
    assert.ok(mini.querySelector('.echo-creature-svg title').textContent.includes(name))
    assert.equal(mini.querySelector('.echo-creature').dataset.framing, 'presence')
    assert.equal(mini.querySelector('.echo-mini-tools'), null)
    assert.equal(mini.querySelector('.echo-mini-copy'), null)
    assert.ok(page.byLabel('暂停', mini))
    const mediaBeforeTouch = { ...page.media }
    page.click(page.query('.echo-creature-touch-target', mini))
    await until(() => page.byLabel('音灵的回应', mini), 'independent greeting paper')
    await until(async () => (await host.json('/dsh-music/api/life')).life.greeting.recognitions === 2, 'companion greeting saved by actual life service')
    assert.ok(page.query('.echo-mini'))
    assert.equal(page.query('.echo-home'), null, 'touching the body does not navigate')
    assert.equal(mini.querySelector('.echo-mini-tools'), null, 'touching the body does not open music')
    assert.deepEqual(page.media, mediaBeforeTouch, 'touching the body does not change playback')
    page.click(page.byLabel(`回看记忆：${memoryTitle}`, mini))
    const memoryPaper = await until(() => page.byLabel('共同记忆', mini), 'independent actual memory')
    assert.ok(memoryPaper.textContent.includes(memoryTitle))
    assert.ok(memoryPaper.textContent.includes(memoryNote))
    assert.deepEqual(page.media, mediaBeforeTouch, 'reading a memory does not change playback')
    page.click(page.byLabel('收起纸条', mini))
    page.click(page.byLabel('音乐操作', mini))
    await until(() => page.query('.echo-mini-tools', mini), 'explicit music controls')
    page.click(page.byLabel('更多播放操作', mini))
    await until(() => page.byLabel('收拢伴生窗', mini), 'explicit companion settings')
    page.click(page.byLabel('收拢伴生窗', mini))
    mini = await until(() => page.query('.echo-mini.is-compact'), 'collapsed companion')
    assert.equal(mini.querySelector('.echo-creature').dataset.compact, 'true')
    page.click(page.byLabel('展开伴生窗', mini))
    await until(() => !page.query('.echo-mini').classList.contains('is-compact'), 'expanded companion')
    page.click(page.byLabel('隐藏伴生窗', page.query('.echo-mini')))
    await until(() => !page.query('.echo-mini'), 'hidden companion')
    page.click(page.byText('显示伴生'))
    mini = await until(() => page.query('.echo-mini'), 'restored companion')
    assert.equal(mini.querySelector('.echo-mini-tools'), null, 'restoring the companion clears temporary music tools')
    page.click(page.byLabel('暂停', mini))
    await until(() => page.byLabel('播放', page.query('.echo-mini')), 'paused companion player')
    page.click(page.byLabel('播放', page.query('.echo-mini')))
    await until(() => page.byLabel('暂停', page.query('.echo-mini')), 'resumed companion player')
    mini = page.query('.echo-mini')
    page.click(page.byLabel('音乐操作', mini))
    await until(() => page.query('.echo-mini-tools', mini), 'music controls for explicit navigation')
    page.click(page.byLabel('更多播放操作', mini))
    page.click(await until(() => page.byText('回到主舞台', mini), 'main-stage navigation button'))
    await until(() => page.query('.echo-home'), 'explicit companion navigation to actual home')
    await until(() => !page.query('.echo-mini'), 'companion yields to the main dock')
    assert.equal(page.query('[data-testid="preview-music"]').getAttribute('aria-current'), 'page')
    // Avoid pretending the test has heard audio or accumulated listening time.
    page.click(page.byLabel('暂停', page.query('.echo-dock')))
    await until(() => page.byLabel('播放', page.query('.echo-dock')), 'audio controls paused for persistence assertions')
    assert.equal((await host.json('/dsh-music/api/life')).life.stats.listenedMs, 0)
  })

  await t.test('downloads the real replayable archive and restores the same life after a new DOM load', async () => {
    page.click(page.byText('记忆', page.query('.dshm-tabs')))
    await until(() => page.query('.echo-memories-page'), 'memory timeline')
    assert.ok(page.query('.echo-timeline-creature .echo-creature-svg'))
    assert.equal(page.document.querySelectorAll('.echo-memory-item').length, 1)
    page.click(page.byText('带走生命档案'))
    const download = await until(() => page.downloads[0], 'archive Blob download')
    const archive = JSON.parse(await download.content)
    assert.equal(download.filename, `ECHO-${identity}.json`)
    assert.equal(archive.format, 'echo-life-archive')
    assert.equal(archive.life.id, identity)
    assert.equal(archive.life.name, name)
    assert.equal(archive.life.memories[0].title, memoryTitle)
    assert.deepEqual(archive.life.greeting.pattern, savedGreeting)
    assert.ok(archive.events.some(event => event.type === 'rename'))
    assert.ok(archive.events.some(event => event.type === 'memory'))
    assert.ok(archive.events.some(event => event.type === 'greeting'))
    assert.deepEqual(archive, await host.json('/dsh-music/api/life/export'))
    assert.equal(page.errors.length, 0, page.errors.join('\n'))

    page.close()
    page = null
    page = await openPreview(host.base)
    await until(() => page.query('.echo-name-row h3')?.textContent === name, 'saved name after new DOM load')
    const restored = await host.json('/dsh-music/api/life')
    assert.equal(restored.life.id, identity)
    assert.equal(restored.life.name, name)
    assert.equal(restored.life.memories[0].title, memoryTitle)
    assert.equal(restored.life.memories[0].note, memoryNote)
    assert.deepEqual(restored.life.greeting.pattern, savedGreeting)
    assert.equal(restored.life.greeting.recognitions, 2)
    assert.ok(page.byLabel(`回看记忆：${memoryTitle}`))
    assert.ok(page.byText('打个招呼'))
    assert.equal(page.errors.length, 0, page.errors.join('\n'))
  })
})
