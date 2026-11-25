/** HTTP 路由（ctx.webServer.register，真实契约见安装版 dsh-host-webserver）：
 *   GET  exact  /dsh-music/api/library   曲库 JSON
 *   POST exact  /dsh-music/api/rescan    重扫并返回同结构
 *   GET/POST exact /dsh-music/api/playback  播放状态读取/上报（S1 可选，S3 历史用）
 *   GET/HEAD prefix /dsh-music/audio/<id>   Range 音频流
 *   GET/HEAD prefix /dsh-music/cover/<id>   内嵌封面
 *   GET/HEAD exact  /dsh-music/icon.png      插件图标（设置页首启 Logo，读包内 icon.png）
 * 安全：id 只经内存索引解析为路径，绝不拼接用户输入； realpath 必须落在曲库根内。
 * 非 2xx 一律 JSON {error:"中文原因"}。 */
import { readFile, writeFile, realpath } from 'node:fs/promises'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveRangeFile } from './media-core.js'

const ID_RE = /^[a-f0-9]{16}$/
const AUDIO_PREFIX = '/dsh-music/audio/'
const COVER_PREFIX = '/dsh-music/cover/'
const ICON_PATH = '/dsh-music/icon.png'
/* routes.js 位于 bundle/host/，图标在 bundle/icon.png（package.json 的 ./icon 导出） */
const ICON_FILE = fileURLToPath(new URL('../icon.png', import.meta.url))
let iconBuffer = null

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function fail(res, status, error) {
  sendJson(res, status, { error })
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 解析并校验 id → 内部记录；任何非法输入都在这里被拒绝。 */
function resolveTrack(url, prefix, library, res) {
  const id = url.pathname.slice(prefix.length)
  if (!ID_RE.test(id)) {
    fail(res, 404, '无效的曲目 id')
    return null
  }
  const record = library.getRecord(id)
  if (!record) {
    fail(res, 404, '曲目不存在或尚未扫描，请先重新扫描')
    return null
  }
  return record
}

async function serveAudio(req, res, library, warn) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '方法不允许')
  const url = new URL(req.url ?? '/', 'http://dsh-music.local')
  const record = resolveTrack(url, AUDIO_PREFIX, library, res)
  if (!record) return
  // 双重防线：真实路径必须位于某个曲库根目录内（防符号链接/越界）。
  let real
  try {
    real = await realpath(record.filePath)
  } catch {
    return fail(res, 404, '音频文件不存在')
  }
  if (!library.roots().some((root) => real === root || real.startsWith(root + sep))) {
    return fail(res, 403, '文件不在曲库目录内')
  }
  return serveRangeFile(req, res, {
    filePath: real,
    mime: record.mime,
    warn,
    sendError: (status, msg) => fail(res, status, msg),
  })
}

async function serveCover(req, res, library, storage, warn) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '方法不允许')
  const url = new URL(req.url ?? '/', 'http://dsh-music.local')
  const record = resolveTrack(url, COVER_PREFIX, library, res)
  if (!record) return
  if (!record.meta.hasCover) return fail(res, 404, '该曲目无内嵌封面')
  const cacheFile = storage.coverFile(record.id, record.meta.mtimeMs)
  let buf = null
  try {
    buf = await readFile(cacheFile)
  } catch {
    /* 缓存未命中 */
  }
  if (!buf) {
    buf = await library.reader.extractCover(record.filePath)
    if (buf) {
      try {
        await writeFile(cacheFile, buf)
      } catch (err) {
        warn(`dsh-music: 写封面缓存失败: ${err.message}`)
      }
    }
  }
  if (!buf || buf.length === 0) return fail(res, 404, '封面提取失败')
  const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  res.writeHead(200, {
    'Content-Type': isPng ? 'image/png' : 'image/jpeg',
    'Content-Length': buf.length,
    'Cache-Control': 'private, max-age=86400',
  })
  res.end(req.method === 'HEAD' ? undefined : buf)
}

/** 插件图标：包内 icon.png 读一次后常驻内存；缺失时 404（客户端会退回内嵌 Logo）。 */
async function serveIcon(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '方法不允许')
  if (!iconBuffer) {
    try {
      iconBuffer = await readFile(ICON_FILE)
    } catch {
      iconBuffer = null
    }
  }
  if (!iconBuffer || iconBuffer.length === 0) return fail(res, 404, '插件图标不存在')
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': iconBuffer.length,
    'Cache-Control': 'private, max-age=86400',
  })
  res.end(req.method === 'HEAD' ? undefined : iconBuffer)
}

export function registerRoutes(webServer, { library, playback, storage, logger }) {
  const warn = (msg) => logger?.warn?.(msg)
  const disposers = []

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/dsh-music/api/library',
      handler: async (req, res) => {
        if (req.method !== 'GET') return fail(res, 405, '方法不允许')
        try {
          sendJson(res, 200, await library.ensureScanned())
        } catch (err) {
          warn(`dsh-music: 曲库扫描失败: ${err.message}`)
          fail(res, 500, '曲库扫描失败')
        }
      },
    }),
  )

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/dsh-music/api/rescan',
      handler: async (req, res) => {
        if (req.method !== 'POST') return fail(res, 405, '方法不允许')
        try {
          sendJson(res, 200, await library.rescan())
        } catch (err) {
          warn(`dsh-music: 重扫失败: ${err.message}`)
          fail(res, 500, '曲库重扫失败')
        }
      },
    }),
  )

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/dsh-music/api/playback',
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') return sendJson(res, 200, playback.get())
          if (req.method === 'POST') {
            let patch
            try {
              patch = JSON.parse((await readBody(req)) || '{}')
            } catch {
              return fail(res, 400, '请求体不是合法 JSON')
            }
            if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
              return fail(res, 400, '请求体必须是 JSON 对象')
            }
            try {
              return sendJson(res, 200, playback.report(patch))
            } catch (err) {
              return fail(res, 400, err.message)
            }
          }
          return fail(res, 405, '方法不允许')
        } catch (err) {
          warn(`dsh-music: 播放状态服务错误: ${err.message}`)
          fail(res, 500, '播放状态服务内部错误')
        }
      },
    }),
  )

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/dsh-music/api/playback/next',
      handler: (req, res) => {
        if (req.method !== 'GET') return fail(res, 405, '方法不允许')
        const url = new URL(req.url ?? '/', 'http://dsh-music.local')
        const current = url.searchParams.get('trackId') ?? undefined
        // 首扫未完成时暂不校验（与 playback 上报同策略）
        if (current !== undefined && library.snapshot().scannedAt !== 0 && library.getRecord(current) === undefined) {
          return fail(res, 404, 'trackId 不存在于曲库')
        }
        return sendJson(res, 200, playback.nextTrack(current))
      },
    }),
  )

  disposers.push(
    webServer.register({
      kind: 'prefix',
      path: '/dsh-music/audio',
      handler: (req, res) => serveAudio(req, res, library, warn),
    }),
  )

  disposers.push(
    webServer.register({
      kind: 'prefix',
      path: '/dsh-music/cover',
      handler: (req, res) => serveCover(req, res, library, storage, warn),
    }),
  )

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: ICON_PATH,
      handler: (req, res) => serveIcon(req, res),
    }),
  )

  return disposers
}