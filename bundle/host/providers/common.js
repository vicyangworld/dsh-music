/**
 * 第三方音乐平台只读客户端的公共小工具（零外部依赖，仅 node: 内置模块）。
 *
 * 这些客户端访问的都是非官方接口，只做“读喜欢列表”这一件事：
 * 不写账号、不下拉音源、不缓存任何与账号无关的数据。
 */

export function httpError(message, status = 502, extra) {
  const err = new Error(message)
  err.status = status
  if (extra) Object.assign(err, extra)
  return err
}

/** 解析粘贴过来的 Cookie 文本（允许换行、允许带 "Cookie:" 前缀）→ 普通对象 */
export function parseCookie(text) {
  const out = {}
  if (!text || typeof text !== 'string') return out
  const flat = text.replace(/^(\s|cookie:)+/i, '').replace(/[\r\n]+/g, ';')
  for (const part of flat.split(';')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    const key = part.slice(0, i).trim()
    let value = part.slice(i + 1).trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (key && !(key in out)) out[key] = value
  }
  return out
}

/** GET/POST 并解析 JSON；非 2xx 或非 JSON 时抛出带 status 的错误（供路由层映射为 502） */
export async function fetchJson(url, init, fetchImpl, timeoutMs) {
  const F = fetchImpl || globalThis.fetch
  if (typeof F !== 'function') throw httpError('当前运行环境没有 fetch', 500)
  let res
  try {
    res = await F(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (err && err.name === 'TimeoutError') throw httpError('连接超时', 504)
    throw httpError(`网络请求失败：${err && err.message ? err.message : err}`, 502)
  }
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  if (!res.ok) throw httpError(`接口返回 HTTP ${res.status}`, 502)
  if (!json || typeof json !== 'object') throw httpError('接口返回了非 JSON 内容（可能被风控或网络劫持）', 502)
  return { json, res }
}

/** 读取多值 Set-Cookie（Node ≥ 19.7 有 getSetCookie；旧实现退回按行拆分） */
export function readSetCookies(res) {
  const headers = res && res.headers
  if (!headers) return []
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const raw = typeof headers.get === 'function' ? headers.get('set-cookie') : null
  return raw ? String(raw).split(/\r?\n/) : []
}

/** 清洗外部文本：折叠空白、裁剪长度 */
export function cleanText(value, max = 300) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max)
}
