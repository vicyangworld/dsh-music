/** 喜欢/不喜欢（三期批1 likes，八期④数据层扩展）：本地 likes.json v2，key=简繁归一后的「歌手::歌名」。
 * 语义：喜欢才下载入库——liked=true 且曲不在曲库且带有效 verification → 自动触发
 * download 管线下载入库；已在曲库的曲只标记不重复下载。unlike 只去标记，绝不删文件
 * （红线：删除仅由用户主动触发）。不喜欢（dislike）只记口味信号，永不下载、永不删文件。
 * 喜欢与不喜欢互斥（同一 key 不能同时成立）：口味是二值信号，避免推荐读到矛盾偏好；
 * 切换方向只改标记，不动本地文件。数据仅存 ~/.dsh/dsh-music/，不上传。 */
import { normalizeZh } from './t2s.js'

const ID_RE = /^[a-f0-9]{16}$/

export function likeKey(artist, title) {
  return `${normalizeZh(artist).trim()}::${normalizeZh(title).trim()}`
}

export function createLikes({ storage, library, download, logger, history }) {
  const warn = (msg) => logger?.warn?.(msg)
  const file = () => `${storage.dataDir}/likes.json`
  let cache = null // { items, dislikes }
  let chain = Promise.resolve()

  async function load() {
    if (cache) return cache
    const saved = await storage.readJson(file(), null)
    const items = saved && typeof saved.items === 'object' && saved.items !== null ? saved.items : {}
    const dislikes = saved && typeof saved.dislikes === 'object' && saved.dislikes !== null ? saved.dislikes : {}
    // v1（只有 items）自然迁移为 v2：dislikes 为空，下次写入升版
    cache = { items, dislikes }
    return cache
  }

  async function persist() {
    const data = await load()
    const write = chain.then(() => storage.writeJson(file(), { v: 2, items: data.items, dislikes: data.dislikes }))
    chain = write.catch((err) => warn(`dsh-music: 写 likes.json 失败: ${err.message}`))
    return write
  }

  /** 在曲库中按 key 找曲（完整 track 对象）。 */
  function findInLibrary(key) {
    return library.snapshot().tracks.find((t) => likeKey(t.artist, t.title) === key) ?? null
  }

  /** 解析入参公共部分：trackId 或 artist/title，返回规整后的元数据。 */
  async function resolveInput(input = {}) {
    await library.ensureScanned()
    let artist = typeof input.artist === 'string' ? input.artist.trim() : ''
    let title = typeof input.title === 'string' ? input.title.trim() : ''
    let durationMs = Number.isFinite(input.durationMs) && input.durationMs > 0 ? input.durationMs : null
    let album = typeof input.album === 'string' && input.album ? input.album : null
    let trackId = typeof input.trackId === 'string' && ID_RE.test(input.trackId) ? input.trackId : null
    let record = null

    if (input.trackId !== undefined && !trackId) {
      const e = new Error('无效的曲目 id'); e.status = 404; throw e
    }
    if (trackId) {
      record = library.getRecord(trackId)
      if (!record) {
        const e = new Error('曲目不存在或尚未扫描，请先重新扫描'); e.status = 404; throw e
      }
      artist = record.meta.artist || artist
      title = record.meta.title || title
      album = record.meta.album || album
      durationMs = record.meta.duration ? Math.round(record.meta.duration * 1000) : durationMs
    }
    if (!artist || !title) {
      const e = new Error('缺少歌手名 artist 或歌名 title'); e.status = 400; throw e
    }
    return { artist, title, album, durationMs, trackId, record }
  }

  /** 记录口味事件到收听历史（type=dislike/undislike，只进历史与统计，不算播放）。 */
  async function logTaste(kind, { artist, title, trackId }) {
    if (!history || typeof history.appendTaste !== 'function') return null
    try {
      return await history.appendTaste({ kind, artist, title, trackId })
    } catch (err) {
      warn(`dsh-music: 写口味事件失败: ${err.message}`)
      return null
    }
  }

  /** 标记喜欢/取消。入参：{trackId} 或 {artist,title,...元数据}；liked 布尔。 */
  async function set(input = {}) {
    const { artist, title, album, durationMs, trackId } = await resolveInput(input)
    const liked = input.liked === true
    const key = likeKey(artist, title)
    const data = await load()
    const local = findInLibrary(key)
    const resolvedId = local ? local.id : (trackId || null)

    if (!liked) {
      const existed = Boolean(data.items[key])
      delete data.items[key]
      if (existed) await persist()
      return { key, liked: false, disliked: false, trackId: resolvedId, inLibrary: Boolean(local) }
    }

    // 喜欢与不喜欢互斥：置喜欢时清掉不喜欢标记
    const clearedDislike = Boolean(data.dislikes[key])
    if (clearedDislike) delete data.dislikes[key]

    if (local) {
      if (!data.items[key]) data.items[key] = { key, artist, title, album, durationMs, likedAt: Date.now() }
      await persist()
      return { key, liked: true, disliked: false, trackId: local.id, inLibrary: true, already: true }
    }

    // 不在曲库 → 喜欢才下载入库（需有效核实记录）
    const entry = { key, artist, title, album, durationMs, likedAt: Date.now() }
    data.items[key] = entry
    await persist()
    const v = input.verification
    if (!v) {
      return { key, liked: true, disliked: false, inLibrary: false, downloading: false, message: '已标记喜欢，但缺少联网核实记录，未能下载入库' }
    }
    const item = { artist, title, album: album || undefined, durationMs: durationMs || undefined, coverUrl: typeof input.coverUrl === 'string' ? input.coverUrl : undefined, verification: v }
    const verr = await download.core.checkVerification(item)
    if (verr) {
      return { key, liked: true, disliked: false, inLibrary: false, downloading: false, message: verr }
    }
    if (download.isRunning()) {
      return { key, liked: true, disliked: false, inLibrary: false, downloading: false, message: '下载管线正忙，请稍后重试下载入库' }
    }
    await download.archiveVerification(item)
    const snapshot = download.start([item])
    return { key, liked: true, disliked: false, inLibrary: false, downloading: true, runId: snapshot.runId }
  }

  /** 设置/取消「不喜欢」。入参 {trackId} 或 {artist,title,...}；disliked 布尔。
   * 不喜欢绝不下载、绝不删文件；取消不喜欢（disliked=false）也不影响其他标记。 */
  async function setDislike(input = {}) {
    const { artist, title, album, durationMs, trackId } = await resolveInput(input)
    const disliked = input.disliked === true
    const key = likeKey(artist, title)
    const data = await load()
    const local = findInLibrary(key)
    const resolvedId = local ? local.id : (trackId || null)

    if (!disliked) {
      const existed = Boolean(data.dislikes[key])
      delete data.dislikes[key]
      if (existed) {
        await persist()
        await logTaste('undislike', { artist, title, trackId: resolvedId })
      }
      return { key, disliked: false, liked: Boolean(data.items[key]), trackId: resolvedId, inLibrary: Boolean(local) }
    }

    const clearedLike = Boolean(data.items[key])
    if (clearedLike) delete data.items[key]
    if (!data.dislikes[key]) {
      data.dislikes[key] = { key, artist, title, album, durationMs, dislikedAt: Date.now() }
    }
    await persist()
    await logTaste('dislike', { artist, title, trackId: resolvedId })
    return { key, disliked: true, liked: false, clearedLike, trackId: resolvedId, inLibrary: Boolean(local) }
  }

  function decorate(entry) {
    const local = findInLibrary(entry.key)
    return {
      ...entry,
      trackId: local ? local.id : null,
      audioUrl: local ? local.audioUrl : null,
      coverUrl: local ? local.coverUrl : null,
      inLibrary: Boolean(local),
    }
  }

  /** 喜欢列表：曲库内条目实时解析 trackId/audioUrl/coverUrl（前端可直接播）。 */
  async function list() {
    await library.ensureScanned()
    const data = await load()
    const out = Object.values(data.items).map(decorate)
    out.sort((a, b) => (b.likedAt ?? 0) - (a.likedAt ?? 0))
    return { items: out, total: out.length }
  }

  /** 不喜欢列表：同样实时解析曲库状态；不入库的条目 inLibrary=false。 */
  async function listDislikes() {
    await library.ensureScanned()
    const data = await load()
    const out = Object.values(data.dislikes).map(decorate)
    out.sort((a, b) => (b.dislikedAt ?? 0) - (a.dislikedAt ?? 0))
    return { items: out, total: out.length }
  }

  /** 统计卡用摘要（不返回全部条目，避免 stats 响应变大）。 */
  async function summary(limit = 10) {
    const { items, total } = await listDislikes()
    return {
      count: total,
      songs: items.slice(0, Math.max(0, limit)).map((e) => ({ title: e.title, artist: e.artist, dislikedAt: e.dislikedAt ?? null, inLibrary: e.inLibrary })),
    }
  }

  /** 按 key 查单个标记状态（渲染 ♥ 用）。 */
  async function statusOf(artist, title) {
    const data = await load()
    return data.items[likeKey(artist, title)] !== undefined
  }

  /** 同时返回喜欢/不喜欢状态（渲染 ♥/👎 用）；trackId 优先，其次 artist+title。 */
  async function tasteOf(input = {}) {
    let artist = typeof input.artist === 'string' ? input.artist.trim() : ''
    let title = typeof input.title === 'string' ? input.title.trim() : ''
    let trackId = typeof input.trackId === 'string' && ID_RE.test(input.trackId) ? input.trackId : null
    if (trackId) {
      const rec = library.getRecord(trackId)
      if (!rec) {
        const e = new Error('曲目不存在或尚未扫描，请先重新扫描'); e.status = 404; throw e
      }
      artist = rec.meta.artist || artist
      title = rec.meta.title || title
    }
    if (!artist || !title) {
      const e = new Error('缺少歌手名 artist 或歌名 title'); e.status = 400; throw e
    }
    const key = likeKey(artist, title)
    const data = await load()
    const local = findInLibrary(key)
    return {
      key,
      liked: data.items[key] !== undefined,
      disliked: data.dislikes[key] !== undefined,
      trackId: local ? local.id : (trackId || null),
      inLibrary: Boolean(local),
    }
  }

  return { set, setDislike, list, listDislikes, summary, statusOf, tasteOf, file }
}

export function registerLikesRoutes(webServer, { likes, logger }) {
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
  const readBody = (req, limit = 256 * 1024) => new Promise((resolve, reject) => {
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

  const disposers = []
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/library/like',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不允许' })
      const body = await readJsonBody(req, res)
      if (!body) return
      return handle(res, () => likes.set(body), '喜欢服务')
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/library/likes',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      return handle(res, () => likes.list(), '喜欢列表')
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/library/dislike',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不允许' })
      const body = await readJsonBody(req, res)
      if (!body) return
      return handle(res, () => likes.setDislike(body), '不喜欢服务')
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/library/dislikes',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      return handle(res, () => likes.listDislikes(), '不喜欢列表')
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/library/taste',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      const url = new URL(req.url ?? '/', 'http://dsh-music.local')
      const query = {
        trackId: url.searchParams.get('trackId') ?? undefined,
        artist: url.searchParams.get('artist') ?? undefined,
        title: url.searchParams.get('title') ?? undefined,
      }
      return handle(res, () => likes.tasteOf(query), '口味状态')
    },
  }))
  return disposers
}
