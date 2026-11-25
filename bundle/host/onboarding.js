/** 七期批2：首启 onboarding 状态机（欢迎页/个性化设置/曲库选择）。
 * GET  /dsh-music/api/onboarding/state   → {completed, libraryConfigured, mode, prefs, libraryPath, starter}
 * POST /dsh-music/api/onboarding/complete → 完成设置（taste + libraryMode: local|starter）
 * 语义（与 Client 契约）：
 *  - completed=false 才弹欢迎页；端点缺失/失败绝不打扰老用户。
 *  - 既有非空曲库自动 completed=true、mode='existing'（老用户零打扰）。
 *  - mode='custom'（用户指向已有音乐库）→ libraryConfigured=true，Client 进曲库页。
 *  - mode='starter'（用插件默认曲库）→ libraryConfigured=false，starter 串行下载完成后自动入库，Client 进推荐页。
 *  - 状态只写 ~/.dsh/dsh-music/onboarding.json（仅本地，不上传）。 */
import { stat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { expandHome } from './library.js'

const PREFS_MAX_BYTES = 4096

function sanitizePrefs(prefs) {
  if (prefs == null) return { ok: true, prefs: {} }
  if (typeof prefs !== 'object' || Array.isArray(prefs)) return { ok: false, error: '个性化设置必须是 JSON 对象' }
  let text
  try {
    text = JSON.stringify(prefs)
  } catch {
    return { ok: false, error: '个性化设置无法序列化' }
  }
  if (text.length > PREFS_MAX_BYTES) return { ok: false, error: '个性化设置过大' }
  return { ok: true, prefs: JSON.parse(text) }
}

export function createOnboarding({ storage, library, starter, config = {}, logger }) {
  const warn = (msg) => logger?.warn?.(msg)
  const file = join(storage.dataDir, 'onboarding.json')
  let saved = null
  let loaded = false

  async function load() {
    if (loaded) return saved
    const raw = await storage.readJson(file, null)
    saved = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { completed: false, mode: null, prefs: {}, libraryPath: null, completedAt: null, ...raw }
      : { completed: false, mode: null, prefs: {}, libraryPath: null, completedAt: null }
    loaded = true
    // 重启后把用户自选音乐库重新挂回扫描根（目录不存在则忽略）
    if (saved.libraryPath) {
      try {
        await library.addDirectory(saved.libraryPath, 'custom')
      } catch (err) {
        warn(`dsh-music: 恢复自定义曲库失败: ${err.message}`)
      }
    }
    return saved
  }

  async function persist() {
    try {
      await storage.writeJson(file, saved)
    } catch (err) {
      warn(`dsh-music: 写 onboarding.json 失败: ${err.message}`)
      throw err
    }
  }

  async function starterState() {
    if (!starter) return null
    try {
      return await starter.state()
    } catch {
      return null
    }
  }

  /** 当前状态（对 Client 的全部字段）。 */
  async function state() {
    const s = await load()
    if (!s.completed) {
      // 既有非空曲库 → 自动完成（老用户不受欢迎页打扰）
      try {
        await library.ensureScanned()
      } catch (err) {
        warn(`dsh-music: onboarding 检查曲库失败: ${err.message}`)
      }
      if (library.snapshot().tracks.length > 0) {
        s.completed = true
        s.mode = 'existing'
        s.completedAt = Date.now()
        await persist().catch(() => {})
      }
    }
    const st = await starterState()
    return {
      completed: Boolean(s.completed),
      mode: s.mode ?? null,
      libraryConfigured: s.mode === 'existing' || s.mode === 'custom',
      libraryPath: s.libraryPath ?? null,
      prefs: s.prefs ?? {},
      completedAt: s.completedAt ?? null,
      starter: st,
    }
  }

  /** 完成首启设置。返回 { error } 或 { state, startedStarter }。 */
  async function complete(body = {}) {
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      return { error: '请求体必须是 JSON 对象' }
    }
    const prefsResult = sanitizePrefs(body.prefs ?? body.taste)
    if (!prefsResult.ok) return { error: prefsResult.error }
    const s = await load()

    const modeHint = typeof body.libraryMode === 'string' ? body.libraryMode : null
    const rawPath = body.libraryPath != null ? String(body.libraryPath).trim() : ''
    let libraryPath = null
    let mode

    if (rawPath) {
      // 用户指向一个具体音乐目录（可选）：路径必须真实存在
      const candidate = rawPath
      const p = expandHome(candidate)
      let isDir = false
      try {
        isDir = (await stat(p)).isDirectory()
      } catch {
        isDir = false
      }
      if (!isDir) return { error: '曲库路径不存在或不是目录' }
      libraryPath = await realpath(p).catch(() => p)
      try {
        await library.addDirectory(libraryPath, 'custom')
      } catch (err) {
        warn(`dsh-music: 添加自定义曲库失败: ${err.message}`)
      }
      mode = 'custom'
    } else if (modeHint === 'local' || body.libraryConfigured === true) {
      // 「使用我已有的音乐库」：直接用已扫描到的曲库（spotify-liked / 系统音乐），不需要路径
      try {
        await library.ensureScanned()
      } catch (err) {
        warn(`dsh-music: complete(local) 扫描曲库失败: ${err.message}`)
      }
      mode = 'existing'
    } else if (modeHint === 'skip' || body.useStarter === false || body.skipStarter === true) {
      mode = 'none'
    } else {
      mode = 'starter'
    }

    s.completed = true
    s.completedAt = Date.now()
    s.mode = mode
    s.prefs = prefsResult.prefs
    s.libraryPath = libraryPath
    await persist()

    let startedStarter = false
    if (mode === 'starter' && starter) {
      /* 已就绪的 starter 不重复下载（设置页反复保存不应重取）；failed/skipped 才允许重试 */
      const st = await starterState()
      if (st && st.status === 'ready') {
        startedStarter = false
      } else {
        try {
          startedStarter = starter.provision() === true
        } catch (err) {
          warn(`dsh-music: starter provisioning 启动失败: ${err.message}`)
        }
      }
    }
    return { state: await state(), startedStarter }
  }

  return { file, state, complete }
}

export function registerOnboardingRoutes(webServer, { onboarding, logger }) {
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

  const disposers = []
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/onboarding/state',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      try {
        return sendJson(res, 200, await onboarding.state())
      } catch (err) {
        warn(`dsh-music: onboarding state 失败: ${err.message}`)
        return sendJson(res, 500, { error: '读取首启状态失败' })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/onboarding/complete',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不允许' })
      let body
      try {
        body = JSON.parse((await readBody(req)) || '{}')
      } catch {
        return sendJson(res, 400, { error: '请求体不是合法 JSON' })
      }
      try {
        const result = await onboarding.complete(body)
        if (result.error) return sendJson(res, 400, { error: result.error })
        return sendJson(res, 200, { ok: true, ...result })
      } catch (err) {
        warn(`dsh-music: onboarding complete 失败: ${err.message}`)
        return sendJson(res, 500, { error: '保存首启设置失败' })
      }
    },
  }))
  return disposers
}
