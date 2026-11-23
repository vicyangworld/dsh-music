/**
 * ECHO body schema 2. A deterministic, bounded body family, not an AI model.
 * All geometry, contact and motion consumers share this descriptor. Growing
 * decisions must carry their actual source; merely deriving a body is not AI.
 * Pure module: no ambient clock, storage, randomness, network or renderer.
 */
import { getMorphology, validateLife, ValidationError } from './life-core.js'

export const BODY_SCHEMA_VERSION = 2
export const BODY_TOPOLOGY = 'feifei-quadruped/1'
export const BODY_PARAMETER_LIMITS = Object.freeze({
  bodyLength: Object.freeze({ min: 0.85, max: 1.65, maxDelta: 0.06 }),
  bodyWidth: Object.freeze({ min: 0.42, max: 0.86, maxDelta: 0.045 }),
  bodyHeight: Object.freeze({ min: 0.40, max: 0.88, maxDelta: 0.04 }),
  legLength: Object.freeze({ min: 0.26, max: 0.72, maxDelta: 0.035 }),
  headScale: Object.freeze({ min: 0.82, max: 1.24, maxDelta: 0.03 }),
  earLength: Object.freeze({ min: 0.14, max: 0.36, maxDelta: 0.02 }),
  tailLength: Object.freeze({ min: 0.65, max: 1.70, maxDelta: 0.08 }),
  tailFullness: Object.freeze({ min: 0.12, max: 0.38, maxDelta: 0.025 }),
  maneFullness: Object.freeze({ min: 0.10, max: 0.34, maxDelta: 0.025 }),
})
const PARAMETER_KEYS = Object.keys(BODY_PARAMETER_LIMITS)
const MAX_DATE = 8640000000000000
const round = (v) => Math.round(v * 1e6) / 1e6
const vec = (x, y, z) => [round(x), round(y), round(z)]
const copy = (value) => JSON.parse(JSON.stringify(value))
const fail = (message, code = 'INVALID_BODY_STATE') => { throw new ValidationError(message, code) }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value
}
function string(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label}无效`)
  return value.trim().normalize('NFC')
}
function integer(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(`${label}无效`)
  return value
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}
function equal(a, b) { return canonical(a) === canonical(b) }
// Content/change identification only. Archive integrity uses the host checksum.
function hash(value, initial = 2166136261) {
  let h = initial >>> 0
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d) >>> 0
  h ^= h >>> 15
  return (h ^ (h >>> 16)) >>> 0
}
const unit = (seed, label) => hash(seed, hash(`echo-body/2:${label}`)) / 4294967295

function identityFor(seed) {
  return {
    palette: Math.floor(unit(seed, 'palette') * 4),
    eyeSpacing: round(0.94 + unit(seed, 'eye-spacing') * 0.12),
    earTilt: round(-0.10 + unit(seed, 'ear-tilt') * 0.20),
    tailCurl: round(0.16 + unit(seed, 'tail-curl') * 0.28),
    maneAsymmetry: round(-0.06 + unit(seed, 'mane-asymmetry') * 0.12),
    expressionSignature: [round(unit(seed, 'tempo')), round(unit(seed, 'attention')), round(unit(seed, 'amplitude'))],
  }
}

function parameters(value) {
  object(value, '身体参数')
  for (const key of Object.keys(value)) if (!PARAMETER_KEYS.includes(key)) fail(`不支持身体参数 ${key}`, 'UNSUPPORTED_BODY_PARAMETER')
  const result = {}
  for (const key of PARAMETER_KEYS) {
    const range = BODY_PARAMETER_LIMITS[key], n = value[key]
    if (!Number.isFinite(n) || n < range.min || n > range.max) fail(`身体参数 ${key}超出已验证范围`, 'BODY_OUT_OF_RANGE')
    result[key] = round(n)
  }
  if (result.bodyWidth > result.bodyLength * 0.85 || result.legLength > result.bodyLength * 0.65 || result.tailLength > result.bodyLength * 1.65) {
    fail('身体比例超出当前朏朏结构的支持范围', 'BODY_OUT_OF_RANGE')
  }
  return result
}

function source(value, allowMigration = false) {
  object(value, '成长来源')
  if (!['model', 'manual', ...(allowMigration ? ['legacy-migration'] : [])].includes(value.kind)) fail('需要记录真实的成长来源', 'INVALID_GROWTH_SOURCE')
  const result = {
    kind: value.kind,
    provider: string(value.provider, '来源服务', 80),
    model: string(value.model, '模型或规则标识', 160),
    requestId: string(value.requestId, '生成请求标识', 160),
  }
  if (value.modelVersion !== undefined) result.modelVersion = string(value.modelVersion, '模型版本', 160)
  return result
}

function assertHeader(body) {
  object(body, '身体档案')
  if (body.schemaVersion !== BODY_SCHEMA_VERSION) fail('身体档案版本不兼容', 'UNSUPPORTED_BODY_VERSION')
  if (body.species !== 'feifei' || body.topology !== BODY_TOPOLOGY) fail('当前运动系统尚未支持这个身体结构', 'UNSUPPORTED_BODY_TOPOLOGY')
  string(body.lifeId, '生命标识')
  string(body.seed, '生命种子', 128)
  integer(body.lifeRevision, '生命版本')
  integer(body.bodyRevision, '身体版本')
  integer(body.createdAt, '初生时间', MAX_DATE)
  integer(body.updatedAt, '身体更新时间', MAX_DATE)
  if (body.updatedAt < body.createdAt) fail('身体更新时间不能倒退')
  if (!equal(body.identity, identityFor(body.seed))) fail('身体升级改变了先天身份', 'BODY_IDENTITY_MISMATCH')
  parameters(body.parameters)
  source(body.provenance, true)
}

function contentId(body) {
  const value = canonical({ version: BODY_SCHEMA_VERSION, lifeId: body.lifeId, seed: body.seed, topology: body.topology, parameters: body.parameters, identity: body.identity })
  return `feifei-${hash(value).toString(16).padStart(8, '0')}${hash(value, 0x9e3779b9).toString(16).padStart(8, '0')}`
}

/** Local joints and world rest positions are in body units: X forward, Y up, Z left. */
export function deriveBodyDescriptor(body) {
  assertHeader(body)
  const p = parameters(body.parameters), i = body.identity
  const footHeight = 0.065, hipHeight = p.legLength + footHeight
  const rootHeight = round(hipHeight + p.bodyHeight * 0.28)
  const d = { ...p, rootHeight, hipHeight: round(hipHeight), headRadius: round(0.34 * p.headScale), footHeight, pawRadius: round(0.10 + p.bodyWidth * 0.035), tailSegments: 6 }
  const joints = [], byId = new Map()
  const limits = (x, y, z) => ({ x, y, z })
  function joint(id, parent, rest, range) {
    const base = parent ? byId.get(parent).restWorld : [0, 0, 0]
    const value = { id, parent, rest, restWorld: vec(...rest.map((v, n) => v + base[n])), limits: range }
    joints.push(value); byId.set(id, value)
    return value
  }
  joint('root', null, vec(0, rootHeight, 0), limits([-0.35, 0.35], [-Math.PI, Math.PI], [-0.45, 0.45]))
  joint('spine', 'root', vec(-p.bodyLength * 0.12, 0, 0), limits([-0.3, 0.3], [-0.35, 0.35], [-0.35, 0.35]))
  joint('chest', 'root', vec(p.bodyLength * 0.23, p.bodyHeight * 0.07, 0), limits([-0.3, 0.3], [-0.35, 0.35], [-0.4, 0.4]))
  joint('neck', 'chest', vec(p.bodyLength * 0.16, p.bodyHeight * 0.19, 0), limits([-0.4, 0.4], [-0.55, 0.55], [-0.6, 0.6]))
  joint('head', 'neck', vec(p.bodyLength * 0.17, p.bodyHeight * 0.12, 0), limits([-0.45, 0.45], [-0.65, 0.65], [-0.65, 0.65]))
  for (const [side, sign] of [['left', 1], ['right', -1]]) joint(`ear.${side}`, 'head', vec(-d.headRadius * 0.12, d.headRadius * 0.65, sign * d.headRadius * 0.63), limits([-0.35, 0.35], [-0.3, 0.3], [-0.45, 0.45]))
  const contacts = []
  for (const [end, x] of [['front', p.bodyLength * 0.32], ['rear', -p.bodyLength * 0.34]]) {
    for (const [side, sign] of [['left', 1], ['right', -1]]) {
      const prefix = `leg.${end}.${side}`, bend = end === 'front' ? -0.045 : 0.045
      joint(`${prefix}.hip`, 'root', vec(x, -p.bodyHeight * 0.28, sign * p.bodyWidth * 0.34), limits([-0.3, 0.3], [-0.35, 0.35], [-0.75, 0.75]))
      joint(`${prefix}.knee`, `${prefix}.hip`, vec(bend, -p.legLength * 0.5, 0), limits([-0.15, 0.15], [-0.15, 0.15], [-0.95, 0.95]))
      const ankle = joint(`${prefix}.ankle`, `${prefix}.knee`, vec(-bend, -p.legLength * 0.5, 0), limits([-0.25, 0.25], [-0.3, 0.3], [-0.6, 0.6]))
      contacts.push({ id: `foot.${end}.${side}`, joint: ankle.id, local: vec(0, -footHeight, 0), restWorld: vec(ankle.restWorld[0], 0, ankle.restWorld[2]), radius: d.pawRadius })
    }
  }
  for (let n = 0; n < 6; n++) {
    const offset = n === 0 ? vec(-p.bodyLength * 0.35, p.bodyHeight * 0.04, 0) : vec(-p.tailLength / 5, p.tailLength * i.tailCurl / 5, 0)
    joint(`tail.${n}`, n === 0 ? 'spine' : `tail.${n - 1}`, offset, limits([-0.6, 0.6], [-0.8, 0.8], [-0.8, 0.8]))
  }
  const palettes = [
    { coat: '#c8b69c', mane: '#e7d7be', undercoat: '#f3ebdf' },
    { coat: '#b7b9aa', mane: '#d8ddce', undercoat: '#eef0e6' },
    { coat: '#c6b6b0', mane: '#e3d6d0', undercoat: '#f1e9e4' },
    { coat: '#b4bfbb', mane: '#d2ded8', undercoat: '#eaf0e9' },
  ]
  const appearance = { ...palettes[i.palette], tail: '#faf7ed', eye: '#28342f', nose: '#65534b', ear: '#bd9689', roughness: 0.88, identity: copy(i) }
  const colliders = [
    { id: 'torso', joint: 'root', shape: 'ellipsoid', offset: [0, 0, 0], radii: vec(p.bodyLength * 0.52, p.bodyHeight * 0.5, p.bodyWidth * 0.5) },
    { id: 'head', joint: 'head', shape: 'ellipsoid', offset: [0, 0, 0], radii: vec(d.headRadius * 1.05, d.headRadius, d.headRadius * 0.94) },
    ...contacts.map(c => ({ id: c.id, joint: c.joint, shape: 'ellipsoid', offset: [0, 0, 0], radii: vec(c.radius * 1.25, footHeight, c.radius) })),
    ...joints.filter(j => j.id.startsWith('tail.')).map((j, index) => ({ id: j.id, joint: j.id, shape: 'sphere', offset: [0, 0, 0], radius: round(p.tailFullness * (1 - index * 0.065)) })),
  ]
  const head = byId.get('head').restWorld, neck = byId.get('neck').restWorld, tip = byId.get('tail.5').restWorld
  const maneRadius = d.headRadius + p.maneFullness
  const halfWidth = Math.max(p.bodyWidth * 0.5, d.headRadius, maneRadius, p.tailFullness)
  const bounds = {
    min: vec(Math.min(-p.bodyLength * 0.52, tip[0] - p.tailFullness, neck[0] - maneRadius), Math.min(0, neck[1] - maneRadius), -halfWidth),
    max: vec(Math.max(head[0] + d.headRadius * 1.2, neck[0] + maneRadius), Math.max(head[1] + d.headRadius + p.earLength, tip[1] + p.tailFullness, neck[1] + maneRadius), halfWidth),
  }
  return {
    schemaVersion: BODY_SCHEMA_VERSION, topology: BODY_TOPOLOGY, bodyRevision: body.bodyRevision,
    contentId: contentId(body), dimensions: d, appearance,
    skeleton: { coordinateSystem: 'x-forward/y-up/z-left', joints }, contacts, colliders,
    // Touch and collision consumers use the same anatomical regions.
    hitRegions: colliders.map(c => ({ ...copy(c), kind: c.id.startsWith('foot.') ? 'paw' : c.id.startsWith('tail.') ? 'tail' : c.id })),
    attachments: [
      { id: 'mane', joint: 'neck', radius: round(d.headRadius + p.maneFullness), identityAnchor: 'maneAsymmetry' },
      ...joints.filter(j => j.id.startsWith('tail.')).map(j => ({ id: `fur.${j.id}`, joint: j.id, radius: p.tailFullness, color: appearance.tail })),
    ],
    bounds,
    motionContract: { version: 'echo-motion/1', topology: BODY_TOPOLOGY, parameterOrder: [...PARAMETER_KEYS], jointOrder: joints.map(j => j.id), contactOrder: contacts.map(c => c.id), floorY: 0, pose: 'local-rest-relative-quaternion-xyzw', timeUnit: 'seconds', root: 'absolute-body-space-position', capabilities: ['look', 'reach', 'settle', 'tail-expression'], requiresMorphologyCondition: true },
  }
}

export function createBodyFromLife(life) {
  validateLife(life)
  const m = getMorphology(life)
  const body = {
    schemaVersion: BODY_SCHEMA_VERSION, species: 'feifei', topology: BODY_TOPOLOGY,
    lifeId: life.id, seed: life.seed, lifeRevision: life.processedEventIds.length, bodyRevision: 0,
    createdAt: life.createdAt, updatedAt: life.updatedAt, identity: identityFor(life.seed),
    parameters: parameters({
      bodyLength: 0.98 + m.elongation * 0.34, bodyWidth: 0.50 + m.spread * 0.20,
      bodyHeight: 0.51 + m.curvature * 0.18, legLength: 0.34 + m.buoyancy * 0.16,
      headScale: 0.92 + (1 - life.genome.base.elongation) * 0.12, earLength: 0.19 + life.genome.base.folds * 0.09,
      tailLength: 0.85 + m.curvature * 0.42 + m.elongation * 0.12,
      tailFullness: 0.16 + m.texture * 0.11, maneFullness: 0.14 + m.folds * 0.12,
    }),
    provenance: { kind: 'legacy-migration', provider: 'echo', model: life.rulesVersion, modelVersion: String(life.version), requestId: `migration:${life.id}` },
    lastGrowth: null, previousBody: null,
  }
  body.descriptor = deriveBodyDescriptor(body)
  body.contentId = body.descriptor.contentId
  return body
}

export function validateBodyState(body, life) {
  assertHeader(body)
  if (life) {
    if (body.lifeId !== life.id || body.seed !== life.seed || body.createdAt !== life.createdAt) fail('身体与生命身份不一致', 'BODY_IDENTITY_MISMATCH')
    if (body.lifeRevision !== life.processedEventIds.length) fail('身体与生命版本不一致', 'BODY_LIFE_REVISION_MISMATCH')
  }
  const expected = deriveBodyDescriptor(body)
  if (body.contentId !== expected.contentId || !equal(body.descriptor, expected)) fail('身体资源与参数不一致', 'BODY_DESCRIPTOR_MISMATCH')
  if (body.bodyRevision === 0) {
    if (body.lastGrowth !== null || body.previousBody !== null || body.provenance.kind !== 'legacy-migration') fail('初始身体记录无效')
  } else {
    object(body.lastGrowth, '已接受的成长')
    if (!body.previousBody) fail('成长缺少上一身体版本')
    const previous = body.previousBody
    // A compact previous snapshot may itself have an earlier accepted growth,
    // but must never recursively carry the entire lifetime.
    if (previous.previousBody !== undefined) fail('上一身体记录不能递归嵌套')
    assertHeader(previous)
    if (previous.lifeId !== body.lifeId || previous.seed !== body.seed || previous.createdAt !== body.createdAt || previous.bodyRevision + 1 !== body.bodyRevision) fail('上一身体版本不一致')
    const previousExpected = deriveBodyDescriptor(previous)
    if (previous.contentId !== previousExpected.contentId || !equal(previous.descriptor, previousExpected)) fail('上一身体资源已损坏')
    const accepted = validateBodyCandidate(previous, body.lastGrowth)
    if (accepted.at !== body.updatedAt || !equal(accepted.parameters, body.parameters) || !equal(accepted.source, body.provenance)) fail('成长决定与当前身体不一致')
    if (life && accepted.evidenceEventIds.some(id => !life.processedEventIds.includes(id))) fail('成长引用了不存在的经历', 'INVALID_GROWTH_EVIDENCE')
  }
  return body
}

/** Normal life events advance the version without manufacturing a growth decision. */
export function synchronizeBodyLifeRevision(body, life) {
  validateBodyState(body)
  if (body.lifeId !== life.id || body.seed !== life.seed || body.createdAt !== life.createdAt) fail('身体与生命身份不一致', 'BODY_IDENTITY_MISMATCH')
  const revision = integer(life.processedEventIds?.length, '生命版本')
  if (revision < body.lifeRevision) fail('不能用旧生命覆盖当前身体', 'STALE_BODY_GROWTH')
  return revision === body.lifeRevision ? body : { ...body, lifeRevision: revision }
}

function normalizeCandidate(body, input) {
  object(input, '成长提案')
  if (input.topology !== undefined && input.topology !== body.topology) fail('成长提案改变了未支持的身体结构', 'UNSUPPORTED_BODY_TOPOLOGY')
  if (input.species !== undefined && input.species !== body.species) fail('成长提案不能更换物种', 'UNSUPPORTED_BODY_TOPOLOGY')
  if (input.lifeId !== undefined && input.lifeId !== body.lifeId) fail('成长提案属于另一个生命', 'BODY_IDENTITY_MISMATCH')
  if (input.identity !== undefined && !equal(input.identity, body.identity)) fail('成长提案改变了先天身份', 'BODY_IDENTITY_MISMATCH')
  const baseLifeRevision = integer(input.baseLifeRevision, '提案生命版本'), baseBodyRevision = integer(input.baseBodyRevision, '提案身体版本')
  if (baseLifeRevision !== body.lifeRevision || baseBodyRevision !== body.bodyRevision) fail('成长提案依据的身体或经历已改变', 'STALE_BODY_GROWTH')
  object(input.parameters, '成长参数')
  const next = parameters({ ...body.parameters, ...input.parameters })
  let changed = false
  for (const key of PARAMETER_KEYS) {
    if (Math.abs(next[key] - body.parameters[key]) > BODY_PARAMETER_LIMITS[key].maxDelta + 1e-7) fail(`一次成长的 ${key} 变化过大`, 'BODY_GROWTH_TOO_LARGE')
    if (next[key] !== body.parameters[key]) changed = true
  }
  if (!changed) fail('成长提案没有改变身体', 'BODY_NO_CHANGE')
  const at = integer(input.at, '成长时间', MAX_DATE)
  if (at < body.updatedAt) fail('成长时间不能倒退')
  if (!Array.isArray(input.evidenceEventIds) || input.evidenceEventIds.length > 32) fail('成长证据应为不超过 32 个经历标识', 'INVALID_GROWTH_EVIDENCE')
  const evidenceEventIds = input.evidenceEventIds.map(id => string(id, '经历标识'))
  if (new Set(evidenceEventIds).size !== evidenceEventIds.length) fail('成长证据包含重复标识', 'INVALID_GROWTH_EVIDENCE')
  return {
    schemaVersion: BODY_SCHEMA_VERSION, id: string(input.id, '提案标识'), at, lifeId: body.lifeId,
    topology: body.topology, baseLifeRevision, baseBodyRevision,
    parameters: next, source: source(input.source), reason: string(input.reason, '成长原因', 600), evidenceEventIds,
  }
}

export function createBodyCandidate(body, input) {
  validateBodyState(body)
  const candidate = normalizeCandidate(body, input)
  // Build the whole candidate now; a successful proposal has one coherent
  // descriptor before any consumer activates it.
  const preview = { ...body, bodyRevision: body.bodyRevision + 1, parameters: candidate.parameters, updatedAt: candidate.at, provenance: candidate.source }
  candidate.contentId = deriveBodyDescriptor(preview).contentId
  return candidate
}

export function validateBodyCandidate(body, input) {
  assertHeader(body)
  object(input, '成长提案')
  if (input.schemaVersion !== BODY_SCHEMA_VERSION) fail('成长提案版本不兼容', 'UNSUPPORTED_BODY_VERSION')
  const candidate = normalizeCandidate(body, input)
  const expected = deriveBodyDescriptor({ ...body, bodyRevision: body.bodyRevision + 1, parameters: candidate.parameters, updatedAt: candidate.at, provenance: candidate.source }).contentId
  if (input.contentId !== expected) fail('成长提案内容已改变', 'BODY_DESCRIPTOR_MISMATCH')
  return { ...candidate, contentId: expected }
}

export function commitBodyCandidate(body, input, { lifeRevision = body.lifeRevision, life } = {}) {
  validateBodyState(body)
  if (body.lastGrowth?.id === input?.id) {
    if (!equal(body.lastGrowth, input)) fail('同一成长标识对应不同内容', 'BODY_PROPOSAL_CONFLICT')
    return body
  }
  if (lifeRevision !== body.lifeRevision || (life && life.processedEventIds.length !== lifeRevision)) fail('生命经历已改变，需要重新评估成长', 'STALE_BODY_GROWTH')
  if (life && (life.id !== body.lifeId || life.seed !== body.seed)) fail('成长不能提交到另一个生命', 'BODY_IDENTITY_MISMATCH')
  const candidate = validateBodyCandidate(body, input)
  if (life && candidate.evidenceEventIds.some(id => !life.processedEventIds.includes(id))) fail('成长引用了不存在的经历', 'INVALID_GROWTH_EVIDENCE')
  const { previousBody: ignored, ...previous } = body
  const next = { ...copy(body), bodyRevision: body.bodyRevision + 1, parameters: copy(candidate.parameters), updatedAt: candidate.at, provenance: copy(candidate.source), lastGrowth: copy(candidate), previousBody: copy(previous) }
  next.descriptor = deriveBodyDescriptor(next)
  next.contentId = next.descriptor.contentId
  validateBodyState(next, life)
  return next
}

/** A renderer can retain world contact targets while adapting the new rest rig. */
export function getBodyTransition(previous, next) {
  validateBodyState(previous); validateBodyState(next)
  if (previous.lifeId !== next.lifeId || previous.seed !== next.seed || previous.topology !== next.topology) fail('不同生命或结构不能进行连续身体过渡', 'UNSUPPORTED_BODY_TOPOLOGY')
  return {
    fromRevision: previous.bodyRevision, toRevision: next.bodyRevision,
    jointIds: [...next.descriptor.motionContract.jointOrder],
    contactIds: [...next.descriptor.motionContract.contactOrder],
    rootHeightDelta: round(next.descriptor.dimensions.rootHeight - previous.descriptor.dimensions.rootHeight),
    lengthRatios: Object.fromEntries(PARAMETER_KEYS.map(key => [key, round(next.parameters[key] / previous.parameters[key])])),
    preserve: ['world-contact-targets', 'look-target', 'root-heading', 'joint-angular-velocity'],
  }
}
