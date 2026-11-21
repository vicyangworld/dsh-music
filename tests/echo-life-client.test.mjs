import test from 'node:test'
import assert from 'node:assert/strict'
import { createLifeClient } from '../src/client/echo/service.js'
import { createLife, applyLifeEvent, getMorphology } from '../bundle/shared/life-core.js'

const KEY = 'dsh-music.echo.outbox.v1'
const NOW = Date.UTC(2026, 10, 21, 12)
const event = (id, extra = {}) => ({ id, type: 'interaction', at: NOW, action: 'touch', ...extra })
const clone = value => JSON.parse(JSON.stringify(value))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(value) })

function memoryStorage(initial = null) {
  let raw = initial
  return {
    failWrites: false, failReads: false, writes: 0, onWrite: null,
    getItem(key) { assert.equal(key, KEY); if (this.failReads) throw new Error('read denied'); return raw },
    setItem(key, value) { assert.equal(key, KEY); if (this.failWrites) throw new Error('quota exceeded'); this.onWrite?.(value); this.writes++; raw = value },
    get raw() { return raw },
    set raw(value) { raw = value },
  }
}

function fakeTimers() {
  let serial = 0
  const tasks = new Map()
  return {
    setTimeout(fn, delay) { const id = ++serial; tasks.set(id, { fn, delay }); return id },
    clearTimeout(id) { tasks.delete(id) },
    get size() { return tasks.size },
    async runAll() { const queued = [...tasks.values()]; tasks.clear(); for (const task of queued) task.fn(); await new Promise(resolve => setImmediate(resolve)) },
  }
}

function fixture(t, options = {}) {
  const storage = options.storage || memoryStorage()
  const timers = fakeTimers()
  const eventTarget = new EventTarget()
  let life = createLife({ seed: 'client-reliability', now: NOW })
  const calls = []
  const server = {
    offline: false, rejected: new Map(), beforeGet: null, beforePost: null, afterPost: null,
    snapshot: () => ({ life: clone(life), morphology: getMorphology(life) }),
    get life() { return life },
    set life(value) { life = value },
  }
  const fetcher = async (url, init = {}) => {
    calls.push({ url, ...init })
    if (server.offline) throw new TypeError('Network unavailable')
    if (init.method === 'POST') {
      const input = JSON.parse(init.body)
      if (server.beforePost) await server.beforePost(input, init)
      const denied = server.rejected.get(input.id)
      if (denied) return response({ error: denied.message || 'Event rejected', code: denied.code }, denied.status)
      life = applyLifeEvent(life, input)
      if (server.afterPost) await server.afterPost(input, init)
      return response(server.snapshot())
    }
    const data = server.snapshot()
    if (server.beforeGet) await server.beforeGet(data, init)
    return response(data)
  }
  const client = createLifeClient({ storage, fetcher, timers, eventTarget, ...options })
  t.after(() => client.dispose())
  return { client, server, storage, calls, timers, eventTarget, fetcher }
}

test('a rejected head is retained separately and does not block later experiences', async t => {
  const f = fixture(t)
  await f.client.load()
  f.server.rejected.set('missing-song', { status: 404, code: 'UNKNOWN_LIFE_TRACK' })
  await assert.rejects(f.client.submit(event('missing-song')))
  await f.client.submit(event('a-new-memory'))
  assert.deepEqual(f.server.life.processedEventIds, ['a-new-memory'])
  const local = f.client.exportOutbox()
  assert.equal(local.rejected[0].event.id, 'missing-song')
  assert.equal(f.client.source.getSnapshot().rejectedCount, 1)
})

test('identical IDs are canonicalized and occupy one outbox entry while offline', async t => {
  const f = fixture(t)
  f.server.offline = true
  await assert.rejects(f.client.submit(event('caf\u00e9')))
  await assert.rejects(f.client.submit(event('  cafe\u0301  ')))
  assert.equal(f.client.source.getSnapshot().pending, 1)
  f.server.offline = false
  await f.client.retry()
  assert.deepEqual(f.server.life.processedEventIds, ['caf\u00e9'])
})

test('failed storage retains the event in memory, never claims durable queuing, and can recover', async t => {
  const f = fixture(t)
  f.storage.failWrites = true
  await assert.rejects(f.client.submit(event('unsaved')), error => error.queued !== true)
  assert.equal(f.client.source.getSnapshot().volatileCount, 1)
  assert.equal(f.client.exportOutbox().volatile[0].id, 'unsaved')
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0)
  f.storage.failWrites = false
  await f.client.retry()
  assert.deepEqual(f.server.life.processedEventIds, ['unsaved'])
  assert.equal(f.client.source.getSnapshot().volatileCount, 0)
})

test('submission persists synchronously, isolates caller mutation, and survives a new client', async t => {
  const f = fixture(t)
  f.server.offline = true
  const input = event('pagehide-delta')
  const sent = f.client.submit(input)
  assert.equal(JSON.parse(f.storage.raw).pending[0].id, 'pagehide-delta')
  input.action = 'invalid-after-enqueue'
  await assert.rejects(sent, error => error.queued === true)
  f.client.dispose()
  f.server.offline = false
  const restarted = createLifeClient({ storage: f.storage, fetcher: f.fetcher, timers: fakeTimers(), eventTarget: new EventTarget() })
  t.after(() => restarted.dispose())
  await restarted.retry()
  assert.deepEqual(f.server.life.processedEventIds, ['pagehide-delta'])
  assert.equal(restarted.source.getSnapshot().pending, 0)
})

test('concurrent submissions serialize POSTs and report each event own result', async t => {
  const f = fixture(t)
  await f.client.load()
  const first = deferred()
  let inFlight = 0, peak = 0
  f.server.beforePost = async input => {
    peak = Math.max(peak, ++inFlight)
    if (input.id === 'accepted') await first.promise
    inFlight--
    if (input.id === 'offline-later') throw new TypeError('Connection lost')
  }
  const accepted = f.client.submit(event('accepted'))
  const duplicate = f.client.submit(event(' accepted '))
  const later = f.client.submit(event('offline-later'))
  const rejected = assert.rejects(later, error => error.queued === true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1)
  first.resolve()
  await Promise.all([accepted, duplicate, rejected])
  assert.equal(peak, 1)
  assert.deepEqual(f.server.life.processedEventIds, ['accepted'])
  assert.deepEqual(f.client.exportOutbox().pending.map(item => item.id), ['offline-later'])
})

test('lost acknowledgements retry the same ID and never apply an experience twice', async t => {
  const f = fixture(t)
  await f.client.load()
  let disconnected = true
  f.server.afterPost = () => { if (disconnected) throw new TypeError('Response lost after commit') }
  await assert.rejects(f.client.submit(event('commit-without-response')), error => error.queued === true)
  assert.equal(f.server.life.stats.interactions, 1)
  disconnected = false
  await f.client.retry()
  assert.equal(f.server.life.stats.interactions, 1)
  assert.equal(f.client.source.getSnapshot().pending, 0)
})

test('acknowledgement cleanup failure retains the durable record until a safe retry', async t => {
  const f = fixture(t)
  await f.client.load()
  f.server.beforePost = () => { f.storage.failWrites = true }
  await f.client.submit(event('cleanup-failed'))
  assert.equal(f.server.life.stats.interactions, 1)
  assert.equal(JSON.parse(f.storage.raw).pending[0].id, 'cleanup-failed')
  assert.equal(f.client.exportOutbox().pending.length, 1)
  assert.ok(f.client.source.getSnapshot().storageError)
  f.storage.failWrites = false
  await f.client.retry()
  assert.equal(JSON.parse(f.storage.raw).pending.length, 0)
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1)
})

test('permanent invalid events are exportable across restart and explicitly retryable', async t => {
  const f = fixture(t)
  await f.client.load()
  f.server.rejected.set('temporarily-missing', { status: 404, code: 'UNKNOWN_LIFE_TRACK', message: 'This local track is absent' })
  f.server.rejected.set('bad-payload', { status: 400, code: 'INVALID_LIFE_EVENT' })
  await assert.rejects(f.client.submit(event('temporarily-missing')), error => error.quarantined && error.queued === false)
  await assert.rejects(f.client.submit(event('bad-payload')), error => error.quarantined && error.queued === false)
  const exported = f.client.exportOutbox()
  exported.rejected[0].event.id = 'must-not-mutate-storage'
  f.client.dispose()
  const restarted = createLifeClient({ storage: f.storage, fetcher: f.fetcher, timers: fakeTimers(), eventTarget: new EventTarget() })
  t.after(() => restarted.dispose())
  assert.equal(restarted.source.getSnapshot().rejectedCount, 2)
  assert.equal(restarted.exportOutbox().rejected[0].event.id, 'temporarily-missing')
  f.server.rejected.delete('temporarily-missing')
  await restarted.retryRejected('temporarily-missing')
  assert.deepEqual(f.server.life.processedEventIds, ['temporarily-missing'])
  assert.equal(restarted.source.getSnapshot().rejectedCount, 1)
  assert.equal(restarted.exportOutbox().rejected[0].event.id, 'bad-payload')
})

test('quarantine write failure never removes the original event', async t => {
  const f = fixture(t)
  await f.client.load()
  f.server.rejected.set('cannot-quarantine', { status: 400, code: 'INVALID_LIFE_EVENT' })
  f.server.beforePost = () => { f.storage.failWrites = true }
  await assert.rejects(f.client.submit(event('cannot-quarantine')), error => error.queued === true)
  assert.equal(f.client.source.getSnapshot().rejectedCount, 0)
  assert.equal(f.client.exportOutbox().pending[0].id, 'cannot-quarantine')
  assert.equal(JSON.parse(f.storage.raw).pending[0].id, 'cannot-quarantine')
  f.storage.failWrites = false
  f.server.beforePost = null
  await f.client.retry()
  assert.equal(f.client.source.getSnapshot().pending, 0)
  assert.equal(f.client.source.getSnapshot().rejectedCount, 1)
})

test('whole-archive capacity and unknown routes remain pending rather than being quarantined', async t => {
  for (const rejection of [
    { status: 409, code: 'LIFE_CAPACITY_REACHED' },
    { status: 404, code: 'ROUTE_NOT_FOUND' },
  ]) {
    const f = fixture(t)
    await f.client.load()
    f.server.rejected.set('retain-this', rejection)
    await assert.rejects(f.client.submit(event('retain-this')), error => error.queued === true)
    assert.equal(f.client.source.getSnapshot().pending, 1)
    assert.equal(f.client.source.getSnapshot().rejectedCount, 0)
    assert.equal(f.timers.size, 0)
  }
})

test('corrupt and unknown-version local archives preserve their exact bytes for export', async t => {
  for (const raw of ['{unfinished JSON', JSON.stringify({ version: 99, pending: [event('old')], rejected: [] })]) {
    const f = fixture(t, { storage: memoryStorage(raw) })
    await f.client.load()
    await assert.rejects(f.client.submit(event('while-unreadable')), error => error.queued === false)
    assert.equal(f.storage.raw, raw)
    assert.equal(f.client.exportOutbox().rawStorage, raw)
    assert.equal(f.client.exportOutbox().volatile[0].id, 'while-unreadable')
    assert.equal(f.storage.writes, 0)
  }
})

test('storage access errors recover without reloading and legacy duplicates migrate once', async t => {
  const storage = memoryStorage(JSON.stringify([event('caf\u00e9'), event('  cafe\u0301  ')]))
  storage.failReads = true
  const f = fixture(t, { storage })
  await assert.rejects(f.client.submit(event('new-while-storage-locked')))
  storage.failReads = false
  await f.client.retry()
  assert.deepEqual(f.server.life.processedEventIds, ['caf\u00e9', 'new-while-storage-locked'])
  assert.equal(f.client.source.getSnapshot().storageError, null)
  assert.equal(JSON.parse(storage.raw).version, 2)
})

test('a delayed older load cannot roll back a successful post or replace its identity', async t => {
  for (const foreignIdentity of [false, true]) {
    const f = fixture(t)
    await f.client.load()
    const held = deferred()
    f.server.beforeGet = async data => {
      if (foreignIdentity) data.life = createLife({ seed: 'a-different-stale-identity', now: NOW })
      await held.promise
    }
    const oldRead = f.client.load()
    await new Promise(resolve => setImmediate(resolve))
    await f.client.submit(event('newer-write'))
    const current = f.client.source.getSnapshot().life
    held.resolve()
    await oldRead
    assert.equal(f.client.source.getSnapshot().life.id, current.id)
    assert.deepEqual(f.client.source.getSnapshot().life.processedEventIds, ['newer-write'])
  }
})

test('a delayed failed read cannot put a newer committed life into an error state', async t => {
  const f = fixture(t)
  await f.client.load()
  const held = deferred()
  f.server.beforeGet = async () => { await held.promise; throw new Error('Stale GET failed') }
  const oldRead = f.client.load()
  const rejected = assert.rejects(oldRead)
  await new Promise(resolve => setImmediate(resolve))
  await f.client.submit(event('accepted-despite-old-read'))
  held.resolve()
  await rejected
  assert.equal(f.client.source.getSnapshot().status, 'ready')
  assert.equal(f.client.source.getSnapshot().error, null)
})

test('online recovery flushes once, cancels retry timers, and does not duplicate concurrent loads', async t => {
  const f = fixture(t)
  f.server.offline = true
  await assert.rejects(f.client.submit(event('reconnect')))
  assert.equal(f.timers.size, 1)
  f.server.offline = false
  f.eventTarget.dispatchEvent(new Event('online'))
  f.eventTarget.dispatchEvent(new Event('online'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.server.life.processedEventIds, ['reconnect'])
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1)
  assert.equal(f.timers.size, 0)
  const before = f.calls.length
  await Promise.all([f.client.load(), f.client.load(), f.client.load()])
  assert.equal(f.calls.length - before, 1)
})

test('dispose aborts active work, clears timers and online hooks, and leaves queued events durable', async t => {
  const f = fixture(t)
  await f.client.load()
  const held = deferred()
  let signal
  f.server.beforePost = async (_input, init) => { signal = init.signal; await held.promise }
  let notifications = 0
  f.client.source.subscribe(() => notifications++)
  const sent = f.client.submit(event('dispose-in-flight'))
  const rejected = assert.rejects(sent)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.timers.size, 1)
  f.client.dispose()
  assert.equal(signal.aborted, true)
  assert.equal(f.timers.size, 0)
  await rejected
  const atDisposal = notifications
  const requestsAtDisposal = f.calls.length
  held.resolve()
  f.eventTarget.dispatchEvent(new Event('online'))
  await assert.rejects(f.client.submit(event('after-dispose')), error => error.code === 'LIFE_CLIENT_CLOSED')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.length, requestsAtDisposal)
  assert.equal(notifications, atDisposal)
  assert.equal(JSON.parse(f.storage.raw).pending[0].id, 'dispose-in-flight')
})

test('stalled requests time out without losing the queue and can retry later', async t => {
  const f = fixture(t)
  await f.client.load()
  const held = deferred()
  f.server.beforePost = () => held.promise
  const sent = f.client.submit(event('timeout'))
  const rejected = assert.rejects(sent, error => error.code === 'LIFE_REQUEST_TIMEOUT' && error.queued === true)
  await new Promise(resolve => setImmediate(resolve))
  await f.timers.runAll()
  await rejected
  assert.equal(f.client.source.getSnapshot().pending, 1)
  assert.equal(f.timers.size, 1)
  held.resolve()
  f.server.beforePost = null
  await f.client.retry()
  assert.equal(f.server.life.stats.interactions, 1)
  assert.equal(f.timers.size, 0)
})

test('dispatch only marks durable retryable events as queued', async t => {
  const f = fixture(t)
  f.server.offline = true
  await assert.rejects(f.client.dispatch('memory', { title: 'Saved offline' }), error => error.queued === true)
  f.storage.failWrites = true
  await assert.rejects(f.client.dispatch('memory', { title: 'Not yet on disk' }), error => error.queued === false && error.unsaved === true)
  assert.equal(f.client.exportOutbox().pending.length, 1)
  assert.equal(f.client.exportOutbox().volatile.length, 1)
})

test('recovery drains a full older outbox without writing an oversized new archive', async t => {
  const storage = memoryStorage(JSON.stringify(Array.from({ length: 499 }, (_, index) => event(`older-${index}`))))
  storage.failReads = true
  const f = fixture(t, { storage })
  await assert.rejects(f.client.submit(event('newer-1')))
  await assert.rejects(f.client.submit(event('newer-2')))
  storage.failReads = false
  storage.onWrite = value => {
    const saved = JSON.parse(value)
    assert.ok(saved.pending.length + saved.rejected.length <= 500, 'Every intermediate archive must remain readable after a crash')
  }
  await f.client.retry()
  assert.equal(f.server.life.processedEventIds.length, 501)
  assert.deepEqual(f.server.life.processedEventIds.slice(-2), ['newer-1', 'newer-2'])
  assert.equal(f.client.source.getSnapshot().pending, 0)
})

test('a malformed successful response retains the record and schedules recovery', async t => {
  let delegate
  const f = fixture(t, { fetcher: (...args) => args[1]?.method === 'POST'
    ? Promise.resolve({ status: 200, ok: true, json: async () => { throw new SyntaxError('Unexpected HTML') } })
    : delegate(...args) })
  delegate = f.fetcher
  await f.client.load()
  await assert.rejects(f.client.submit(event('invalid-200')), error => error.queued === true)
  assert.equal(f.client.source.getSnapshot().pending, 1)
  assert.equal(f.timers.size, 1)
})

test('startup load failure schedules retry for an existing durable backlog', async t => {
  const f = fixture(t, { storage: memoryStorage(JSON.stringify([event('from-yesterday')])) })
  f.server.offline = true
  await assert.rejects(f.client.load())
  assert.equal(f.timers.size, 1)
  f.server.offline = false
  await f.timers.runAll()
  assert.deepEqual(f.server.life.processedEventIds, ['from-yesterday'])
  assert.equal(f.timers.size, 0)
})

test('disposing before a request starts does not invoke the network callback', async t => {
  const f = fixture(t)
  const loading = f.client.load()
  f.client.dispose()
  await assert.rejects(loading, error => error.code === 'LIFE_CLIENT_CLOSED')
  assert.equal(f.calls.length, 0)
  assert.equal(f.timers.size, 0)
})
