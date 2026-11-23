/** Wire contract for a learned motion service. This module does not contain a
 * model, weights, or an animation library. Quaternions are local, rest-relative
 * [x,y,z,w]; frame times are seconds relative to a segment's beginning. */
export const MOTION_PROTOCOL = 'echo-motion/1'
export const MOTION_LIMITS = Object.freeze({ joints: 64, frames: 121, seconds: 2, requestBytes: 256 * 1024, responseBytes: 2 * 1024 * 1024 })
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/
const FEATURES = ['energy', 'brightness', 'rhythm', 'texture']
const CAPABILITIES = ['body-conditioned', 'pose-conditioned', 'goal-conditioned', 'continuous-motion']

export class MotionError extends Error {
  constructor(message, code = 'INVALID_MOTION', status = 400) {
    super(message)
    this.name = 'MotionError'
    this.code = code
    this.status = status
  }
}
const fail = (message, code, status) => { throw new MotionError(message, code, status) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const finite = (value, low, high) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
const validId = value => typeof value === 'string' && ID.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)
const revision = value => Number.isSafeInteger(value) && value >= 0
const copy = value => JSON.parse(JSON.stringify(value))
function vector(value, length, bound = 10) {
  if (!Array.isArray(value) || value.length !== length || !value.every(n => finite(n, -bound, bound))) fail('运动坐标无效。')
  return [...value]
}
function quaternion(value) {
  const q = vector(value, 4, 1.001)
  const norm = Math.hypot(...q)
  if (Math.abs(norm - 1) > 0.001) fail('运动旋转不是单位四元数。')
  return q.map(n => n / norm)
}
function scalarMap(value, required = [], upper = 1) {
  if (!object(value) || Object.keys(value).length > 32) fail('运动条件格式无效。')
  const pairs = Object.entries(value)
  if (required.some(k => !Object.hasOwn(value, k)) || pairs.some(([k, n]) => !validId(k) || !finite(n, 0, upper))) fail('运动条件必须处于支持的数值范围。')
  return Object.fromEntries(pairs)
}
function bounded(value, limit) {
  let text
  try { text = JSON.stringify(value) } catch { fail('运动数据不能序列化。') }
  if (!text || new TextEncoder().encode(text).length > limit) fail('运动数据超过容量限制。', 'MOTION_TOO_LARGE', 413)
}
function noClips(value) {
  if (['clip', 'clipId', 'animation', 'animationId', 'play'].some(k => Object.hasOwn(value, k))) fail('学习型运动接口只接受姿态轨迹，不能返回预设动画名称。', 'MOTION_CLIP_REJECTED')
}

/** A reduced body snapshot sufficient for motion; host uses its authoritative
 * body instead of accepting client-supplied geometry as a new body version. */
export function motionBody(body) {
  if (!object(body) || body.schemaVersion !== 2 || !validId(body.lifeId) || !revision(body.lifeRevision) || !revision(body.bodyRevision) || !validId(body.topology) || body.species !== 'feifei') fail('运动请求缺少兼容的身体版本。', 'MOTION_BODY_INVALID')
  const d = body.descriptor
  if (!object(d) || !object(d.skeleton) || d.skeleton.coordinateSystem !== 'x-forward/y-up/z-left' || !Array.isArray(d.skeleton.joints) || !d.skeleton.joints.length || d.skeleton.joints.length > MOTION_LIMITS.joints || !Array.isArray(d.contacts)) fail('身体骨架或接触点无效。', 'MOTION_BODY_INVALID')
  if (!validId(d.contentId) || (body.contentId !== undefined && body.contentId !== d.contentId)) fail('身体内容标识不一致。', 'MOTION_BODY_INVALID')
  const ids = new Set()
  let roots = 0
  for (const joint of d.skeleton.joints) {
    if (!object(joint) || !validId(joint.id) || ids.has(joint.id) || (joint.parent !== null && !ids.has(joint.parent))) fail('骨架连接顺序或关节标识无效。', 'MOTION_BODY_INVALID')
    if (joint.parent === null) roots++
    vector(joint.rest, 3)
    if (!object(joint.limits) || ['x', 'y', 'z'].some(axis => !Array.isArray(joint.limits[axis]) || joint.limits[axis].length !== 2 || !joint.limits[axis].every(n => finite(n, -Math.PI, Math.PI)) || joint.limits[axis][0] > joint.limits[axis][1])) fail('关节活动范围无效。', 'MOTION_BODY_INVALID')
    ids.add(joint.id)
  }
  if (roots !== 1 || d.contacts.length > 16) fail('身体必须具有一个根关节及有限接触点。', 'MOTION_BODY_INVALID')
  const contacts = new Set()
  for (const contact of d.contacts) {
    if (!object(contact) || !validId(contact.id) || contacts.has(contact.id) || !ids.has(contact.joint)) fail('身体接触点无效。', 'MOTION_BODY_INVALID')
    contacts.add(contact.id)
  }
  const result = { schemaVersion: 2, species: body.species, lifeId: body.lifeId, lifeRevision: body.lifeRevision, bodyRevision: body.bodyRevision, contentId: d.contentId, topology: body.topology, parameters: scalarMap(body.parameters, [], 10), descriptor: copy(d) }
  bounded(result, MOTION_LIMITS.requestBytes / 2)
  return result
}

export function sameMotionBody(a, b) {
  return !!a && !!b && a.lifeId === b.lifeId && a.bodyRevision === b.bodyRevision && a.topology === b.topology && (a.contentId || a.descriptor?.contentId) === (b.contentId || b.descriptor?.contentId)
}

function pose(value, body, { state = false } = {}) {
  if (!object(value)) fail('运动姿态无效。')
  noClips(value)
  if (!finite(value.time, 0, state ? 1e12 : MOTION_LIMITS.seconds)) fail('运动时间无效。')
  const root = vector(value.root, 3)
  if (!object(value.rotations) || Object.keys(value.rotations).length !== body.descriptor.skeleton.joints.length) fail('运动必须提供每个关节的旋转。')
  const rotations = Object.fromEntries(body.descriptor.skeleton.joints.map(j => {
    if (!Object.hasOwn(value.rotations, j.id)) fail('运动缺少身体关节。')
    return [j.id, quaternion(value.rotations[j.id])]
  }))
  const contactIds = new Set(body.descriptor.contacts.map(c => c.id))
  if (!Array.isArray(value.contacts) || value.contacts.length > contactIds.size || new Set(value.contacts).size !== value.contacts.length || value.contacts.some(id => !contactIds.has(id))) fail('运动包含未知接触点。')
  return { time: value.time, root, rotations, contacts: [...value.contacts] }
}

export function validateMotionRequest(raw, { authoritativeBody } = {}) {
  if (!object(raw)) fail('运动请求无效。')
  bounded(raw, MOTION_LIMITS.requestBytes)
  noClips(raw)
  if (raw.protocol !== MOTION_PROTOCOL || !validId(raw.requestId)) fail('运动请求协议或标识无效。')
  const requestedBody = motionBody(raw.body)
  if (authoritativeBody && !sameMotionBody(requestedBody, authoritativeBody)) fail('身体已经成长，请用当前身体重新生成运动。', 'MOTION_BODY_STALE', 409)
  const body = authoritativeBody ? motionBody(authoritativeBody) : requestedBody
  const state = pose(raw.state, body, { state: true })
  if (!object(raw.goal)) fail('运动缺少目标。')
  noClips(raw.goal)
  const goal = { target: vector(raw.goal.target, 3), attention: raw.goal.attention, energy: raw.goal.energy }
  if (!finite(goal.attention, 0, 1) || !finite(goal.energy, 0, 1)) fail('运动目标强度无效。')
  return { protocol: MOTION_PROTOCOL, requestId: raw.requestId, body, state, goal, music: scalarMap(raw.music, FEATURES), style: scalarMap(raw.style || {}) }
}

export function validateMotionModel(value) {
  if (!object(value) || value.kind !== 'learned' || !validId(value.id) || !validId(value.version) || typeof value.weightsSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.weightsSha256)) fail('运动服务没有提供学习模型与权重来源。', 'MOTION_MODEL_UNVERIFIED', 503)
  return { kind: 'learned', id: value.id, version: value.version, weightsSha256: value.weightsSha256 }
}

export function validateMotionStatus(raw) {
  if (!object(raw) || raw.protocol !== MOTION_PROTOCOL) fail('运动服务协议不兼容。', 'MOTION_PROTOCOL_UNSUPPORTED', 503)
  if (raw.status !== 'ready') return { protocol: MOTION_PROTOCOL, status: 'unavailable', available: false, reason: '学习型运动模型尚未就绪。', model: null }
  const model = validateMotionModel(raw.model)
  if (!Array.isArray(raw.capabilities) || CAPABILITIES.some(c => !raw.capabilities.includes(c)) || !Array.isArray(raw.supportedTopologies) || !raw.supportedTopologies.length || raw.supportedTopologies.length > 16 || raw.supportedTopologies.some(t => !validId(t))) fail('模型尚未声明身体、姿态和目标条件能力。', 'MOTION_CAPABILITY_UNSUPPORTED', 503)
  return { protocol: MOTION_PROTOCOL, status: 'ready', available: true, model, capabilities: [...CAPABILITIES], supportedTopologies: [...new Set(raw.supportedTopologies)], reason: null }
}

const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]))
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.reduce((s, n, i) => s + n * b[i], 0))))

function inJointRange(q, limits) {
  const [x, y, z, w] = q
  const m13 = 2 * (x * z + y * w)
  const ay = Math.asin(Math.max(-1, Math.min(1, m13)))
  const ax = Math.abs(m13) < 0.9999999 ? Math.atan2(-2 * (y * z - x * w), 1 - 2 * (x * x + y * y)) : Math.atan2(2 * (y * z + x * w), 1 - 2 * (x * x + z * z))
  const az = Math.abs(m13) < 0.9999999 ? Math.atan2(-2 * (x * y - z * w), 1 - 2 * (y * y + z * z)) : 0
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))
  const within = values => ['x', 'y', 'z'].every((axis, i) => values[i] >= limits[axis][0] - 0.002 && values[i] <= limits[axis][1] + 0.002)
  // Euler XYZ has two equivalent representations; accept either, notably for
  // root yaw beyond +/- pi/2. Restricting to the canonical form rejects turns.
  return within([ax, ay, az]) || within([wrap(ax + Math.PI), wrap(Math.PI - ay), wrap(az + Math.PI)])
}

/** This verifies format and coarse continuity, not physical correctness or
 * whether a provider truly ran the stated checkpoint. Contacts/IK and renderer
 * arrival blending remain required. A model identity is provenance, not proof. */
export function validateMotionSequence(raw, request, { currentBody, expectedModel } = {}) {
  const context = validateMotionRequest(request)
  if (currentBody && !sameMotionBody(context.body, currentBody)) fail('成长后的身体已使这段运动过期。', 'MOTION_BODY_STALE', 409)
  if (!object(raw)) fail('模型没有返回运动轨迹。')
  bounded(raw, MOTION_LIMITS.responseBytes)
  noClips(raw)
  if (raw.protocol !== MOTION_PROTOCOL || raw.requestId !== context.requestId || raw.lifeId !== context.body.lifeId || raw.bodyRevision !== context.body.bodyRevision || raw.topology !== context.body.topology) fail('运动结果不属于当前请求或身体。', 'MOTION_RESULT_STALE', 409)
  const model = validateMotionModel(raw.model)
  if (expectedModel && (model.id !== expectedModel.id || model.version !== expectedModel.version || model.weightsSha256 !== expectedModel.weightsSha256)) fail('模型在生成过程中发生了变化。', 'MOTION_MODEL_CHANGED', 409)
  if (!Array.isArray(raw.frames) || raw.frames.length < 2 || raw.frames.length > MOTION_LIMITS.frames) fail('运动轨迹帧数无效。')
  const frames = raw.frames.map(frame => pose(frame, context.body))
  for (const frame of frames) for (const joint of context.body.descriptor.skeleton.joints) {
    if (!inJointRange(frame.rotations[joint.id], joint.limits)) fail('生成姿态超出身体关节活动范围。', 'MOTION_JOINT_LIMIT')
  }
  if (frames[0].time !== 0 || frames.at(-1).time < 0.05) fail('运动轨迹必须从零开始并覆盖有效时长。')
  if (distance(frames[0].root, context.state.root) > 0.015 || Object.keys(context.state.rotations).some(id => angle(frames[0].rotations[id], context.state.rotations[id]) > 0.1)) fail('运动起点与当前姿态不连续。', 'MOTION_START_DISCONTINUITY')
  for (let i = 1; i < frames.length; i++) {
    const previous = frames[i - 1], next = frames[i], dt = next.time - previous.time
    if (dt < 0.001 || dt > 0.12) fail('运动帧时间必须递增且保持连续。')
    if (distance(previous.root, next.root) / dt > 4 || Object.keys(next.rotations).some(id => angle(previous.rotations[id], next.rotations[id]) / dt > 18)) fail('运动轨迹存在突变。', 'MOTION_DISCONTINUITY')
  }
  return { protocol: MOTION_PROTOCOL, requestId: context.requestId, lifeId: context.body.lifeId, bodyRevision: context.body.bodyRevision, topology: context.body.topology, model, frames }
}
