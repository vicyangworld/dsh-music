import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLifeService } from '../bundle/host/life.js'
import { createStorage } from '../bundle/host/storage.js'
import { createDevelopmentService, registerDevelopmentRoutes } from '../bundle/host/development.js'

async function setup(t, { trained = true, ready = true, respond, timeoutMs = 1000, finishReason = 'stop' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'echo-development-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let at = Date.UTC(2026, 10, 23)
  const lifeOptions = { storage: createStorage({ dataDir: directory }), library: { getRecord: () => ({ meta: { title: 'Private title', artist: 'Private artist' } }) }, now: () => at, seedFactory: () => 'growth-test-identity' }
  const life = createLifeService(lifeOptions)
  await life.get()
  if (ready) for (let i = 0; i < 10; i++) await life.append({
    id: 'listen-' + i, type: 'listening', at, sessionId: 'session',
    track: { id: '0123456789abcdef' }, listenedMs: 30000, featureSource: 'audio',
    features: { energy: 0.4, brightness: 0.6, rhythm: 0.3, texture: 0.5 },
  })
  const calls = []
  const llm = {
    listProviders: () => ['test-provider'],
    async *stream(request) {
      calls.push(request)
      const input = JSON.parse(request.messages[0].content[0].text)
      const output = respond ? await respond(input, request) : {
        parameters: { tailLength: input.parameters.tailLength + 0.02 },
        reason: '共同聆听后，尾部发生一次很小的变化。',
        evidenceEventIds: [input.observations[0].id],
      }
      yield { type: 'text-delta', text: typeof output === 'string' ? output : JSON.stringify(output) }
      yield { type: 'finish', reason: { kind: finishReason } }
    },
  }
  const development = createDevelopmentService({
    life, getLlm: () => trained ? llm : null,
    config: { lifeGrowthProvider: 'test-provider', lifeGrowthModel: 'test-growth-model' },
    now: () => at, timeoutMs,
  })
  t.after(() => development.dispose())
  const expected = async () => {
    const { body } = await life.get()
    return { baseLifeRevision: body.lifeRevision, baseBodyRevision: body.bodyRevision }
  }
  return { life, calls, development, expected, restart: () => createLifeService(lifeOptions), advance: () => { at += 60001 }, now: () => at }
}

test('missing growth model is explicitly unavailable and never changes the body', async t => {
  const f = await setup(t, { trained: false })
  const before = await readFile(f.life.file, 'utf8')
  assert.equal(f.development.status().available, false)
  assert.equal(f.development.status().motionModel, false)
  await assert.rejects(f.development.grow(await f.expected()), e => e.code === 'GROWTH_MODEL_UNAVAILABLE')
  assert.equal(await readFile(f.life.file, 'utf8'), before)
})

test('insufficient listening does not call a model or invent growth', async t => {
  const f = await setup(t, { ready: false })
  const result = await f.development.grow(await f.expected())
  assert.equal(result.developmentResult.status, 'waiting')
  assert.equal(result.body.bodyRevision, 0)
  assert.equal(f.calls.length, 0)
})

test('model result commits with provenance; restart restores result without rerunning AI', async t => {
  const f = await setup(t)
  const before = await f.life.get()
  const result = await f.development.grow(await f.expected())
  assert.equal(result.developmentResult.status, 'committed')
  assert.equal(result.body.bodyRevision, 1)
  assert.equal(result.body.parameters.tailLength, Math.round((before.body.parameters.tailLength + 0.02) * 1e6) / 1e6)
  assert.equal(result.body.provenance.kind, 'model')
  assert.equal(result.body.provenance.model, 'test-growth-model')
  const restored = await f.restart().get()
  assert.deepEqual(restored.body, result.body)
  assert.equal(f.calls.length, 1)
  const outgoing = JSON.stringify(f.calls[0])
  assert.ok(!outgoing.includes('Private title'))
  assert.ok(!outgoing.includes('Private artist'))
  assert.ok(!outgoing.includes('growth-test-identity'))
})

test('defer is retained as no growth, not replaced with a procedural proposal', async t => {
  const f = await setup(t, { respond: () => ({ defer: true }) })
  const before = await readFile(f.life.file, 'utf8')
  const result = await f.development.grow(await f.expected())
  assert.equal(result.developmentResult.status, 'deferred')
  assert.equal(await readFile(f.life.file, 'utf8'), before)
  assert.ok(f.development.status().nextAttemptAt > f.now())
})

test('invalid, invented-evidence and out-of-range model results do not commit', async t => {
  for (const respond of [
    () => 'not-json',
    input => ({ parameters: { tailLength: input.parameters.tailLength + 0.02 }, reason: '变化', evidenceEventIds: ['nonexistent-event'] }),
    input => ({ parameters: { tailLength: 99 }, reason: '变化', evidenceEventIds: [input.observations[0].id] }),
    input => ({ parameters: { wings: 4 }, reason: '变化', evidenceEventIds: [input.observations[0].id] }),
    input => ({ clip: 'happy_03', parameters: { tailLength: input.parameters.tailLength + 0.02 }, reason: '变化', evidenceEventIds: [input.observations[0].id] }),
  ]) {
    const f = await setup(t, { respond })
    const before = await readFile(f.life.file, 'utf8')
    await assert.rejects(f.development.grow(await f.expected()))
    assert.equal(await readFile(f.life.file, 'utf8'), before)
  }
})

test('new experiences while a model is generating reject its stale body proposal', async t => {
  let release, started
  const began = new Promise(resolve => { started = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  const f = await setup(t, { respond: async input => {
    started()
    await blocked
    return { parameters: { tailLength: input.parameters.tailLength + 0.02 }, reason: '变化', evidenceEventIds: [input.observations[0].id] }
  } })
  const request = f.development.grow(await f.expected())
  await began
  await f.life.append({ id: 'touch-during-generation', type: 'interaction', action: 'touch', at: f.now() })
  release()
  await assert.rejects(request, e => e.code === 'STALE_BODY_GROWTH')
  const state = await f.life.get()
  assert.equal(state.body.bodyRevision, 0)
  assert.ok(state.life.processedEventIds.includes('touch-during-generation'))
})

test('an unresponsive model times out without committing or poisoning later requests', async t => {
  const f = await setup(t, { timeoutMs: 20, respond: () => new Promise(() => {}) })
  const before = await readFile(f.life.file, 'utf8')
  await assert.rejects(f.development.grow(await f.expected()), e => e.code === 'GROWTH_MODEL_TIMEOUT')
  assert.equal(f.development.status().active, false)
  assert.equal(await readFile(f.life.file, 'utf8'), before)
})

test('disposal promptly settles a provider that ignores AbortSignal and never commits late output', async t => {
  let began, release
  const started = new Promise(resolve => { began = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  const f = await setup(t, { timeoutMs: 10000, respond: async input => {
    began()
    await blocked
    return { parameters: { tailLength: input.parameters.tailLength + 0.02 }, reason: '变化', evidenceEventIds: [input.observations[0].id] }
  } })
  const before = await readFile(f.life.file, 'utf8')
  const result = f.development.grow(await f.expected()).then(() => null, cause => cause)
  await started
  f.development.dispose()
  let timer
  const failure = await Promise.race([result, new Promise(resolve => { timer = setTimeout(() => resolve('still-pending'), 100) })])
  clearTimeout(timer)
  assert.equal(failure.code, 'GROWTH_MODEL_ABORTED')
  assert.equal(f.development.status().active, false)
  assert.equal(f.development.status().available, false)
  release()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(await readFile(f.life.file, 'utf8'), before)
})

test('disposal can also interrupt a pending growth-context read', async () => {
  const development = createDevelopmentService({
    life: { growthContext: () => new Promise(() => {}) },
    getLlm: () => ({ listProviders: () => ['provider'], stream() { throw new Error('must never reach model') } }),
    config: { lifeGrowthProvider: 'provider', lifeGrowthModel: 'model' },
  })
  const pending = development.grow({ baseLifeRevision: 0, baseBodyRevision: 0 })
  development.dispose()
  await assert.rejects(pending, e => e.code === 'GROWTH_MODEL_ABORTED')
})

test('late output after timeout cannot overwrite a successful later request', async t => {
  let release, invocations = 0
  const late = new Promise(resolve => { release = resolve })
  const f = await setup(t, { timeoutMs: 20, respond: async input => {
    if (++invocations === 1) await late
    return { parameters: { tailLength: input.parameters.tailLength + 0.02 }, reason: '变化', evidenceEventIds: [input.observations[0].id] }
  } })
  await assert.rejects(f.development.grow(await f.expected()), e => e.code === 'GROWTH_MODEL_TIMEOUT')
  f.advance()
  const committed = await f.development.grow(await f.expected())
  assert.equal(committed.body.bodyRevision, 1)
  release()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual((await f.life.get()).body, committed.body)
  assert.equal((await f.life.exportArchive()).bodyGrowth.length, 1)
  assert.equal(f.calls.length, 2)
})

test('concurrent and cooldown requests cannot start extra model generations', async t => {
  let began, release
  const started = new Promise(resolve => { began = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  const f = await setup(t, { respond: async () => { began(); await blocked; return { defer: true } } })
  const pending = f.development.grow(await f.expected())
  await started
  await assert.rejects(f.development.grow(await f.expected()), e => e.code === 'GROWTH_MODEL_BUSY')
  release()
  assert.equal((await pending).developmentResult.status, 'deferred')
  await assert.rejects(f.development.grow(await f.expected()), e => e.code === 'GROWTH_MODEL_COOLDOWN')
  assert.equal(f.calls.length, 1)
})

test('empty recent evidence does not spend a model call or fabricate an evidence ID', async t => {
  const f = await setup(t)
  for (let i = 0; i < 32; i++) await f.life.append({ id: `memory:${i}`, type: 'memory', at: f.now(), title: 'Private memory' })
  assert.equal((await f.life.get()).development.eligible, true)
  const result = await f.development.grow(await f.expected())
  assert.equal(result.developmentResult.status, 'waiting')
  assert.ok(result.developmentResult.nextAttemptAt > f.now())
  assert.equal(f.calls.length, 0)
  assert.equal(result.body.bodyRevision, 0)
})

test('the model payload whitelists observation fields even if the host adds private metadata', async t => {
  const f = await setup(t)
  const original = f.life.growthContext
  f.life.growthContext = async () => {
    const context = await original()
    return { ...context, evidence: context.evidence.map(event => ({ ...event, track: { title: 'PRIVATE-METADATA' }, file: '/private/library/path', note: 'PRIVATE-MEMORY' })) }
  }
  await f.development.grow(await f.expected())
  const request = JSON.stringify(f.calls[0])
  for (const text of ['PRIVATE-METADATA', '/private/library/path', 'PRIVATE-MEMORY', 'Private title', 'Private artist', 'growth-test-identity']) assert.ok(!request.includes(text))
})

test('oversized or unfinished streams fail before any body commit', async t => {
  for (const options of [{ respond: () => 'x'.repeat(6001) }, { finishReason: 'length' }]) {
    const f = await setup(t, options)
    const before = await readFile(f.life.file, 'utf8')
    await assert.rejects(f.development.grow(await f.expected()), e => e.code === 'GROWTH_MODEL_RESULT')
    assert.equal(await readFile(f.life.file, 'utf8'), before)
    assert.equal(f.development.status().active, false)
  }
})

test('cross-origin HTTP growth cannot invoke the model', async t => {
  const f = await setup(t)
  let handler
  const dispose = registerDevelopmentRoutes({ getOrigin: () => 'http://127.0.0.1:3456', register(route) { handler = route.handler; return () => {} } }, { development: f.development })
  t.after(dispose)
  const res = { headersSent: false, destroyed: false, writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } }
  await handler({ method: 'POST', headers: { origin: 'https://unrelated.example', 'sec-fetch-site': 'cross-site', host: '127.0.0.1:3456' }, socket: { remoteAddress: '127.0.0.1' } }, res)
  assert.equal(res.status, 403)
  assert.equal(f.calls.length, 0)
})

test('a valid same-origin HTTP request commits the requested current body version', async t => {
  const f = await setup(t)
  let handler
  const dispose = registerDevelopmentRoutes({ getOrigin: () => 'http://127.0.0.1:3456', register(route) { handler = route.handler; return () => {} } }, { development: f.development })
  t.after(dispose)
  const expected = await f.expected()
  const req = {
    method: 'POST', socket: { remoteAddress: '127.0.0.1' },
    headers: { origin: 'http://127.0.0.1:3456', host: '127.0.0.1:3456', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(expected)) },
  }
  const res = { headersSent: false, destroyed: false, writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } }
  await handler(req, res)
  assert.equal(res.status, 200)
  assert.equal(res.body.developmentResult.status, 'committed')
  assert.equal(res.body.body.bodyRevision, expected.baseBodyRevision + 1)
  assert.equal(f.calls.length, 1)
})
