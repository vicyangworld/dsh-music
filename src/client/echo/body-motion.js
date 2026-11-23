/**
 * Continuous local motor foundation. This module is deliberately labelled
 * procedural: its springs and inverse kinematics are NOT a learned model.
 * Learned providers may supply validated rest-relative quaternion sequences.
 */
const EPS = 1e-8;
const IDENTITY = [0, 0, 0, 1];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const add = (a, b) => a.map((n, i) => n + b[i]);
const sub = (a, b) => a.map((n, i) => n - b[i]);
const mul = (a, k) => a.map(n => n * k);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const length = a => Math.hypot(...a);
const normal = (a, fallback = [0, 1, 0]) => length(a) > EPS ? mul(a, 1 / length(a)) : [...fallback];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);
const copyRotations = rotations => Object.fromEntries(Object.entries(rotations).map(([id, q]) => [id, [...q]]));

export function quaternionMultiply(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

export function quaternionRotate(q, p) {
  const xyz = q.slice(0, 3), uv = cross(xyz, p), uuv = cross(xyz, uv);
  return add(p, add(mul(uv, 2 * q[3]), mul(uuv, 2)));
}

export function quaternionFromEuler(x = 0, y = 0, z = 0) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}

export function quaternionSlerp(a, b, t) {
  let end = b, cosine = dot(a, b);
  if (cosine < 0) { end = mul(b, -1); cosine = -cosine; }
  if (cosine > 0.9995) return normal(lerp(a, end, t), IDENTITY);
  const angle = Math.acos(clamp(cosine, -1, 1)), sine = Math.sin(angle);
  return add(mul(a, Math.sin((1 - t) * angle) / sine), mul(end, Math.sin(t * angle) / sine));
}

function quaternionFromVectors(from, to) {
  const a = normal(from), b = normal(to), cosine = dot(a, b);
  if (cosine < -0.99999) {
    const axis = normal(cross(a, Math.abs(a[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
    return [...axis, 0];
  }
  return normal([...cross(a, b), 1 + cosine], IDENTITY);
}

const inverseQuaternion = q => [-q[0], -q[1], -q[2], q[3]];

export function damp(value, velocity, target, frequency, dt) {
  const offset = value - target, auxiliary = velocity + frequency * offset, decay = Math.exp(-frequency * dt);
  return [target + (offset + auxiliary * dt) * decay, (velocity - frequency * auxiliary * dt) * decay];
}

export function forwardBodyPose(descriptor, root, rotations) {
  const world = {};
  for (const joint of descriptor.skeleton.joints) {
    const parent = world[joint.parent];
    const local = rotations[joint.id] || IDENTITY;
    world[joint.id] = parent
      ? { position: add(parent.position, quaternionRotate(parent.rotation, joint.rest)), rotation: quaternionMultiply(parent.rotation, local) }
      : { position: [...root], rotation: [...local] };
  }
  return world;
}

/** Target and bend direction are world-space; unreachable targets are bounded. */
export function solveTwoBone(hip, target, upperLength, lowerLength, bend = [1, 0, 0]) {
  const delta = sub(target, hip), direction = normal(delta, [0, -1, 0]);
  const distance = clamp(length(delta), Math.abs(upperLength - lowerLength) + 1e-5, upperLength + lowerLength - 1e-5);
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const side = normal(sub(bend, mul(direction, dot(bend, direction))), [0, 0, 1]);
  return { knee: add(hip, add(mul(direction, along), mul(side, height))), ankle: add(hip, mul(direction, distance)), reachable: Math.abs(length(delta) - distance) < 1e-4 };
}

function contactsFor(descriptor) {
  return descriptor.contacts.map(contact => ({
    id: contact.id,
    joint: contact.joint || contact.jointId,
    offset: contact.local || contact.offset || contact.localPosition || [0, -(descriptor.dimensions.footHeight || 0.065), 0],
  }));
}

function bindContacts(state, body, preserve = true) {
  const joints = Object.fromEntries(body.descriptor.skeleton.joints.map(joint => [joint.id, joint]));
  const previous = state.footTargets || {};
  state.footTargets = Object.fromEntries(contactsFor(body.descriptor).map(contact => [contact.id,
    preserve && previous[contact.id] ? [...previous[contact.id]] : [...(joints[contact.joint]?.restWorld || [0, body.descriptor.dimensions.footHeight, 0])]]));
  const allContacts = contactsFor(body.descriptor).map(contact => contact.id);
  state.contacts = preserve && Array.isArray(state.contacts) ? state.contacts.filter(id => allContacts.includes(id)) : allContacts;
}

export function createBodyMotionState(body) {
  const rootJoint = body.descriptor.skeleton.joints.find(joint => !joint.parent);
  const state = {
    lifeId: body.lifeId, bodyRevision: body.bodyRevision, topology: body.topology,
    time: 0, source: 'procedural', root: [...rootJoint.restWorld],
    rotations: Object.fromEntries(body.descriptor.skeleton.joints.map(joint => [joint.id, [...IDENTITY]])),
    attention: [0, 0], attentionVelocity: [0, 0], heightVelocity: 0,
    tail: Array.from({ length: 6 }, () => [0, 0]), tailVelocity: Array.from({ length: 6 }, () => [0, 0]),
    touch: 0, lastTouch: 0, sequence: null, contactError: 0, settlingFeet: {},
  };
  bindContacts(state, body, false);
  return state;
}

export function captureBodyMotionState(state) {
  const { sequence, ...snapshot } = state;
  return JSON.parse(JSON.stringify(snapshot));
}

/** Per-view snapshots never share mutable controller state or a render clock. */
export function restoreBodyMotionState(body, snapshot) {
  const fresh = createBodyMotionState(body);
  if (!snapshot || snapshot.lifeId !== body.lifeId || snapshot.bodyRevision !== body.bodyRevision || snapshot.topology !== body.topology) return fresh;
  const vector = (value, count) => Array.isArray(value) && value.length === count && value.every(Number.isFinite);
  if (!vector(snapshot.root, 3) || !Number.isFinite(snapshot.time) || snapshot.time < 0) return fresh;
  if (Object.keys(fresh.rotations).some(id => !vector(snapshot.rotations?.[id], 4) || Math.abs(length(snapshot.rotations[id]) - 1) > 0.01)) return fresh;
  const copy = JSON.parse(JSON.stringify(snapshot));
  fresh.root = copy.root; fresh.time = copy.time; fresh.rotations = copy.rotations;
  if (vector(copy.attention, 2)) fresh.attention = copy.attention;
  if (vector(copy.attentionVelocity, 2)) fresh.attentionVelocity = copy.attentionVelocity;
  if (Number.isFinite(copy.heightVelocity)) fresh.heightVelocity = copy.heightVelocity;
  if (copy.tail?.length === 6 && copy.tail.every(value => vector(value, 2))) fresh.tail = copy.tail;
  if (copy.tailVelocity?.length === 6 && copy.tailVelocity.every(value => vector(value, 2))) fresh.tailVelocity = copy.tailVelocity;
  for (const id of fresh.contacts) if (vector(copy.footTargets?.[id], 3)) fresh.footTargets[id] = copy.footTargets[id];
  const allowedContacts = new Set(fresh.contacts);
  if (Array.isArray(copy.contacts) && copy.contacts.every(id => allowedContacts.has(id))) fresh.contacts = copy.contacts;
  if (copy.settlingFeet && typeof copy.settlingFeet === 'object') fresh.settlingFeet = Object.fromEntries(Object.entries(copy.settlingFeet).filter(([id, value]) => allowedContacts.has(id) && vector(value?.target, 3) && vector(value?.velocity, 3)));
  // A suspended view may have stopped during a generated step. Begin a local
  // landing from its live ankle position; never call an old anchor a contact.
  beginSettling(fresh, body.descriptor);
  return fresh;
}

/** Preserve the live pose and planted feet across a compatible body revision. */
export function retargetBodyMotionState(state, body) {
  if (state.lifeId !== body.lifeId || state.topology !== body.topology) return createBodyMotionState(body);
  state.bodyRevision = body.bodyRevision;
  state.sequence = null;
  state.source = 'procedural';
  state.rotations = Object.fromEntries(body.descriptor.skeleton.joints.map(joint => [joint.id, state.rotations[joint.id] || [...IDENTITY]]));
  bindContacts(state, body, true);
  return state;
}

export function acceptMotionSequence(state, sequence) {
  if (!sequence || sequence.lifeId !== state.lifeId || sequence.bodyRevision !== state.bodyRevision || sequence.topology !== state.topology || !sequence.frames?.length) return false;
  state.sequence = { ...sequence, acceptedAt: state.time, fromRoot: [...state.root], fromRotations: copyRotations(state.rotations) };
  return true;
}

/** Frames are validated by motion-core before this sampling boundary. */
export function sampleMotionSequence(sequence, elapsed) {
  const frames = sequence.frames;
  if (!frames?.length || elapsed > frames[frames.length - 1].time) return null;
  let right = frames.findIndex(frame => frame.time >= elapsed);
  if (right < 0) return null;
  const a = frames[Math.max(0, right - 1)], b = frames[right];
  const t = b.time === a.time ? 0 : clamp((elapsed - a.time) / (b.time - a.time), 0, 1);
  return { root: lerp(a.root, b.root, t), rotations: Object.fromEntries(Object.keys(a.rotations).map(id => [id, quaternionSlerp(a.rotations[id], b.rotations[id], t)])), contacts: t < 0.5 ? a.contacts : b.contacts };
}

function beginSettling(state, descriptor) {
  const world = forwardBodyPose(descriptor, state.root, state.rotations);
  const joints = Object.fromEntries(descriptor.skeleton.joints.map(joint => [joint.id, joint]));
  state.settlingFeet ||= {};
  for (const contact of contactsFor(descriptor)) {
    if (state.contacts.includes(contact.id) || Object.hasOwn(state.settlingFeet, contact.id)) continue;
    const current = world[contact.joint]?.position;
    if (!current) continue;
    const floor = -contact.offset[1];
    const knee = joints[joints[contact.joint].parent], hip = joints[knee.parent], hipPosition = world[hip.id].position;
    const landing = state.footTargets[contact.id] ? [...state.footTargets[contact.id]] : [hipPosition[0], floor, hipPosition[2]];
    landing[1] = floor;
    if (length(sub(landing, hipPosition)) > length(knee.rest) + length(joints[contact.joint].rest) - 1e-4) { landing[0] = hipPosition[0]; landing[2] = hipPosition[2]; }
    state.footTargets[contact.id] = [current[0], Math.max(floor, current[1]), current[2]];
    state.settlingFeet[contact.id] = { target: landing, velocity: [0, 0, 0] };
  }
}

function advanceSettling(state, descriptor, dt) {
  for (const contact of contactsFor(descriptor)) {
    if (!Object.hasOwn(state.settlingFeet, contact.id)) continue;
    const target = state.footTargets[contact.id], settling = state.settlingFeet[contact.id];
    for (let axis = 0; axis < 3; axis++) [target[axis], settling.velocity[axis]] = damp(target[axis], settling.velocity[axis], settling.target[axis], 10, dt);
    if (length(sub(target, settling.target)) < 0.0005) {
      state.footTargets[contact.id] = [...settling.target]; delete state.settlingFeet[contact.id];
      if (!state.contacts.includes(contact.id)) state.contacts.push(contact.id);
    }
  }
}

function constrainContacts(state, descriptor) {
  const joints = Object.fromEntries(descriptor.skeleton.joints.map(joint => [joint.id, joint]));
  state.contactError = 0;
  for (const contact of contactsFor(descriptor)) {
    if (!state.contacts.includes(contact.id) && !Object.hasOwn(state.settlingFeet || {}, contact.id)) continue;
    const ankle = joints[contact.joint], knee = joints[ankle?.parent], hip = joints[knee?.parent];
    if (!hip || !knee || !ankle) continue;
    const world = forwardBodyPose(descriptor, state.root, state.rotations);
    const target = state.footTargets[contact.id];
    if (!target) continue;
    const solved = solveTwoBone(world[hip.id].position, target, length(knee.rest), length(ankle.rest), [hip.id.includes('.front.') ? -1 : 1, 0, 0]);
    const parentRotation = world[hip.parent]?.rotation || IDENTITY;
    const upperWorld = quaternionFromVectors(knee.rest, sub(solved.knee, world[hip.id].position));
    state.rotations[hip.id] = quaternionMultiply(inverseQuaternion(parentRotation), upperWorld);
    const lowerWorld = quaternionFromVectors(ankle.rest, sub(solved.ankle, solved.knee));
    state.rotations[knee.id] = quaternionMultiply(inverseQuaternion(upperWorld), lowerWorld);
    state.rotations[ankle.id] = inverseQuaternion(lowerWorld);
    state.contactError = Math.max(state.contactError, length(sub(solved.ankle, target)));
  }
}

/** A single pose solve also supports static/reduced-motion body upgrades. */
export function reconcileBodyContacts(state, descriptor) {
  constrainContacts(state, descriptor);
  return state;
}

/** Advance one bounded render step. Returns the same state to avoid frame churn. */
export function stepBodyMotion(state, body, inputs = {}, seconds = 1 / 60) {
  if (body.bodyRevision !== state.bodyRevision) retargetBodyMotionState(state, body);
  const dt = clamp(Number.isFinite(seconds) ? seconds : 0, 0, 0.05);
  if (!dt) return state;
  state.time += dt;
  const descriptor = body.descriptor, rootJoint = descriptor.skeleton.joints.find(joint => !joint.parent);
  const pointer = inputs.pointer || [0, 0], energy = clamp(inputs.energy ?? (inputs.active ? 0.4 : 0), 0, 1);
  if ((inputs.touch || 0) !== state.lastTouch) { state.lastTouch = inputs.touch || 0; state.touch = 1; }
  state.touch *= Math.exp(-3.5 * dt);
  for (let axis = 0; axis < 2; axis++) [state.attention[axis], state.attentionVelocity[axis]] = damp(state.attention[axis], state.attentionVelocity[axis], clamp(pointer[axis] || 0, -1, 1), 6, dt);
  const breath = Math.sin(state.time * (0.8 + energy * 0.2)) * 0.004;
  [state.root[1], state.heightVelocity] = damp(state.root[1], state.heightVelocity, rootJoint.restWorld[1] + breath + state.touch * 0.009, 7, dt);
  const restRotations = Object.fromEntries(descriptor.skeleton.joints.map(joint => [joint.id, [...IDENTITY]]));
  restRotations.root = quaternionFromEuler(state.attention[0] * 0.012, -state.attention[0] * 0.045, breath * 0.7);
  restRotations.spine = quaternionFromEuler(0, 0, breath * 0.6);
  restRotations.neck = quaternionFromEuler(0, -state.attention[0] * 0.12, -state.attention[1] * 0.045);
  restRotations.head = quaternionFromEuler(state.attention[0] * 0.025, -state.attention[0] * 0.22, -state.attention[1] * 0.17 + state.touch * 0.035);
  restRotations['ear.left'] = quaternionFromEuler(0, state.touch * 0.13, state.touch * 0.08);
  restRotations['ear.right'] = quaternionFromEuler(0, -state.touch * 0.09, state.touch * 0.1);
  const tailLength = body.parameters.tailLength;
  for (let i = 0; i < 6; i++) {
    const slow = Math.sin(state.time * (0.75 + energy * 0.7) - i * 0.38);
    const yaw = 0.24 + i * 0.015 + slow * (0.015 + energy * 0.028) + state.attention[0] * 0.017;
    const lift = -0.07 + Math.sin(state.time * 0.6 - i * 0.31) * 0.014 + state.touch * 0.06;
    [state.tail[i][0], state.tailVelocity[i][0]] = damp(state.tail[i][0], state.tailVelocity[i][0], yaw, (9 - i * 0.6) / Math.sqrt(tailLength), dt);
    [state.tail[i][1], state.tailVelocity[i][1]] = damp(state.tail[i][1], state.tailVelocity[i][1], lift, (8 - i * 0.55) / Math.sqrt(tailLength), dt);
    restRotations[`tail.${i}`] = quaternionFromEuler(0, state.tail[i][0], state.tail[i][1]);
  }
  const sequence = state.sequence;
  const sampled = sequence ? sampleMotionSequence(sequence, state.time - sequence.acceptedAt) : null;
  if (sampled) {
    state.settlingFeet = {};
    const blend = clamp((state.time - sequence.acceptedAt) / 0.22, 0, 1);
    state.root = lerp(sequence.fromRoot, sampled.root, blend);
    state.rotations = Object.fromEntries(Object.keys(sampled.rotations).map(id => [id, quaternionSlerp(sequence.fromRotations[id] || IDENTITY, sampled.rotations[id], blend)]));
    const previousContacts = state.contacts;
    state.contacts = [...sampled.contacts];
    const world = forwardBodyPose(descriptor, state.root, state.rotations);
    for (const contact of contactsFor(descriptor)) {
      if (state.contacts.includes(contact.id) && !previousContacts.includes(contact.id)) state.footTargets[contact.id] = [...world[contact.joint].position];
    }
    state.source = 'learned';
  } else {
    if (sequence) { state.sequence = null; state.heightVelocity = 0; beginSettling(state, descriptor); }
    state.rotations = Object.fromEntries(Object.keys(restRotations).map(id => [id, quaternionSlerp(state.rotations[id] || IDENTITY, restRotations[id], 1 - Math.exp(-8 * dt))]));
    state.source = 'procedural';
    beginSettling(state, descriptor); advanceSettling(state, descriptor, dt);
  }
  constrainContacts(state, descriptor);
  return state;
}

export function motionRequestState(state) {
  return { time: state.time, root: [...state.root], rotations: copyRotations(state.rotations), contacts: [...state.contacts] };
}

/** A compatible growth transition changes dimensions/rest positions together. */
export function interpolateBodyDescriptor(from, to, t) {
  const amount = clamp(t, 0, 1);
  if (amount === 1) return to;
  const previous = Object.fromEntries(from.skeleton.joints.map(joint => [joint.id, joint]));
  const dimensions = Object.fromEntries(Object.entries(to.dimensions).map(([key, value]) => [key,
    typeof value === 'number' && typeof from.dimensions[key] === 'number' ? from.dimensions[key] + (value - from.dimensions[key]) * amount : value]));
  const spatial = (a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * amount;
    if (Array.isArray(b)) return b.map((value, index) => spatial(a?.[index], value));
    if (b && typeof b === 'object') return Object.fromEntries(Object.entries(b).map(([key, value]) => [key, spatial(a?.[key], value)]));
    return b;
  };
  const regions = key => {
    const prior = Object.fromEntries((from[key] || []).map(region => [region.id, region]));
    return (to[key] || []).map(region => spatial(prior[region.id], region));
  };
  return { ...to, dimensions, contacts: regions('contacts'), colliders: regions('colliders'), hitRegions: regions('hitRegions'), attachments: regions('attachments'), bounds: spatial(from.bounds, to.bounds), skeleton: { ...to.skeleton, joints: to.skeleton.joints.map(joint => ({ ...joint,
    rest: previous[joint.id] ? lerp(previous[joint.id].rest, joint.rest, amount) : joint.rest,
    restWorld: previous[joint.id] ? lerp(previous[joint.id].restWorld, joint.restWorld, amount) : joint.restWorld,
  })) } };
}
