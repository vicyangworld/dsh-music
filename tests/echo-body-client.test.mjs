import test from 'node:test'
import assert from 'node:assert/strict'
import { createLifeClient } from '../src/client/echo/service.js'
import { createLife, applyLifeEvent, getMorphology } from '../bundle/shared/life-core.js'
import { createBodyFromLife, createBodyCandidate, commitBodyCandidate } from '../bundle/shared/body-core.js'

const clone = value => JSON.parse(JSON.stringify(value))
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => clone(data) })
const nextTurn = () => new Promise(resolve => setImmediate(resolve))
function data() {
  let life = createLife({ seed: 'body-client', now: 1000 })
  for (let i = 0; i < 10; i++) life = applyLifeEvent(life, {
    id: 'audio-' + i, type: 'listening', at: 1000 + i, sessionId: 'one',
    track: { id: '0123456789abcdef', title: 'Track' }, listenedMs: 30000, featureSource: 'audio',
    features: { energy: 0.5, brightness: 0.5, rhythm: 0.5, texture: 0.5 },
  })
  const body = createBodyFromLife(life)
  const proposal = createBodyCandidate(body, {
    id: 'model-one', at: 2000, baseLifeRevision: body.lifeRevision, baseBodyRevision: 0,
    parameters: { tailLength: body.parameters.tailLength + 0.02 },
    source: { kind: 'model', provider: 'test', model: 'test', requestId: 'one' },
    reason: '一次小幅成长', evidenceEventIds: ['audio-1'],
  })
  const grown = commitBodyCandidate(body, proposal, { life })
  return { life, body, grown, snapshot: current => ({ life, body: current, morphology: getMorphology(life), development: { eligible: current.bodyRevision === 0, observedAudioMs: 300000, minimumAudioMs: 300000 } }) }
}
function client(t, fetcher, motionProvider) {
  const service = createLifeClient({
    fetcher, storage: { getItem: () => null, setItem() {} }, eventTarget: new EventTarget(),
    motionProvider: motionProvider || { async refreshStatus() { return { available: false, retryable: false } }, dispose() {} },
  })
  t.after(() => service.dispose())
  return service
}

test('a body growth response cannot be rolled back by a delayed GET with the same event count', async t => {
  const f = data()
  let getCount = 0, modelAvailable = false, releaseOld
  const old = new Promise(resolve => { releaseOld = resolve })
  const service = client(t, async (url, options = {}) => {
    if (url.endsWith('/development')) {
      if (options.method === 'POST') return response(f.snapshot(f.grown))
      return response({ available: modelAvailable, nextAttemptAt: 0 })
    }
    getCount++
    if (getCount === 2) await old
    return response(f.snapshot(f.body))
  })
  await service.load()
  await nextTurn()
  const delayed = service.load()
  modelAvailable = true
  await service.refreshDevelopment()
  await nextTurn()
  assert.equal(service.source.getSnapshot().body.bodyRevision, 1)
  releaseOld()
  await delayed
  assert.equal(service.source.getSnapshot().body.bodyRevision, 1)
  assert.equal(service.source.getSnapshot().life.processedEventIds.length, 10)
})

test('after accepting a v2 body, an incomplete response preserves it and reports the mismatch', async t => {
  const f = data()
  let complete = true
  const service = client(t, async url => {
    if (url.endsWith('/development')) return response({ available: false })
    const snapshot = f.snapshot(f.body)
    if (!complete) delete snapshot.body
    return response(snapshot)
  })
  await service.load()
  complete = false
  await assert.rejects(service.load(), e => e.code === 'LIFE_RESPONSE_INVALID')
  assert.deepEqual(service.source.getSnapshot().body, f.body)
})

test('a transient capability failure can recover through retry without recreating the life client', async t => {
  const f = data()
  let failed = true, probes = 0
  const service = client(t, async url => {
    if (url.endsWith('/development')) {
      probes++
      if (failed) throw new TypeError('temporary network failure')
      return response({ available: false, reason: 'growth-model-not-configured' })
    }
    return response(f.snapshot(f.body))
  })
  await service.load()
  await nextTurn()
  failed = false
  await service.retry()
  await nextTurn()
  assert.ok(probes >= 2)
  assert.equal(service.source.getSnapshot().growthModel.reason, 'growth-model-not-configured')
})

test('view motion memory uses independent copies and never leaks into another body revision', async t => {
  const f = data()
  const service = client(t, async url => url.endsWith('/development') ? response({ available: false }) : response(f.snapshot(f.body)))
  await service.load()
  const pose = { lifeId: f.body.lifeId, topology: f.body.topology, bodyRevision: 0, root: [0, 1, 0] }
  service.motionMemory.write(pose)
  pose.root[0] = 9
  const restored = service.motionMemory.read(f.body)
  assert.deepEqual(restored.root, [0, 1, 0])
  restored.root[0] = 7
  assert.equal(service.motionMemory.read(f.body).root[0], 0)
  assert.equal(service.motionMemory.read(f.grown), null)
})
