/** 歌词管线：缓存 → 内嵌 → LRCLIB live → 联网调研缓存 → none 降级。
 * 命中即原子写缓存（二次打开秒开）；同一 track 并发去重；任何失败降级为 none，绝不抛错给路由。 */
import { parseLrc, plainToLines, fromLrclibRecord } from './lrc.js'
import { fetchLyrics } from './lrclib.js'
import { slugify } from './cache.js'

const NONE_TTL = 24 * 3600 * 1000
const NONE_MESSAGE = '暂无歌词，仅播放'

export function createLyricsPipeline({ library, cache, embedded, logger }) {
  const warn = (msg) => logger?.warn?.(msg)
  const inflight = new Map()

  function payload(trackId, source, data, cached, fetchedAt, message) {
    return {
      trackId,
      source,
      synced: data?.synced ?? false,
      lines: data?.lines ?? [],
      plain: data?.plain ?? null,
      cached,
      fetchedAt,
      message: message ?? null,
    }
  }

  function embeddedToData(text) {
    if (/\[\d{1,3}:\d{2}/.test(text)) {
      const lines = parseLrc(text)
      if (lines.length > 0) return { synced: true, lines, plain: text }
    }
    return { synced: false, lines: plainToLines(text), plain: text }
  }

  async function save(id, source, data, message) {
    try {
      await cache.writeJson(cache.lyricsFile(id), {
        version: 1,
        source,
        data,
        message: message ?? null,
        fetchedAt: Date.now(),
      })
    } catch (err) {
      warn(`dsh-music: 写歌词缓存失败 ${id}: ${err.message}`)
    }
  }

  async function resolve(record) {
    const id = record.id
    const meta = record.meta ?? {}

    // 1) 缓存命中（none 结果带 TTL，过期则重新解析）
    const hit = await cache.readJson(cache.lyricsFile(id))
    if (hit && hit.version === 1) {
      if (hit.source === 'none') {
        if (Date.now() - (hit.fetchedAt ?? 0) < NONE_TTL) {
          return payload(id, 'none', null, true, hit.fetchedAt, hit.message ?? NONE_MESSAGE)
        }
      } else if (hit.data) {
        return payload(id, hit.source, hit.data, true, hit.fetchedAt, null)
      }
    }

    // 2) 内嵌标签歌词
    const emb = await embedded.extract(record.filePath)
    if (emb && emb.text) {
      const data = embeddedToData(emb.text)
      await save(id, 'embedded', data)
      return payload(id, 'embedded', data, false, Date.now(), null)
    }

    // 3) LRCLIB live（精确 get → 模糊 search 择优）
    const rec = await fetchLyrics({
      artist: meta.artist,
      title: meta.title,
      album: meta.album,
      duration: meta.duration,
    })
    const data = fromLrclibRecord(rec)
    if (data) {
      await save(id, 'lrclib', data)
      return payload(id, 'lrclib', data, false, Date.now(), null)
    }

    // 4) 联网调研歌词缓存（scripts/content 预填）
    const slug = slugify(`${meta.artist ?? ''}-${meta.title ?? ''}`)
    const web = await cache.readJson(cache.webLyricsFile(slug))
    if (web && web.data) {
      await save(id, 'web', web.data)
      return payload(id, 'web', web.data, false, web.fetchedAt ?? Date.now(), null)
    }

    // 5) 降级：无歌词
    await save(id, 'none', null, NONE_MESSAGE)
    return payload(id, 'none', null, false, Date.now(), NONE_MESSAGE)
  }

  return {
    /** @returns 歌词载荷，或 {error:'notfound'}（id 不在曲库）。 */
    async get(trackId) {
      const record = library.getRecord(trackId)
      if (!record) return { error: 'notfound' }
      if (inflight.has(trackId)) return inflight.get(trackId)
      const job = resolve(record).finally(() => inflight.delete(trackId))
      inflight.set(trackId, job)
      return job
    },
  }
}