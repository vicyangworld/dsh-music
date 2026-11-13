/** 试听缓存（三期批1）：推荐曲点播放=下载到本地临时缓存并可播，不入库、不写 dsh-music。
 * 文件按 sha16(歌手::歌名) 命名存 ~/.dsh/dsh-music/cache/preview/，LRU 保留 30 个；
 * 管线原语复用 media-core（同一套 pick/process），与下载/spotify-sync 共享同一把锁（不并发）。
 * 播放路由 /dsh-music/preview/<sha16>.<ext>：文件名完全由 Host 生成并经正则校验，无用户输入拼接。 */
import { mkdir, readdir, stat, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createPipelineLock } from './lock.js'
import { createMediaCore, serveRangeFile } from './media-core.js'
import { normalizeZh } from './t2s.js'

const FILE_RE = /^([a-f0-9]{16})\.(m4a|opus)$/
const MIME = { '.m4a': 'audio/mp4', '.opus': 'audio/ogg' }
const KEEP = 30

export function previewKey(artist, title) {
  return createHash('sha1').update(`${normalizeZh(artist).trim()}::${normalizeZh(title).trim()}`).digest('hex').slice(0, 16)
}

export function createPreview({ storage, library, config = {}, logger } = {}) {
  const core = createMediaCore({ storage, config, logger })
  const lock = createPipelineLock(config.pipelineLockPath)
  const warn = (msg) => logger?.warn?.(msg)
  const previewDir = join(storage.dataDir, 'cache', 'preview')
  let job = null
  let disposed = false

  async function findCached(key16) {
    for (const ext of ['.m4a', '.opus']) {
      try {
        const st = await stat(join(previewDir, key16 + ext))
        if (st.size > 10000) return { fileKey: key16 + ext, audioUrl: `/dsh-music/preview/${key16}${ext}` }
      } catch { /* 无 */ }
    }
    return null
  }

  async function trimLru() {
    try {
      const names = (await readdir(previewDir)).filter((n) => FILE_RE.test(n))
      if (names.length <= KEEP) return
      const withTime = await Promise.all(names.map(async (n) => {
        const st = await stat(join(previewDir, n)).catch(() => null)
        return st ? { n, m: st.mtimeMs } : null
      }))
      const list = withTime.filter(Boolean).sort((a, b) => a.m - b.m)
      for (const item of list.slice(0, list.length - KEEP)) {
        await rm(join(previewDir, item.n), { force: true }).catch(() => {})
      }
    } catch (err) {
      warn(`dsh-music: 试听缓存清理失败: ${err.message}`)
    }
  }

  /** 启动试听下载；调用前须已校验。已缓存直接 ready。 */
  async function start(item) {
    const key16 = previewKey(item.artist, item.title)
    await mkdir(previewDir, { recursive: true })
    const cached = await findCached(key16)
    if (cached) return { status: 'ready', ...cached }
    if (job?.running) return { status: 'busy' }
    const workdir = join(storage.dataDir, 'tmp', `preview-${key16}`)
    job = { running: true, key16, artist: item.artist, title: item.title, status: 'downloading', error: null, startedAt: Date.now() }
    const snapshot = job
    ;(async () => {
      const acquired = await lock.acquire()
      if (!acquired) {
        snapshot.running = false
        snapshot.status = 'fail'
        snapshot.error = '下载管线正在运行（spotify-sync、喜欢入库或上一轮试听持有锁），请等上一轮结束后再试'
        return
      }
      try {
        await mkdir(workdir, { recursive: true })
        const outDir = join(workdir, 'out')
        await mkdir(outDir, { recursive: true })
        const result = await core.processItem(item, outDir, workdir)
        if (result.status === 'fail') {
          snapshot.status = 'fail'
          snapshot.error = `试听失败：${result.note}`
        } else {
          // 产物改名为 key16.ext（文件名完全 Host 控制，URL 无用户输入）
          const ext = result.file.endsWith('.opus') ? '.opus' : '.m4a'
          const target = join(previewDir, key16 + ext)
          await rename(result.file, target)
          snapshot.status = 'ready'
          snapshot.audioUrl = `/dsh-music/preview/${key16}${ext}`
          snapshot.fileKey = key16 + ext
        }
        await trimLru()
      } catch (err) {
        snapshot.status = 'fail'
        snapshot.error = `试听失败：${err.message.slice(0, 200)}`
      } finally {
        await rm(workdir, { recursive: true, force: true }).catch(() => {})
        await lock.release()
        snapshot.running = false
      }
    })().catch((err) => {
      snapshot.running = false
      snapshot.status = 'fail'
      snapshot.error = `试听失败：${err.message}`
      warn(`dsh-music: 试听管线异常: ${err.message}`)
    })
    return { status: 'downloading', audioUrl: snapshot.audioUrl ?? null }
  }

  function status() {
    if (!job) return { running: false, status: 'idle', artist: null, title: null, audioUrl: null, error: null }
    return JSON.parse(JSON.stringify({
      running: job.running,
      status: job.status,
      artist: job.artist,
      title: job.title,
      audioUrl: job.audioUrl ?? null,
      error: job.error,
    }))
  }

  /** 播放流：安全解析 fileKey → previewDir 内实际文件。 */
  async function serve(req, res, fileKey, sendError) {
    const m = FILE_RE.exec(fileKey)
    if (!m) return sendError(404, '无效的试听文件')
    const filePath = join(previewDir, m[1] + (m[2] === 'opus' ? '.opus' : '.m4a'))
    // 越界防线：realpath 必须仍在 previewDir 内
    const { realpath } = await import('node:fs/promises')
    let real
    try {
      real = await realpath(filePath)
      const dirReal = await realpath(previewDir)
      if (!real.startsWith(dirReal + '/')) return sendError(403, '文件不在试听缓存内')
    } catch {
      return sendError(404, '试听文件不存在，请先请求试听')
    }
    return serveRangeFile(req, res, {
      filePath: real,
      mime: MIME[m[2] === 'opus' ? '.opus' : '.m4a'],
      warn,
      sendError,
    })
  }

  return {
    start,
    status,
    findCached,
    serve,
    trimLru,
    previewDir,
    checkVerification: (item) => core.checkVerification(item),
    archive: (item) => core.archiveVerification(item),
    archiveHasMatch: (item) => core.archiveHasMatch(item),
    dispose() {
      disposed = true
      core.killAll()
      lock.release().catch(() => {})
    },
  }
}

export function registerPreviewRoutes(webServer, { preview, logger }) {
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
    path: '/dsh-music/api/library/preview',
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
        const artist = typeof body.artist === 'string' ? body.artist.trim() : ''
        const title = typeof body.title === 'string' ? body.title.trim() : ''
        if (!artist || !title) return sendJson(res, 400, { error: '缺少歌手名 artist 或歌名 title' })
        const item = {
          artist,
          title,
          album: typeof body.album === 'string' ? body.album : undefined,
          durationMs: Number.isFinite(body.durationMs) && body.durationMs > 0 ? body.durationMs : undefined,
          coverUrl: typeof body.coverUrl === 'string' ? body.coverUrl : undefined,
          verification: body.verification,
        }
        // 核实前置：试听同样不下载未经核实的歌曲（红线 12，D1 后含留档交叉比对）
        const verr = await preview.checkVerification(item)
        if (verr) return sendJson(res, 400, { error: verr })
        await preview.archive(item)
        const r = await preview.start(item)
        if (r.status === 'busy') return sendJson(res, 409, { error: '已有试听在下载，请等当前完成' })
        return sendJson(res, r.status === 'ready' ? 200 : 202, r)
      } catch (err) {
        warn(`dsh-music: 试听服务错误: ${err.message}`)
        return sendJson(res, 500, { error: '试听服务内部错误' })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/library/preview/status',
    handler: (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      return sendJson(res, 200, preview.status())
    },
  }))
  disposers.push(webServer.register({
    kind: 'prefix',
    path: '/dsh-music/preview',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: '方法不允许' })
      const url = new URL(req.url ?? '/', 'http://dsh-music.local')
      const fileKey = url.pathname.slice('/dsh-music/preview/'.length)
      return preview.serve(req, res, decodeURIComponent(fileKey), (status, msg) => sendJson(res, status, { error: msg }))
    },
  }))
  return disposers
}