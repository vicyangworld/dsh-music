/** 歌手内容：读调研缓存（scripts/content 预填）→ 未命中 best-effort 维基百科 zh REST summary 兜底 intro。
 * 每条 intro/news/trivia 带 source+date；trivia 用 kind 区分事实/传闻。运行时不调 LLM、不依赖付费 key。 */
import { slugify } from './cache.js'

const UA = 'dsh-music/0.1 (local music plugin; artist content)'
/** 九期点4：简介/资料缓存 TTL 30 天（Chief 建议 7–30 天取上限），过期后下次打开刷新。 */
const PROFILE_TTL_MS = 30 * 24 * 3600 * 1000

function today() {
  return new Date().toISOString().slice(0, 10)
}

async function wikiIntro(name, timeoutMs = 10000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const url = `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal })
    if (!res.ok) return null
    const d = await res.json()
    if (!d || d.type === 'disambiguation' || typeof d.extract !== 'string' || d.extract.trim() === '') return null
    return {
      text: d.extract.trim(),
      source: '维基百科',
      url: d.content_urls?.desktop?.page ?? `https://zh.wikipedia.org/wiki/${encodeURIComponent(name)}`,
      date: today(),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function emptyPayload(name, message) {
  return {
    name,
    intro: null,
    news: [],
    trivia: [],
    similarArtists: [],
    similarSongs: [],
    cached: false,
    fetchedAt: Date.now(),
    message,
  }
}

export function createArtistContent({ cache, logger }) {
  const warn = (msg) => logger?.warn?.(msg)
  return {
    async get(name) {
      const slug = slugify(name)
      const hit = await cache.readJson(cache.artistFile(slug))
      const fresh = hit && hit.version === 1 && hit.data && Date.now() - (hit.fetchedAt ?? 0) < PROFILE_TTL_MS
      if (fresh) {
        const d = hit.data
        return {
          name: d.name ?? name,
          intro: d.intro ?? null,
          news: Array.isArray(d.news) ? d.news : [],
          trivia: Array.isArray(d.trivia) ? d.trivia : [],
          similarArtists: Array.isArray(d.similarArtists) ? d.similarArtists : [],
          similarSongs: Array.isArray(d.similarSongs) ? d.similarSongs : [],
          cached: true,
          fetchedAt: hit.fetchedAt ?? Date.now(),
          message: null,
        }
      }
      const intro = await wikiIntro(name)
      if (intro) {
        // 九期点4：live 兜底成功即持久化（TTL 内重开零网络拉取）；写失败只警告不影响返回。
        // 过期刷新时合并保留原有调研字段（news/trivia/similar 不被空数组覆盖）。
        const old = hit?.data ?? {}
        const keep = (cur, prev) => (Array.isArray(cur) && cur.length > 0 ? cur : Array.isArray(prev) ? prev : [])
        const data = {
          name,
          intro,
          news: keep([], old.news),
          trivia: keep([], old.trivia),
          similarArtists: keep([], old.similarArtists),
          similarSongs: keep([], old.similarSongs),
        }
        try {
          await cache.writeJson(cache.artistFile(slug), { version: 1, data, fetchedAt: Date.now() })
        } catch (err) {
          warn(`dsh-music: 回写歌手缓存失败 ${name}: ${err.message}`)
        }
        return {
          name,
          intro,
          news: data.news,
          trivia: data.trivia,
          similarArtists: data.similarArtists,
          similarSongs: data.similarSongs,
          cached: false,
          fetchedAt: Date.now(),
          message: '动态/逸闻/相似内容由调研补齐',
        }
      }
      warn(`dsh-music: 歌手内容无缓存且维基兜底失败: ${name}`)
      return emptyPayload(name, '暂无该歌手内容')
    },
  }
}