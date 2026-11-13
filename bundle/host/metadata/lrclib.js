/** LRCLIB 客户端：免密钥，node22 全局 fetch，零外部依赖。
 * 端点（PRD 已核实）：GET /api/get（精确，duration 未知必须省略）、GET /api/search（模糊）。
 * 所有失败/无命中返回 null，由管线降级，绝不抛错给路由。 */

const BASE = 'https://lrclib.net/api'
const UA = 'dsh-music/0.1 (local music plugin; lyrics pipeline)'

async function getJson(url, timeoutMs) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 精确查询。artist/title 必填；album/duration 可选（duration 非有限正数则省略，避免空串 400）。 */
export async function lrclibGet({ artist, title, album, duration }, timeoutMs = 12000) {
  if (!artist || !title) return null
  const params = new URLSearchParams()
  params.set('artist_name', artist)
  params.set('track_name', title)
  if (album) params.set('album_name', album)
  if (Number.isFinite(duration) && duration > 0) params.set('duration', String(Math.round(duration)))
  const data = await getJson(`${BASE}/get?${params}`, timeoutMs)
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null
}

/** 模糊查询，返回数组（可能为空）。 */
export async function lrclibSearch(query, timeoutMs = 12000) {
  if (!query || !query.trim()) return []
  const params = new URLSearchParams({ q: query.trim() })
  const data = await getJson(`${BASE}/search?${params}`, timeoutMs)
  return Array.isArray(data) ? data : []
}

/** 从搜索候选按时长接近度择优（duration 未知则取第一个有词的）。 */
export function pickBest(candidates, duration) {
  const usable = candidates.filter((c) => c && !c.instrumental && (c.syncedLyrics || c.plainLyrics))
  if (usable.length === 0) return null
  if (!Number.isFinite(duration) || duration <= 0) {
    return usable.find((c) => c.syncedLyrics) ?? usable[0]
  }
  let best = null
  let bestDiff = Infinity
  for (const c of usable) {
    const d = Number.isFinite(c.duration) ? Math.abs(c.duration - duration) : Infinity
    // 同步歌词优先：时长差相近时偏好 synced
    const score = d - (c.syncedLyrics ? 0.5 : 0)
    if (score < bestDiff) {
      bestDiff = score
      best = c
    }
  }
  return best
}

/** 组合管线：先精确 get，未命中再 search 择优。返回 LRCLIB 记录或 null。 */
export async function fetchLyrics({ artist, title, album, duration }, timeoutMs = 12000) {
  const exact = await lrclibGet({ artist, title, album, duration }, timeoutMs)
  if (exact && !exact.instrumental && (exact.syncedLyrics || exact.plainLyrics)) return exact
  const candidates = await lrclibSearch(`${artist} ${title}`, timeoutMs)
  return pickBest(candidates, duration)
}