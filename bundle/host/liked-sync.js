/** 国内平台喜欢列表只读导入（QQ音乐 / 网易云）：编排 + 路由（三期扩展，十一期）。
 * - 账号：网易云扫码登录（拿 MUSIC_U cookie）、QQ 音乐扫码登录（qqlogin.js，走 QQ 音乐网页版同款链路）或粘贴 Cookie；
 *   凭据由 accounts.js 以 0600 存本机，cookie 不进日志、不进任何响应。
 * - 同步：拉取平台「喜欢」→ likes.importItems 只打 ♥（不下载、不写平台账号）→ 记录平台 id 做增量：
 *   云端移除只报数，本地标记与文件一律保留。状态文件 ~/.dsh/dsh-music/liked-sync.json。
 * - 红线：绝不调用任何写接口；绝不经这两个平台拉取音源（音源仍只走既有验证下载管线）。
 * - 可选开关：config.likedSync === false 时整个模块关闭，仅 status 返回 enabled:false（前端据此隐藏入口）。 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { cleanText } from './providers/common.js'
import { likeKey } from './likes.js'

export const PROVIDERS = { netease: { label: '网易云音乐' }, qq: { label: 'QQ 音乐' } }
const QR_SESSION_TTL_MS = 10 * 60 * 1000
const QR_SESSION_MAX = 8
const REMOVED_PREVIEW = 10

function fail(message, status) {
  const e = new Error(message)
  e.status = status
  throw e
}

function normalizeState(saved) {
  if (!saved || typeof saved !== 'object') return { ids: [], known: {}, lastSyncAt: null, lastResult: null }
  return {
    ids: Array.isArray(saved.ids) ? saved.ids.map(String) : [],
    known: saved.known && typeof saved.known === 'object' ? saved.known : {},
    lastSyncAt: Number(saved.lastSyncAt) || null,
    lastResult: saved.lastResult && typeof saved.lastResult === 'object' ? saved.lastResult : null,
  }
}

export function createLikedSync({ likes, accounts, storage, logger, netease, qqmusic, qqlogin, onImported }) {
  const warn = (msg) => logger?.warn?.(msg)
  const stateFile = () => join(storage.dataDir, 'liked-sync.json')
  const busy = { netease: false, qq: false }
  const qrSessions = new Map() // 网易云 key -> createdAt
  const qqSessions = new Map() // QQ 扫码 key -> { createdAt, qrsig, cookies }（只在内存）
  let state = null
  let stateChain = Promise.resolve()

  async function loadState() {
    if (state) return state
    const saved = await storage.readJson(stateFile(), null)
    state = { v: 1, netease: normalizeState(saved && saved.netease), qq: normalizeState(saved && saved.qq) }
    return state
  }

  function persistState() {
    const data = state
    const write = stateChain.then(() => storage.writeJson(stateFile(), data))
    stateChain = write.catch((err) => warn(`dsh-music: 写 liked-sync.json 失败: ${err.message}`))
    return write
  }

  /** 换账号 / 断开时清掉该平台的增量状态，避免把“另一个账号的移除”误报出来；不动 ♥ 标记。 */
  function resetProviderState(provider) {
    if (state && state[provider]) state[provider] = { ids: [], known: {}, lastSyncAt: null, lastResult: null }
  }

  function assertProvider(provider) {
    if (!provider || !PROVIDERS[provider]) fail('未知平台', 404)
  }

  async function status() {
    const [summary, st] = await Promise.all([accounts.summary(), loadState()])
    const providers = {}
    for (const key of Object.keys(PROVIDERS)) {
      const account = summary[key]
      const s = st[key]
      providers[key] = {
        label: PROVIDERS[key].label,
        connected: Boolean(account),
        account: account ? { uid: account.uid, nickname: account.nickname, loginAt: account.loginAt } : null,
        busy: busy[key],
        lastSyncAt: s.lastSyncAt,
        lastResult: s.lastResult,
        knownCount: Object.keys(s.known).length,
      }
    }
    return { enabled: true, providers }
  }

  // ---------- 网易云扫码 ----------
  async function neteaseQrCreate() {
    const created = await netease.qrKey()
    const now = Date.now()
    for (const [k, at] of qrSessions) if (now - at > QR_SESSION_TTL_MS) qrSessions.delete(k)
    while (qrSessions.size >= QR_SESSION_MAX) qrSessions.delete(qrSessions.keys().next().value)
    qrSessions.set(created.key, now)
    return { key: created.key, url: created.url }
  }

  async function neteaseQrPoll(key) {
    const k = typeof key === 'string' ? key.trim() : ''
    const createdAt = qrSessions.get(k)
    if (!k || k.length > 64 || createdAt === undefined) fail('二维码会话已过期，请重新生成', 404)
    if (Date.now() - createdAt > QR_SESSION_TTL_MS) {
      qrSessions.delete(k)
      fail('二维码会话已过期，请重新生成', 404)
    }
    const polled = await netease.qrPoll(k)
    if (polled.code !== 803) return { code: polled.code, message: polled.message }
    const account = await netease.account(polled.cookie)
    const previous = await accounts.get('netease')
    await accounts.set('netease', { uid: account.uid, nickname: account.nickname, cookie: polled.cookie })
    await loadState()
    if (!previous || previous.uid !== account.uid) resetProviderState('netease')
    qrSessions.delete(k)
    return { code: 803, message: polled.message, account: { uid: account.uid, nickname: account.nickname } }
  }

  // ---------- QQ 音乐扫码（手机 QQ 扫；微信登录的账号仍走 Cookie） ----------
  async function qqQrCreate() {
    if (!qqlogin) fail('QQ 扫码登录未启用', 503)
    const created = await qqlogin.qrCreate()
    const key = randomUUID()
    const now = Date.now()
    for (const [k, sess] of qqSessions) if (now - sess.createdAt > QR_SESSION_TTL_MS) qqSessions.delete(k)
    while (qqSessions.size >= QR_SESSION_MAX) qqSessions.delete(qqSessions.keys().next().value)
    qqSessions.set(key, { createdAt: now, qrsig: created.qrsig, loginSig: created.loginSig || '', cookies: created.cookies, jar: created.jar || null })
    // 二维码内容（模块矩阵 / PNG data URL）随 key 一起下发；qrsig 等不出内存
    return { key, matrix: created.matrix, png: created.png }
  }

  async function qqQrPoll(key) {
    if (!qqlogin) fail('QQ 扫码登录未启用', 503)
    const k = typeof key === 'string' ? key.trim() : ''
    const session = qqSessions.get(k)
    if (!k || k.length > 64 || !session) fail('二维码会话已过期，请重新生成', 404)
    if (Date.now() - session.createdAt > QR_SESSION_TTL_MS) {
      qqSessions.delete(k)
      fail('二维码会话已过期，请重新生成', 404)
    }
    const polled = await qqlogin.qrPoll(session)
    if (polled.code === 800 || polled.code === 804) qqSessions.delete(k)
    if (polled.code !== 803) return { code: polled.code, message: polled.message }
    const probed = await qqmusic.probe(polled.cookie) // 401：换到的登录态读不到账号 → 让用户重扫
    const previous = await accounts.get('qq')
    await accounts.set('qq', { uid: probed.uin, nickname: probed.nickname, cookie: probed.cookie })
    await loadState()
    if (!previous || previous.uid !== probed.uin) resetProviderState('qq')
    qqSessions.delete(k)
    return { code: 803, message: polled.message, account: { uid: probed.uin, nickname: probed.nickname } }
  }

  // ---------- QQ 音乐 Cookie ----------
  async function qqConnect(body = {}) {
    const cookie = typeof body.cookie === 'string' ? body.cookie : ''
    if (!cookie.trim()) fail('请粘贴 y.qq.com 的 Cookie', 400)
    const probed = await qqmusic.probe(cookie) // 400 解析失败 / 401 登录态失效
    const previous = await accounts.get('qq')
    await accounts.set('qq', { uid: probed.uin, nickname: probed.nickname, cookie: probed.cookie })
    await loadState()
    if (!previous || previous.uid !== probed.uin) resetProviderState('qq')
    return { account: { uid: probed.uin, nickname: probed.nickname }, likedDir: probed.likedDir }
  }

  async function refresh(provider) {
    assertProvider(provider)
    const account = await accounts.get(provider)
    if (!account) fail(`请先登录${PROVIDERS[provider].label}`, 401)
    if (provider === 'netease') {
      const info = await netease.account(account.cookie)
      await accounts.set('netease', { uid: info.uid, nickname: info.nickname, cookie: account.cookie, loginAt: account.loginAt })
      return { account: { uid: info.uid, nickname: info.nickname } }
    }
    const probed = await qqmusic.probe(account.cookie)
    await accounts.set('qq', { uid: probed.uin, nickname: probed.nickname, cookie: account.cookie, loginAt: account.loginAt })
    return { account: { uid: probed.uin, nickname: probed.nickname }, likedDir: probed.likedDir }
  }

  async function disconnect(provider) {
    assertProvider(provider)
    await accounts.clear(provider)
    await loadState()
    resetProviderState(provider)
    await persistState()
    return { ok: true, provider }
  }

  // ---------- 同步 ----------
  async function sync(provider) {
    assertProvider(provider)
    // busy 标记必须在任何 await 之前置位：两次并发调用会在第一个 await 处交错，否则都能通过检查
    if (busy[provider]) fail('该平台的同步已在进行中，请稍候', 409)
    busy[provider] = true
    const startedAt = Date.now()
    try {
      const account = await accounts.get(provider)
      if (!account) fail(`请先登录${PROVIDERS[provider].label}`, 401)
      const pulled = provider === 'netease'
        ? await netease.likedTracks(account.cookie, account.uid)
        : await qqmusic.likedTracks(account.cookie)
      const tracks = Array.isArray(pulled.tracks) ? pulled.tracks : []
      const st = await loadState()
      const prev = st[provider]
      const known = {}
      const ids = []
      for (const tr of tracks) {
        const id = String(tr.platformId)
        known[id] = { key: likeKey(tr.artist, tr.title), title: cleanText(tr.title, 200), artist: cleanText(tr.artist, 200) }
        ids.push(id)
      }
      const removedItems = prev.ids
        .filter((id) => !(id in known))
        .map((id) => prev.known[id])
        .filter(Boolean)
      const merged = await likes.importItems(provider, tracks)
      if (merged.added > 0 && typeof onImported === 'function') {
        try { onImported({ provider, added: merged.added }) } catch (err) { warn(`dsh-music: 导入后扫描触发失败: ${err.message}`) }
      }
      const result = {
        provider,
        at: startedAt,
        durationMs: Date.now() - startedAt,
        total: tracks.length,
        unavailable: Number.isFinite(pulled.unavailable) ? pulled.unavailable : 0,
        playlistName: cleanText((pulled.playlist && pulled.playlist.name) || (pulled.dir && pulled.dir.name), 100) || null,
        added: merged.added,
        existed: merged.existed,
        skippedDisliked: merged.skippedDisliked,
        removed: removedItems.length,
        removedItems: removedItems.slice(0, REMOVED_PREVIEW).map((r) => ({ title: r.title, artist: r.artist })),
      }
      st[provider] = { ids, known, lastSyncAt: Date.now(), lastResult: result }
      await persistState()
      return result
    } finally {
      busy[provider] = false
    }
  }

  function dispose() {
    qrSessions.clear()
    qqSessions.clear()
  }

  return { status, neteaseQrCreate, neteaseQrPoll, qqQrCreate, qqQrPoll, qqConnect, refresh, disconnect, sync, dispose, stateFile }
}

export function registerLikedSyncRoutes(webServer, { likedSync, logger }) {
  const warn = (msg) => logger?.warn?.(msg)
  const sendJson = (res, status, value) => {
    const body = JSON.stringify(value)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    })
    res.end(body)
  }
  const readBody = (req, limit = 64 * 1024) => new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('请求体过大')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
  const readJsonBody = async (req, res) => {
    let body
    try {
      body = JSON.parse((await readBody(req)) || '{}')
    } catch {
      sendJson(res, 400, { error: '请求体不是合法 JSON' })
      return null
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: '请求体必须是 JSON 对象' })
      return null
    }
    return body
  }
  const handle = async (res, fn, label) => {
    try {
      return sendJson(res, 200, await fn())
    } catch (err) {
      if (err.status) return sendJson(res, err.status, { error: err.message })
      warn(`dsh-music: ${label}错误: ${err.message}`)
      return sendJson(res, 500, { error: `${label}内部错误` })
    }
  }
  const query = (req) => new URL(req.url ?? '/', 'http://dsh-music.local').searchParams

  const disposers = []
  const route = (method, path, fn, label) => disposers.push(webServer.register({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (req.method !== method) return sendJson(res, 405, { error: '方法不允许' })
      return handle(res, () => fn(req, res), label)
    },
  }))

  route('GET', '/dsh-music/api/liked-sync/status', () => (likedSync ? likedSync.status() : { enabled: false, providers: {} }), '喜欢列表导入状态')
  if (!likedSync) return disposers

  route('POST', '/dsh-music/api/liked-sync/netease/qr', () => likedSync.neteaseQrCreate(), '网易云二维码')
  route('GET', '/dsh-music/api/liked-sync/netease/qr/poll', (req) => likedSync.neteaseQrPoll(query(req).get('key')), '网易云扫码状态')
  route('POST', '/dsh-music/api/liked-sync/qq/qr', () => likedSync.qqQrCreate(), 'QQ 扫码二维码')
  route('GET', '/dsh-music/api/liked-sync/qq/qr/poll', (req) => likedSync.qqQrPoll(query(req).get('key')), 'QQ 扫码状态')
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/liked-sync/qq/connect',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不允许' })
      const body = await readJsonBody(req, res)
      if (!body) return
      return handle(res, () => likedSync.qqConnect(body), 'QQ 音乐登录')
    },
  }))
  for (const provider of Object.keys(PROVIDERS)) {
    route('POST', `/dsh-music/api/liked-sync/${provider}/sync`, () => likedSync.sync(provider), '喜欢列表同步')
    route('POST', `/dsh-music/api/liked-sync/${provider}/refresh`, () => likedSync.refresh(provider), '登录态刷新')
    route('POST', `/dsh-music/api/liked-sync/${provider}/disconnect`, () => likedSync.disconnect(provider), '断开平台')
  }
  return disposers
}
