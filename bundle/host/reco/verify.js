/** 候选联网核实：MusicBrainz 公开检索（无 key），核实真实存在后才允许进入推荐/下载。
 * 核实记录 {source, url, verifiedAt} 与磐石下载 API 的 checkVerification 完全对齐。
 * 缓存 ~/.dsh/dsh-music/cache/verifications/<key>.json（30 天复用）；限速/退避走共享 mb.js。 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { mbJson, mbUrl } from './mb.js'

const CACHE_TTL_MS = 30 * 24 * 3600 * 1000

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[\s'"’·・\-—–,，.。!！?？:：;；()（）\[\]【】]/g, '')
}

function cacheKey(artist, title) {
  return createHash('sha1').update(norm(`${artist}::${title}`)).digest('hex').slice(0, 16)
}

export function createVerifier({ storage, logger } = {}) {
  const warn = (msg) => logger?.warn?.(msg)
  const dir = join(storage.dataDir, 'cache', 'verifications')

  async function readCache(key) {
    try {
      const saved = JSON.parse(await readFile(join(dir, `${key}.json`), 'utf8'))
      if (saved?.verification?.verifiedAt && Date.now() - saved.verification.verifiedAt < CACHE_TTL_MS) return saved
    } catch { /* 无缓存 */ }
    return null
  }

  async function writeCache(key, record) {
    try {
      await mkdir(dir, { recursive: true })
      const tmp = join(dir, `${key}.tmp-${process.pid}`)
      await writeFile(tmp, JSON.stringify(record), 'utf8')
      await rename(tmp, join(dir, `${key}.json`))
    } catch (err) {
      warn?.(`dsh-music: 写核实缓存失败: ${err.message}`)
    }
  }

  /** artist-credit 与查询歌手比对：任一名字归一后互相包含即认可（容忍 "Beyond" vs "Beyond (乐队)"）。 */
  function artistMatches(credits, artist) {
    const q = norm(artist)
    if (!q) return false
    return credits.some((c) => {
      const n = norm(c?.name ?? c?.artist?.name)
      if (!n) return false
      return n.includes(q) || q.includes(n)
    })
  }

  function titleMatches(candidate, title) {
    const a = norm(candidate)
    const b = norm(title)
    if (!a || !b) return false
    return a.includes(b) || b.includes(a)
  }

  /** 核实一首：命中返回 {verification, matched:{artist,title,durationMs,album}}，未命中返回 null。 */
  async function verify({ artist, title, durationMs }) {
    const key = cacheKey(artist, title)
    const cached = await readCache(key)
    if (cached) return cached

    const query = `artist:"${artist}" AND recording:"${title}"`
    const url = mbUrl('recording', { query, limit: 8 })
    let data = null
    try {
      data = await mbJson(url, { logger })
    } catch (err) {
      warn?.(`dsh-music: MusicBrainz 核实请求失败 ${artist}-${title}: ${err.message}`)
      return null
    }
    // MB recording.length 单位即毫秒；时长已知时选最接近的命中
    const target = Number(durationMs) > 0 ? Number(durationMs) : null
    const recordings = Array.isArray(data?.recordings) ? data.recordings : []
    const hits = recordings.filter((r) => artistMatches(r['artist-credit'] ?? [], artist) && titleMatches(r.title, title))
    if (hits.length === 0) return null
    let best = hits[0]
    if (target !== null) {
      const withDur = hits.filter((r) => Number.isFinite(r.length))
      if (withDur.length > 0) {
        best = withDur.reduce((a, b) => Math.abs(a.length - target) < Math.abs(b.length - target) ? a : b)
      }
    }
    const mbid = best.id
    const release = best.releases?.[0]?.title ?? undefined
    // 四期：release-group id 供封面（coverartarchive front-250）用
    const releaseGroupIds = [...new Set((best.releases ?? [])
      .map((r) => r?.['release-group']?.id)
      .filter(Boolean))].slice(0, 3)
    const record = {
      artist,
      title,
      matched: {
        title: best.title,
        durationMs: Number.isFinite(best.length) ? Math.round(best.length) : undefined,
        album: release,
      },
      releaseGroupIds,
      verification: {
        source: 'musicbrainz',
        url: `https://musicbrainz.org/recording/${mbid}`,
        verifiedAt: Date.now(),
        query,
      },
    }
    await writeCache(key, record)
    return record
  }

  return { verify }
}
