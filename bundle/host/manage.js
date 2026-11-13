/** 曲库管理（二期批2）：用户主动删除本地文件 + Finder 显示。
 * 红线：删除仅由用户主动触发（POST，客户端 UI 调用）；spotify-liked 必须 confirm=true
 * 才删（默认返回需确认标记，绝不默认删收藏）；apple-music 库文件拒删（由 Apple Music 管理）；
 * 路径只经曲库索引解析 + realpath 根内校验，绝不拼接用户输入；不读 refresh_token、不碰管线锁。 */
import { spawn } from 'node:child_process'
import { unlink, stat, realpath } from 'node:fs/promises'
import { sep, dirname } from 'node:path'

const ID_RE = /^[a-f0-9]{16}$/

function spawnOk(file, args) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

/** 在系统文件管理器中显示文件（D9 跨平台）：macOS `open -R`、Windows `explorer /select,`、
 * Linux `xdg-open <目录>`。失败不抛错返回 false——调用方仍返回 filePath，前端可自行降级。 */
function defaultReveal(filePath) {
  if (process.platform === 'darwin') return spawnOk('open', ['-R', filePath])
  if (process.platform === 'win32') return spawnOk('explorer', ['/select,', filePath])
  return spawnOk('xdg-open', [dirname(filePath)])
}

export function createManage({ library, logger, reveal = defaultReveal } = {}) {
  const warn = (msg) => logger?.warn?.(msg)

  /** 索引解析 + 越界防线；返回 {record, real} 或抛带 status 的错误。 */
  async function resolve(trackId) {
    if (typeof trackId !== 'string' || !ID_RE.test(trackId)) {
      const e = new Error('无效的曲目 id'); e.status = 404; throw e
    }
    await library.ensureScanned()
    const record = library.getRecord(trackId)
    if (!record) {
      const e = new Error('曲目不存在或尚未扫描，请先重新扫描'); e.status = 404; throw e
    }
    let real
    try {
      real = await realpath(record.filePath)
    } catch {
      const e = new Error('音频文件不存在'); e.status = 404; throw e
    }
    if (!library.roots().some((root) => real === root || real.startsWith(root + sep))) {
      const e = new Error('文件不在曲库目录内'); e.status = 403; throw e
    }
    return { record, real }
  }

  /** 删除：dsh-music 直接删；spotify-liked 需 confirm=true；apple-music 拒删。 */
  async function remove(trackId, confirm = false) {
    const { record, real } = await resolve(trackId)
    if (record.source === 'apple-music') {
      const e = new Error('Apple Music 库文件请在 Apple Music 应用中管理，插件不支持删除'); e.status = 403; throw e
    }
    if (record.source === 'spotify-liked' && confirm !== true) {
      return {
        deleted: false,
        requiresConfirm: true,
        trackId: record.id,
        source: record.source,
        message: '该曲来自 Spotify 收藏，删除本地文件需二次确认（confirm=true）。取消收藏不会自动删除，是否删除由您决定。',
      }
    }
    const st = await stat(real).catch(() => null)
    if (st && !st.isFile()) {
      const e = new Error('目标不是文件，拒绝删除'); e.status = 403; throw e
    }
    if (st) {
      await unlink(real)
    }
    await library.rescan()
    return {
      deleted: true,
      trackId: record.id,
      source: record.source,
      file: real,
      note: st ? undefined : '文件已不存在，仅从曲库移除',
    }
  }

  /** Finder 显示：返回 filePath 并 open -R。 */
  async function revealTrack(trackId) {
    const { record, real } = await resolve(trackId)
    const revealed = await reveal(real).catch((err) => {
      warn(`dsh-music: Finder 显示失败: ${err.message}`)
      return false
    })
    return { trackId: record.id, filePath: real, revealed }
  }

  return { remove, revealTrack }
}

export function registerManageRoutes(webServer, { manage, logger }) {
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
  const parse = async (req, res) => {
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

  const disposers = []
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/library/delete',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不允许' })
      try {
        const body = await parse(req, res)
        if (!body) return
        const result = await manage.remove(body.trackId, body.confirm === true)
        return sendJson(res, 200, result)
      } catch (err) {
        if (err.status) return sendJson(res, err.status, { error: err.message })
        warn(`dsh-music: 删除服务错误: ${err.message}`)
        return sendJson(res, 500, { error: '删除服务内部错误' })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/library/reveal',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不允许' })
      try {
        const body = await parse(req, res)
        if (!body) return
        const result = await manage.revealTrack(body.trackId)
        return sendJson(res, 200, result)
      } catch (err) {
        if (err.status) return sendJson(res, err.status, { error: err.message })
        warn(`dsh-music: Finder 显示错误: ${err.message}`)
        return sendJson(res, 500, { error: 'Finder 显示内部错误' })
      }
    },
  }))
  return disposers
}