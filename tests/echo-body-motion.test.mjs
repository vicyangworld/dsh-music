import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { createLife } from '../bundle/shared/life-core.js';
import { createBodyFromLife, deriveBodyDescriptor } from '../bundle/shared/body-core.js';
import { createBodyMotionState, stepBodyMotion, forwardBodyPose, retargetBodyMotionState, interpolateBodyDescriptor, captureBodyMotionState, restoreBodyMotionState, acceptMotionSequence, quaternionFromEuler, quaternionSlerp, sampleMotionSequence, reconcileBodyContacts } from '../src/client/echo/body-motion.js';
import { createBodyAnatomy, createBodyComponents } from '../src/client/echo/body-renderer.js';

const born = seed => createBodyFromLife(createLife({ seed: seed || 'motion-test', now: 1000 }));
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));
function grown(body, changes) {
  const next = { ...body, parameters: { ...body.parameters, ...changes }, bodyRevision: body.bodyRevision + 1 };
  next.descriptor = deriveBodyDescriptor(next); next.contentId = next.descriptor.contentId;
  return next;
}

test('continuous pointer changes keep planted feet and normalized joint poses', () => {
  for (const seed of ['small', 'medium', 'large']) {
    const body = born(seed), state = createBodyMotionState(body);
    for (let frame = 0; frame < 480; frame++) {
      stepBodyMotion(state, body, { pointer: [Math.sin(frame / 71), Math.cos(frame / 113)], active: true, touch: frame > 180 ? 1 : 0 }, 1 / 60);
      const world = forwardBodyPose(body.descriptor, state.root, state.rotations);
      for (const contact of body.descriptor.contacts) assert.ok(distance(world[contact.joint].position, state.footTargets[contact.id]) < 1e-4);
      for (const q of Object.values(state.rotations)) assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-6);
    }
    assert.equal(state.source, 'procedural');
  }
});

test('growth preserves live pose then adapts bone dimensions without moving planted feet', () => {
  const body = born(), state = createBodyMotionState(body);
  for (let i = 0; i < 120; i++) stepBodyMotion(state, body, { pointer: [0.4, -0.2] }, 1 / 60);
  const anchors = structuredClone(state.footTargets), oldPose = structuredClone(state.rotations), oldTime = state.time;
  const next = grown(body, { legLength: body.parameters.legLength + 0.035, tailLength: body.parameters.tailLength + 0.08 });
  retargetBodyMotionState(state, next);
  assert.deepEqual(state.rotations, oldPose); assert.equal(state.time, oldTime);
  for (let i = 1; i <= 120; i++) {
    const descriptor = interpolateBodyDescriptor(body.descriptor, next.descriptor, i / 120);
    stepBodyMotion(state, { ...next, descriptor }, { pointer: [0.4, -0.2] }, 1 / 60);
    const world = forwardBodyPose(descriptor, state.root, state.rotations);
    for (const contact of descriptor.contacts) assert.ok(distance(world[contact.joint].position, anchors[contact.id]) < 1e-4);
  }
  assert.deepEqual(state.footTargets, anchors);
  assert.equal(state.bodyRevision, next.bodyRevision);
  assert.ok(state.root[1] > body.descriptor.dimensions.rootHeight + 0.02);
});

test('view snapshots preserve posture independently and reject another life or body revision', () => {
  const body = born(), state = createBodyMotionState(body);
  for (let i = 0; i < 40; i++) stepBodyMotion(state, body, { pointer: [0.7, 0.2] }, 1 / 60);
  const saved = captureBodyMotionState(state), restored = restoreBodyMotionState(body, saved);
  assert.deepEqual(restored.rotations, state.rotations); assert.deepEqual(restored.root, state.root);
  restored.root[0] = 5; assert.notEqual(saved.root[0], 5); assert.notEqual(state.root[0], 5);
  const other = restoreBodyMotionState(born('different'), saved); assert.equal(other.time, 0);
  const invalid = structuredClone(saved); invalid.rotations.head = [NaN, 0, 0, 1];
  assert.equal(restoreBodyMotionState(body, invalid).time, 0);
});

test('learned sequence arrival blends from current pose and rejects obsolete bodies', () => {
  const body = born(), state = createBodyMotionState(body);
  stepBodyMotion(state, body, { pointer: [0.5, 0] }, 1 / 60);
  const before = structuredClone(state.rotations.head), rotations = structuredClone(state.rotations);
  rotations.head = quaternionFromEuler(0.05, -0.4, 0.1);
  const sequence = { lifeId: body.lifeId, bodyRevision: body.bodyRevision, topology: body.topology, model: { kind: 'learned', id: 'test-fixture' }, frames: [0, 0.6].map(time => ({ time, root: [...state.root], rotations, contacts: [...state.contacts] })) };
  assert.equal(acceptMotionSequence(state, { ...sequence, bodyRevision: 99 }), false);
  assert.equal(acceptMotionSequence(state, sequence), true);
  stepBodyMotion(state, body, {}, 1 / 60);
  assert.equal(state.source, 'learned');
  assert.ok(distance(state.rotations.head, before) < 0.03);
  for (let i = 0; i < 70; i++) stepBodyMotion(state, body, {}, 1 / 60);
  assert.equal(state.source, 'procedural'); assert.equal(state.sequence, null);
});

test('quaternion interpolation takes the short path and movement horizon is finite', () => {
  const a = quaternionFromEuler(0, 0.3, 0), opposite = a.map(n => -n);
  assert.ok(distance(quaternionSlerp(a, opposite, 0.5), a) < 1e-8);
  const sequence = { frames: [0, 1].map(time => ({ time, root: [time, 0, 0], rotations: { head: a }, contacts: [] })) };
  assert.deepEqual(sampleMotionSequence(sequence, 0.5).root, [0.5, 0, 0]);
  assert.equal(sampleMotionSequence(sequence, 1.01), null);
});

test('an interrupted generated lift lands continuously instead of snapping to an old anchor', () => {
  const body = born(), state = createBodyMotionState(body), id = 'foot.front.left', joint = 'leg.front.left.ankle';
  const rotations = structuredClone(state.rotations);
  rotations['leg.front.left.hip'] = quaternionFromEuler(0, 0, -0.55);
  const sequence = { lifeId: body.lifeId, bodyRevision: body.bodyRevision, topology: body.topology, frames: [0, 0.5].map(time => ({ time, root: [...state.root], rotations, contacts: state.contacts.filter(contact => contact !== id) })) };
  acceptMotionSequence(state, sequence);
  for (let i = 0; i < 29; i++) stepBodyMotion(state, body, {}, 1 / 60);
  const before = forwardBodyPose(body.descriptor, state.root, state.rotations)[joint].position;
  assert.ok(before[1] > body.descriptor.dimensions.footHeight + 0.02);
  stepBodyMotion(state, body, {}, 0.04);
  const after = forwardBodyPose(body.descriptor, state.root, state.rotations)[joint].position;
  assert.ok(distance(before, after) < 0.015, `landing jumped ${distance(before, after)}`);
  assert.ok(!state.contacts.includes(id));
  for (let i = 0; i < 120; i++) stepBodyMotion(state, body, {}, 1 / 60);
  const landed = forwardBodyPose(body.descriptor, state.root, state.rotations)[joint].position;
  assert.ok(state.contacts.includes(id)); assert.ok(Math.abs(landed[1] - body.descriptor.dimensions.footHeight) < 0.001);
});

test('intermediate growing geometry, collision, touch and attachments use one spatial state', () => {
  const body = born(), next = grown(body, { bodyWidth: body.parameters.bodyWidth + 0.04, tailFullness: body.parameters.tailFullness + 0.02, tailLength: body.parameters.tailLength + 0.08 });
  const midpoint = interpolateBodyDescriptor(body.descriptor, next.descriptor, 0.5);
  for (const field of ['colliders', 'hitRegions', 'attachments']) {
    const before = body.descriptor[field].find(item => item.id.includes('tail'));
    const after = next.descriptor[field].find(item => item.id === before.id);
    assert.ok(Math.abs(midpoint[field].find(item => item.id === before.id).radius - (before.radius + after.radius) / 2) < 1e-8);
  }
  assert.ok(Math.abs(midpoint.contacts[0].restWorld[2] - (body.descriptor.contacts[0].restWorld[2] + next.descriptor.contacts[0].restWorld[2]) / 2) < 1e-8);
  assert.ok(Math.abs(midpoint.bounds.min[0] - (body.descriptor.bounds.min[0] + next.descriptor.bounds.min[0]) / 2) < 1e-8);
});

test('static body upgrades reconcile planted feet without advancing the motion clock', () => {
  const body = born(), state = createBodyMotionState(body);
  for (let i = 0; i < 80; i++) stepBodyMotion(state, body, { pointer: [0.8, -0.5] }, 1 / 60);
  const oldTime = state.time, anchors = structuredClone(state.footTargets);
  const next = grown(body, { legLength: body.parameters.legLength + 0.035 });
  retargetBodyMotionState(state, next); state.root[1] = next.descriptor.dimensions.rootHeight; reconcileBodyContacts(state, next.descriptor);
  const world = forwardBodyPose(next.descriptor, state.root, state.rotations);
  for (const contact of next.descriptor.contacts) assert.ok(distance(world[contact.joint].position, anchors[contact.id]) < 1e-4);
  assert.equal(state.time, oldTime);
});

test('real torso and tail use normalized skinning weights and finite grown geometry', () => {
  const body = born(), anatomy = createBodyAnatomy(body), state = createBodyMotionState(body);
  const next = grown(body, { bodyLength: body.parameters.bodyLength + 0.06, tailLength: body.parameters.tailLength + 0.08 });
  anatomy.updateDescriptor(next.descriptor); retargetBodyMotionState(state, next); stepBodyMotion(state, next, {}, 1 / 60);
  anatomy.applyPose(state, next.descriptor); anatomy.group.updateMatrixWorld(true);
  const skins = []; anatomy.group.traverse(node => { if (node.isSkinnedMesh) skins.push(node); });
  assert.equal(skins.length, 3);
  for (const mesh of skins) {
    mesh.skeleton.update();
    const weights = mesh.geometry.attributes.skinWeight, positions = mesh.geometry.attributes.position;
    assert.equal(mesh.skeleton.bones.length, next.descriptor.skeleton.joints.length);
    for (let i = 0; i < weights.count; i++) {
      assert.ok(Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) < 1e-6);
      const point = mesh.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(positions, i));
      assert.ok(point.toArray().every(Number.isFinite));
    }
  }
  anatomy.dispose();
});

test('React wrapper exposes accessible current body and keeps historic SVG fallback', () => {
  const FallbackCreature = () => React.createElement('svg', { 'data-fallback': 'legacy' });
  const { BodyCreature } = createBodyComponents(React, { FallbackCreature });
  const body = born();
  const html = renderToStaticMarkup(React.createElement(BodyCreature, { body, life: { name: '朏朏', memories: [{ id: 'm1', title: '第一首歌' }] }, onTouch() {}, onMemorySelect() {} }));
  assert.match(html, /data-motion-source="procedural"/); assert.match(html, /data-structure="feifei"/);
  assert.match(html, /aria-label="和朏朏打招呼"/); assert.match(html, /回看记忆：第一首歌/);
  assert.match(renderToStaticMarkup(React.createElement(BodyCreature, { life: {} })), /data-fallback="legacy"/);
});
