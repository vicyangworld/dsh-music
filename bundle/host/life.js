/** Persistent ECHO identity and event journal. No remote services are involved.
 * One atomic file contains the birth state, accepted events and latest state;
 * an acknowledgement is sent only after that file has been replaced.
 */
import { open, readFile, rename, unlink, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  createLife as createInitialLife,
  applyLifeEvent,
  getMorphology,
  validateLife,
  validateLifeEvent,
  ValidationError,
} from '../shared/life-core.js'

const ARCHIVE_FORMAT = 'echo-life-archive'
const ARCHIVE_VERSION = 1
const DEFAULT_MAX_EVENTS = 100000
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const BODY_LIMIT = 64 * 1024
const FUTURE_TOLERANCE = 5 * 60 * 1000
const EVENT_TYPES = new Set(['listening', 'share', 'greeting', 'interaction', 'memory', 'rename'])

export class LifeServiceError extends Error {
  constructor(message, code = 'LIFE_SERVICE_ERROR', status = 503) {
    super(message)
    this.name = 'LifeServiceError'
    this.code = code
    this.status = status
  }
}

function digest(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function withChecksum(payload) {
  return { ...payload, checksum: digest(payload) }
}

function clone(value) {
  return structuredClone(value)
}

function badArchive() {
  return new LifeServiceError('生命档案校验失败。原文件已保留，请先备份后恢复档案。', 'LIFE_ARCHIVE_INVALID')
}

function asServiceError(err) {
  if (err instanceof LifeServiceError) return err
  if (err instanceof ValidationError || err?.code === 'INVALID_LIFE_EVENT') {
    return new LifeServiceError(err.message, err.code || 'INVALID_LIFE_EVENT', /_LIMIT$/.test(err.code || '') ? 409 : 400)
  }
  return new LifeServiceError('生命档案暂时无法保存或读取，请检查本地存储后重试。', 'LIFE_STORAGE_UNAVAILABLE')
}

/** The optional clock/seed factory/limits make persistence failure and replay
 * tests reproducible. They are not exposed as request parameters. */
export function createLifeService({ storage, library, logger, now = Date.now, seedFactory = () => randomBytes(24).toString('hex'), limits = {} }) {
  const file = join(storage.dataDir, 'echo-life.json')
  const maxEvents = Math.min(DEFAULT_MAX_EVENTS, Math.max(1, Number.isInteger(limits.events) ? limits.events : DEFAULT_MAX_EVENTS))
  const maxBytes = Math.min(DEFAULT_MAX_BYTES, Math.max(1024, Number.isInteger(limits.bytes) ? limits.bytes : DEFAULT_MAX_BYTES))
  let archive = null
  let eventIds = new Set()
  let tail = Promise.resolve()

  function serialized(work) {
    const next = tail.then(work)
    // A failed write must not poison subsequent reads/retries.
    tail = next.then(() => undefined, () => undefined)
    return next.catch((err) => { throw asServiceError(err) })
  }

  function clock() {
    const at = now()
    if (!Number.isSafeInteger(at) || at < 0 || at > 8.64e15) {
      throw new LifeServiceError('系统时间不可用，生命档案未更改。', 'LIFE_CLOCK_INVALID')
    }
    return at
  }

  async function persist(payload) {
    const next = withChecksum(payload)
    const bytes = JSON.stringify(next)
    if (Buffer.byteLength(bytes) > maxBytes) {
      throw new LifeServiceError('生命档案已达到当前版本的容量上限。请导出备份；现有生命和记忆仍可查看。', 'LIFE_CAPACITY_REACHED', 409)
    }
    await storage.ready
    await mkdir(storage.dataDir, { recursive: true, mode: 0o700 })
    const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`
    let handle
    try {
      handle = await open(tmp, 'wx', 0o600)
      await handle.writeFile(bytes, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      await rename(tmp, file)
      // Directory fsync is unsupported on some host filesystems. Once rename
      // succeeds the committed state is authoritative; never claim a rollback.
      let directory
      try {
        directory = await open(storage.dataDir, 'r')
        await directory.sync()
      } catch {
        logger?.warn?.('dsh-music: 当前文件系统不支持生命档案目录同步。')
      } finally {
        await directory?.close().catch(() => {})
      }
      return next
    } catch (err) {
      await handle?.close().catch(() => {})
      await unlink(tmp).catch(() => {})
      throw err
    }
  }

  function checkArchive(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw badArchive()
    if (value.format !== ARCHIVE_FORMAT || value.version !== ARCHIVE_VERSION) {
      throw new LifeServiceError('这个生命档案来自其他版本。原文件已保留，请使用兼容版本打开。', 'LIFE_ARCHIVE_VERSION', 409)
    }
    const { checksum, ...payload } = value
    if (typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum) || digest(payload) !== checksum) throw badArchive()
    if (!Array.isArray(value.events) || value.events.length > DEFAULT_MAX_EVENTS) throw badArchive()
    try {
      validateLife(value.initial)
      validateLife(value.life)
      if (value.initial.processedEventIds.length !== 0
          || value.initial.id !== value.life.id
          || value.initial.seed !== value.life.seed
          || value.initial.createdAt !== value.life.createdAt
          || JSON.stringify(value.initial.genome) !== JSON.stringify(value.life.genome)
          || value.life.processedEventIds.length !== value.events.length) throw badArchive()
      const ids = new Set()
      for (let i = 0; i < value.events.length; i++) {
        const event = validateLifeEvent(value.events[i])
        if (ids.has(event.id) || event.id !== value.life.processedEventIds[i]) throw badArchive()
        ids.add(event.id)
      }
      return ids
    } catch {
      throw badArchive()
    }
  }

  async function load() {
    if (archive) return archive
    await storage.ready
    let text
    try {
      const info = await stat(file)
      if (!info.isFile() || info.size > DEFAULT_MAX_BYTES) throw badArchive()
      text = await readFile(file, 'utf8')
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err
      const initial = createInitialLife({ seed: seedFactory(), now: clock() })
      const payload = { format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, initial, events: [], life: initial }
      const saved = await persist(payload)
      archive = saved
      eventIds = new Set()
      return archive
    }
    let parsed
    try { parsed = JSON.parse(text) } catch { throw badArchive() }
    const ids = checkArchive(parsed)
    archive = parsed
    eventIds = ids
    return archive
  }

  function snapshot(duplicate) {
    const result = { life: clone(archive.life), morphology: getMorphology(archive.life) }
    if (typeof duplicate === 'boolean') result.duplicate = duplicate
    return result
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !EVENT_TYPES.has(raw.type)) {
      throw new LifeServiceError('生命事件格式不正确。', 'INVALID_LIFE_EVENT', 400)
    }
    const receivedAt = clock()
    if (!Number.isSafeInteger(raw.at) || raw.at < 0 || raw.at > receivedAt + FUTURE_TOLERANCE) {
      throw new LifeServiceError('事件时间无效，请检查系统时间后重试。', 'INVALID_LIFE_EVENT', 400)
    }
    // Keep arrival order, tolerate small client clock differences and delayed
    // delivery, and never let client timestamps push growth into the future.
    const event = { ...raw, at: Math.max(archive.life.updatedAt, archive.life.createdAt, Math.min(receivedAt, raw.at)) }
    if (event.type === 'listening') {
      const trackId = event.track?.id
      if (typeof trackId !== 'string' || !/^[a-f0-9]{8,64}$/.test(trackId)) {
        throw new LifeServiceError('只能记录本地曲库中的播放。', 'UNKNOWN_LIFE_TRACK', 404)
      }
      const record = library?.getRecord?.(trackId)
      if (!record) {
        throw new LifeServiceError('这首歌不在当前本地曲库中；没有计入共同聆听。', 'UNKNOWN_LIFE_TRACK', 404)
      }
      event.track = {
        id: trackId,
        title: String(record.meta?.title || record.title || '未知标题').slice(0, 160),
        artist: String(record.meta?.artist || record.artist || '未知歌手').slice(0, 120),
      }
    }
    // The core validates all numeric ranges and only keeps supported fields.
    return validateLifeEvent(event)
  }

  function get() {
    return serialized(async () => { await load(); return snapshot() })
  }

  function append(raw) {
    return serialized(async () => {
      await load()
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.id !== 'string' || !EVENT_TYPES.has(raw.type)) {
        throw new LifeServiceError('生命事件格式不正确。', 'INVALID_LIFE_EVENT', 400)
      }
      const id = raw.id.trim().normalize('NFC')
      if (!id || id.length > 160 || /[\u0000-\u001f\u007f]/.test(id)) {
        throw new LifeServiceError('生命事件标识无效。', 'INVALID_LIFE_EVENT', 400)
      }
      // Recognize retries before normalizing their timestamp or consulting a
      // library that may have been rescanned since the original accepted event.
      if (eventIds.has(id)) return snapshot(true)
      if (archive.events.length >= maxEvents) {
        throw new LifeServiceError('生命事件已达到当前版本的容量上限。请导出备份；现有生命和记忆仍可查看。', 'LIFE_CAPACITY_REACHED', 409)
      }
      const event = normalize({ ...raw, id })
      const nextLife = applyLifeEvent(archive.life, event)
      const payload = {
        format: ARCHIVE_FORMAT,
        version: ARCHIVE_VERSION,
        initial: archive.initial,
        events: [...archive.events, event],
        life: nextLife,
      }
      const saved = await persist(payload)
      // Never expose an in-memory state which has not been durably committed.
      archive = saved
      eventIds.add(event.id)
      return snapshot(false)
    })
  }

  function exportArchive() {
    return serialized(async () => { await load(); return clone(archive) })
  }

  return { file, get, append, exportArchive }
}

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    let finished = false
    const chunks = []
    req.on('data', (chunk) => {
      if (finished) return
      size += chunk.length
      if (size > BODY_LIMIT) {
        finished = true
        chunks.length = 0
        reject(new LifeServiceError('这条记录过长，请缩短后重试。', 'LIFE_REQUEST_TOO_LARGE', 413))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (finished) return
      finished = true
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new LifeServiceError('请求体不是合法 JSON。', 'INVALID_LIFE_EVENT', 400)) }
    })
    req.on('error', (err) => { if (!finished) { finished = true; reject(err) } })
    req.on('aborted', () => { if (!finished) { finished = true; reject(new LifeServiceError('请求已中断，请重试。', 'LIFE_REQUEST_ABORTED', 400)) } })
  })
}

export function registerLifeRoutes(webServer, { life, logger }) {
  const routes = [
    ['/dsh-music/api/life', 'GET', async (_req, res) => sendJson(res, 200, await life.get())],
    ['/dsh-music/api/life/events', 'POST', async (req, res) => {
      const contentType = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        return sendJson(res, 415, { error: '请使用 JSON 格式提交生命事件。', code: 'LIFE_CONTENT_TYPE' })
      }
      return sendJson(res, 200, await life.append(await readBody(req)))
    }],
    ['/dsh-music/api/life/export', 'GET', async (_req, res) => {
      const archive = await life.exportArchive()
      return sendJson(res, 200, archive, { 'Content-Disposition': 'attachment; filename="echo-life.json"' })
    }],
  ]
  return routes.map(([path, method, handler]) => webServer.register({
    kind: 'exact', path,
    handler: async (req, res) => {
      if (req.method !== method) return sendJson(res, 405, { error: '方法不允许。', code: 'LIFE_METHOD_NOT_ALLOWED' }, { Allow: method })
      try { return await handler(req, res) }
      catch (err) {
        const failure = asServiceError(err)
        if (failure.status >= 500) logger?.warn?.(`dsh-music: 生命服务错误 ${failure.code}`)
        if (!res.headersSent && !res.destroyed) return sendJson(res, failure.status, { error: failure.message, code: failure.code })
      }
    },
  }))
}
