/** 图片供给（四期批1）：歌手/乐队真实图 + 歌曲封面 URL。
 * - 歌手图：维基百科 REST summary（thumbnail/original，已实测带 UA 返回 JSON），失败回退 action=query pageimages；
 * - 歌曲封面：MusicBrainz coverartarchive（release-group front-250）为主源；本机网络实测 CAA 307 跳转
 *   archive.org 后不可达，故默认改用 iTunes 公开搜索 API 的 artworkUrl100（公开源、无 key），
 *   通过 URL 尺寸段替换取 500x500；两源都失败返回 null（前端兜底，不报错）。
 * - 全部本机缓存 cache/reco/img-*.json（30 天；负结果 3 天），不引 LLM，不上传。
 * 磁盘缓存仅存 URL，不下载图片字节。 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const UA = 'dsh-music-plugin/0.1.0 ( local music plugin )'
const TTL_MS = 30 * 24 * 3600 * 1000
const NEG_TTL_MS = 3 * 24 * 3600 * 1000

export function createImages({ storage, logger, config = {} } = {}) {
  const warn = (msg) => logger?.warn?.(msg)
  const dir = join(storage.dataDir, 'cache', 'reco')
  const source = config.recoCoverSource === 'caa' ? 'caa' : 'itunes'

  const keyOf = (prefix, s) => `${prefix}-${createHash('sha1').update(String(s)).digest('hex').slice(0, 20)}.json`

  async function cacheRead(key, ttl) {
    try {
      const saved = JSON.parse(await readFile(join(dir, key), 'utf8'))
      const age = Date.now() - (saved?.fetchedAt ?? 0)
      const limit = saved?.value == null ? Math.min(ttl, NEG_TTL_MS) : ttl
      if (age < limit) return { hit: true, value: saved.value ?? null }
    } catch { /* 无缓存 */ }
    return { hit: false, value: null }
  }

  async function cacheWrite(key, value) {
    try {
      await mkdir(dir, { recursive: true })
      const tmp = join(dir, `${key}.tmp-${process.pid}`)
      await writeFile(tmp, JSON.stringify({ value, fetchedAt: Date.now() }), 'utf8')
      await rename(tmp, join(dir, key))
    } catch (err) {
      warn?.(`dsh-music: 写图片缓存失败: ${err.message}`)
    }
  }

  /** 维基图片 URL → 1200px 横幅派生（纯函数，便于单测）。
   * 实测：upload.wikimedia.org 对任意像素宽度的 thumb 路径返回 400（仅预渲染尺寸可用），
   * 故改用 commons 的 Special:FilePath?width=1200 按需生成（实测 Bruce 428KB vs 原图 10.4MB）。
   * 仅 commons 文件可派生；en/zh 本地 wiki 的非自由文件原图本就不大，返回 null 由调用方回落原图/缩略图。 */
  function deriveBannerUrl(original) {
    const u = String(original ?? '').trim()
    const m = u.match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/([^/]+)\/(.+)$/)
    if (!m) return null
    const [, wiki, rest] = m
    if (wiki !== 'commons') return null
    const last = rest.split('/').pop()
    const name = last.match(/^\d+px-(.+)$/)?.[1] ?? last
    if (!name || !/\.(jpe?g|png|gif|webp)$/i.test(name)) return null
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=1200`
  }

  /** 探测派生横幅可达（HEAD，失败退回 Range GET）。返回 boolean。 */
  async function bannerReachable(url) {
    for (const [method, headers] of [['HEAD', {}], ['GET', { Range: 'bytes=0-0' }]]) {
      try {
        const resp = await fetch(url, { method, headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(8000), redirect: 'follow' })
        if (resp.ok || resp.status === 206) {
          const ct = resp.headers.get('content-type') ?? ''
          if (ct.startsWith('image/') || ct === '') return true
        }
      } catch { /* 试下一种 */ }
    }
    return false
  }

  /** 歌手页横幅：派生 1200px → 探测 → 回落 thumbnail/original。结果随歌手图缓存（避免每次探测）。 */
  async function bannerFor(img) {
    if (!img) return null
    if (img.banner !== undefined) return img.banner ?? null
    const derived = deriveBannerUrl(img.original)
    let banner = null
    if (derived && await bannerReachable(derived)) banner = derived
    return banner ?? img.thumbnail ?? img.original ?? null
  }

  function normalizeUrl(u) {
    if (typeof u !== 'string' || !/^https:\/\//.test(u)) return null
    // 维基 API 会在 URL 后附 utm_* 追踪参数，去掉以稳定缓存与显示
    try {
      const url = new URL(u)
      for (const k of [...url.searchParams.keys()]) {
        if (k.startsWith('utm_')) url.searchParams.delete(k)
      }
      return url.toString()
    } catch { return null }
  }

  /** 维基 action API 取图（单/批量，最多 50 个标题一请求）。
   * REST summary 有严格限流（20 连发即 429 并回 HTML），改用 action=query 批量。
   * 429/HTML/网络错误视为「暂时失败」：不写负缓存，下次重试。返回 Map name→{thumbnail,original}|null。 */
  async function wikiImages(names) {
    const wanted = [...new Set((names ?? []).slice(0, 50).map((n) => String(n ?? '').trim()).filter(Boolean))]
    const out = new Map()
    if (wanted.length === 0) return out
    const api = 'https://zh.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail|original&pithumbsize=500&format=json&redirects=1&titles='
    let data = null
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 2000))
        const resp = await fetch(api + encodeURIComponent(wanted.join('|')), {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          signal: AbortSignal.timeout(15000),
        })
        const ct = resp.headers.get('content-type') ?? ''
        if (resp.status === 429 || !ct.includes('json')) continue // 限流/HTML 拦截：重试，不缓存
        data = await resp.json()
      } catch (err) {
        warn?.(`dsh-music: 维基图片请求失败: ${err.message}`)
      }
    }
    if (!data) return out // 暂时失败：调用方视作 null 且不缓存
    const query = data.query ?? {}
    // 标题归一化/重定向映射：请求名 → 实际页标题
    const alias = new Map()
    for (const n of query.normalized ?? []) alias.set(n.from, n.to)
    for (const r of query.redirects ?? []) alias.set(r.from, r.to)
    const byTitle = new Map()
    for (const page of Object.values(query.pages ?? {})) {
      if (page?.title) byTitle.set(page.title, {
        thumbnail: normalizeUrl(page.thumbnail?.source),
        original: normalizeUrl(page.original?.source),
      })
    }
    for (const name of wanted) {
      const t = alias.get(name) ?? name
      const v = byTitle.get(t) ?? { thumbnail: null, original: null }
      out.set(name, (v.thumbnail || v.original) ? v : null)
    }
    // 兜底：zh 页有页面但无图（如非自由图片被 pageimages 排除）→ 经 langlinks 取英文页 REST summary 图片
    const misses = [...out.entries()].filter(([, v]) => v === null).map(([k]) => k)
    if (misses.length > 0) {
      const enTitles = await enTitlesFor(misses)
      const unresolved = []
      for (const zhName of misses) {
        const enTitle = enTitles.get(zhName)
        if (enTitle) {
          const v = await enSummaryImage(enTitle)
          if (v) { out.set(zhName, v); continue }
        }
        unresolved.push(zhName)
      }
      // 最后兜底：无 zh langlink 时直接按原名查英文维基（如 The E Street Band）
      for (const name of unresolved) {
        if (/[\u4e00-\u9fff]/.test(name)) continue // 纯中文名直查英文页无意义
        const v = await enSummaryImage(name)
        if (v) out.set(name, v)
      }
    }
    return out
  }

  /** zh 标题 → en 标题（langlinks 批量一条请求）。返回 Map zhName→enTitle。 */
  async function enTitlesFor(names) {
    const map = new Map()
    try {
      const api = 'https://zh.wikipedia.org/w/api.php?action=query&prop=langlinks&lllang=en&format=json&redirects=1&titles='
      const resp = await fetch(api + encodeURIComponent(names.join('|')), {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      })
      const ct = resp.headers.get('content-type') ?? ''
      if (!resp.ok || !ct.includes('json')) return map
      const j = await resp.json()
      const query = j?.query ?? {}
      const alias = new Map()
      for (const n of query.normalized ?? []) alias.set(n.from, n.to)
      for (const r of query.redirects ?? []) alias.set(r.from, r.to)
      const byTitle = new Map()
      for (const page of Object.values(query.pages ?? {})) {
        if (page?.title && page.langlinks?.[0]?.['*']) byTitle.set(page.title, page.langlinks[0]['*'])
      }
      for (const name of names) {
        const t = alias.get(name) ?? name
        const en = byTitle.get(t)
        if (en) map.set(name, en)
      }
    } catch (err) {
      warn?.(`dsh-music: langlinks 查询失败: ${err.message}`)
    }
    return map
  }

  /** 英文维基 REST summary 取图（单请求，失败 null；429/HTML 不缓存）。 */
  async function enSummaryImage(enTitle) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500))
        const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(enTitle)}`, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          signal: AbortSignal.timeout(12000),
        })
        const ct = resp.headers.get('content-type') ?? ''
        if (!ct.includes('json')) continue
        const j = await resp.json()
        const value = { thumbnail: normalizeUrl(j?.thumbnail?.source), original: normalizeUrl(j?.originalimage?.source) }
        return (value.thumbnail || value.original) ? value : null
      } catch (err) {
        warn?.(`dsh-music: 英文维基图片失败 ${enTitle}: ${err.message}`)
      }
    }
    return null
  }

  /** 批量歌手图（sections 歌手栏 20 位一次请求）。缓存 30 天；暂时失败不缓存。 */
  async function artistImages(names) {
    const result = new Map()
    const missing = []
    for (const name of [...new Set((names ?? []).map((n) => String(n ?? '').trim()).filter(Boolean))]) {
      const key = keyOf('img-artist', name.toLowerCase())
      const cached = await cacheRead(key, TTL_MS)
      if (cached.hit) result.set(name, cached.value)
      else missing.push(name)
    }
    if (missing.length === 0) return result
    const fetched = await wikiImages(missing)
    for (const [name, value] of fetched) {
      result.set(name, value)
      if (value !== undefined) await cacheWrite(keyOf('img-artist', name.toLowerCase()), value ?? null)
    }
    return result
  }

  /** 轻量歌手头像查询（六期批2）：只返回 {thumbnail, original}，不探测横幅、不拉简介。
   * 复用 artistImages 缓存（30 天）+ 维基兜底链；失败 null。供 UI 各处小头像使用。 */
  async function artistAvatar(name) {
    const raw = String(name ?? '').trim()
    if (!raw) return null
    const all = await artistImages([raw])
    const img = all.get(raw) ?? null
    if (!img) return null
    return { thumbnail: img.thumbnail, original: img.original }
  }

  /** 单歌手图（歌手页）。优先缓存，其次走批量（1 个标题）。
   * 附带 banner（1200px 派生，探测后随缓存持久化；失败回落缩略图/原图）。 */
  async function artistImage(name) {
    const key = keyOf('img-artist', String(name ?? '').toLowerCase().trim())
    const all = await artistImages([name])
    const img = all.get(String(name ?? '').trim()) ?? null
    if (!img) return null
    if (img.banner !== undefined) return img
    const banner = await bannerFor(img)
    const enriched = { ...img, banner }
    await cacheWrite(key, enriched)
    return enriched
  }

  /** 歌曲封面 URL：CAA（可选主源）→ iTunes 公开源。失败返回 null。 */
  async function coverUrl({ artist, title, releaseGroupIds = [] } = {}) {
    const cacheKeyStr = `${artist}::${title}`
    const key = keyOf('img-cover', cacheKeyStr.toLowerCase().trim())
    const cached = await cacheRead(key, TTL_MS)
    if (cached.hit) return cached.value
    let value = null
    if (source === 'caa') {
      const rgid = Array.isArray(releaseGroupIds) ? releaseGroupIds.find(Boolean) : null
      if (rgid) value = `https://coverartarchive.org/release-group/${rgid}/front-250`
    }
    if (!value) {
      try {
        const term = encodeURIComponent(`${artist ?? ''} ${title ?? ''}`.trim())
        const resp = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          signal: AbortSignal.timeout(12000),
        })
        if (resp.ok) {
          const j = await resp.json()
          const art = j?.results?.[0]?.artworkUrl100
          if (typeof art === 'string') {
            value = art.replace('/100x100bb.', '/500x500bb.')
          }
        }
      } catch (err) {
        warn?.(`dsh-music: 封面获取失败 ${artist}-${title}: ${err.message}`)
      }
    }
    await cacheWrite(key, value)
    return value
  }

  return { artistImage, artistImages, artistAvatar, coverUrl, deriveBannerUrl, dispose() {} }
}
