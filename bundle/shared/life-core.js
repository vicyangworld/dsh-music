/**
 * ECHO's versioned, deterministic life rules. No clocks, network, storage, DOM,
 * Node APIs or ambient randomness live here. The host supplies observed events.
 * Three structures are the first renderer's construction grammars, not genres.
 */
export const LIFE_VERSION = 1
export const RULES_VERSION = 'echo-life/1'
export const LIFE_LIMITS = Object.freeze({ events: 100000, memories: 64, timeline: 96 })

const STRUCTURES = ['fold', 'shell', 'ribbon']
const BODY_KEYS = ['elongation', 'spread', 'curvature', 'folds', 'texture', 'warmth', 'buoyancy']
const FEATURE_KEYS = ['energy', 'brightness', 'rhythm', 'texture']
const CHECKPOINT_MS = 5 * 60 * 1000
const TRAIT_TIME_MS = 12 * 60 * 1000
const MAX_DATE = 8640000000000000
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n))
const rounded = (n) => Math.round(clamp(n) * 1e6) / 1e6

export class ValidationError extends Error {
  constructor(message, code = 'INVALID_LIFE_EVENT') {
    super(message)
    this.name = 'ValidationError'
    this.code = code
  }
}

function fail(message, code) { throw new ValidationError(message, code) }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value
}
function text(value, label, max, optional = false, multiline = false) {
  if (optional && (value === undefined || value === null || value === '')) return ''
  if (typeof value !== 'string') fail(`${label}必须是文字`)
  const clean = value.trim().normalize('NFC')
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/
  if ((!optional && !clean) || clean.length > max || controls.test(clean)) fail(`${label}为空、过长或包含无效字符`)
  return clean
}
function number(value, label, min = 0, max = 1, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
    fail(`${label}不是有效数值`)
  }
  return value
}
function timestamp(value) { return number(value, '时间', 0, MAX_DATE, true) }
function validatePattern(pattern) {
  if (!Array.isArray(pattern) || pattern.length < 2 || pattern.length > 8) fail('招呼需要 2 至 8 个敲击间隔')
  return pattern.map((n) => Math.round(number(n, '敲击间隔', 50, 5000)))
}
function track(value) {
  object(value, '歌曲')
  return {
    id: text(value.id, '歌曲标识', 160),
    title: text(value.title, '歌名', 160),
    artist: text(value.artist, '歌手', 160, true),
  }
}

/** A stable identity hash, not a security or globally unique-ID claim. */
function hash(value, basis = 2166136261) {
  let h = basis >>> 0
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}
function fieldHash(seed, label) {
  // Give each field its own starting state before consuming the full seed.
  // Hashing seed + label would make one 32-bit seed-prefix collision collapse
  // every body dimension at once. Domain separation avoids that shared state;
  // it is deterministic variation, not a cryptographic uniqueness guarantee.
  return hash(seed, hash(`echo-life/1:${label}`, 0x9e3779b9))
}
function unit(seed, label) { return fieldHash(seed, label) / 4294967295 }
function identity(seed) {
  return `echo-${hash(seed).toString(16).padStart(8, '0')}${hash(seed, 0x9e3779b9).toString(16).padStart(8, '0')}`
}
function genomeFor(seed) {
  return {
    structure: STRUCTURES[fieldHash(seed, 'structure') % STRUCTURES.length],
    base: Object.fromEntries(BODY_KEYS.map((key) => [key, rounded(0.28 + unit(seed, key) * 0.44)])),
    response: Object.fromEntries(BODY_KEYS.map((key) => [key, rounded(0.55 + unit(seed, `response:${key}`) * 0.45)])),
    phase: rounded(unit(seed, 'phase')),
    accent: rounded(unit(seed, 'accent')),
  }
}

/** Validate and copy only supported fields; metadata never becomes audio data. */
export function validateLifeEvent(input) {
  object(input, '事件')
  const event = { id: text(input.id, '事件标识', 160), type: text(input.type, '事件类型', 24), at: timestamp(input.at) }
  switch (event.type) {
    case 'listening': {
      event.sessionId = text(input.sessionId, '播放时段标识', 160)
      event.track = track(input.track)
      event.listenedMs = number(input.listenedMs, '有效播放时长', 1, 60000, true)
      if (!['audio', 'none'].includes(input.featureSource)) fail('需要注明音频特征来源')
      event.featureSource = input.featureSource
      if (event.featureSource === 'audio') {
        object(input.features, '音频特征')
        event.features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, number(input.features[key], `音频特征 ${key}`)]))
      } else if (input.features !== undefined && input.features !== null) {
        fail('没有实际音频特征时，不能提交推测的音频特征')
      }
      break
    }
    case 'share':
      event.title = text(input.title, '歌名', 160)
      event.artist = text(input.artist, '歌手', 160, true)
      event.note = text(input.note, '分享记录', 1000, true, true)
      break
    case 'greeting':
      event.pattern = validatePattern(input.pattern)
      break
    case 'interaction':
      if (!['touch', 'greet', 'rest'].includes(input.action)) fail('不支持这个互动动作')
      event.action = input.action
      break
    case 'memory':
      event.title = text(input.title, '记忆标题', 160)
      event.note = text(input.note, '记忆内容', 1000, true, true)
      if (input.track !== undefined && input.track !== null) event.track = track(input.track)
      break
    case 'rename':
      event.name = text(input.name, '名字', 40)
      break
    default:
      fail('不支持这个生命事件')
  }
  return event
}

function assertCore(life) {
  object(life, '生命档案')
  if (life.version !== LIFE_VERSION || life.rulesVersion !== RULES_VERSION) fail('生命规则版本不兼容', 'UNSUPPORTED_LIFE_VERSION')
  const seed = text(life.seed, '生命种子', 128)
  if (life.id !== identity(seed)) fail('生命身份与种子不一致', 'INVALID_LIFE_STATE')
  text(life.name, '名字', 40)
  timestamp(life.createdAt)
  timestamp(life.updatedAt)
  if (life.updatedAt < life.createdAt) fail('生命档案时间倒退', 'INVALID_LIFE_STATE')
  object(life.genome, '先天形态')
  if (!STRUCTURES.includes(life.genome.structure)) fail('未知的身体结构', 'INVALID_LIFE_STATE')
  for (const key of BODY_KEYS) {
    number(life.genome.base?.[key], `先天形态 ${key}`)
    number(life.genome.response?.[key], `生长响应 ${key}`)
  }
  number(life.genome.phase, '动作签名')
  number(life.genome.accent, '外观签名')
  object(life.growth, '成长状态')
  number(life.growth.audioMs, '音频观察时长', 0, Number.MAX_SAFE_INTEGER, true)
  number(life.growth.lastCheckpointAudioMs, '成长节点时长', 0, life.growth.audioMs, true)
  for (const key of FEATURE_KEYS) number(life.growth.traits?.[key], `成长特征 ${key}`)
  object(life.stats, '经历统计')
  for (const key of ['listenedMs', 'listeningSessions', 'interactions', 'sharedSongs']) {
    number(life.stats[key], `经历统计 ${key}`, 0, Number.MAX_SAFE_INTEGER, true)
  }
  if (life.growth.audioMs > life.stats.listenedMs) fail('音频观察时长超过播放时长', 'INVALID_LIFE_STATE')
  for (const [key, max] of [['processedEventIds', LIFE_LIMITS.events], ['listeningSessionIds', LIFE_LIMITS.events], ['memories', LIFE_LIMITS.memories], ['timeline', LIFE_LIMITS.timeline]]) {
    if (!Array.isArray(life[key]) || life[key].length > max) fail(`${key}超出档案限制`, 'INVALID_LIFE_STATE')
  }
  if (life.greeting !== null) {
    object(life.greeting, '专属招呼')
    validatePattern(life.greeting.pattern)
    timestamp(life.greeting.learnedAt)
    text(life.greeting.eventId, '招呼事件', 160)
    number(life.greeting.recognitions, '招呼回应次数', 0, Number.MAX_SAFE_INTEGER, true)
  }
  for (const memory of life.memories) {
    object(memory, '共同记忆')
    text(memory.id, '记忆标识', 160)
    text(memory.title, '记忆标题', 160)
    text(memory.note, '记忆内容', 1000, true, true)
    timestamp(memory.at)
    if (memory.track) track(memory.track)
  }
  return life
}

function validateMorphology(morphology) {
  object(morphology, '历史形态')
  if (!STRUCTURES.includes(morphology.structure)) fail('历史身体结构无效', 'INVALID_LIFE_STATE')
  for (const key of ['seed', ...BODY_KEYS, 'phase', 'accent']) number(morphology[key], `历史形态 ${key}`)
  if (!Array.isArray(morphology.marks) || morphology.marks.length > 8) fail('历史身体标记无效', 'INVALID_LIFE_STATE')
  for (const mark of morphology.marks) {
    text(mark.id, '身体标记', 160)
    number(mark.position, '身体标记位置')
    number(mark.strength, '身体标记强度')
  }
}

/** Full validation for persisted snapshots. Invoke once on load, not per frame. */
export function validateLife(life) {
  assertCore(life)
  for (const key of ['processedEventIds', 'listeningSessionIds']) {
    for (const id of life[key]) text(id, key, 160)
    if (new Set(life[key]).size !== life[key].length) fail(`${key}包含重复标识`, 'INVALID_LIFE_STATE')
  }
  if (life.stats.listeningSessions !== life.listeningSessionIds.length) fail('播放时段统计与记录不符', 'INVALID_LIFE_STATE')
  if (new Set(life.memories.map((m) => m.id)).size !== life.memories.length) fail('共同记忆包含重复标识', 'INVALID_LIFE_STATE')
  if (!life.timeline.length || life.timeline[0].kind !== 'birth') fail('缺少初生档案', 'INVALID_LIFE_STATE')
  const expectedGenome = genomeFor(life.seed)
  for (const key of ['structure', 'phase', 'accent']) {
    if (life.genome[key] !== expectedGenome[key]) fail('先天身份数据已改变', 'INVALID_LIFE_STATE')
  }
  for (const group of ['base', 'response']) for (const key of BODY_KEYS) {
    if (life.genome[group][key] !== expectedGenome[group][key]) fail('先天身份数据已改变', 'INVALID_LIFE_STATE')
  }
  for (const memory of life.memories) {
    if (memory.at < life.createdAt || memory.at > life.updatedAt) fail('共同记忆时间超出档案范围', 'INVALID_LIFE_STATE')
  }
  if (life.greeting && (life.greeting.learnedAt < life.createdAt || life.greeting.learnedAt > life.updatedAt)) fail('招呼时间超出档案范围', 'INVALID_LIFE_STATE')
  for (const point of life.timeline) {
    object(point, '成长节点')
    text(point.id, '成长节点标识', 180)
    timestamp(point.at)
    if (point.at < life.createdAt || point.at > life.updatedAt) fail('成长节点时间超出档案范围', 'INVALID_LIFE_STATE')
    text(point.kind, '成长节点类型', 24)
    text(point.reason, '成长节点说明', 160)
    if (point.eventId !== null) text(point.eventId, '成长节点事件', 160)
    validateMorphology(point.morphology)
    if (point.morphology.structure !== life.genome.structure) fail('成长节点改变了先天身体结构', 'INVALID_LIFE_STATE')
    if (point.morphology.phase !== life.genome.phase || point.morphology.accent !== life.genome.accent || point.morphology.seed !== rounded(unit(life.seed, 'render'))) fail('成长节点改变了身份签名', 'INVALID_LIFE_STATE')
  }
  number(life.timelineOmitted, '已归并节点数', 0, Number.MAX_SAFE_INTEGER, true)
  return life
}

export function createLife({ seed, now, name = '音灵' } = {}) {
  seed = text(seed, '生命种子', 128)
  now = timestamp(now)
  name = text(name, '名字', 40)
  const life = {
    version: LIFE_VERSION,
    rulesVersion: RULES_VERSION,
    id: identity(seed), seed, name, createdAt: now, updatedAt: now,
    genome: genomeFor(seed),
    growth: { audioMs: 0, traits: Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0.5])), lastCheckpointAudioMs: 0 },
    stats: { listenedMs: 0, listeningSessions: 0, interactions: 0, sharedSongs: 0 },
    greeting: null,
    memories: [], timeline: [], timelineOmitted: 0,
    processedEventIds: [], listeningSessionIds: [],
  }
  life.timeline.push({ id: 'birth', at: now, kind: 'birth', reason: '初次相遇', eventId: null, morphology: getMorphology(life) })
  return life
}

const RESPONSE_WEIGHTS = {
  elongation: [0.4, 0.15, 0.3, 0.15],
  spread: [0.1, 0.35, 0.35, 0.2],
  curvature: [-0.25, 0.15, -0.15, 0.45],
  folds: [0.15, 0.1, 0.5, 0.25],
  texture: [0.1, 0.2, 0.15, 0.55],
  warmth: [-0.25, -0.35, 0.1, 0.3],
  buoyancy: [0.3, 0.4, 0.1, -0.2],
}

/** Small stable seed-dependent response differences, bounded around the same body. */
export function getMorphology(life) {
  assertCore(life)
  const maturity = 1 - Math.exp(-life.growth.audioMs / (30 * 60 * 1000))
  const centered = FEATURE_KEYS.map((k) => life.growth.traits[k] * 2 - 1)
  const morphology = {
    structure: life.genome.structure,
    seed: rounded(unit(life.seed, 'render')),
  }
  for (const key of BODY_KEYS) {
    const response = RESPONSE_WEIGHTS[key].reduce((sum, weight, i) => sum + weight * centered[i], 0)
    morphology[key] = rounded(life.genome.base[key] + response * maturity * life.genome.response[key] * 0.24)
  }
  morphology.phase = life.genome.phase
  morphology.accent = life.genome.accent
  // Eight legible bodily marks; all memories remain in the archive. No badges,
  // score or invented significance is added to these user-selected moments.
  morphology.marks = life.memories.slice(-8).map((memory) => ({
    id: memory.id,
    position: rounded(unit(life.seed, `mark:${memory.id}`)),
    strength: rounded(0.45 + unit(life.seed, `mark-strength:${memory.id}`) * 0.4),
  }))
  return morphology
}

function checkpoint(life, event, reason) {
  life.timeline.push({
    id: `point:${event.id}`, at: event.at, kind: event.type, reason,
    eventId: event.id, morphology: getMorphology(life),
  })
  if (life.timeline.length > LIFE_LIMITS.timeline) {
    // Keep birth, all explicit memories (capped at 64), and the newest point.
    // Older passive checkpoints are compacted first, then older greetings.
    let index = life.timeline.findIndex((point, i) => i > 0 && i < life.timeline.length - 1 && point.kind === 'listening')
    if (index < 0) index = life.timeline.findIndex((point, i) => i > 0 && i < life.timeline.length - 1 && point.kind !== 'memory')
    if (index < 0) index = 1
    life.timeline.splice(index, 1)
    life.timelineOmitted++
  }
}

export function applyLifeEvent(life, input) {
  assertCore(life)
  object(input, '事件')
  const id = text(input.id, '事件标识', 160)
  // Exactly-once identity is checked before body validation: a retried event
  // cannot change meaning or become invalid because client metadata changed.
  if (life.processedEventIds.includes(id)) return life
  if (life.processedEventIds.length >= LIFE_LIMITS.events) fail('生命档案已达到本版事件上限，请先导出档案', 'LIFE_EVENT_LIMIT')
  const event = validateLifeEvent(input)
  if (event.at < life.createdAt) fail('事件时间早于生命诞生时间')
  if (event.type === 'memory' && life.memories.length >= LIFE_LIMITS.memories) fail('本版最多保留 64 段共同记忆', 'LIFE_MEMORY_LIMIT')
  const next = {
    ...life,
    updatedAt: Math.max(life.updatedAt, event.at),
    stats: { ...life.stats },
    growth: { ...life.growth, traits: { ...life.growth.traits } },
    greeting: life.greeting ? { ...life.greeting, pattern: [...life.greeting.pattern] } : null,
    memories: [...life.memories], timeline: [...life.timeline],
    processedEventIds: [...life.processedEventIds, id],
    listeningSessionIds: [...life.listeningSessionIds],
  }
  switch (event.type) {
    case 'listening': {
      next.stats.listenedMs = number(next.stats.listenedMs + event.listenedMs, '累计播放时长', 0, Number.MAX_SAFE_INTEGER, true)
      if (!next.listeningSessionIds.includes(event.sessionId)) {
        next.listeningSessionIds.push(event.sessionId)
        next.stats.listeningSessions++
      }
      if (event.featureSource === 'audio') {
        const alpha = 1 - Math.exp(-event.listenedMs / TRAIT_TIME_MS)
        for (const key of FEATURE_KEYS) next.growth.traits[key] += alpha * (event.features[key] - next.growth.traits[key])
        next.growth.audioMs = number(next.growth.audioMs + event.listenedMs, '累计音频观察时长', 0, Number.MAX_SAFE_INTEGER, true)
        if (next.growth.audioMs - next.growth.lastCheckpointAudioMs >= CHECKPOINT_MS) {
          next.growth.lastCheckpointAudioMs = next.growth.audioMs
          checkpoint(next, event, '共同聆听中的变化')
        }
      }
      break
    }
    case 'share':
      next.stats.sharedSongs = number(next.stats.sharedSongs + 1, '分享次数', 0, Number.MAX_SAFE_INTEGER, true)
      break
    case 'greeting':
      next.greeting = { pattern: event.pattern, learnedAt: event.at, eventId: event.id, recognitions: 0 }
      checkpoint(next, event, '学会了你的招呼')
      break
    case 'interaction':
      next.stats.interactions = number(next.stats.interactions + 1, '互动次数', 0, Number.MAX_SAFE_INTEGER, true)
      if (event.action === 'greet' && next.greeting) next.greeting.recognitions = number(next.greeting.recognitions + 1, '招呼回应次数', 0, Number.MAX_SAFE_INTEGER, true)
      break
    case 'memory':
      next.memories.push({ id: event.id, title: event.title, note: event.note, at: event.at, ...(event.track ? { track: event.track } : {}) })
      checkpoint(next, event, event.title)
      break
    case 'rename':
      next.name = event.name
      break
  }
  return next
}

export function replayLife(initial, events) {
  validateLife(initial)
  if (!Array.isArray(events)) fail('经历列表必须是数组')
  return events.reduce((life, event) => applyLifeEvent(life, event), initial)
}
