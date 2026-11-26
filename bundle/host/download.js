/** 泛化下载管线（入库）：把核实过的歌曲下载到 ~/Music/dsh-music/ 并自动重扫入库。
 * 管线原语复用 media-core.js（与试听缓存共用），此处只保留「批次 job + 入库」语义。
 * 红线：与 spotify-sync/试听共享一把锁（不并发）；核实前置；只写 ~/Music/dsh-music/，
 * 绝不写 ~/Music/spotify-liked/；绝不读取 ~/.config/spotify-sync/refresh_token（只操作 sync.lock）。
 * 三期批1 语义补充：推荐曲的入库由「喜欢」触发（likes.js 调用本模块），POST /api/download
 * 端点保留（其他用途），调用方决定何时入库。
 * 十三期队列语义：运行中再提交不再 409，而是并入当前批次——front=true 插到待处理队首（用户点了
 * 想先听的那首），否则排到队尾；撞锁（spotify-sync/试听持锁）才整批不执行。 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createPipelineLock } from './lock.js'
import { createMediaCore, sanitize } from './media-core.js'

export { sanitize }

const OUT_DIR = join(homedir(), 'Music', 'dsh-music')

export function createDownload({ storage, library, config = {}, logger }) {
  const core = createMediaCore({ storage, config, logger })
  const lock = createPipelineLock(config.pipelineLockPath) // 默认与 spotify-sync 同锁
  const warn = (msg) => logger?.warn?.(msg)
  let disposed = false
  let job = null // 当前批次（可序列化状态：items 按执行顺序排列）
  let ctl = null // 当前批次的运行时句柄 { sources, finishing, done, resolve }

  async function persistRun(summary) {
    const file = join(storage.dataDir, 'downloads.json')
    let runs = []
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'))
      if (Array.isArray(saved)) runs = saved
    } catch { /* 首次 */ }
    runs.push(summary)
    try {
      await writeFile(file, JSON.stringify(runs.slice(-50), null, 1), 'utf8')
    } catch (err) {
      warn(`dsh-music: 写 downloads.json 失败: ${err.message}`)
    }
  }

  function entryOf(it) {
    return { artist: it.artist, title: it.title, status: 'pending', note: null, trackId: null }
  }

  /** 新建一批并开始执行。wait：等上一批收尾（释放锁）后再取锁。 */
  function launch(items, wait) {
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const snapshot = {
      running: true,
      runId,
      startedAt: Date.now(),
      finishedAt: null,
      total: items.length,
      done: 0,
      queued: 0,
      error: null,
      items: items.map(entryOf),
    }
    const handle = { sources: new Map(), finishing: false }
    handle.done = new Promise((resolve) => { handle.resolve = resolve })
    for (const it of snapshot.items) handle.sources.set(it, items[snapshot.items.indexOf(it)])
    job = snapshot
    ctl = handle
    const workdir = join(storage.dataDir, 'tmp', `download-${runId}`)
    ;(async () => {
      if (wait) await wait
      const acquired = await lock.acquire()
      if (!acquired) {
        snapshot.running = false
        snapshot.finishedAt = Date.now()
        snapshot.error = '下载管线正在运行（spotify-sync、试听或上一轮下载持有锁），请等上一轮结束后再试'
        for (const it of snapshot.items) { it.status = 'fail'; it.note = '撞锁未执行' }
        handle.resolve()
        return
      }
      try {
        await mkdir(OUT_DIR, { recursive: true })
        await mkdir(workdir, { recursive: true })
        for (;;) {
          if (disposed) break
          const idx = snapshot.items.findIndex((it) => it.status === 'pending')
          if (idx < 0) break
          const it = snapshot.items[idx]
          it.status = 'downloading'
          try {
            const result = await core.processItem(handle.sources.get(it), OUT_DIR, workdir)
            it.status = result.status
            it.note = result.note
            if (result.file) {
              it.file = result.file
              if (result.status === 'ok' || result.status === 'skip') {
                try {
                  await library.rescan()
                  const rec = library.findByFile(it.file)
                  if (rec) it.trackId = rec.id
                } catch (err) {
                  warn(`dsh-music: 单曲入库重扫失败: ${err.message}`)
                }
              }
            }
          } catch (err) {
            it.status = 'fail'
            it.note = err.message.slice(0, 160)
          }
          snapshot.done++
        }
        handle.finishing = true
        // 兜底重扫：确保所有已落盘产物都已入库并映射回 trackId（供 Client 直接点击播放）
        try {
          const needFinalScan = snapshot.items.some((it) => it.file && !it.trackId)
          if (needFinalScan) await library.rescan()
          for (const it of snapshot.items) {
            if (it.file && !it.trackId) {
              const rec = library.findByFile(it.file)
              if (rec) it.trackId = rec.id
            }
          }
        } catch (err) {
          warn(`dsh-music: 下载后重扫失败: ${err.message}`)
        }
      } catch (err) {
        snapshot.error = err.message
      } finally {
        handle.finishing = true
        await rm(workdir, { recursive: true, force: true }).catch(() => {})
        await lock.release()
        snapshot.running = false
        snapshot.finishedAt = Date.now()
        handle.resolve()
        await persistRun({
          runId,
          startedAt: snapshot.startedAt,
          finishedAt: snapshot.finishedAt,
          error: snapshot.error,
          items: snapshot.items.map(({ artist, title, status, note, trackId }) => ({ artist, title, status, note, trackId })),
        })
      }
    })().catch((err) => {
      snapshot.running = false
      handle.finishing = true
      snapshot.error = err.message
      handle.resolve()
      warn(`dsh-music: 下载管线异常: ${err.message}`)
    })
    return snapshot
  }

  /** 入队（顺序执行，绝不并发）。调用前已完成参数与核实校验。
   * 空闲 → 立即起新批次；运行中 → 并入当前批次：front=true 插到待处理队首（当前正在下载的那首相让不了），否则排到队尾。
   * 返回 { snapshot, queued }（queued = 并入运行中批次的条数）。 */
  function enqueue(items, { front = false } = {}) {
    if (job && job.running && ctl && !ctl.finishing) {
      const entries = items.map(entryOf)
      for (const e of entries) ctl.sources.set(e, items[entries.indexOf(e)])
      const at = front ? job.items.findIndex((it) => it.status === 'pending') : -1
      if (at < 0) job.items.push(...entries)
      else job.items.splice(at, 0, ...entries)
      job.total = job.items.length
      job.queued += entries.length
      return { snapshot: job, queued: entries.length }
    }
    const previous = job && job.running && ctl ? ctl.done : null
    return { snapshot: launch(items, previous), queued: 0 }
  }

  return {
    lock,
    core,
    /** 校验一批请求；返回错误消息或 null（async：核实含留档交叉比对）。 */
    async validate(items) {
      if (!Array.isArray(items) || items.length === 0) return 'items 必须是非空数组'
      if (items.length > 20) return '单批最多 20 首'
      for (const item of items) {
        if (!item || typeof item !== 'object') return '每个条目必须是对象'
        if (typeof item.artist !== 'string' || !item.artist.trim()) return '缺少歌手名 artist'
        if (typeof item.title !== 'string' || !item.title.trim()) return '缺少歌名 title'
        const verr = await core.checkVerification(item)
        if (verr) return `${item.artist} - ${item.title}: ${verr}`
      }
      return null
    },
    isRunning: () => job?.running === true,
    start: (items) => enqueue(items),
    enqueue,
    status() {
      if (!job) return { running: false, runId: null, items: [], total: 0, done: 0, pending: 0 }
      const copy = JSON.parse(JSON.stringify(job))
      copy.pending = copy.items.filter((it) => it.status === 'pending').length
      return copy
    },
    archiveVerification: (item) => core.archiveVerification(item),
    dispose() {
      disposed = true
      core.killAll()
      lock.release().catch(() => {})
    },
  }
}

export function registerDownloadRoutes(webServer, { download, logger }) {
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
  const readBody = (req, limit = 512 * 1024) => new Promise((resolve, reject) => {
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
    path: '/dsh-music/api/download',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不允许' })
      try {
        let body
        try {
          body = JSON.parse((await readBody(req)) || '{}')
        } catch {
          return sendJson(res, 400, { error: '请求体不是合法 JSON' })
        }
        const items = body?.items
        const verr = await download.validate(items)
        if (verr) return sendJson(res, 400, { error: verr })
        for (const item of items) await download.archiveVerification(item)
        /* 运行中不再 409：并入当前批次队列；front=true 置顶到待下载列表顶部（用户点了想先听的歌）。 */
        const { snapshot, queued } = download.enqueue(items, { front: body?.front === true })
        return sendJson(res, 202, { runId: snapshot.runId, total: snapshot.total, queued })
      } catch (err) {
        warn(`dsh-music: 下载服务错误: ${err.message}`)
        return sendJson(res, 500, { error: '下载服务内部错误' })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/download/status',
    handler: (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      return sendJson(res, 200, download.status())
    },
  }))
  return disposers
}