/** metadata 路由注册（拾词写范围）。由磐石在 host/main.js 接线：
 *   import { registerMetadataRoutes } from './metadata/index.js'
 *   const metaDisposers = registerMetadataRoutes(ctx.webServer, { library, storage, logger, config })
 * 路由：GET exact /dsh-music/api/lyrics?track=<id>；GET exact /dsh-music/api/artist?name=<歌手>。
 * 错误自捕写中文 JSON；降级走 200 + source:none，绝不 5xx。零外部依赖（node22 全局 fetch）。 */
import { createMetadataCache } from './cache.js'
import { createEmbeddedLyrics } from './embedded.js'
import { createLyricsPipeline } from './lyrics.js'
import { createArtistContent } from './artist.js'

const ID_RE = /^[a-f0-9]{16}$/

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

export function registerMetadataRoutes(webServer, { library, storage, logger, config = {} }) {
  const warn = (msg) => logger?.warn?.(msg)
  const cache = createMetadataCache(storage.dataDir)
  const embedded = createEmbeddedLyrics(config)
  const lyrics = createLyricsPipeline({ library, cache, embedded, logger })
  const artist = createArtistContent({ cache, logger })
  const disposers = []

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/dsh-music/api/lyrics',
      handler: async (req, res) => {
        if (req.method !== 'GET') return fail(res, 405, '方法不允许')
        try {
          const url = new URL(req.url ?? '/', 'http://dsh-music.local')
          const id = url.searchParams.get('track') ?? ''
          if (!ID_RE.test(id)) return fail(res, 404, '无效的曲目 id')
          await library.ensureScanned()
          const result = await lyrics.get(id)
          if (result?.error === 'notfound') return fail(res, 404, '曲目不存在或尚未扫描，请先重新扫描')
          return sendJson(res, 200, result)
        } catch (err) {
          warn(`dsh-music: 歌词服务错误: ${err.message}`)
          return fail(res, 500, '歌词服务内部错误')
        }
      },
    }),
  )

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: '/dsh-music/api/artist',
      handler: async (req, res) => {
        if (req.method !== 'GET') return fail(res, 405, '方法不允许')
        try {
          const url = new URL(req.url ?? '/', 'http://dsh-music.local')
          const name = (url.searchParams.get('name') ?? '').trim()
          if (!name) return fail(res, 400, '缺少歌手名')
          const result = await artist.get(name)
          return sendJson(res, 200, result)
        } catch (err) {
          warn(`dsh-music: 歌手内容服务错误: ${err.message}`)
          return fail(res, 500, '歌手内容服务内部错误')
        }
      },
    }),
  )

  return disposers
}