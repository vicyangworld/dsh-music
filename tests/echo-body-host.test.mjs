import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLifeService, MIN_BODY_GROWTH_AUDIO_MS } from '../bundle/host/life.js'
import { createLife, applyLifeEvent } from '../bundle/shared/life-core.js'
import { createBodyFromLife, createBodyCandidate, commitBodyCandidate, synchronizeBodyLifeRevision } from '../bundle/shared/body-core.js'

const NOW = Date.UTC(2026, 10, 23, 8)
const TRACK = '0123456789abcdef'
const clone = value => structuredClone(value)
const checksum = value => {
  const { checksum: ignored, ...payload } = value
  return { ...payload, checksum: createHash('sha256').update(JSON.stringify(payload)).digest('hex') }
}
const listen = (id, extra = {}) => ({
  id, type: 'listening', at: NOW, sessionId: 'recording-session', track: { id: TRACK, title: 'Source' },
  listenedMs: 60000, featureSource: 'audio', features: { energy: 0.6, brightness: 0.4, rhythm: 0.65, texture: 0.3 }, ...extra,
})
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'echo-body-host-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const storage = createStorage({ dataDir: directory })
  const library = { getRecord: id => id === TRACK ? { id, meta: { title: 'Source', artist: 'Author' } } : null }
  const make = (options = {}) => createLifeService({ storage, library, now: () => NOW, seedFactory: () => 'body-host-seed', ...options })
  return { directory, storage, make, service: make() }
}
async function feed(service, prefix) {
  for (let n = 0; n < MIN_BODY_GROWTH_AUDIO_MS / 60000; n++) await service.append(listen(`${prefix}:${n}`))
  return service.get()
}
function candidate(snapshot, id = `growth:${snapshot.body.bodyRevision + 1}`) {
  return createBodyCandidate(snapshot.body, {
    id, at: NOW, baseLifeRevision: snapshot.body.lifeRevision, baseBodyRevision: snapshot.body.bodyRevision,
    parameters: { tailLength: snapshot.body.parameters.tailLength + 0.025, legLength: snapshot.body.parameters.legLength + 0.01 },
    source: { kind: 'model', provider: 'fixture', model: 'test-only-body-model', requestId: id },
    reason: 'A persisted test result; no model inference occurs in this test.',
    evidenceEventIds: [snapshot.life.processedEventIds.at(-1)],
  })
}
async function twoGrowths(service) {
  const ready1 = await feed(service, 'before-first'), one = candidate(ready1, 'growth:one')
  const first = await service.commitGrowth(one)
  const ready2 = await feed(service, 'before-second'), two = candidate(ready2, 'growth:two')
  const second = await service.commitGrowth(two)
  return { first, second, one, two, archive: await service.exportArchive() }
}

test('legacy v1 is verified then durably migrated without changing its life or event history', async t => {
  const f = await fixture(t)
  const initial = createLife({ seed: 'a-real-legacy-seed', now: NOW, name: '旧朋友' })
  const events = [listen('old:1'), listen('old:2'), { id: 'old:memory', type: 'memory', at: NOW, title: 'A shared memory' }]
  const life = events.reduce(applyLifeEvent, initial)
  const legacy = checksum({ format: 'echo-life-archive', version: 1, initial, events, life })
  await f.storage.ready
  await writeFile(f.service.file, JSON.stringify(legacy), { mode: 0o600 })
  let seeds = 0
  const migrated = await f.make({ seedFactory: () => { seeds++; return 'must-not-use' } }).get()
  const persisted = JSON.parse(await readFile(f.service.file, 'utf8'))
  assert.equal(seeds, 0)
  assert.equal(persisted.version, 2)
  assert.notEqual(persisted.checksum, legacy.checksum)
  assert.equal(persisted.checksum, checksum(persisted).checksum)
  assert.deepEqual(persisted.initial, initial)
  assert.deepEqual(persisted.events, events)
  assert.deepEqual(persisted.life, life)
  assert.deepEqual(migrated.body, createBodyFromLife(life))
  assert.equal(persisted.bodyBaselineAudioMs, life.growth.audioMs)
  assert.equal(migrated.development.observedAudioMs, 0)
  assert.deepEqual(await f.make().get(), migrated)
})

test('invalid legacy checksums and failed migration writes leave the old file untouched', async t => {
  const f = await fixture(t), initial = createLife({ seed: 'unmodified-legacy', now: NOW })
  const legacy = checksum({ format: 'echo-life-archive', version: 1, initial, events: [], life: initial })
  await f.storage.ready
  const invalid = JSON.stringify({ ...legacy, life: { ...initial, name: 'tampered' } })
  await writeFile(f.service.file, invalid)
  await assert.rejects(f.make().get(), e => e.code === 'LIFE_ARCHIVE_INVALID')
  assert.equal(await readFile(f.service.file, 'utf8'), invalid)
  const original = JSON.stringify(legacy)
  await writeFile(f.service.file, original)
  const capacity = Math.max(1024, Buffer.byteLength(original) + 16)
  await assert.rejects(f.make({ limits: { bytes: capacity } }).get(), e => e.code === 'LIFE_CAPACITY_REACHED')
  assert.equal(await readFile(f.service.file, 'utf8'), original)
  const migrated = await f.make().get()
  assert.equal(migrated.life.seed, initial.seed)
  assert.equal(migrated.body.bodyRevision, 0)
})

test('two model growth results survive restart exactly, including their source and previous body', async t => {
  const f = await fixture(t), { first, second, one, two, archive } = await twoGrowths(f.service)
  assert.equal(first.body.bodyRevision, 1)
  assert.equal(second.body.bodyRevision, 2)
  assert.deepEqual(second.body.lastGrowth, two)
  assert.deepEqual(second.body.previousBody.lastGrowth, one)
  assert.equal(second.body.previousBody.previousBody, undefined)
  assert.deepEqual(archive.bodyGrowth.map(r => r.candidate), [one, two])
  assert.deepEqual(archive.bodyGrowth.map(r => r.observedAudioMs), [MIN_BODY_GROWTH_AUDIO_MS, MIN_BODY_GROWTH_AUDIO_MS * 2])
  const { duplicate, ...expected } = second
  assert.deepEqual(await f.make().get(), expected)
  assert.deepEqual((await f.make().exportArchive()).bodyGrowth, archive.bodyGrowth)
})

test('listening or interaction received during inference makes its old growth proposal stale', async t => {
  const f = await fixture(t), ready = await feed(f.service, 'ready'), proposal = candidate(ready)
  await f.service.append(listen('arrived-during-inference'))
  const before = await readFile(f.service.file, 'utf8')
  await assert.rejects(f.service.commitGrowth(proposal), e => e.code === 'STALE_BODY_GROWTH' && e.status === 409)
  assert.equal(await readFile(f.service.file, 'utf8'), before)
  assert.equal((await f.service.get()).body.bodyRevision, 0)
  const fresh = candidate(await f.service.get())
  await f.service.append({ id: 'touch-during-inference', type: 'interaction', action: 'touch', at: NOW })
  await assert.rejects(f.service.commitGrowth(fresh), e => e.code === 'STALE_BODY_GROWTH')
})

test('growth retries remain idempotent after later growth and conflicting IDs cannot replace history', async t => {
  const f = await fixture(t), { one, two } = await twoGrowths(f.service)
  const before = await readFile(f.service.file, 'utf8')
  const duplicate = await f.service.commitGrowth(one)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.body.bodyRevision, 2)
  assert.deepEqual(duplicate.body.lastGrowth, two)
  await assert.rejects(f.service.commitGrowth({ ...one, reason: 'a different result with the same ID' }), e => e.code === 'BODY_PROPOSAL_CONFLICT')
  assert.equal(await readFile(f.service.file, 'utf8'), before)
  assert.equal((await f.make().commitGrowth(one)).duplicate, true)
})

test('failed growth persistence retains the complete old body and a later retry commits once', async t => {
  const f = await fixture(t), ready = await feed(f.service, 'ready'), proposal = candidate(ready)
  const before = await f.service.get(), saved = await readFile(f.service.file, 'utf8')
  await rm(f.service.file)
  await mkdir(f.service.file)
  await assert.rejects(f.service.commitGrowth(proposal), e => e.code === 'LIFE_STORAGE_UNAVAILABLE')
  assert.deepEqual(await f.service.get(), before)
  assert.equal((await readdir(f.directory)).some(name => name.includes('.tmp-')), false)
  await rm(f.service.file, { recursive: true })
  await writeFile(f.service.file, saved, { mode: 0o600 })
  const committed = await f.service.commitGrowth(proposal)
  assert.equal(committed.body.bodyRevision, 1)
  assert.equal(committed.duplicate, false)
  assert.deepEqual((await f.make().get()).body, committed.body)
})

test('growth eligibility uses newly observed audio and excludes playback without features', async t => {
  const f = await fixture(t)
  for (let n = 0; n < 6; n++) {
    const event = listen(`duration-only:${n}`, { featureSource: 'none' })
    delete event.features
    await f.service.append(event)
  }
  const before = await f.service.get()
  assert.equal(before.life.stats.listenedMs, 360000)
  assert.equal(before.development.eligible, false)
  assert.equal(before.development.observedAudioMs, 0)
  const proposal = candidate(before)
  await assert.rejects(f.service.commitGrowth(proposal), e => e.code === 'BODY_GROWTH_NOT_READY')
  const ready = await feed(f.service, 'observed')
  const next = await f.service.commitGrowth(candidate(ready))
  assert.equal(next.development.observedAudioMs, 0)
  assert.equal(next.development.eligible, false)
  await assert.rejects(f.service.commitGrowth(candidate(next, 'too-soon')), e => e.code === 'BODY_GROWTH_NOT_READY')
})

test('rechecksummed malformed body and growth histories are rejected without rewriting the archive', async t => {
  const f = await fixture(t), { archive, first } = await twoGrowths(f.service)
  const corruptions = [
    a => { a.body.parameters.legLength += 0.01 },
    a => { a.bodyGrowth[0].observedAudioMs -= 1 },
    a => { a.bodyGrowth[0].observedAudioMs += 60000 },
    a => { a.bodyBaselineAudioMs = 1000 },
    a => { a.bodyGrowth[1].candidate.parameters.tailLength += 0.01 },
    a => { a.bodyGrowth.push(clone(a.bodyGrowth[1])) },
    a => { a.bodyInitial = clone(first.body); a.bodyGrowth.shift(); a.bodyBaselineAudioMs = MIN_BODY_GROWTH_AUDIO_MS },
    a => {
      // A structurally valid replay still must not use an event from the future.
      a.bodyGrowth[0].candidate.evidenceEventIds = [a.bodyGrowth[1].candidate.evidenceEventIds[0]]
      let b = a.bodyInitial
      for (const record of a.bodyGrowth) b = commitBodyCandidate({ ...b, lifeRevision: record.candidate.baseLifeRevision }, record.candidate)
      a.body = synchronizeBodyLifeRevision(b, a.life)
    },
  ]
  for (const corrupt of corruptions) {
    const changed = clone(archive)
    corrupt(changed)
    const content = JSON.stringify(checksum(changed))
    await writeFile(f.service.file, content)
    const restarted = f.make({ seedFactory: () => { throw new Error('damaged life must never be replaced') } })
    await assert.rejects(restarted.get(), e => e.code === 'LIFE_ARCHIVE_INVALID')
    assert.equal(await readFile(f.service.file, 'utf8'), content)
  }
})
