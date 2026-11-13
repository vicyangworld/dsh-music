/** Spotify 一键同步后端：只调用 spotify-sync CLI，凭据由 CLI 间接使用。
 * 本模块绝不读取/移动/删除 ~/.config/spotify-sync/refresh_token，也不触碰该目录其他文件
 * （锁由 CLI 自己管理；与推荐下载共享同一把锁，天然互斥）。
 * 取消收藏不触发本地删除（CLI 语义：只报「移除 N」）。同步成功后自动重扫入库。
 * D6 分发修复：不硬编码本机技能脚本路径——CLI 经 PATH/config 探测；缺失时同步标为
 * 可选功能并给中文安装引导，绝不让整个插件/用户流程因它不可用。 */
import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

const SYNC_TIMEOUT_MS = 30 * 60 * 1000
const MAX_LINES = 300
const OPTIONAL_HINT = '未检测到 spotify-sync CLI。Spotify 同步是可选功能：安装 spotify-sync 后即可启用（或在本插件 config 中设置 syncCommand / syncScriptPath），不影响本地曲库、搜索、试听与推荐。'

/** 解析 CLI 输出：云端/新增/移除 行、逐曲结果行、「完成 {...}」汇总（Python dict repr）。 */
export function parseSyncOutput(lines) {
  const result = { cloud: null, added: null, removed: null, ok: 0, mismatch: 0, skip: 0, fail: 0, ts: null, missing: null }
  const tracks = []
  for (const line of lines) {
    const head = /云端收藏\s*(\d+)\s*首\s*\|\s*新增\s*(\d+)\s*\|\s*移除\s*(\d+)/.exec(line)
    if (head) {
      result.cloud = Number(head[1])
      result.added = Number(head[2])
      result.removed = Number(head[3])
    }
    const track = /^\[(\d+)\/(\d+)\]\s+(\w+)\s+(.+)$/.exec(line)
    if (track) tracks.push({ index: Number(track[1]), total: Number(track[2]), status: track[3].toLowerCase(), detail: track[4] })
    const done = /完成\s*(\{.*\})/.exec(line)
    if (done) {
      for (const m of done[1].matchAll(/'?(\w+)'?:\s*(?:'([^']*)'|(\d+))/g)) {
        const key = m[1]
        const value = m[2] !== undefined ? m[2] : Number(m[3])
        if (key in result) result[key] = value
      }
    }
  }
  return { result, tracks }
}

async function executable(file) {
  try {
    await access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function findOnPath(name) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (await executable(candidate)) return candidate
  }
  return null
}

export function createSync({ library, config = {}, logger }) {
  const warn = (msg) => logger?.warn?.(msg)
  let child = null
  let cached = null
  let state = {
    running: false,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    result: null,
    tracks: [],
    lines: [],
    error: null,
  }

  /** 探测 CLI 可用性（不跑同步）：config.syncCommand → PATH 的 spotify-sync →
   * config.syncScriptPath（python3 直跑技能脚本）。结果进程内缓存，probe() 可强制重探。 */
  async function availability() {
    if (cached) return cached
    const cmd = typeof config.syncCommand === 'string' && config.syncCommand ? config.syncCommand : null
    if (cmd) {
      if (await executable(cmd)) {
        cached = { available: true, mode: 'cli', command: cmd, message: null }
        return cached
      }
      warn(`dsh-music: 配置的 syncCommand 不可执行（${cmd}），继续探测 PATH`)
    }
    const found = await findOnPath('spotify-sync')
    if (found) {
      cached = { available: true, mode: 'cli', command: found, message: null }
      return cached
    }
    const script = typeof config.syncScriptPath === 'string' && config.syncScriptPath ? config.syncScriptPath : null
    if (script && await executable(script)) {
      const python = config.pythonPath || (await findOnPath('python3')) || '/usr/bin/python3'
      cached = { available: true, mode: 'script', command: python, script, message: null }
      return cached
    }
    cached = { available: false, mode: null, command: null, message: OPTIONAL_HINT }
    return cached
  }

  async function launch(args = []) {
    const av = await availability()
    if (!av.available) {
      const err = new Error(OPTIONAL_HINT)
      err.code = 'SYNC_OPTIONAL_UNAVAILABLE'
      throw err
    }
    const attempt = (file, a) => new Promise((resolve, reject) => {
      const proc = spawn(file, a, { stdio: ['ignore', 'pipe', 'pipe'] })
      proc.on('error', reject)
      proc.on('spawn', () => resolve(proc))
    })
    if (av.mode === 'script') return attempt(av.command, ['-I', av.script, ...args])
    return attempt(av.command, args)
  }

  /** 只读 --status：取「缺失」数（云端应有而本地没有的文件），补齐 F7 展示。 */
  async function readMissing() {
    try {
      const proc = await launch(['--status'])
      let out = ''
      proc.stdout.on('data', (c) => { out += c.toString('utf8') })
      const code = await new Promise((resolve) => proc.on('close', resolve))
      if (code !== 0) return null
      const m = /缺失:\s*(\d+)/.exec(out)
      return m ? Number(m[1]) : null
    } catch {
      return null
    }
  }

  async function start() {
    if (state.running) return { busy: true }
    const av = await availability()
    if (!av.available) return { available: false, started: false, message: av.message }
    state = { running: true, startedAt: Date.now(), finishedAt: null, exitCode: null, result: null, tracks: [], lines: [], error: null }
    const snapshot = state
    let proc
    try {
      proc = await launch()
    } catch (err) {
      snapshot.running = false
      snapshot.finishedAt = Date.now()
      snapshot.error = err.code === 'SYNC_OPTIONAL_UNAVAILABLE' ? err.message : `无法启动 spotify-sync CLI：${err.message}`
      return { available: av.available, started: false, error: snapshot.error }
    }
    child = proc
    const pushLine = (line) => {
      if (!line) return
      snapshot.lines.push(line)
      if (snapshot.lines.length > MAX_LINES) snapshot.lines.shift()
    }
    let buf = ''
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      const parts = buf.split('\n')
      buf = parts.pop()
      for (const p of parts) pushLine(p.trimEnd())
    })
    proc.stderr.on('data', (chunk) => {
      for (const p of chunk.toString('utf8').split('\n')) pushLine(p.trimEnd())
    })
    const timer = setTimeout(() => {
      warn('dsh-music: spotify-sync 超时（30 分钟），终止进程')
      proc.kill('SIGKILL')
    }, SYNC_TIMEOUT_MS)
    proc.on('close', async (code) => {
      clearTimeout(timer)
      if (buf.trim()) pushLine(buf.trim())
      child = null
      snapshot.exitCode = code
      snapshot.finishedAt = Date.now()
      snapshot.running = false
      const parsed = parseSyncOutput(snapshot.lines)
      snapshot.result = parsed.result
      snapshot.tracks = parsed.tracks
      if (code === 3) {
        snapshot.error = '已有同步/下载管线在运行（撞锁），请等上一轮结束后再试'
      } else if (code !== 0) {
        snapshot.error = `spotify-sync 退出码 ${code}，详见输出行`
      } else {
        // 同步成功：新下载的歌曲自动入库；再只读 --status 补缺失数
        try {
          await library.rescan()
        } catch (err) {
          warn(`dsh-music: 同步后重扫失败: ${err.message}`)
        }
        snapshot.result.missing = await readMissing()
      }
    })
    return { available: true, started: true }
  }

  return {
    start,
    availability,
    probe: async () => { cached = null; return availability() },
    isRunning: () => state.running,
    async status() {
      const av = await availability()
      const copy = JSON.parse(JSON.stringify(state))
      return { ...copy, available: av.available, mode: av.mode, message: av.message }
    },
    dispose() {
      if (child) child.kill('SIGKILL')
      child = null
    },
  }
}

export function registerSyncRoutes(webServer, { sync, logger }) {
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
  const disposers = []
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/sync',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不允许' })
      try {
        const r = await sync.start()
        if (r.busy) return sendJson(res, 409, { error: '同步已在运行，请等当前轮结束' })
        if (r.available === false) return sendJson(res, 200, { available: false, started: false, message: r.message })
        if (r.error) return sendJson(res, 500, { available: true, started: false, error: r.error })
        return sendJson(res, 202, { available: true, started: true })
      } catch (err) {
        warn(`dsh-music: 同步服务错误: ${err.message}`)
        return sendJson(res, 500, { error: '同步服务内部错误' })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/sync/availability',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      try {
        const av = await sync.availability()
        return sendJson(res, 200, { available: av.available, hint: av.available ? null : av.message })
      } catch (err) {
        warn(`dsh-music: 同步可用性探测错误: ${err.message}`)
        return sendJson(res, 500, { error: '同步可用性探测内部错误' })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/sync/status',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      try {
        return sendJson(res, 200, await sync.status())
      } catch (err) {
        warn(`dsh-music: 同步状态错误: ${err.message}`)
        return sendJson(res, 500, { error: '同步状态内部错误' })
      }
    },
  }))
  return disposers
}