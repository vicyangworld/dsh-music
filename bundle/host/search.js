/** 批3 歌曲/歌手搜索：曲库模糊过滤（简繁归一）+ MusicBrainz 联网补全。
 * 复用 reco/mb.js 的全局限速退避（只读引用，不修改）；T2S 映射与客户端一致。
 * remote 项自带 verification（MB 搜索命中即联网核实）并写留档（三期 D1：核实须可交叉比对）。 */
import { mbJson, mbUrl } from './reco/mb.js'
import { normalizeZh } from './t2s.js'
import { archiveVerificationFile } from './media-core.js'

const TYPES = new Set(['song', 'artist', 'both'])

export function createSearch({ library, storage, logger } = {}) {
  const warn = (msg) => logger?.warn?.(msg)

  /** 曲库本地过滤：song=歌名/歌手/专辑模糊匹配；artist=仅歌手。返回完整 track 对象（可直接播）。 */
  function localSearch(query, type) {
    const nq = normalizeZh(query).trim()
    if (!nq) return []
    const tracks = library.snapshot().tracks
    return tracks.filter((t) => {
      const artist = normalizeZh(t.artist)
      if (type === 'artist') return artist.includes(nq)
      return normalizeZh(t.title).includes(nq) || artist.includes(nq) || normalizeZh(t.album || '').includes(nq)
    })
  }

  /** MusicBrainz 补全：song→recording（带核实记录），artist→artist 条目。 */
  async function remoteSearch(query, type) {
    if (type === 'artist') {
      const data = await mbJson(mbUrl('artist', { query, limit: 8 }), { logger })
      return (data.artists ?? []).map((a) => ({
        kind: 'artist',
        id: a.id,
        name: a.name,
        artist: a.name,
        disambiguation: a.disambiguation || null,
        country: a.country || null,
        source: 'musicbrainz',
        url: `https://musicbrainz.org/artist/${a.id}`,
      }))
    }
    const data = await mbJson(mbUrl('recording', { query, limit: 8 }), { logger })
    const items = (data.recordings ?? [])
      .filter((r) => r && r.id && !r.video)
      .map((r) => {
        const artist = (r['artist-credit'] ?? []).map((a) => a.name).join(', ') || '未知歌手'
        const album = (r.releases ?? [])[0]?.title || null
        return {
          kind: 'song',
          id: r.id,
          artist,
          title: r.title,
          album,
          durationMs: r.length ?? null,
          source: 'musicbrainz',
          verification: {
            source: 'MusicBrainz',
            url: `https://musicbrainz.org/recording/${r.id}`,
            verifiedAt: Date.now(),
            note: `search score=${r.score ?? '?'}`,
          },
        }
      })
    // D1 交叉比对要求：MB 补全即联网核实，同步写留档（best-effort，失败不阻断搜索）
    if (storage) {
      for (const it of items) {
        await archiveVerificationFile(storage.dataDir, it).catch((err) => warn(`dsh-music: 搜索核实留档失败: ${err.message}`))
      }
    }
    return items
  }

  /** 十一批3 聚合候选：一次返回「可选歌手」「可选歌曲」两组（模糊搜索供选择）。
   * Promise.allSettled：任一支路失败不拖垮另一支路，失败信息进 remoteError。 */
  async function remoteSearchBoth(query) {
    const [artistRes, songRes] = await Promise.allSettled([
      remoteSearch(query, 'artist'),
      remoteSearch(query, 'song'),
    ])
    const artists = artistRes.status === 'fulfilled' ? artistRes.value : []
    const songs = songRes.status === 'fulfilled' ? songRes.value : []
    const errors = [artistRes, songRes].filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason))
    return { artists, songs, errors }
  }

  /** 主入口：空 q 返回空；本地无匹配时才联网补全；MB 失败优雅降级（remoteError）。 */
  async function search(q, type = 'song') {
    const query = String(q ?? '').trim()
    const t = TYPES.has(type) ? type : 'song'
    if (!query) {
      return t === 'both'
        ? { local: [], artists: [], songs: [], remote: [], query: '', type: t, remoteError: null }
        : { local: [], remote: [], query: '', type: t, remoteError: null }
    }
    await library.ensureScanned()
    const local = localSearch(query, t === 'both' ? 'song' : t)
    if (t === 'both') {
      let artists = []
      let songs = []
      let remoteError = null
      try {
        const r = await remoteSearchBoth(query)
        artists = r.artists
        songs = r.songs
        if (r.errors.length) remoteError = `联网补全部分失败：${r.errors.join('; ')}`
      } catch (err) {
        remoteError = `联网补全暂不可用：${err.message}`
        warn(`dsh-music: 搜索联网补全失败: ${err.message}`)
      }
      // 与本地去重（歌曲按 歌手+歌名）；歌手项无本地概念，全部保留供选择
      const localKeys = new Set(local.map((x) => `${normalizeZh(x.artist)}::${normalizeZh(x.title)}`))
      songs = songs.filter((s) => !localKeys.has(`${normalizeZh(s.artist)}::${normalizeZh(s.title)}`))
      return { local, artists, songs, remote: [...artists, ...songs], query, type: t, remoteError }
    }
    let remote = []
    let remoteError = null
    // O1（Chief 定口径）：非空 query 始终联网补全（不再仅本地未命中才发，本地结果在前由客户端合并）
    try {
      remote = await remoteSearch(query, t)
      // 与本地去重（歌曲按 歌手+歌名；artist 项保留，供客户端展示联网歌手 chip）
      const localKeys = new Set(local.map((x) => `${normalizeZh(x.artist)}::${normalizeZh(x.title)}`))
      remote = remote.filter((r) => r.kind === 'artist' || !localKeys.has(`${normalizeZh(r.artist)}::${normalizeZh(r.title)}`))
    } catch (err) {
      remoteError = `联网补全暂不可用：${err.message}`
      warn(`dsh-music: 搜索联网补全失败: ${err.message}`)
    }
    return { local, remote, query, type: t, remoteError }
  }

  return { search, localSearch }
}

export function registerSearchRoutes(webServer, { search, logger }) {
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
    path: '/dsh-music/api/library/search',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      try {
        const url = new URL(req.url ?? '/', 'http://dsh-music.local')
        const q = url.searchParams.get('q') ?? ''
        const type = url.searchParams.get('type') ?? 'song'
        if (!TYPES.has(type)) return sendJson(res, 400, { error: 'type 必须是 song、artist 或 both' })
        return sendJson(res, 200, await search.search(q, type))
      } catch (err) {
        warn(`dsh-music: 搜索服务错误: ${err.message}`)
        return sendJson(res, 500, { error: '搜索服务内部错误' })
      }
    },
  }))
  return disposers
}