import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createLife, applyLifeEvent, getMorphology, replayLife, validateLife,
  validateLifeEvent, ValidationError, LIFE_LIMITS,
} from '../bundle/shared/life-core.js'

const NOW = Date.UTC(2026, 10, 21, 8)
const AUDIO = { energy: 0.9, brightness: 0.8, rhythm: 0.95, texture: 0.75 }
const QUIET = { energy: 0.12, brightness: 0.18, rhythm: 0.1, texture: 0.2 }
const born = (seed = 'one-unique-life') => createLife({ seed, now: NOW })
const listen = (index, features = AUDIO, overrides = {}) => ({
  id: `listen:${index}`, type: 'listening', at: NOW + (index + 1) * 30000,
  sessionId: 'track-session:1', track: { id: 'aabbccddeeff0011', title: 'Test recording', artist: 'Local artist' },
  listenedMs: 30000, featureSource: 'audio', features, ...overrides,
})
const sequence = (features, count = 120, offset = 0) => Array.from({ length: count }, (_, i) => listen(i + offset, features))
const event = (type, fields = {}, n = 1) => ({ id: `${type}:${n}`, type, at: NOW + n * 1000, ...fields })
const bodyKeys = ['elongation', 'spread', 'curvature', 'folds', 'texture', 'warmth', 'buoyancy']

test('same seed and different observed music change structural dimensions, not only colour', () => {
  const a = replayLife(born(), sequence(AUDIO))
  const b = replayLife(born(), sequence(QUIET))
  const ma = getMorphology(a), mb = getMorphology(b)
  assert.equal(ma.structure, mb.structure)
  assert.ok(Math.abs(ma.elongation - mb.elongation) > 0.12)
  assert.ok(Math.abs(ma.spread - mb.spread) > 0.12)
  assert.ok(Math.abs(ma.folds - mb.folds) > 0.12)
  assert.notDeepEqual(ma, mb)
})

test('different seeds sharing the same playlist retain different bodies and signatures', () => {
  const a = replayLife(born('listener-a'), sequence(AUDIO))
  const b = replayLife(born('listener-b'), sequence(AUDIO))
  assert.notEqual(a.id, b.id)
  assert.notDeepEqual(getMorphology(a), getMorphology(b))
  assert.notEqual(getMorphology(a).phase, getMorphology(b).phase)
  const structures = new Set(Array.from({ length: 30 }, (_, i) => born(`person:${i}`).genome.structure))
  assert.equal(structures.size, 3)
})

test('known FNV prefix-collision seeds do not collapse into the same whole body', () => {
  // These real, distinct seeds collide before suffixes in the old FNV scheme.
  // Appending any field label to that shared state made every trait identical.
  const legacyPrefix = seed => {
    let value = 2166136261
    for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619) >>> 0
    return value
  }
  assert.equal(legacyPrefix('costarring'), 1582148253)
  assert.equal(legacyPrefix('liquid'), 1582148253)
  const a = born('costarring'), b = born('liquid')
  assert.notEqual(a.id, b.id)
  assert.notDeepEqual(a.genome.base, b.genome.base)
  assert.notDeepEqual(a.genome.response, b.genome.response)
  const ma = getMorphology(a), mb = getMorphology(b)
  assert.ok(['elongation', 'spread', 'curvature', 'folds'].filter(key => ma[key] !== mb[key]).length >= 2)
  assert.notDeepEqual(getMorphology(replayLife(a, sequence(AUDIO, 20))), getMorphology(replayLife(b, sequence(AUDIO, 20))))
})

test('replay, JSON restoration and retries preserve exact appearance and counters', () => {
  const initial = born()
  const events = [...sequence(AUDIO, 15), event('greeting', { pattern: [250, 480, 250] }, 900), event('memory', { title: 'First shared song', note: 'A real user-selected moment' }, 901)]
  const direct = events.reduce(applyLifeEvent, initial)
  const replay = replayLife(initial, events)
  assert.deepEqual(direct, replay)
  const restored = JSON.parse(JSON.stringify(direct))
  assert.equal(validateLife(restored), restored)
  assert.deepEqual(getMorphology(restored), getMorphology(direct))
  for (const e of events) assert.equal(applyLifeEvent(restored, e), restored)
  assert.equal(restored.stats.listenedMs, 450000)
  assert.equal(restored.stats.listeningSessions, 1)
  assert.equal(restored.memories.length, 1)
  assert.equal(getMorphology(restored).marks[0].id, events.at(-1).id)
})

test('events are immutable, normalize safe text and never mutate caller-owned data', () => {
  const initial = born()
  const before = JSON.stringify(initial)
  const input = event('greeting', { pattern: [250.2, 480.7] })
  Object.freeze(input.pattern)
  Object.freeze(input)
  const result = applyLifeEvent(initial, input)
  assert.equal(JSON.stringify(initial), before)
  assert.deepEqual(result.greeting.pattern, [250, 481])
  assert.equal(initial.greeting, null)
  const named = applyLifeEvent(result, event('rename', { name: '  小砾  ' }, 2))
  assert.equal(named.name, '小砾')
  assert.equal(result.name, '音灵')
})

test('sharing and missing audio features never invent observed music or body growth', () => {
  const initial = born()
  const share = applyLifeEvent(initial, event('share', { title: 'A song title', artist: 'Someone' }))
  assert.equal(share.stats.sharedSongs, 1)
  assert.equal(share.stats.listenedMs, 0)
  assert.deepEqual(getMorphology(share), getMorphology(initial))
  const noFeatures = sequence(AUDIO, 30).map(({ features, ...e }) => ({ ...e, featureSource: 'none' }))
  const played = replayLife(share, noFeatures)
  assert.equal(played.stats.listenedMs, 900000)
  assert.equal(played.growth.audioMs, 0)
  assert.deepEqual(getMorphology(played), getMorphology(initial))
  assert.throws(() => validateLifeEvent(listen(0, AUDIO, { featureSource: 'none' })), ValidationError)
})

test('passage of wall-clock time causes no decay, while chronological music order matters', () => {
  const untouched = born()
  assert.deepEqual(getMorphology(JSON.parse(JSON.stringify(untouched))), getMorphology(untouched))
  const a = replayLife(born(), [...sequence(AUDIO, 40), ...sequence(QUIET, 40, 40)])
  const b = replayLife(born(), [...sequence(QUIET, 40), ...sequence(AUDIO, 40, 40)])
  assert.equal(a.stats.listenedMs, b.stats.listenedMs)
  assert.notDeepEqual(getMorphology(a), getMorphology(b))
})

test('continuous same-feature listening is independent of heartbeat chunk size', () => {
  const small = replayLife(born(), sequence(AUDIO, 40))
  const large = replayLife(born(), sequence(AUDIO, 20).map((e) => ({ ...e, listenedMs: 60000 })))
  assert.deepEqual(getMorphology(small), getMorphology(large))
})

test('identity remains stable and all dimensions stay bounded under sustained extreme input', () => {
  const initial = born()
  const original = getMorphology(initial)
  const extreme = replayLife(initial, sequence({ energy: 1, brightness: 1, rhythm: 1, texture: 1 }, 500))
  const morphology = getMorphology(extreme)
  assert.equal(extreme.id, initial.id)
  assert.deepEqual(extreme.genome, initial.genome)
  assert.equal(morphology.structure, original.structure)
  assert.equal(morphology.phase, original.phase)
  assert.equal(morphology.accent, original.accent)
  for (const key of bodyKeys) {
    assert.ok(Number.isFinite(morphology[key]) && morphology[key] >= 0 && morphology[key] <= 1)
    assert.ok(Math.abs(morphology[key] - original[key]) <= 0.240001)
  }
})

test('birth and user-selected memories survive bounded checkpoint compaction', () => {
  let life = born()
  life = applyLifeEvent(life, event('memory', { title: 'An early important memory' }))
  for (let i = 0; i < 120; i++) life = applyLifeEvent(life, event('greeting', { pattern: [120, 300, 150] }, i + 2))
  assert.equal(life.timeline.length, LIFE_LIMITS.timeline)
  assert.equal(life.timeline[0].kind, 'birth')
  assert.ok(life.timeline.some((p) => p.kind === 'memory'))
  assert.equal(life.processedEventIds.length, 121)
  assert.ok(life.timelineOmitted > 0)
  assert.equal(applyLifeEvent(life, event('memory', { title: 'Changed retry' })), life)
  validateLife(life)
})

test('five-minute audio checkpoints avoid one evolution per heartbeat; greetings can be recognized', () => {
  let life = replayLife(born(), sequence(AUDIO, 9))
  assert.equal(life.timeline.length, 1)
  life = applyLifeEvent(life, listen(9))
  assert.equal(life.timeline.length, 2)
  life = applyLifeEvent(life, event('greeting', { pattern: [200, 400] }, 1000))
  life = applyLifeEvent(life, event('interaction', { action: 'greet' }, 1001))
  assert.equal(life.greeting.recognitions, 1)
  assert.equal(life.stats.interactions, 1)
})

test('invalid numbers, clocks, patterns, oversized strings and wrong source evidence are rejected', () => {
  const invalid = [
    listen(0, { ...AUDIO, energy: NaN }), listen(0, { ...AUDIO, rhythm: Infinity }),
    listen(0, { ...AUDIO, brightness: 1.1 }), listen(0, AUDIO, { listenedMs: -1 }),
    listen(0, AUDIO, { listenedMs: 60001 }), listen(0, AUDIO, { at: 'yesterday' }),
    listen(0, AUDIO, { at: MAX_DATE + 1 }), listen(0, AUDIO, { at: NOW - 1 }),
    event('greeting', { pattern: [200] }), event('greeting', { pattern: [20, 200] }),
    event('greeting', { pattern: [200, Infinity] }), event('rename', { name: 'x'.repeat(41) }),
    event('memory', { title: 'Fine', note: 'x'.repeat(1001) }),
    event('share', { title: '' }), event('interaction', { action: 'secret-upgrade' }),
    event('listening', { track: null }), event('unknown', {}),
  ]
  for (const e of invalid) assert.throws(() => applyLifeEvent(born(), e), ValidationError)
  assert.throws(() => createLife({ seed: '', now: NOW }), ValidationError)
  assert.throws(() => createLife({ seed: 'ok', now: Infinity }), ValidationError)
})

const MAX_DATE = 8640000000000000

test('persisted corruption is rejected, rather than silently generating a different life', () => {
  for (const corrupt of [
    (life) => { life.growth.traits.energy = NaN },
    (life) => { life.genome.base.spread = 0.1 },
    (life) => { life.id = 'some-other-life' },
    (life) => { life.rulesVersion = 'future-unknown-rules' },
    (life) => { life.processedEventIds = ['same', 'same'] },
    (life) => { life.timeline[0].morphology.seed = Infinity },
    (life) => { life.stats.listeningSessions = 4 },
  ]) {
    const life = born()
    corrupt(life)
    assert.throws(() => validateLife(life), ValidationError)
  }
})

test('bounded memory capacity fails without losing earlier memories or applying the rejected event', () => {
  let life = born()
  for (let i = 0; i < LIFE_LIMITS.memories; i++) life = applyLifeEvent(life, event('memory', { title: `Moment ${i}` }, i + 1))
  const saved = JSON.stringify(life)
  assert.throws(() => applyLifeEvent(life, event('memory', { title: 'Overflow' }, 999)), (err) => err.code === 'LIFE_MEMORY_LIMIT')
  assert.equal(JSON.stringify(life), saved)
  assert.equal(life.memories.length, LIFE_LIMITS.memories)
  assert.equal(getMorphology(life).marks.length, 8)
})

test('event capacity never expires idempotency and fails before applying a new event', () => {
  const life = born()
  life.processedEventIds = Array.from({ length: LIFE_LIMITS.events }, (_, i) => `already:${i}`)
  const input = event('interaction', { action: 'touch' })
  assert.throws(() => applyLifeEvent(life, input), (err) => err.code === 'LIFE_EVENT_LIMIT')
  assert.equal(life.stats.interactions, 0)
  assert.equal(applyLifeEvent(life, { ...input, id: 'already:0' }), life)
})

test('accumulation overflow cannot contaminate a previously loaded life', () => {
  const life = born()
  life.stats.listenedMs = Number.MAX_SAFE_INTEGER
  assert.throws(() => applyLifeEvent(life, listen(0)), ValidationError)
  assert.equal(life.stats.listenedMs, Number.MAX_SAFE_INTEGER)
})
