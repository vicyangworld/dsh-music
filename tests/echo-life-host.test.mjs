import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createStorage } from '../bundle/host/storage.js'
import { createLifeService, registerLifeRoutes } from '../bundle/host/life.js'
import { replayLife, getMorphology } from '../bundle/shared/life-core.js'

const NOW = Date.UTC(2026, 10, 21, 10, 0, 0)
const TRACK_ID = '0123456789abcdef'

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'echo-life-host-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const storage = createStorage({ dataDir: directory })
  const records = new Map([[TRACK_ID, { id: TRACK_ID, meta: { title: 'Local recording', artist: 'Author' } }]])
  const library = { getRecord: (id) => records.get(id) }
  const make = (extra = {}) => createLifeService({ storage, library, now: () => NOW, seedFactory: () => 'persistent-test-life', ...options, ...extra })
  return { directory, storage, library, records, service: make(), make }
}

function listen(id, extra = {}) {
  return {
    id, type: 'listening', at: NOW, sessionId: `session-${id}`,
    track: { id: TRACK_ID, title: 'Untrusted title', artist: 'Untrusted artist' },
    listenedMs: 30000,
    features: { energy: 0.6, brightness: 0.75, rhythm: 0.4, texture: 0.3 },
    featureSource: 'audio', ...extra,
  }
}

test('concurrent first reads create one private durable identity; restart restores it', async (t) => {
  let births = 0
  const f = await fixture(t, { seedFactory: () => `birth-${++births}` })
  const snapshots = await Promise.all(Array.from({ length: 8 }, () => f.service.get()))
  assert.equal(births, 1)
  assert.equal(new Set(snapshots.map((x) => x.life.id)).size, 1)
  const first = snapshots[0]
  const after = await f.make({ seedFactory: () => 'must-not-be-used' }).get()
  assert.deepEqual(after, first)
  if (process.platform !== 'win32') assert.equal((await stat(f.service.file)).mode & 0o777, 0o600)
  first.life.name = 'caller mutation'
  assert.notEqual((await f.service.get()).life.name, first.life.name)
})

test('concurrent writes and retries are serialized, exactly once, with authoritative track metadata', async (t) => {
  const f = await fixture(t)
  const requests = Array.from({ length: 12 }, (_, i) => listen(`play-${i}`))
  const results = await Promise.all([...requests, ...requests].map((event) => f.service.append(event)))
  assert.equal(results.filter((r) => r.duplicate).length, 12)
  const archive = await f.service.exportArchive()
  assert.equal(archive.events.length, 12)
  assert.equal(archive.life.stats.listenedMs, 12 * 30000)
  assert.deepEqual(archive.events.map((e) => e.id), requests.map((e) => e.id))
  assert.equal(archive.events[0].track.title, 'Local recording')
  assert.equal(archive.events[0].track.artist, 'Author')
  const restored = await f.make().get()
  assert.deepEqual(restored.life, archive.life)
  assert.deepEqual(replayLife(archive.initial, archive.events), archive.life)
  assert.deepEqual(getMorphology(archive.life), restored.morphology)
})

test('a committed event stays idempotent after its local song is removed', async (t) => {
  const f = await fixture(t)
  await f.service.append(listen('already-played'))
  f.records.delete(TRACK_ID)
  const retried = await f.service.append(listen('already-played'))
  assert.equal(retried.duplicate, true)
  assert.equal(retried.life.stats.listenedMs, 30000)
  await assert.rejects(f.service.append(listen('new-unknown')), (e) => e.code === 'UNKNOWN_LIFE_TRACK')
})

test('id canonicalization cannot introduce duplicate journal entries', async (t) => {
  const f = await fixture(t)
  await f.service.append(listen('caf\u00e9'))
  const retried = await f.service.append(listen('  cafe\u0301  '))
  assert.equal(retried.duplicate, true)
  assert.equal((await f.service.exportArchive()).events.length, 1)
  assert.equal((await f.make().get()).life.stats.listenedMs, 30000)
})

test('unknown and preview songs never become observed listening; explicit sharing stays separate', async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.service.append(listen('unknown', { track: { id: 'abcdef0123456789' } })), (e) => e.status === 404)
  await assert.rejects(f.service.append(listen('preview', { track: { id: 'preview:12345' } })), (e) => e.status === 404)
  const shared = await f.service.append({ id: 'shared-song', type: 'share', at: NOW, title: 'A song I chose', artist: 'Someone' })
  assert.equal(shared.life.stats.listenedMs, 0)
  assert.equal(shared.life.stats.sharedSongs, 1)
  assert.equal((await f.service.exportArchive()).events.length, 1)
})

test('invalid numeric data, invalid times and invalid events do not alter the archive', async (t) => {
  const f = await fixture(t)
  await f.service.get()
  const before = await readFile(f.service.file, 'utf8')
  const badEvents = [
    listen('nan', { listenedMs: NaN }),
    listen('infinity', { features: { energy: Infinity, brightness: 0.5, rhythm: 0.5, texture: 0.5 } }),
    listen('duration', { listenedMs: 60001 }),
    listen('future', { at: NOW + 3600000 }),
    listen('string-date', { at: 'tomorrow' }),
    listen('source', { featureSource: 'spotify-guess' }),
    { id: 'bad-greeting', type: 'greeting', at: NOW, pattern: [10, 'no'] },
    { id: 'unknown-type', type: 'model-rewrite', at: NOW },
    [], null,
  ]
  for (const event of badEvents) await assert.rejects(f.service.append(event))
  assert.equal(await readFile(f.service.file, 'utf8'), before)
  assert.equal((await f.service.get()).life.stats.listenedMs, 0)
})

test('timestamps tolerate small client skew and record arrival order without future growth', async (t) => {
  const f = await fixture(t)
  await f.service.append({ id: 'first', type: 'interaction', at: NOW + 10000, action: 'touch' })
  await f.service.append({ id: 'late', type: 'interaction', at: NOW - 100000, action: 'touch' })
  const archive = await f.service.exportArchive()
  assert.deepEqual(archive.events.map((e) => e.id), ['first', 'late'])
  assert.deepEqual(archive.events.map((e) => e.at), [NOW, NOW])
})

test('a failed disk commit does not publish the uncommitted life or poison the write queue', async (t) => {
  const f = await fixture(t)
  const first = await f.service.get()
  const saved = await readFile(f.service.file, 'utf8')
  await rm(f.service.file)
  await mkdir(f.service.file) // rename cannot replace a directory with a file
  await assert.rejects(f.service.append(listen('retry-after-disk-error')), (e) => e.code === 'LIFE_STORAGE_UNAVAILABLE')
  assert.deepEqual(await f.service.get(), first)
  assert.equal((await readdir(f.directory)).some((name) => name.includes('.tmp-')), false)
  await rm(f.service.file, { recursive: true })
  await writeFile(f.service.file, saved, { mode: 0o600 })
  const retried = await f.service.append(listen('retry-after-disk-error'))
  assert.equal(retried.duplicate, false)
  assert.equal(retried.life.stats.listenedMs, 30000)
})

test('corrupt JSON, a modified snapshot and an unknown version preserve the original file', async (t) => {
  const f = await fixture(t)
  const valid = await f.service.exportArchive()
  const cases = [
    { content: '{broken', code: 'LIFE_ARCHIVE_INVALID' },
    { content: JSON.stringify({ ...valid, life: { ...valid.life, name: 'silently changed' } }), code: 'LIFE_ARCHIVE_INVALID' },
    { content: JSON.stringify({ ...valid, version: 999 }), code: 'LIFE_ARCHIVE_VERSION' },
  ]
  for (const item of cases) {
    await writeFile(f.service.file, item.content)
    const restarted = f.make({ seedFactory: () => { throw new Error('must never replace a damaged identity') } })
    await assert.rejects(restarted.get(), (e) => e.code === item.code)
    await assert.rejects(restarted.append(listen('must-not-write')), (e) => e.code === item.code)
    assert.equal(await readFile(f.service.file, 'utf8'), item.content)
  }
})

test('capacity never discards idempotency keys or previously accepted events', async (t) => {
  const f = await fixture(t, { limits: { events: 2 } })
  await f.service.append(listen('one'))
  await f.service.append(listen('two'))
  const before = await readFile(f.service.file, 'utf8')
  await assert.rejects(f.service.append(listen('three')), (e) => e.code === 'LIFE_CAPACITY_REACHED')
  assert.equal((await f.service.append(listen('one'))).duplicate, true)
  assert.equal(await readFile(f.service.file, 'utf8'), before)
  assert.equal((await f.service.exportArchive()).events.length, 2)
})

test('HTTP routes expose the real lifecycle and export with strict input handling', async (t) => {
  const f = await fixture(t)
  const registered = new Map()
  const webServer = { register(def) { registered.set(def.path, def.handler); return () => registered.delete(def.path) } }
  const disposers = registerLifeRoutes(webServer, { life: f.service })
  const server = createServer((req, res) => {
    const handler = registered.get(new URL(req.url, 'http://localhost').pathname)
    if (!handler) { res.writeHead(404); res.end(); return }
    void handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    disposers.forEach((dispose) => dispose())
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  })
  const base = `http://127.0.0.1:${server.address().port}/dsh-music/api/life`
  const initial = await fetch(base).then((r) => r.json())
  assert.ok(initial.life.id)
  assert.ok(initial.morphology.structure)
  const response = await fetch(`${base}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(listen('via-http')) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).life.stats.listenedMs, 30000)
  const wrongMethod = await fetch(base, { method: 'POST' })
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'GET')
  const malformed = await fetch(`${base}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
  assert.equal(malformed.status, 400)
  const wrongType = await fetch(`${base}/events`, { method: 'POST', body: '{}' })
  assert.equal(wrongType.status, 415)
  const oversized = await fetch(`${base}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: 'x'.repeat(70000) }) })
  assert.equal(oversized.status, 413)
  const exported = await fetch(`${base}/export`)
  assert.equal(exported.status, 200)
  assert.match(exported.headers.get('content-disposition'), /attachment/)
  const archive = await exported.json()
  assert.equal(archive.events.length, 1)
  assert.deepEqual(replayLife(archive.initial, archive.events), archive.life)
})
