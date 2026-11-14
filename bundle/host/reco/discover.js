/** 候选发现（传统算法，无 LLM）：
 * 相近位：MusicBrainz 歌手检索 → browse recordings by artist（高频歌手 + artist-rels 关系歌手），
 *         去掉曲库已有与近期播放，按批次游标轮换取样。
 * 探索位：按 quota.js 轮换轴选「与画像不同」的轴值，用代表曲目池（pools.js）+ MB tag 检索补充。
 * 所有发现结果只是候选，最终必须经 verify.js 逐首核实才进入推荐。
 * 发现缓存：~/.dsh/dsh-music/cache/reco/（歌手 30 天、曲目 7 天），二次生成提速。 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { mbJson, mbUrl } from './mb.js'
import { normKey } from './quota.js'
import { GENRE_POOLS, LANGUAGE_POOLS, ERA_POOLS, SCENE_POOLS, WILDCARD_POOL } from './pools.js'

const ARTIST_TTL_MS = 30 * 24 * 3600 * 1000
const RECORDINGS_TTL_MS = 7 * 24 * 3600 * 1000

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[\s'"’·・\-—–,，.。!！?？:：;；()（）\[\]【】]/g, '')
}

/** taste 归一化（v7 批2：客户端首启偏好透传）：genres 小写去空白；语言常见英文名映射到池键。 */
const TASTE_LANGUAGE_ALIASES = {
  japanese: '日语', korean: '韩语', french: '法语', spanish: '西班牙语',
  portuguese: '葡萄牙语', italian: '意大利语',
  chinese: '中文', mandarin: '中文', 华语: '中文', english: '英语', cantonese: '粤语',
}

export function normalizeTaste(taste) {
  const clean = (v) => (Array.isArray(v) ? v : [])
    .map((s) => String(s ?? '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20)
  const languages = clean(taste?.languages).map((s) => TASTE_LANGUAGE_ALIASES[s] ?? s)
  return { genres: clean(taste?.genres), languages }
}

/** 软偏置排序：taste 命中的键排前面，其余保持原顺序（空 taste 原样返回，行为与现状完全一致）。 */
export function biasKeys(keys, prefer) {
  const list = Array.isArray(prefer) ? prefer.map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean) : []
  if (list.length === 0) return keys
  const hit = new Set(list)
  return [
    ...keys.filter((k) => hit.has(k.toLowerCase())),
    ...keys.filter((k) => !hit.has(k.toLowerCase())),
  ]
}

/** 新歌窗口：近 180 天新发行才算「新歌」（八期①纠偏；Chief 允许自定，取半年）。 */
export const NEW_RELEASE_DAYS = 180

/** 新歌理由：发行年必须来自真实发行日期（不是入库时间）。 */
export function newReleaseReason(artist, releaseDate, album, releaseType = 'Album') {
  const year = String(releaseDate ?? '').slice(0, 4)
  const rel = releaseType === 'Single' ? '单曲' : releaseType === 'EP' ? 'EP' : album ? `专辑《${album}》` : '单曲'
  return year ? `新歌推荐：${artist} ${year} 年发行${rel}` : `新歌推荐：${artist} 近期发行${rel}`
}

export function createDiscover({ storage, logger } = {}) {
  const warn = (msg) => logger?.warn?.(msg)
  const dir = join(storage.dataDir, 'cache', 'reco')

  async function cacheRead(name, ttl) {
    try {
      const saved = JSON.parse(await readFile(join(dir, name), 'utf8'))
      if (saved?.fetchedAt && Date.now() - saved.fetchedAt < ttl) return saved
    } catch { /* 无缓存 */ }
    return null
  }

  async function cacheWrite(name, value) {
    try {
      await mkdir(dir, { recursive: true })
      const tmp = join(dir, `${name}.tmp-${process.pid}`)
      await writeFile(tmp, JSON.stringify({ ...value, fetchedAt: Date.now() }), 'utf8')
      await rename(tmp, join(dir, name))
    } catch (err) {
      warn?.(`dsh-music: 写发现缓存失败: ${err.message}`)
    }
  }

  /** 歌手检索：取归一化名字互相包含且 score 最高者。返回 {mbid, name, tags[]} 或 null。 */
  async function findArtist(name) {
    const key = `artist-${createHash('sha1').update(norm(name)).digest('hex').slice(0, 16)}.json`
    const cached = await cacheRead(key, ARTIST_TTL_MS)
    if (cached) return cached.artist ?? null
    let artist = null
    try {
      const data = await mbJson(mbUrl('artist', { query: `artist:"${name}"`, limit: 5 }), { logger })
      const q = norm(name)
      const hits = (data?.artists ?? []).filter((a) => {
        const n = norm(a.name)
        return n && (n.includes(q) || q.includes(n))
      })
      if (hits.length > 0) {
        const best = hits.reduce((a, b) => ((b.score ?? 0) > (a.score ?? 0) ? b : a))
        artist = {
          mbid: best.id,
          name: best.name,
          tags: (best.tags ?? []).slice(0, 5).map((t) => String(t.name).toLowerCase()),
        }
      }
    } catch (err) {
      warn?.(`dsh-music: 歌手检索失败 ${name}: ${err.message}`)
      return null // 失败不缓存，下次重试
    }
    if (artist) await cacheWrite(key, { artist })
    return artist
  }

  /** browse recordings by artist：返回 [{artist, title, durationMs}]（过滤视频）。
   * browse 默认不带 artist-credit，必须 inc=artist-credits；另以种子歌手名兜底。 */
  async function browseRecordings(mbid, fallbackArtist) {
    const key = `recordings-${mbid}.json`
    const cached = await cacheRead(key, RECORDINGS_TTL_MS)
    if (cached) return cached.recordings ?? []
    let recordings = []
    try {
      const data = await mbJson(mbUrl('recording', { artist: mbid, limit: 50, inc: 'artist-credits' }), { logger })
      recordings = (data?.recordings ?? [])
        .filter((r) => !r.video && r.title)
        .map((r) => ({
          artist: r['artist-credit']?.[0]?.name ?? fallbackArtist,
          title: r.title,
          durationMs: Number.isFinite(r.length) ? r.length : undefined,
        }))
        .filter((r) => r.artist)
    } catch (err) {
      warn?.(`dsh-music: browse recordings 失败 ${mbid}: ${err.message}`)
      return [] // 失败不缓存，下次重试
    }
    await cacheWrite(key, { recordings })
    return recordings
  }

  /** artist-rels 关系歌手（双向），排除自身。返回 [{mbid, name}]。 */
  async function relatedArtists(mbid) {
    const key = `relations-${mbid}.json`
    const cached = await cacheRead(key, RECORDINGS_TTL_MS)
    if (cached) return cached.related ?? []
    let related = []
    try {
      const data = await mbJson(mbUrl(`artist/${mbid}`, { inc: 'artist-rels' }), { logger })
      const seen = new Set()
      for (const rel of data?.relations ?? []) {
        const a = rel.artist
        if (!a?.id || a.id === mbid || seen.has(a.id)) continue
        seen.add(a.id)
        related.push({ mbid: a.id, name: a.name })
      }
      related = related.slice(0, 4)
    } catch (err) {
      warn?.(`dsh-music: artist-rels 失败 ${mbid}: ${err.message}`)
      return [] // 失败不缓存
    }
    await cacheWrite(key, { related })
    return related
  }

  /** MB tag 检索录音（探索位补充候选）。返回 [{artist, title, durationMs}]。 */
  async function searchByTag(tag) {
    const key = `tag-${createHash('sha1').update(norm(tag)).digest('hex').slice(0, 16)}.json`
    const cached = await cacheRead(key, RECORDINGS_TTL_MS)
    if (cached) return cached.recordings ?? []
    let recordings = []
    try {
      const data = await mbJson(mbUrl('recording', { query: `tag:"${tag}"`, limit: 15 }), { logger })
      recordings = (data?.recordings ?? [])
        .filter((r) => !r.video && r.title && (r['artist-credit'] ?? []).length > 0)
        .map((r) => ({
          artist: r['artist-credit'][0].name,
          title: r.title,
          durationMs: Number.isFinite(r.length) ? r.length : undefined,
        }))
    } catch (err) {
      warn?.(`dsh-music: tag 检索失败 ${tag}: ${err.message}`)
      return [] // 失败不缓存
    }
    await cacheWrite(key, { recordings })
    return recordings
  }

  /** 通用 recording Lucene 检索（批3 风格搜索用；tag:"x" AND tag:"y" 等）。缓存 7 天，失败不缓存。 */
  async function searchRecordings(lucene, { limit = 20 } = {}) {
    const key = `search-${createHash('sha1').update(lucene).digest('hex').slice(0, 16)}.json`
    const cached = await cacheRead(key, RECORDINGS_TTL_MS)
    if (cached) return cached.recordings ?? []
    let recordings = []
    try {
      const data = await mbJson(mbUrl('recording', { query: lucene, limit }), { logger })
      recordings = (data?.recordings ?? [])
        .filter((r) => !r.video && r.title && (r['artist-credit'] ?? []).length > 0)
        .map((r) => ({
          artist: r['artist-credit'][0].name,
          title: r.title,
          durationMs: Number.isFinite(r.length) ? r.length : undefined,
        }))
      await cacheWrite(key, { recordings })
    } catch (err) {
      warn?.(`dsh-music: recording 检索失败 ${lucene}: ${err.message}`)
      return [] // 失败不缓存，下次重试
    }
    return recordings
  }

  /** 相近候选：高频/曲库种子歌手的作品 + 关系歌手作品。目标 ≥12 首供核实与替补。
   * extraKeys：近期已推荐过的歌（防重复推荐，S4 调优）。 */
  async function buildSimilarCandidates({ seedArtists, libraryKeys, recentKeys, extraKeys, cursor = 0 }) {
    const out = []
    const seen = new Set([...libraryKeys, ...recentKeys, ...(extraKeys ?? [])])
    // 去掉括号版本后缀再归一，避免同一首歌的 remix/现场版重复占位
    const baseKey = (artist, title) => normKey(artist, String(title).replace(/[（(].*?[)）]/g, ''))
    const push = (rec, reason) => {
      const key = baseKey(rec.artist, rec.title)
      if (!key || seen.has(key)) return
      seen.add(key)
      out.push({ category: 'similar', artist: rec.artist, title: rec.title, durationMs: rec.durationMs, reason })
    }
    const seeds = []
    for (const name of seedArtists.slice(0, 3)) {
      const a = await findArtist(name)
      if (a) seeds.push({ seedName: name, ...a })
    }
    // 种子歌手本人的作品（游标轮换取样，批间不重样）
    for (const s of seeds) {
      const recs = await browseRecordings(s.mbid, s.name)
      const fresh = recs.filter((r) => !seen.has(normKey(r.artist, r.title)))
      const start = fresh.length > 0 ? cursor % fresh.length : 0
      const ordered = [...fresh.slice(start), ...fresh.slice(0, start)]
      for (const r of ordered.slice(0, 8)) {
        const reason = norm(r.artist) === norm(s.seedName)
          ? `相近：您常听 ${s.seedName}，这首同风格作品延续您的口味`
          : `相近：${r.artist} 与您常听的 ${s.seedName} 曲风相近`
        push(r, reason)
      }
    }
    // 关系歌手（artist-rels）补充（三期：14 相近位需要更大候选池）
    if (seeds.length > 0 && out.length < 22) {
      const related = await relatedArtists(seeds[0].mbid)
      for (const rel of related.slice(0, 3)) {
        if (out.length >= 26) break
        const recs = await browseRecordings(rel.mbid, rel.name)
        const fresh = recs.filter((r) => !seen.has(normKey(r.artist, r.title)))
        for (const r of fresh.slice(0, 4)) {
          push(r, `相近：${rel.name} 与您常听的 ${seeds[0].seedName} 风格相关`)
        }
      }
    }
    return out
  }

  /** 探索候选：每个轴位选「不在画像里」的轴值（游标轮换），代表曲目池 + tag 检索补充。
   * 可选 taste（客户端首启偏好）：流派/语言轴上命中的轴值排在前面（软偏置，游标仍轮转），
   * 不传 taste 时顺序与现状完全一致。 */
  async function buildExploreCandidates({ slots, profileValues, cursors = {}, taste = {} }) {
    const out = []
    const nextCursors = { ...cursors }
    const tasteValues = normalizeTaste(taste)
    const pickValue = (pool, axis) => {
      const keys = Object.keys(pool).filter((k) => !profileValues.has(k.toLowerCase()))
      if (keys.length === 0) return null
      const prefer = axis === 'genre' ? tasteValues.genres : axis === 'language' ? tasteValues.languages : []
      const ordered = biasKeys(keys, prefer)
      const c = Number(nextCursors[axis]) || 0
      const value = ordered[c % ordered.length]
      nextCursors[axis] = c + 1
      return value
    }
    for (const slot of slots) {
      const axis = slot.axis
      let entries = []
      let value = null
      let hintField = null
      if (axis === 'genre') {
        value = pickValue(GENRE_POOLS, 'genre'); hintField = 'genreHint'
        if (value) entries = [...GENRE_POOLS[value]]
      } else if (axis === 'language') {
        value = pickValue(LANGUAGE_POOLS, 'language'); hintField = 'languageHint'
        if (value) entries = [...LANGUAGE_POOLS[value]]
      } else if (axis === 'era') {
        value = pickValue(ERA_POOLS, 'era'); hintField = 'eraHint'
        if (value) entries = [...ERA_POOLS[value]]
      } else if (axis === 'scene') {
        value = pickValue(SCENE_POOLS, 'scene'); hintField = 'sceneHint'
        if (value) entries = [...SCENE_POOLS[value]]
      } else {
        // wildcard：意外之喜位，池内游标轮换取 3 首
        const c = Number(nextCursors.wildcard) || 0
        nextCursors.wildcard = c + 1
        const ordered = [...WILDCARD_POOL.slice(c % WILDCARD_POOL.length), ...WILDCARD_POOL.slice(0, c % WILDCARD_POOL.length)]
        entries = ordered.slice(0, 3)
        value = '不设限'
      }
      if (!value) continue
      // genre/language 轴追加 MB tag 检索的真实发现（池条目优先，检索结果作替补）
      if ((axis === 'genre' || axis === 'language') && entries.length < 6) {
        const tagRecs = await searchByTag(axis === 'genre' ? value : value)
        for (const r of tagRecs.slice(0, 3)) entries.push(r)
      }
      for (const e of entries) {
        const reason = axis === 'wildcard'
          ? `意外之喜：${e.artist}《${e.title}》，风格不设限，也许正合你意`
          : `探索·${slot.label}：试试${value}——${e.artist}《${e.title}》，换换口味`
        out.push({
          category: 'explore',
          axis,
          artist: e.artist,
          title: e.title,
          durationMs: e.durationMs,
          reason,
          [hintField ?? 'sceneHint']: value === '不设限' ? '意外之喜' : value,
        })
      }
    }
    return { candidates: out, cursors: nextCursors }
  }

  /** browse release-groups by artist：按首发日期降序。缓存 7 天。 */
  async function browseReleaseGroups(mbid) {
    const key = `release-groups-${mbid}.json`
    const cached = await cacheRead(key, RECORDINGS_TTL_MS)
    if (cached) return cached.groups ?? []
    let groups = []
    try {
      const data = await mbJson(mbUrl('release-group', { artist: mbid, limit: 100 }), { logger })
      groups = (data?.['release-groups'] ?? [])
        .filter((g) => g['first-release-date'] && g.id)
        .map((g) => ({ rgid: g.id, title: g.title, date: g['first-release-date'], type: g['primary-type'] }))
        .sort((a, b) => b.date.localeCompare(a.date))
    } catch (err) {
      warn?.(`dsh-music: browse release-groups 失败 ${mbid}: ${err.message}`)
      return [] // 失败不缓存
    }
    await cacheWrite(key, { groups })
    return groups
  }

  /** 近期发行曲目（已实测路径：release-group → release → recording，recording 不支持直接按 rg browse）。
   * sinceDays 内的 Album/Single/EP，取最近 maxReleases 张、每张 perRelease 首。 */
  /** release-group → releases → recordings（各层缓存 7 天；recording 不支持直接按 rg browse）。 */
  async function recordingsFromReleaseGroup(g, perRelease = 3) {
    const relKey = `releases-${g.rgid}.json`
    let releases = (await cacheRead(relKey, RECORDINGS_TTL_MS))?.releases
    if (!releases) {
      try {
        const data = await mbJson(mbUrl('release', { 'release-group': g.rgid, limit: 5 }), { logger })
        releases = (data?.releases ?? []).map((r) => ({ rid: r.id, title: r.title, date: r.date }))
        await cacheWrite(relKey, { releases })
      } catch (err) {
        warn?.(`dsh-music: browse releases 失败 ${g.rgid}: ${err.message}`)
        return []
      }
    }
    if (!releases?.[0]) return []
    const recKey = `recordings-release-${releases[0].rid}.json`
    let recs = (await cacheRead(recKey, RECORDINGS_TTL_MS))?.recordings
    if (!recs) {
      try {
        const data = await mbJson(mbUrl('recording', { release: releases[0].rid, limit: 10, inc: 'artist-credits' }), { logger })
        recs = (data?.recordings ?? [])
          .filter((r) => !r.video && r.title && r['artist-credit']?.[0]?.name)
          .map((r) => ({
            artist: r['artist-credit'][0].name,
            title: r.title,
            durationMs: Number.isFinite(r.length) ? r.length : undefined,
          }))
        await cacheWrite(recKey, { recordings: recs })
      } catch (err) {
        warn?.(`dsh-music: browse release recordings 失败 ${releases[0].rid}: ${err.message}`)
        return []
      }
    }
    return (recs ?? []).slice(0, perRelease).map((r) => ({ ...r, album: g.title, releaseDate: g.date, releaseType: g.type }))
  }

  /** 近期发行曲目（已实测路径：release-group → release → recording，recording 不支持直接按 rg browse）。
   * sinceDays 内的 Album/Single/EP，取最近 maxReleases 张、每张 perRelease 首。 */
  async function recentReleaseRecordings(mbid, { sinceDays = 730, maxReleases = 2, perRelease = 3 } = {}) {
    const cutoff = new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const groups = (await browseReleaseGroups(mbid))
      .filter((g) => g.date >= cutoff && ['Album', 'Single', 'EP'].includes(g.type))
      .slice(0, maxReleases)
    const out = []
    for (const g of groups) out.push(...await recordingsFromReleaseGroup(g, perRelease))
    return out
  }

  /** 按流派标签检索「近 N 天首发」的专辑/单曲/EP（八期①拓宽新歌来源，不限于高频歌手）。
   * MB release-group search 支持 tag + firstreleasedate；结果按首发日期降序、剔除 Live/精选。 */
  async function searchRecentReleaseGroups(tag, { sinceDays = NEW_RELEASE_DAYS, limit = 6 } = {}) {
    const cutoff = new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const key = `rgsearch-${createHash('sha1').update(`${norm(tag)}|${cutoff}`).digest('hex').slice(0, 16)}.json`
    const cached = await cacheRead(key, RECORDINGS_TTL_MS)
    if (cached) return cached.groups ?? []
    let groups = []
    try {
      const query = `tag:"${tag}" AND firstreleasedate:[${cutoff} TO *]`
      const data = await mbJson(mbUrl('release-group', { query, limit: 25 }), { logger })
      const skipSecondary = new Set(['Live', 'Compilation', 'Remix', 'Interview', 'Demo'])
      const today = new Date().toISOString().slice(0, 10)
      groups = (data?.['release-groups'] ?? [])
        .filter((g) => g.id && g['first-release-date'] && g['first-release-date'] >= cutoff && g['first-release-date'] <= today
          && ['Album', 'Single', 'EP'].includes(g['primary-type'])
          && !(g['secondary-types'] ?? []).some((t) => skipSecondary.has(t)))
        .sort((a, b) => String(b['first-release-date']).localeCompare(String(a['first-release-date'])))
        .slice(0, limit)
        .map((g) => ({ rgid: g.id, title: g.title, date: g['first-release-date'], type: g['primary-type'] }))
      await cacheWrite(key, { groups })
    } catch (err) {
      warn?.(`dsh-music: 近期发行检索失败 ${tag}: ${err.message}`)
      return [] // 失败不缓存
    }
    return groups
  }

  /** 歌手栏目候选：高频歌手 → MB artist-rels 相似歌手 → 其作品（不含种子本人）。
   * 游标轮换相似歌手取样，批间不重样。返回 {candidates, cursor}。 */
  async function buildArtistCandidates({ seedArtists, libraryKeys, recentKeys, extraKeys, cursor = 0, limit = 6 }) {
    const seen = new Set([...libraryKeys, ...recentKeys, ...(extraKeys ?? [])])
    const baseKey = (artist, title) => normKey(artist, String(title).replace(/[（(].*?[)）]/g, ''))
    const out = []
    let nextCursor = cursor
    for (const name of seedArtists.slice(0, 3)) {
      if (out.length >= limit + 4) break
      const a = await findArtist(name)
      if (!a) continue
      const related = await relatedArtists(a.mbid)
      if (related.length === 0) continue
      const start = nextCursor % related.length
      nextCursor++
      const ordered = [...related.slice(start), ...related.slice(0, start)]
      for (const rel of ordered.slice(0, 2)) {
        if (out.length >= limit + 4) break
        const recs = await browseRecordings(rel.mbid, rel.name)
        const fresh = recs.filter((r) => !seen.has(baseKey(r.artist, r.title)))
        for (const r of fresh.slice(0, 3)) {
          const key = baseKey(r.artist, r.title)
          if (seen.has(key)) continue
          seen.add(key)
          out.push({
            category: 'artist', artist: r.artist, title: r.title, durationMs: r.durationMs,
            reason: `歌手推荐：${rel.name} 与您常听的 ${name} 风格相近`,
          })
        }
      }
    }
    return { candidates: out, cursor: nextCursor }
  }

  /** 歌手详情（标签 + 关系歌手），缓存 7 天。返回 {mbid,name,tags,related:[{mbid,name}]} 或 null。 */
  async function artistInfo(mbid) {
    const key = `artistinfo-${mbid}.json`
    const cached = await cacheRead(key, RECORDINGS_TTL_MS)
    if (cached) return cached.info ?? null
    let info = null
    try {
      const data = await mbJson(mbUrl(`artist/${mbid}`, { inc: 'tags+artist-rels' }), { logger })
      info = {
        mbid: data.id,
        name: data.name,
        tags: (data.tags ?? []).slice(0, 5).map((t) => String(t.name).toLowerCase()),
        related: (data.relations ?? [])
          .map((r) => r.artist)
          .filter((a) => a?.id && a.id !== mbid)
          .slice(0, 6)
          .map((a) => ({ mbid: a.id, name: a.name })),
      }
    } catch (err) {
      warn?.(`dsh-music: artist 详情失败 ${mbid}: ${err.message}`)
      return null // 失败不缓存
    }
    await cacheWrite(key, { info })
    return info
  }

  /** 按标签检索歌手（探索补充），缓存 7 天。返回 [{mbid,name,tags}]。 */
  async function searchArtistsByTag(tag) {
    const key = `artisttag-${createHash('sha1').update(norm(tag)).digest('hex').slice(0, 16)}.json`
    const cached = await cacheRead(key, RECORDINGS_TTL_MS)
    if (cached) return cached.artists ?? []
    let artists = []
    try {
      const data = await mbJson(mbUrl('artist', { query: `tag:"${tag}"`, limit: 25 }), { logger })
      artists = (data?.artists ?? [])
        .filter((a) => a.id && a.name)
        .map((a) => ({ mbid: a.id, name: a.name, tags: (a.tags ?? []).slice(0, 5).map((t) => String(t.name).toLowerCase()) }))
      await cacheWrite(key, { artists })
    } catch (err) {
      warn?.(`dsh-music: 歌手标签检索失败 ${tag}: ${err.message}`)
      return [] // 失败不缓存
    }
    return artists
  }

  /** 歌手推荐列表（三期，20 位歌手对象）：高频歌手的 MB 关系歌手 + 同标签热门歌手补充。
   * 返回 {artists:[{id,name,genreHint,reason,similar,verification}], cursor}。
   * 只做发现不逐首核实歌曲；歌手对象自带 MusicBrainz 歌手页核实记录。 */
  const JUNK_ARTISTS = new Set(['various artists', '[unknown]', 'unknown artist', 'unknown', 'va'])
  const isJunkArtist = (name) => JUNK_ARTISTS.has(String(name ?? '').trim().toLowerCase())
  async function buildArtistList({ seedArtists, exclude, cursor = 0, limit = 20 }) {
    const out = []
    const seen = new Set(exclude ?? [])
    const seeds = []
    for (const name of (seedArtists ?? []).slice(0, 4)) {
      const a = await findArtist(name)
      if (a) seeds.push({ seedName: name, ...a })
    }
    const pushArtist = async (rel, reason, knownTags) => {
      if (isJunkArtist(rel.name) || seen.has(rel.name) || seen.has(rel.mbid) || out.length >= limit + 6) return
      // 标签检索来源已有 tags：直接用，省一次 artistInfo 请求（冷启动提速、减少 503 概率）
      const info = knownTags ? { name: rel.name, tags: knownTags, related: [] } : await artistInfo(rel.mbid)
      if (!info) return
      seen.add(rel.name)
      seen.add(rel.mbid)
      out.push({
        id: rel.mbid,
        name: info.name,
        genreHint: info.tags[0] ?? undefined,
        similar: info.related.map((r) => r.name).slice(0, 3),
        reason,
        verification: {
          source: 'musicbrainz',
          url: `https://musicbrainz.org/artist/${rel.mbid}`,
          verifiedAt: Date.now(),
        },
      })
    }
    // 1) 种子歌手的关系歌手（每种子 4 位，游标轮转起点）
    for (const [i, s] of seeds.entries()) {
      if (out.length >= limit + 4) break
      const related = await relatedArtists(s.mbid)
      if (related.length === 0) continue
      const start = (cursor + i) % related.length
      const ordered = [...related.slice(start), ...related.slice(0, start)]
      for (const rel of ordered.slice(0, 6)) {
        await pushArtist(rel, `相似歌手：与您常听的 ${s.seedName} 风格相近`)
      }
    }
    // 2) 不足则同标签热门歌手补充（种子歌手的首个标签）
    if (out.length < limit + 6) {
      for (const s of seeds) {
        if (out.length >= limit + 6) break
        for (const tag of (s.tags ?? []).slice(0, 2)) {
          if (out.length >= limit + 6) break
          const pool = await searchArtistsByTag(tag)
          for (const a of pool.slice(0, 8)) {
            await pushArtist({ mbid: a.mbid, name: a.name }, `热门${tag}歌手：值得探索`, a.tags)
          }
        }
      }
    }
    return { artists: out.slice(0, limit), cursor: cursor + 1 }
  }

  /** 新歌栏目候选：曲库近 30 天新增（本地，优先）+ 高频歌手 MB 近两年新发行（补充）。
   * 全部候选仍须过 verify.js 核实；本地曲核实失败则不输出（守「先核实再输出」红线）。 */
  /** 新歌候选（八期①）：新歌 = 真正的新发行（近 NEW_RELEASE_DAYS 天），不再把
   * 「曲库刚入库」当新歌（刚入库是用户已有的歌，不属于新歌发现）。
   * 来源顺序：高频歌手 → 相似歌手（artist-rels）→ 口味/画像流派代表歌手；
   * 每首仍必须经 verify.js 核实；去重曲库/近期播放/已推荐；跳过不喜欢过的曲目与歌手
   * （只读 dislikes 标记，不把口味事件当播放画像）。 */
  async function buildNewCandidates({
    seedArtists = [], libraryKeys = new Set(), recentKeys = new Set(), extraKeys = new Set(),
    tasteGenres = [], dislikedKeys = new Set(), dislikedArtists = new Set(), limit = 20,
  }) {
    const seen = new Set([...recentKeys, ...(extraKeys ?? [])])
    const artistSeen = new Set()
    const baseKey = (artist, title) => normKey(artist, String(title).replace(/[（(].*?[)）]/g, ''))
    const dislikedArtist = (name) => dislikedArtists.has(String(name ?? '').trim().toLowerCase())
    const out = []
    const albumCount = new Map() // 同一专辑最多进 2 首，防一张专辑刷屏
    const push = (c) => {
      const key = baseKey(c.artist, c.title)
      if (!key || seen.has(key) || libraryKeys.has(key)) return
      if (dislikedKeys.has(normKey(c.artist, c.title)) || dislikedArtist(c.artist)) return
      const ak = c.album ? baseKey(c.artist, c.album) : null
      if (ak && (albumCount.get(ak) ?? 0) >= 2) return
      seen.add(key)
      if (ak) albumCount.set(ak, (albumCount.get(ak) ?? 0) + 1)
      out.push(c)
    }
    const takeArtist = (mbid, name) => {
      if (!mbid || artistSeen.has(mbid) || dislikedArtist(name)) return false
      artistSeen.add(mbid)
      return true
    }
    const enough = () => out.length >= limit + 4
    const take = async (mbid, { maxReleases = 1, perRelease = 6 } = {}) => {
      const recs = await recentReleaseRecordings(mbid, { sinceDays: NEW_RELEASE_DAYS, maxReleases, perRelease })
      const today = new Date().toISOString().slice(0, 10)
      const cutoff = new Date(Date.now() - NEW_RELEASE_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10)
      for (const r of recs) {
        if (!r?.releaseDate || r.releaseDate < cutoff || r.releaseDate > today) continue
        push({
          category: 'new', artist: r.artist, title: r.title, album: r.album,
          durationMs: r.durationMs, releaseDate: r.releaseDate,
          reason: newReleaseReason(r.artist, r.releaseDate, r.album, r.releaseType),
        })
      }
    }
    // 1) 高频歌手（画像种子）：每位取最近 2 张发行
    for (const name of seedArtists.slice(0, 3)) {
      if (enough()) break
      const a = await findArtist(name)
      if (!a || !takeArtist(a.mbid, a.name)) continue
      await take(a.mbid, { maxReleases: 2 })
    }
    // 2) 相似歌手（artist-rels）：最多 2 位种子 × 2 位关系歌手
    if (!enough()) {
      for (const name of seedArtists.slice(0, 2)) {
        if (enough()) break
        const a = await findArtist(name)
        if (!a) continue
        const rels = await relatedArtists(a.mbid)
        let n = 0
        for (const rel of rels) {
          if (n >= 2 || enough()) break
          if (!takeArtist(rel.mbid, rel.name)) continue
          await take(rel.mbid, { maxReleases: 1 })
          n++
        }
      }
    }
    // 3) 口味/画像流派：按 tag + 首发日期直查近期发行（不限高频歌手），每流派最多取 3 张
    if (!enough()) {
      for (const tag of tasteGenres.slice(0, 3)) {
        if (enough()) break
        const groups = await searchRecentReleaseGroups(tag, { limit: 6 })
        let n = 0
        for (const g of groups) {
          if (n >= 3 || enough()) break
          const today = new Date().toISOString().slice(0, 10)
          if (!g.date || g.date > today) continue
          const recs = await recordingsFromReleaseGroup(g, 6)
          for (const r of recs) {
            push({
              category: 'new', artist: r.artist, title: r.title, album: r.album ?? g.title,
              durationMs: r.durationMs, releaseDate: r.releaseDate ?? g.date,
              reason: newReleaseReason(r.artist, r.releaseDate ?? g.date, r.album ?? g.title, r.releaseType ?? g.type),
            })
          }
          n++
        }
      }
    }
    // 真实发行日期降序（最新在前）
    out.sort((a, b) => String(b.releaseDate ?? '').localeCompare(String(a.releaseDate ?? '')))
    return out.slice(0, limit + 8)
  }

  return { findArtist, artistInfo, searchArtistsByTag, buildArtistList, browseRecordings, relatedArtists, searchByTag, searchRecordings, buildSimilarCandidates, buildExploreCandidates, browseReleaseGroups, recentReleaseRecordings, buildArtistCandidates, buildNewCandidates }
}
