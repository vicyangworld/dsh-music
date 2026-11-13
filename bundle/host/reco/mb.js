/** MusicBrainz 共享客户端：全局限速（匿名 ≥1.05s/请求）+ 503/502 退避重试。
 * 候选发现（discover.js）与核实（verify.js）共用同一个限速器，避免叠加超频。
 * 无 key、无付费依赖；UA 按 MB 匿名访问规范携带。 */
const UA = 'dsh-music-plugin/0.1.0 ( local plugin )'
const MIN_INTERVAL_MS = 1050
let lastCall = 0

/** 请求 MB JSON API。503/502 退避重试（2.5s/5s），其余错误抛出由调用方降级。 */
export async function mbJson(url, { logger, retries = 3 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2500 * attempt))
    const wait = lastCall + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCall = Date.now()
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    })
    if (resp.status === 503 || resp.status === 502) continue
    if (!resp.ok) throw new Error(`MusicBrainz HTTP ${resp.status}`)
    return resp.json()
  }
  throw new Error('MusicBrainz 持续限速（503），本次请求放弃')
}

export function mbUrl(path, params = {}) {
  const qs = new URLSearchParams({ fmt: 'json', ...params })
  return `https://musicbrainz.org/ws/2/${path}?${qs}`
}
