/** Optional bridge to an explicitly configured local learned-motion service.
 * No endpoint or weights are bundled. A provider's manifest is a declaration;
 * it does not establish training quality or real-time suitability. */
import { MOTION_PROTOCOL, MOTION_LIMITS, MotionError, validateMotionRequest, validateMotionStatus, validateMotionSequence, sameMotionBody } from '../shared/motion-core.js'

const unavailable = (reason = '未连接学习型运动模型。') => ({ protocol: MOTION_PROTOCOL, status: 'unavailable', available: false, reason, model: null })

export function normalizeMotionEndpoint(value) {
  if (!value) return null
  let url
  try { url = new URL(value) } catch { throw new MotionError('运动服务地址无效。', 'MOTION_ENDPOINT_INVALID', 503) }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || Number(url.port) < 1024 || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new MotionError('运动服务只支持显式配置的本机回环端口。', 'MOTION_ENDPOINT_INVALID', 503)
  }
  return url.origin
}

async function readResponse(response, maxBytes) {
  if (!response.ok) throw new MotionError('本机运动模型尚未返回可用结果。', 'MOTION_PROVIDER_ERROR', 503)
  if (Number(response.headers.get('content-length')) > maxBytes) throw new MotionError('模型返回的数据过大。', 'MOTION_TOO_LARGE', 502)
  const reader = response.body?.getReader()
  if (!reader) throw new MotionError('模型返回了空响应。', 'MOTION_PROVIDER_ERROR', 502)
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new MotionError('模型返回的数据过大。', 'MOTION_TOO_LARGE', 502)
      chunks.push(Buffer.from(value))
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new MotionError('模型响应不是有效 JSON。', 'MOTION_PROVIDER_ERROR', 502) }
  } finally { await reader.cancel().catch(() => {}) }
}

export function createMotionService({ life, endpoint = process.env.ECHO_MOTION_ENDPOINT, fetcher = globalThis.fetch, timeoutMs = 2000, now = Date.now } = {}) {
  let origin, configurationError
  try { origin = normalizeMotionEndpoint(endpoint) } catch (err) { configurationError = err }
  const timeout = Math.max(100, Math.min(10000, Number.isFinite(timeoutMs) ? timeoutMs : 2000))
  let cached = null, checkedAt = -Infinity, busy = false
  const active = new Set()
  let disposed = false

  async function call(path, input, signal, bytes) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, timeout)
    active.add(controller)
    try {
      const response = await fetcher(`${origin}${path}`, { method: input ? 'POST' : 'GET', headers: { Accept: 'application/json', ...(input ? { 'Content-Type': 'application/json' } : {}) }, body: input ? JSON.stringify(input) : undefined, signal: controller.signal, redirect: 'error' })
      return await readResponse(response, bytes)
    } catch (err) {
      if (controller.signal.aborted) throw new MotionError('运动模型响应超时或请求已取消。', 'MOTION_TIMEOUT', 503)
      if (err instanceof MotionError) throw err
      throw new MotionError('本机运动模型暂时无法连接。', 'MOTION_PROVIDER_UNAVAILABLE', 503)
    } finally {
      clearTimeout(timer)
      active.delete(controller)
      signal?.removeEventListener('abort', abort)
    }
  }

  async function status({ force = false } = {}) {
    if (disposed) return unavailable('运动服务已关闭。')
    if (configurationError) return unavailable(configurationError.message)
    if (!origin) return unavailable()
    if (!force && cached && now() - checkedAt < 5000) return structuredClone(cached)
    try { cached = validateMotionStatus(await call('/status', null, null, 16 * 1024)) }
    catch { cached = unavailable('本机学习型运动模型尚未就绪。') }
    checkedAt = now()
    return structuredClone(cached)
  }

  async function generate(raw, { signal } = {}) {
    if (disposed) throw new MotionError('运动服务已关闭。', 'MOTION_SERVICE_CLOSED', 503)
    const initial = validateMotionRequest(raw)
    if (!origin || configurationError) throw new MotionError(configurationError?.message || '未连接学习型运动模型。', 'MOTION_MODEL_UNAVAILABLE', 503)
    if (busy) throw new MotionError('上一段运动仍在生成。', 'MOTION_BUSY', 429)
    busy = true
    try {
      const provider = await status()
      if (!provider.available || !provider.supportedTopologies.includes(initial.body.topology)) throw new MotionError('当前身体尚无可用的学习型运动模型。', 'MOTION_MODEL_UNAVAILABLE', 503)
      const current = (await life?.get?.())?.body
      if (!current) throw new MotionError('当前生命尚未建立身体。', 'MOTION_BODY_UNAVAILABLE', 409)
      const request = validateMotionRequest(initial, { authoritativeBody: current })
      const rawSequence = await call('/generate', request, signal, MOTION_LIMITS.responseBytes)
      const latest = (await life.get())?.body
      if (!sameMotionBody(current, latest)) throw new MotionError('生成期间身体已经成长。', 'MOTION_BODY_STALE', 409)
      return validateMotionSequence(rawSequence, request, { currentBody: latest, expectedModel: provider.model })
    } catch (err) {
      if (err?.status >= 500) { cached = null; checkedAt = -Infinity }
      throw err
    } finally { busy = false }
  }
  function dispose() { disposed = true; for (const controller of active) controller.abort(); active.clear() }
  return { status, generate, dispose }
}

function send(res, status, data, headers = {}) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers })
  res.end(body)
}
function readRequest(req) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false
    const chunks = []
    const finish = (err, result) => { if (done) return; done = true; clearTimeout(timer); chunks.length = 0; err ? reject(err) : resolve(result) }
    const timer = setTimeout(() => finish(new MotionError('运动请求读取超时。', 'MOTION_TIMEOUT', 408)), 5000)
    req.on('data', chunk => {
      if (done) return
      size += chunk.length
      if (size > MOTION_LIMITS.requestBytes) return finish(new MotionError('运动请求过大。', 'MOTION_TOO_LARGE', 413))
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (done) return
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { finish(new MotionError('运动请求不是有效 JSON。')) }
    })
    req.on('error', () => finish(new MotionError('运动请求中断。', 'MOTION_REQUEST_ABORTED')))
    req.on('aborted', () => finish(new MotionError('运动请求中断。', 'MOTION_REQUEST_ABORTED')))
  })
}

export function registerMotionRoutes(webServer, { life, logger, ...options } = {}) {
  const service = createMotionService({ life, ...options })
  const routes = [
    ['/dsh-music/api/life/motion', 'GET', () => service.status({ force: true })],
    ['/dsh-music/api/life/motion/generate', 'POST', async (req, signal) => {
      if (String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new MotionError('运动请求需要 JSON 格式。', 'MOTION_CONTENT_TYPE', 415)
      return service.generate(await readRequest(req), { signal })
    }],
  ]
  return [...routes.map(([path, method, handle]) => webServer.register({ kind: 'exact', path, handler: async (req, res) => {
    if (req.method !== method) return send(res, 405, { error: '方法不允许。', code: 'MOTION_METHOD_NOT_ALLOWED' }, { Allow: method })
    const controller = new AbortController()
    const closed = () => { if (!res.writableEnded) controller.abort() }
    res.on?.('close', closed)
    try {
      const result = await handle(req, controller.signal)
      if (!res.destroyed) send(res, 200, result)
    } catch (err) {
      const error = err instanceof MotionError ? err : new MotionError('运动服务暂时不可用。', 'MOTION_PROVIDER_ERROR', 503)
      if (error.status >= 500) logger?.warn?.(`dsh-music: 运动服务 ${error.code}`)
      if (!res.headersSent && !res.destroyed) send(res, error.status, { error: error.message, code: error.code })
    } finally { res.removeListener?.('close', closed) }
  } })), () => service.dispose()]
}
