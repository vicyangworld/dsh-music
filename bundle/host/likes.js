/** 喜欢/收藏（三期批1）：本地 likes.json，key=简繁归一后的「歌手::歌名」。
 * 语义：喜欢才下载入库——liked=true 且曲不在曲库且带有效 verification → 自动触发
 * download 管线下载入库；已在曲库的曲只标记不重复下载。unlike 只去标记，绝不删文件
 * （红线：删除仅由用户主动触发）。数据仅存 ~/.dsh/dsh-music/，不上传。 */
import { normalizeZh } from './t2s.js'

const ID_RE = /^[a-f0-9]{16}$/

export function likeKey(artist, title) {
  return `${normalizeZh(artist).trim()}::${normalizeZh(title).trim()}`
}

export function createLikes({ storage, library, download, logger }) {
  const warn = (msg) => logger?.warn?.(msg)
  const file = () => `${storage.dataDir}/likes.json`
  let cache = null
  let chain = Promise.resolve()

  async function load() {
    if (cache) return cache
    const saved = await storage.readJson(file(), null)
    cache = saved && typeof saved.items === 'object' && saved.items !== null ? saved.items : {}
    return cache
  }

  async function persist() {
    const write = chain.then(() => storage.writeJson(file(), { v: 1, items: cache }))
    chain = write.catch((err) => warn(`dsh-music: 写 likes.json 失败: ${err.message}`))
    return write
  }

  /** 在曲库中按 key 找曲（完整 track 对象）。 */
  function findInLibrary(key) {
    return library.snapshot().tracks.find((t) => likeKey(t.artist, t.title) === key) ?? null
  }

  /** 标记喜欢/取消。入参：{trackId} 或 {artist,title,...元数据}；liked 布尔。 */
  async function set(input = {}) {
    await library.ensureScanned()
    const liked = input.liked === true
    let artist = typeof input.artist === 'string' ? input.artist.trim() : ''
    let title = typeof input.title === 'string' ? input.title.trim() : ''
    let durationMs = Number.isFinite(input.durationMs) && input.durationMs > 0 ? input.durationMs : null
    let album = typeof input.album === 'string' && input.album ? input.album : null
    let trackId = typeof input.trackId === 'string' && ID_RE.test(input.trackId) ? input.trackId : null

    if (input.trackId !== undefined && !trackId) {
      const e = new Error('无效的曲目 id'); e.status = 404; throw e
    }
    if (trackId) {
      const record = library.getRecord(trackId)
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
    const key = likeKey(artist, title)
    const items = await load()
    const local = findInLibrary(key)
    if (local) trackId = local.id

    if (!liked) {
      delete items[key]
      await persist()
      return { key, liked: false, trackId: local ? local.id : null, inLibrary: Boolean(local) }
    }

    if (local) {
      if (!items[key]) items[key] = { key, artist, title, album, durationMs, likedAt: Date.now() }
      await persist()
      return { key, liked: true, trackId: local.id, inLibrary: true, already: true }
    }

    // 不在曲库 → 喜欢才下载入库（需有效核实记录）
    const entry = { key, artist, title, album, durationMs, likedAt: Date.now() }
    items[key] = entry
    await persist()
    const v = input.verification
    if (!v) {
      return { key, liked: true, inLibrary: false, downloading: false, message: '已标记喜欢，但缺少联网核实记录，未能下载入库' }
    }
    const item = { artist, title, album: album || undefined, durationMs: durationMs || undefined, coverUrl: typeof input.coverUrl === 'string' ? input.coverUrl : undefined, verification: v }
    const verr = await download.core.checkVerification(item)
    if (verr) {
      return { key, liked: true, inLibrary: false, downloading: false, message: verr }
    }
    if (download.isRunning()) {
      return { key, liked: true, inLibrary: false, downloading: false, message: '下载管线正忙，请稍后重试下载入库' }
    }
    await download.archiveVerification(item)
    const snapshot = download.start([item])
    return { key, liked: true, inLibrary: false, downloading: true, runId: snapshot.runId }
  }

  /** 喜欢列表：曲库内条目实时解析 trackId/audioUrl/coverUrl（前端可直接播）。 */
  async function list() {
    await library.ensureScanned()
    const items = await load()
    const out = []
    for (const entry of Object.values(items)) {
      const local = findInLibrary(entry.key)
      out.push({
        ...entry,
        trackId: local ? local.id : null,
        audioUrl: local ? local.audioUrl : null,
        coverUrl: local ? local.coverUrl : null,
        inLibrary: Boolean(local),
      })
    }
    out.sort((a, b) => (b.likedAt ?? 0) - (a.likedAt ?? 0))
    return { items: out, total: out.length }
  }

  /** 按 key 查单个标记状态（渲染 ♥ 用）。 */
  async function statusOf(artist, title) {
    const items = await load()
    return items[likeKey(artist, title)] !== undefined
  }

  return { set, list, statusOf, file }
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
  const disposers = []
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/library/like',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不允许' })
      try {
        let body
        try {
          body = JSON.parse((await readBody(req)) || '{}')
        } catch {
          return sendJson(res, 400, { error: '请求体不是合法 JSON' })
        }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          return sendJson(res, 400, { error: '请求体必须是 JSON 对象' })
        }
        return sendJson(res, 200, await likes.set(body))
      } catch (err) {
        if (err.status) return sendJson(res, err.status, { error: err.message })
        warn(`dsh-music: 喜欢服务错误: ${err.message}`)
        return sendJson(res, 500, { error: '喜欢服务内部错误' })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/library/likes',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      try {
        return sendJson(res, 200, await likes.list())
      } catch (err) {
        warn(`dsh-music: 喜欢列表错误: ${err.message}`)
        return sendJson(res, 500, { error: '喜欢列表内部错误' })
      }
    },
  }))
  return disposers
}