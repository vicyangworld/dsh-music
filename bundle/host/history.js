/** 收听历史：append-only JSONL，仅存 ~/.dsh/dsh-music/history.jsonl，不上传。
 * 每条含 trackId/artist/title/timestamp/completion(0-1)/skipped/reason/durationSeconds。
 * trackId 必须存在于曲库索引（S1-003：不记录未知 id）。
 * 五期：GET /api/history/stats 只读聚合（totalSeconds 按 时长×完整度 估算）。 */
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeZh } from './t2s.js'

export function createHistory({ storage, library, logger }) {
  const file = join(storage.dataDir, 'history.jsonl')
  let chain = Promise.resolve() // 串行化追加，避免并发写交错

  /** 追加一条播放事件；校验失败抛中文错误（路由转 400/404）。 */
  async function append(event = {}) {
    const rec = library.getRecord(event.trackId)
    if (!rec) {
      const err = new Error('trackId 不存在于曲库，请先重新扫描')
      err.code = 'UNKNOWN_TRACK'
      throw err
    }
    const completion = Number(event.completion)
    if (!Number.isFinite(completion) || completion < 0 || completion > 1) {
      throw new Error('completion 必须是 0~1 之间的数字（播放完整度）')
    }
    const entry = {
      trackId: rec.id,
      artist: rec.meta.artist,
      title: rec.meta.title,
      timestamp: Number.isFinite(event.timestamp) ? event.timestamp : Date.now(),
      completion: Math.round(completion * 1000) / 1000,
      skipped: Boolean(event.skipped),
      reason: typeof event.reason === 'string' && event.reason
        ? event.reason.slice(0, 40)
        : (event.skipped ? 'skipped' : 'ended'),
      // 五期统计：记录时长（秒），旧条目无此字段时回退曲库查询
      durationSeconds: Number.isFinite(rec.meta.duration) ? Math.round(rec.meta.duration * 1000) / 1000 : null,
    }
    const line = JSON.stringify(entry) + '\n'
    const write = chain.then(() => appendFile(file, line, 'utf8'))
    chain = write.catch((err) => logger?.warn?.(`dsh-music: 写历史失败: ${err.message}`))
    await write
    return entry
  }

  /** 追加一条口味事件（不喜欢/取消不喜欢）。只进历史与统计，不算播放；
   * reco 等播放画像默认读不到（read 默认过滤），因此不会污染推荐。 */
  async function appendTaste(event = {}) {
    const kind = event.kind === 'undislike' ? 'undislike' : event.kind === 'dislike' ? 'dislike' : null
    if (!kind) throw new Error('kind 必须是 dislike 或 undislike')
    const artist = typeof event.artist === 'string' ? event.artist.trim() : ''
    const title = typeof event.title === 'string' ? event.title.trim() : ''
    if (!artist || !title) throw new Error('缺少歌手名 artist 或歌名 title')
    let trackId = null
    if (event.trackId !== undefined && event.trackId !== null) {
      const rec = library.getRecord(event.trackId)
      if (!rec) {
        const err = new Error('trackId 不存在于曲库，请先重新扫描')
        err.code = 'UNKNOWN_TRACK'
        throw err
      }
      trackId = rec.id
    }
    const entry = {
      type: kind,
      trackId,
      artist,
      title,
      timestamp: Number.isFinite(event.timestamp) ? event.timestamp : Date.now(),
      reason: kind,
    }
    const line = JSON.stringify(entry) + '\n'
    const write = chain.then(() => appendFile(file, line, 'utf8'))
    chain = write.catch((err) => logger?.warn?.(`dsh-music: 写口味事件失败: ${err.message}`))
    await write
    return entry
  }

  /** 读取历史（ newest first ）。limit 上限 10000，供推荐引擎一次取全量。
   * 默认只返回播放事件；includeTaste=true 时口味事件也返回（归一 type='play'）。 */
  async function read({ limit = 200, offset = 0, includeTaste = false } = {}) {
    let events = await readAll()
    if (!includeTaste) events = events.filter((e) => e.type === undefined || e.type === 'play')
    const total = events.length
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 10000)
    const off = Math.max(Number(offset) || 0, 0)
    const slice = events.slice().reverse().slice(off, off + lim)
    return {
      events: includeTaste ? slice.map((e) => ({ ...e, type: e.type ?? 'play' })) : slice,
      total,
    }
  }

  /** 读取全部事件（坏行跳过，不排序不截断）。 */
  async function readAll() {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      return []
    }
    const out = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        /* 坏行跳过 */
      }
    }
    return out
  }

  /** 聚合统计（只读本地）：总播放/总时长(估算)/去重歌曲歌手/TOP/近7天/跳过/平均完整度。
   * 只统计播放事件；口味事件单独计数（dislikeEvents/undislikeEvents）。 */
  async function stats() {
    const all = await readAll()
    const events = all.filter((e) => e.type === undefined || e.type === 'play')
    let dislikeEvents = 0
    let undislikeEvents = 0
    for (const e of all) {
      if (e.type === 'dislike') dislikeEvents++
      else if (e.type === 'undislike') undislikeEvents++
    }
    const pad = (n) => String(n).padStart(2, '0')
    const localDate = (ts) => {
      const d = new Date(ts)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
    let totalSeconds = 0
    let skippedCount = 0
    let completionSum = 0
    const songs = new Map()
    const artists = new Map()
    const byDay = new Map()
    for (const e of events) {
      const completion = Number.isFinite(e.completion) ? Math.min(Math.max(e.completion, 0), 1) : 0
      completionSum += completion
      if (e.skipped === true) skippedCount++
      const dur = Number(e.durationSeconds) || library.getRecord(e.trackId)?.meta?.duration || 0
      totalSeconds += dur * completion
      const artist = String(e.artist ?? '未知歌手')
      const title = String(e.title ?? '未知标题')
      const ts = Number.isFinite(e.timestamp) ? e.timestamp : Date.now()
      const sk = `${normalizeZh(artist)}::${normalizeZh(title)}`
      const song = songs.get(sk) ?? { title, artist, plays: 0, trackId: null, lastTs: -Infinity }
      song.plays++
      song.title = title
      song.artist = artist
      // 记录该歌曲键最近一条事件的 trackId（文件按时间追加，时间戳兜底取新）
      if (ts >= song.lastTs) {
        song.lastTs = ts
        song.trackId = typeof e.trackId === 'string' && e.trackId ? e.trackId : null
      }
      songs.set(sk, song)
      const ak = normalizeZh(artist)
      const item = artists.get(ak) ?? { name: artist, plays: 0 }
      item.plays++
      item.name = artist
      artists.set(ak, item)
      const day = localDate(ts)
      byDay.set(day, (byDay.get(day) ?? 0) + 1)
    }
    const today = new Date()
    const daily = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      daily.push({ date: key, plays: byDay.get(key) ?? 0 })
    }
    const byPlays = (x, y) => y.plays - x.plays
    return {
      totalPlays: events.length,
      totalSeconds: Math.round(totalSeconds),
      uniqueSongs: songs.size,
      uniqueArtists: artists.size,
      topSongs: [...songs.values()].sort(byPlays).slice(0, 10).map(({ lastTs, ...song }) => ({
        ...song,
        // trackId 仍在本机曲库才可点播，否则置空（客户端按不可播处理）
        trackId: song.trackId && library.getRecord(song.trackId) ? song.trackId : null,
      })),
      topArtists: [...artists.values()].sort(byPlays).slice(0, 10),
      daily,
      skippedCount,
      avgCompletion: events.length === 0 ? 0 : Math.round((completionSum / events.length) * 1000) / 1000,
      // 口味信号（八期④）：不喜欢事件计数，与播放统计分离
      dislikeEvents,
      undislikeEvents,
    }
  }

  return { file, append, appendTaste, read, readAll, stats }
}

export function registerHistoryRoutes(webServer, { history, likes, logger }) {
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
    path: '/dsh-music/api/history',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const url = new URL(req.url ?? '/', 'http://dsh-music.local')
          const limit = url.searchParams.get('limit') ?? 200
          const offset = url.searchParams.get('offset') ?? 0
          const includeTaste = url.searchParams.get('includeTaste') === '1' || url.searchParams.get('includeTaste') === 'true'
          return sendJson(res, 200, await history.read({ limit, offset, includeTaste }))
        }
        if (req.method === 'POST') {
          let event
          try {
            event = JSON.parse((await readBody(req)) || '{}')
          } catch {
            return sendJson(res, 400, { error: '请求体不是合法 JSON' })
          }
          if (event === null || typeof event !== 'object' || Array.isArray(event)) {
            return sendJson(res, 400, { error: '请求体必须是 JSON 对象' })
          }
          try {
            return sendJson(res, 200, await history.append(event))
          } catch (err) {
            const status = err.code === 'UNKNOWN_TRACK' ? 404 : 400
            return sendJson(res, status, { error: err.message })
          }
        }
        return sendJson(res, 405, { error: '方法不允许' })
      } catch (err) {
        warn(`dsh-music: 历史服务错误: ${err.message}`)
        return sendJson(res, 500, { error: '收听历史服务内部错误' })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/history/stats',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      try {
        const value = await history.stats()
        // 合并当前不喜欢清单摘要（八期④：不喜欢也进统计卡）
        if (likes && typeof likes.summary === 'function') {
          const summary = await likes.summary(10)
          value.dislikes = { count: summary.count, events: value.dislikeEvents ?? 0, songs: summary.songs }
        }
        return sendJson(res, 200, value)
      } catch (err) {
        warn(`dsh-music: 历史统计错误: ${err.message}`)
        return sendJson(res, 500, { error: '历史统计内部错误' })
      }
    },
  }))
  return disposers
}