import test from 'node:test'
import assert from 'node:assert/strict'
import { applyLifeEvent, createLife } from '../bundle/shared/life-core.js'
import {
  BODY_PARAMETER_LIMITS, BODY_TOPOLOGY, createBodyFromLife, createBodyCandidate,
  commitBodyCandidate, validateBodyState, synchronizeBodyLifeRevision, getBodyTransition,
} from '../bundle/shared/body-core.js'

const NOW = Date.UTC(2026, 10, 23, 8)
const clone = value => JSON.parse(JSON.stringify(value))
const born = (seed = 'body-specimen') => createLife({ seed, now: NOW })
const proposal = (body, overrides = {}) => ({
  id: `growth:${body.bodyRevision + 1}`, at: NOW + (body.bodyRevision + 1) * 1000,
  baseLifeRevision: body.lifeRevision, baseBodyRevision: body.bodyRevision,
  parameters: { tailLength: body.parameters.tailLength + 0.025, legLength: body.parameters.legLength + 0.01 },
  source: { kind: 'model', provider: 'test-provider', model: 'test-motion-body-model', modelVersion: 'fixture-1', requestId: `request:${body.bodyRevision + 1}` },
  reason: 'A recorded candidate used to test atomic growth; not a shipped AI model.', evidenceEventIds: [], ...overrides,
})
const grow = (body, overrides = {}, options = {}) => commitBodyCandidate(body, createBodyCandidate(body, proposal(body, overrides)), options)
const code = value => err => err.code === value

test('legacy migration preserves identity and observed variation without claiming AI', () => {
  const life = born(), initial = clone(life), body = createBodyFromLife(life)
  assert.deepEqual(life, initial)
  assert.equal(body.lifeId, life.id)
  assert.equal(body.seed, life.seed)
  assert.equal(body.createdAt, life.createdAt)
  assert.equal(body.topology, BODY_TOPOLOGY)
  assert.equal(body.provenance.kind, 'legacy-migration')
  assert.deepEqual(body, createBodyFromLife(clone(life)))
  assert.notDeepEqual(body.identity, createBodyFromLife(born('another-life')).identity)
  const heard = applyLifeEvent(life, {
    id: 'music:1', type: 'listening', at: NOW + 30000, sessionId: 'session:1',
    track: { id: 'aabbccddeeff0011', title: 'Real source' }, listenedMs: 30000,
    featureSource: 'audio', features: { energy: 1, brightness: 1, rhythm: 1, texture: 1 },
  })
  const migratedLater = createBodyFromLife(heard)
  assert.deepEqual(migratedLater.identity, body.identity)
  assert.notDeepEqual(migratedLater.parameters, body.parameters)
  assert.equal(migratedLater.lifeRevision, 1)
})

test('all anatomical consumers share the same four planted contacts after growth', () => {
  const body = createBodyFromLife(born()), next = grow(body)
  const beforeJoints = new Map(body.descriptor.skeleton.joints.map(j => [j.id, j]))
  const afterJoints = new Map(next.descriptor.skeleton.joints.map(j => [j.id, j]))
  assert.equal(next.descriptor.skeleton.joints.length, 25)
  assert.equal(next.descriptor.contacts.length, 4)
  assert.deepEqual(next.descriptor.motionContract.jointOrder, body.descriptor.motionContract.jointOrder)
  assert.equal(next.descriptor.motionContract.pose, 'local-rest-relative-quaternion-xyzw')
  for (const contact of next.descriptor.contacts) {
    const ankle = afterJoints.get(contact.joint)
    assert.ok(Math.abs(ankle.restWorld[1] + contact.local[1]) < 0.000003)
    assert.equal(contact.restWorld[1], 0)
    assert.ok(next.descriptor.colliders.some(c => c.id === contact.id && c.joint === contact.joint))
    assert.ok(next.descriptor.hitRegions.some(c => c.id === contact.id && c.joint === contact.joint))
  }
  assert.ok(afterJoints.get('root').restWorld[1] > beforeJoints.get('root').restWorld[1])
  assert.ok(afterJoints.get('tail.5').restWorld[0] < beforeJoints.get('tail.5').restWorld[0])
  // The tail root includes its spine parent's offset and must remain inside
  // the torso, otherwise even valid skinning leaves a visible detached seam.
  for (const current of [body, next]) {
    const root = current.descriptor.skeleton.joints.find(joint => joint.id === 'tail.0')
    const torso = current.descriptor.colliders.find(collider => collider.id === 'torso')
    const torsoCenter = current.descriptor.skeleton.joints.find(joint => joint.id === torso.joint).restWorld
    const ellipsoidDistance = root.restWorld.reduce((sum, value, axis) => sum + ((value - torsoCenter[axis]) / torso.radii[axis]) ** 2, 0)
    assert.ok(ellipsoidDistance < 1, 'tail root must overlap the torso surface')
  }
  assert.ok(next.descriptor.bounds.min[0] < body.descriptor.bounds.min[0])
  assert.deepEqual(next.identity, body.identity)
  const transition = getBodyTransition(body, next)
  assert.equal(transition.rootHeightDelta, 0.01)
  assert.ok(transition.preserve.includes('world-contact-targets'))
  assert.deepEqual(transition.contactIds, body.descriptor.motionContract.contactOrder)
})

test('ordinary life events invalidate pending growth but do not silently grow the body', () => {
  const life = born(), body = createBodyFromLife(life)
  const candidate = createBodyCandidate(body, proposal(body))
  const updatedLife = applyLifeEvent(life, { id: 'touch:1', type: 'interaction', action: 'touch', at: NOW + 1000 })
  const synced = synchronizeBodyLifeRevision(body, updatedLife)
  assert.equal(synced.lifeRevision, 1)
  assert.equal(synced.bodyRevision, 0)
  assert.deepEqual(synced.parameters, body.parameters)
  assert.equal(synced.descriptor, body.descriptor)
  assert.equal(synced.contentId, body.contentId)
  assert.throws(() => commitBodyCandidate(synced, candidate), code('STALE_BODY_GROWTH'))
  assert.throws(() => commitBodyCandidate(body, candidate, { lifeRevision: 1 }), code('STALE_BODY_GROWTH'))
  assert.throws(() => synchronizeBodyLifeRevision(synced, life), code('STALE_BODY_GROWTH'))
})

test('accepted growth is atomic, immutable, idempotent and restorable without re-inference', () => {
  const life = born(), body = createBodyFromLife(life), before = clone(body)
  const candidate = createBodyCandidate(body, proposal(body)), candidateBefore = clone(candidate)
  const next = commitBodyCandidate(body, candidate, { life })
  assert.deepEqual(body, before)
  assert.deepEqual(candidate, candidateBefore)
  assert.equal(next.bodyRevision, 1)
  assert.equal(next.contentId, candidate.contentId)
  assert.equal(next.descriptor.contentId, candidate.contentId)
  assert.equal(next.descriptor.bodyRevision, next.bodyRevision)
  assert.deepEqual(next.lastGrowth, candidate)
  assert.deepEqual(next.provenance, candidate.source)
  assert.equal(next.previousBody.contentId, body.contentId)
  assert.equal(next.previousBody.previousBody, undefined)
  assert.equal(commitBodyCandidate(next, candidate), next)
  assert.throws(() => commitBodyCandidate(next, { ...candidate, reason: 'changed retry' }), code('BODY_PROPOSAL_CONFLICT'))
  const restored = clone(next)
  assert.equal(validateBodyState(restored, life), restored)
  const third = grow(restored)
  assert.equal(third.previousBody.bodyRevision, 1)
  assert.equal(third.previousBody.previousBody, undefined)
  assert.equal(validateBodyState(clone(third), life).bodyRevision, 2)
})

test('model provenance and evidence are retained and must identify real accepted events', () => {
  const initial = born()
  const life = applyLifeEvent(initial, { id: 'memory:1', type: 'memory', title: 'A selected memory', at: NOW + 100 })
  const body = createBodyFromLife(life)
  const candidate = createBodyCandidate(body, proposal(body, { evidenceEventIds: ['memory:1'] }))
  const next = commitBodyCandidate(body, candidate, { life })
  assert.deepEqual(next.lastGrowth.evidenceEventIds, ['memory:1'])
  const bad = createBodyCandidate(body, proposal(body, { evidenceEventIds: ['missing:1'] }))
  assert.throws(() => commitBodyCandidate(body, bad, { life }), code('INVALID_GROWTH_EVIDENCE'))
  assert.throws(() => createBodyCandidate(body, proposal(body, { source: { kind: 'ai' } })), code('INVALID_GROWTH_SOURCE'))
  assert.throws(() => createBodyCandidate(body, proposal(body, { source: { kind: 'model', provider: 'test', model: 'model' } })))
  assert.throws(() => createBodyCandidate(body, proposal(body, { evidenceEventIds: ['memory:1', 'memory:1'] })), code('INVALID_GROWTH_EVIDENCE'))
})

test('unsupported topology, large jumps, invalid parameters and identity changes are rejected', () => {
  const body = createBodyFromLife(born())
  const invalid = [
    [{ topology: 'dijiang-six-leg/1' }, 'UNSUPPORTED_BODY_TOPOLOGY'],
    [{ species: 'nine-tail-fox' }, 'UNSUPPORTED_BODY_TOPOLOGY'],
    [{ lifeId: 'another-life' }, 'BODY_IDENTITY_MISMATCH'],
    [{ identity: { ...body.identity, palette: (body.identity.palette + 1) % 4 } }, 'BODY_IDENTITY_MISMATCH'],
    [{ parameters: { tailCount: 9 } }, 'UNSUPPORTED_BODY_PARAMETER'],
    [{ parameters: { legLength: NaN } }, 'BODY_OUT_OF_RANGE'],
    [{ parameters: { bodyWidth: Infinity } }, 'BODY_OUT_OF_RANGE'],
    [{ parameters: { tailLength: 10 } }, 'BODY_OUT_OF_RANGE'],
    [{ parameters: { legLength: body.parameters.legLength + BODY_PARAMETER_LIMITS.legLength.maxDelta + 0.01 } }, 'BODY_GROWTH_TOO_LARGE'],
    [{ parameters: { ...body.parameters } }, 'BODY_NO_CHANGE'],
  ]
  for (const [overrides, expected] of invalid) assert.throws(() => createBodyCandidate(body, proposal(body, overrides)), code(expected))
})

test('persisted partial upgrades and candidate tampering cannot activate a mismatched body', () => {
  const life = born(), body = createBodyFromLife(life), next = grow(body)
  for (const corrupt of [
    b => { b.descriptor.skeleton.joints[0].rest[1] += 0.01 },
    b => { b.descriptor.colliders[0].radii[0] += 0.01 },
    b => { b.parameters.tailLength += 0.01 },
    b => { b.identity.eyeSpacing += 0.01 },
    b => { b.contentId = 'not-the-current-body' },
    b => { b.previousBody.descriptor.contacts[0].restWorld[1] = 1 },
    b => { b.lastGrowth.source.model = 'a-different-model' },
  ]) {
    const changed = clone(next)
    corrupt(changed)
    assert.throws(() => validateBodyState(changed, life))
  }
  const candidate = createBodyCandidate(body, proposal(body))
  candidate.parameters.tailLength += 0.005
  assert.throws(() => commitBodyCandidate(body, candidate), code('BODY_DESCRIPTOR_MISMATCH'))
  assert.equal(body.bodyRevision, 0)
  assert.equal(validateBodyState(body, life), body)
})

test('body identity and life revision remain strict through JSON restoration', () => {
  const life = born(), body = clone(createBodyFromLife(life))
  assert.throws(() => validateBodyState(body, born('another-life')), code('BODY_IDENTITY_MISMATCH'))
  const later = applyLifeEvent(life, { id: 'touch:1', type: 'interaction', action: 'touch', at: NOW + 1000 })
  assert.throws(() => validateBodyState(body, later), code('BODY_LIFE_REVISION_MISMATCH'))
  assert.equal(validateBodyState(synchronizeBodyLifeRevision(body, later), later).lifeRevision, 1)
  assert.throws(() => getBodyTransition(body, createBodyFromLife(born('another-life'))), code('UNSUPPORTED_BODY_TOPOLOGY'))
})
