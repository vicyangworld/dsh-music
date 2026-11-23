import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createLife } from '../bundle/shared/life-core.js'
import { createBodyFromLife } from '../bundle/shared/body-core.js'
import { MOTION_PROTOCOL, validateMotionRequest, validateMotionSequence, validateMotionStatus } from '../bundle/shared/motion-core.js'
import { createMotionService, normalizeMotionEndpoint, registerMotionRoutes } from '../bundle/host/motion.js'
import { createMotionProvider } from '../src/client/echo/motion-provider.js'

// Deliberately synthetic protocol fixtures. These are not weights, training
// examples, or evidence that a learned model has been integrated.
const MODEL = { kind: 'learned', id: 'protocol-test-fixture', version: '1', weightsSha256: 'a'.repeat(64) }
const clone = value => structuredClone(value)
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
function fixture(seed = 'motion-contract-test') {
  const body = createBodyFromLife(createLife({ seed, now: 12345 }))
  const input = {
    protocol: MOTION_PROTOCOL, requestId: 'request-1', body,
    state: { time: 12, root: [...body.descriptor.skeleton.joints[0].rest], rotations: Object.fromEntries(body.descriptor.skeleton.joints.map(j => [j.id, [0, 0, 0, 1]])), contacts: body.descriptor.contacts.map(c => c.id) },
    goal: { target: [0.7, 0.5, 0.1], attention: 0.8, energy: 0.4 },
    music: { energy: 0.4, brightness: 0.5, rhythm: 0.3, texture: 0.5 }, style: { reserve: 0.5 },
  }
  const sequence = request => ({
    protocol: MOTION_PROTOCOL, requestId: request.requestId, lifeId: request.body.lifeId,
    bodyRevision: request.body.bodyRevision, topology: request.body.topology, model: clone(MODEL),
    frames: [0, 0.05, 0.1].map(time => ({ ...clone(request.state), time, rotations: { ...clone(request.state.rotations), head: [0, Math.sin(time / 2), 0, Math.cos(time / 2)] } })),
  })
  const status = { protocol: MOTION_PROTOCOL, status: 'ready', model: MODEL, supportedTopologies: [body.topology], capabilities: ['body-conditioned', 'pose-conditioned', 'goal-conditioned', 'continuous-motion'] }
  return { body, input, sequence, status }
}

test('motion contract carries every current joint, contact and body condition; normal life events do not invalidate it', () => {
  const f = fixture()
  const input = validateMotionRequest(f.input)
  assert.equal(input.body.descriptor.skeleton.joints.length, 25)
  assert.deepEqual(input.body.parameters, f.body.parameters)
  assert.equal(validateMotionSequence(f.sequence(input), input, { currentBody: { ...f.body, lifeRevision: 10 }, expectedModel: MODEL }).frames.length, 3)
  input.body.parameters.tailLength = 1.5
  assert.notEqual(f.body.parameters.tailLength, 1.5)
})

test('model status requires actual capability declarations and checkpoint provenance', () => {
  const f = fixture()
  assert.equal(validateMotionStatus(f.status).available, true)
  assert.equal(validateMotionStatus({ protocol: MOTION_PROTOCOL, status: 'loading' }).available, false)
  for (const bad of [
    { ...f.status, model: { ...MODEL, kind: 'procedural' } },
    { ...f.status, model: { ...MODEL, weightsSha256: '' } },
    { ...f.status, capabilities: ['clip-selection'] },
  ]) assert.throws(() => validateMotionStatus(bad))
})

test('motion contract rejects clips, malformed poses, unbounded conditions and unknown contacts', () => {
  const f = fixture()
  const mutations = [
    r => { r.clipId = 'happy-03' },
    r => { r.state.root[0] = NaN },
    r => { r.state.rotations.head = [0, 0, 0, 0] },
    r => { delete r.state.rotations.head },
    r => { r.state.contacts.push('unknown-foot') },
    r => { r.goal.energy = Infinity },
    r => { r.music.energy = '0.5' },
    r => { r.body.descriptor.skeleton.joints[2].parent = 'missing' },
  ]
  for (const mutate of mutations) { const input = clone(f.input); mutate(input); assert.throws(() => validateMotionRequest(input)) }
})

test('generated trajectories reject stale identity, model changes, discontinuities and joint violations', () => {
  const f = fixture(), request = validateMotionRequest(f.input)
  const mutations = [
    r => { r.clip = 'jump' },
    r => { r.lifeId = 'some-other-life' },
    r => { r.bodyRevision++ },
    r => { r.requestId = 'older-request' },
    r => { r.frames[0].root[0] += 0.1 },
    r => { r.frames[1].time = 0 },
    r => { r.frames[2].root[0] += 2 },
    r => { r.frames[2].rotations.head = [0, Math.sin(0.8 / 2), 0, Math.cos(0.8 / 2)] },
    r => { r.model.weightsSha256 = 'b'.repeat(64) },
  ]
  for (const mutate of mutations) { const result = f.sequence(request); mutate(result); assert.throws(() => validateMotionSequence(result, request, { expectedModel: MODEL })) }
  assert.throws(() => validateMotionSequence(f.sequence(request), request, { currentBody: { ...f.body, bodyRevision: 1 } }), e => e.code === 'MOTION_BODY_STALE')
  assert.throws(() => validateMotionSequence(f.sequence(request), request, { currentBody: { ...f.body, contentId: 'changed' } }), e => e.code === 'MOTION_BODY_STALE')
})

test('endpoint configuration is opt-in, loopback only, and cannot specify credentials or paths', async () => {
  assert.equal(normalizeMotionEndpoint(''), null)
  assert.equal(normalizeMotionEndpoint('http://127.0.0.1:8765'), 'http://127.0.0.1:8765')
  assert.equal(normalizeMotionEndpoint('http://[::1]:8765'), 'http://[::1]:8765')
  for (const endpoint of ['https://example.com:8765', 'http://localhost:8765', 'http://127.0.0.1', 'http://127.0.0.1:8765/path', 'http://127.0.0.1:8765?redirect=remote', 'http://user:pass@127.0.0.1:8765']) assert.throws(() => normalizeMotionEndpoint(endpoint))
  let calls = 0
  const service = createMotionService({ endpoint: '', fetcher: () => { calls++; throw new Error('must not fetch') } })
  assert.equal((await service.status()).available, false)
  await assert.rejects(service.generate(fixture().input), e => e.code === 'MOTION_MODEL_UNAVAILABLE')
  assert.equal(calls, 0)
  service.dispose()
})

test('host substitutes its authoritative body, then rejects a response made obsolete during generation', async () => {
  const f = fixture()
  let current = f.body, growDuringGeneration = false, observed
  const service = createMotionService({ endpoint: 'http://127.0.0.1:8765', life: { get: async () => ({ body: current }) }, fetcher: async (url, options) => {
    assert.equal(options.redirect, 'error')
    if (url.endsWith('/status')) return response(f.status)
    observed = JSON.parse(options.body)
    if (growDuringGeneration) current = { ...current, bodyRevision: current.bodyRevision + 1 }
    return response(f.sequence(observed))
  } })
  const forged = clone(f.input)
  forged.body.parameters.tailLength = 9
  await service.generate(forged)
  assert.deepEqual(observed.body.parameters, f.body.parameters)
  growDuringGeneration = true
  await assert.rejects(service.generate(f.input), e => e.code === 'MOTION_BODY_STALE')
  service.dispose()
})

test('host rejects a changed checkpoint and caps streamed result size', async () => {
  const f = fixture()
  for (const mode of ['checkpoint', 'size']) {
    const service = createMotionService({ endpoint: 'http://127.0.0.1:8765', life: { get: async () => ({ body: f.body }) }, fetcher: async url => {
      if (url.endsWith('/status')) return response(f.status)
      if (mode === 'size') return new Response(' '.repeat(2 * 1024 * 1024 + 1))
      const result = f.sequence(f.input); result.model.weightsSha256 = 'c'.repeat(64)
      return response(result)
    } })
    await assert.rejects(service.generate(f.input), e => e.code === (mode === 'size' ? 'MOTION_TOO_LARGE' : 'MOTION_MODEL_CHANGED'))
    service.dispose()
  }
})

test('shared client defaults to unavailable and single-view cancellation leaves the provider available', async () => {
  const f = fixture()
  let calls = 0, hold = false, started
  const provider = createMotionProvider({ getCurrentBody: () => f.body, fetcher: async (url, options) => {
    calls++
    if (!url.endsWith('/generate')) return response(f.status)
    if (hold) return new Promise((resolve, reject) => {
      started?.()
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
    return response(f.sequence(JSON.parse(options.body)))
  } })
  await assert.rejects(provider.generate(f.input), e => e.code === 'MOTION_MODEL_UNAVAILABLE')
  assert.equal(calls, 0)
  await provider.refreshStatus()
  assert.equal(provider.getSnapshot().available, true)
  hold = true
  const controller = new AbortController()
  const isStarted = new Promise(resolve => { started = resolve })
  const pending = provider.generate(f.input, { signal: controller.signal })
  await isStarted
  await assert.rejects(provider.generate(f.input), e => e.code === 'MOTION_BUSY')
  controller.abort()
  await assert.rejects(pending, e => e.code === 'MOTION_ABORTED')
  assert.equal(provider.getSnapshot().available, true)
  hold = false
  assert.equal((await provider.generate(f.input)).frames.length, 3)
  provider.dispose()
  assert.equal(provider.getSnapshot().available, false)
})

test('client rejects body changes during inference, without disabling a healthy model', async () => {
  const f = fixture()
  let current = f.body
  const provider = createMotionProvider({ getCurrentBody: () => current, fetcher: async (url, options) => {
    if (!url.endsWith('/generate')) return response(f.status)
    current = { ...current, bodyRevision: 1 }
    return response(f.sequence(JSON.parse(options.body)))
  } })
  await provider.refreshStatus()
  await assert.rejects(provider.generate(f.input), e => e.code === 'MOTION_BODY_STALE')
  assert.equal(provider.getSnapshot().available, true)
  provider.dispose()
})

test('host routes expose honest unavailable status and enforce HTTP request boundaries', async t => {
  const routes = new Map()
  const dispose = registerMotionRoutes({ register(def) { routes.set(def.path, def.handler); return () => routes.delete(def.path) } }, { endpoint: '' })
  const server = createServer((req, res) => routes.get(req.url)?.(req, res) || (!routes.has(req.url) && res.end('not found')))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { for (const fn of dispose) fn(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}/dsh-music/api/life/motion`
  assert.equal((await (await fetch(base)).json()).available, false)
  assert.equal((await fetch(base, { method: 'POST' })).status, 405)
  assert.equal((await fetch(`${base}/generate`, { method: 'POST', body: '{}' })).status, 415)
  assert.equal((await fetch(`${base}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' })).status, 400)
  assert.equal((await fetch(`${base}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture().input) })).status, 503)
  assert.equal((await fetch(`${base}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ large: 'x'.repeat(256 * 1024) }) })).status, 413)
})
