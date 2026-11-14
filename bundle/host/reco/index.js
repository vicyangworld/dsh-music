/** 推荐引擎（传统算法版，用户 2026-11-12 拍板：彻底去掉 LLM，绕开配额/内容过滤）：
 * 收听历史+曲库画像 → MusicBrainz 候选发现（browse recordings / artist-rels / tag 检索 / 代表曲目池）
 * → 70/30 配额装配（7 相近 + 3 探索，探索轴轮换 + 意外之喜位）→ 逐首联网核实 → 自动补位 → 本地留档。
 * 不依赖任何 LLM 服务；llm.js 保留但不再被引用。
 * 推荐记录只存本地 ~/.dsh/dsh-music/reco-history.json；核实缓存 cache/verifications/；发现缓存 cache/reco/。
 * 导出：createReco({history, library, storage, config, logger}) + registerRecoRoutes()。
 * 磐石接线（bundle/host/main.js，属其写范围）：
 *   inject 只需 ['webServer']（不再需要 'llm'，已有也兼容）
 *   import { createReco, registerRecoRoutes } from './reco/index.js'
 *   const reco = createReco({ history, library, storage, config, logger })
 *   ctx.effect 内：...registerRecoRoutes(ctx.webServer, { reco, logger })；清理 reco.dispose()
 *   打包：package.json files 需含 host/reco 下全部 js（host 双星 glob 已覆盖）。 */
import { join, dirname } from 'node:path'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { createVerifier } from './verify.js'
import { createDiscover } from './discover.js'
import { detectLanguage } from './diversity.js'
import { topArtists, planExploreSlots, normKey, assembleBatch, exploreCandidateOk } from './quota.js'
import { interpretStyle, styleQueryPlan, fallbackPlan, FALLBACK_GENRES } from './style.js'
import { createImages } from './images.js'

const SIMILAR_SLOTS = 14
const EXPLORE_SLOTS = 6
const HISTORY_LIMIT = 500
const RECENT_RECOMMENDED_MAX = 40 // 防重复：最近 2 批（20 首/批）推荐过的歌不再进候选
const STYLE_LIMIT = 8 // 风格搜索结果上限
const BOOTSTRAP_HISTORY_EVENTS = 3 // 播放事件少于此值视为历史不足（D3 冷启动探索批次）

export function createReco({ history, library, storage, config = {}, logger, verifier: verifierOverride, discover: discoverOverride, images: imagesOverride } = {}) {
  const warn = (msg) => logger?.warn?.(msg)
  // verifier/discover/images 可注入（单测用假实现离线跑全流程）；生产缺省即真实模块
  const verifier = verifierOverride ?? createVerifier({ storage, logger })
  const discover = discoverOverride ?? createDiscover({ storage, logger })
  const images = imagesOverride ?? createImages({ storage, logger, config })
  const stateFile = join(storage.dataDir, 'reco-state.json')
  const historyFile = join(storage.dataDir, 'reco-history.json')
  let generating = false
  let sectionsBusy = false

  async function readJson(file, fallback) {
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch {
      return fallback
    }
  }

  async function writeJson(file, value) {
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    await writeFile(tmp, JSON.stringify(value), 'utf8')
    await rename(tmp, file)
  }

  /** 不喜欢标记（八期④）：只读 likes.json v2 的 dislikes，不进播放画像（口味事件不参与历史统计）。
   * 返回归一后的「歌手::歌名」集合 + 小写歌手集合（歌手级软降权用）。文件不存在视为零。 */
  async function readDislikes() {
    const saved = await readJson(join(storage.dataDir, 'likes.json'), null)
    const dislikes = saved && typeof saved.dislikes === 'object' && saved.dislikes !== null ? saved.dislikes : {}
    const keys = new Set()
    const artists = new Set()
    for (const d of Object.values(dislikes)) {
      if (!d || typeof d !== 'object') continue
      const artist = typeof d.artist === 'string' ? d.artist : ''
      const title = typeof d.title === 'string' ? d.title : ''
      if (!artist || !title) continue
      keys.add(normKey(artist, title))
      artists.add(artist.trim().toLowerCase())
    }
    return { keys, artists }
  }

  /** 生成一批推荐（10 首 = 7 相近 + 3 探索，逐首已核实）。纯算法 + MusicBrainz，无 LLM。
   * 可选 options.taste（v7 批2：客户端首启偏好 {genres[],languages[]}）仅软偏置探索轴，不传时行为不变。 */
  async function generate(options = {}) {
    if (generating) {
      const err = new Error('推荐正在生成中，请稍候')
      err.code = 'BUSY'
      throw err
    }
    generating = true
    try {
      return await generateInner(options)
    } finally {
      generating = false
    }
  }

  /** 画像构建（generate 与 sections 共用）：历史加权歌手 + 曲库歌手分布 + 语言启发式 + MB 标签流派。 */
  async function buildProfile(events, tracks) {
    // snapshot() 为扁平格式 {id,title,artist,...}；防御式兼容内部 .meta 形状
    const flat = (r) => ({ artist: r.artist ?? r.meta?.artist, title: r.title ?? r.meta?.title })
    const histTop = topArtists(events)
    const artistWeight = new Map()
    for (const t of histTop) {
      if (t.artist === '未知歌手') continue
      artistWeight.set(t.artist, t.score)
    }
    for (const r of tracks) {
      const { artist } = flat(r)
      if (!artist || artist === '未知歌手') continue
      artistWeight.set(artist, (artistWeight.get(artist) ?? 0) + 0.15)
    }
    const seedArtists = [...artistWeight.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([artist]) => artist)
    const topArtistSet = new Set(seedArtists.slice(0, 3))

    const languages = new Set()
    for (const r of tracks) {
      const { artist, title } = flat(r)
      languages.add(detectLanguage(`${artist} ${title}`))
    }
    for (const e of events.slice(0, 100)) languages.add(detectLanguage(`${e.artist} ${e.title}`))

    // 流派画像：种子歌手的 MB 标签（discover 内有缓存）
    const genres = new Set()
    for (const name of seedArtists.slice(0, 2)) {
      const a = await discover.findArtist(name)
      for (const tag of a?.tags ?? []) genres.add(tag)
    }
    const profileValues = new Set([...genres, ...languages].map((v) => String(v).toLowerCase()))
    const profile = { genres: [...genres], languages: [...languages], eras: [] }
    const libraryKeys = new Set(tracks.map((r) => { const { artist, title } = flat(r); return normKey(artist, title) }))
    const recentKeys = new Set(events.slice(0, 40).map((e) => normKey(e.artist, e.title)))
    return { seedArtists, topArtistSet, profileValues, profile, libraryKeys, recentKeys }
  }

  function sameLocalDay(a, b) {
    const da = new Date(a), db = new Date(b)
    return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
  }

  /** 风格描述搜索推荐（批3）：中文/英文风格词 → MB 标签映射 → 检索 → 逐首核实。
   * 不引 LLM、不读用户历史（用户主动搜索）；降级链由 style.js 规划，全部查询落空则热门流派回退并明示。
   * 结果 item 结构与 sections 一致（category='style'，可直接传 POST /api/download）。 */
  async function styleSearch(q) {
    const raw = typeof q === 'string' ? q.trim().slice(0, 100) : ''
    if (!raw) {
      return { q: '', interpretedTags: [], items: [], fallback: false, message: '请输入风格描述，如：深夜爵士 / 粤语经典 / 80s rock', generatedAt: Date.now() }
    }
    const { terms, byKind } = interpretStyle(raw)
    const matched = terms.length > 0
    const plan = matched ? styleQueryPlan(byKind) : fallbackPlan()
    const interpretedTags = [...new Set(terms.flatMap((t) => t.tags))]

    const getRecord = typeof library.getRecord === 'function' ? library.getRecord : undefined
    let snap = library.snapshot()
    if (!snap?.scannedAt && typeof library.ensureScanned === 'function') await library.ensureScanned()
    snap = library.snapshot()
    const tracks = snap?.tracks ?? []
    const libraryKeys = new Set(tracks.map((r) => normKey(r.artist ?? r.meta?.artist, r.title ?? r.meta?.title)))

    const items = []
    const usedKeys = new Set()
    let lastNote = null
    let mbDegraded = false
    for (const step of plan) {
      lastNote = step.note
      let found
      try {
        found = await discover.searchRecordings(step.query, { limit: 20 })
      } catch (err) {
        warn?.(`dsh-music: 风格检索异常 ${step.query}: ${err.message}`)
        mbDegraded = true
        continue
      }
      if (found.length === 0) continue
      for (const c of found) {
        if (items.length >= STYLE_LIMIT) break
        const key = normKey(c.artist, c.title)
        if (!key || usedKeys.has(key) || libraryKeys.has(key)) continue
        usedKeys.add(key)
        const v = await verifier.verify({ artist: c.artist, title: c.title, durationMs: c.durationMs })
        if (!v) continue // MB 自有录音理论上必可核实；个别异常直接跳过
        items.push({
          artist: c.artist,
          title: c.title,
          durationMs: c.durationMs || v.matched?.durationMs || undefined,
          album: v.matched?.album || undefined,
          category: 'style',
          axis: null,
          reason: `风格搜索：${matched ? terms.map((t) => t.term).join('+') : '热门流派'} → ${step.note}`,
          genreHint: byKind.genre?.[0] || (matched ? undefined : step.note),
          verification: { source: v.verification.source, url: v.verification.url, verifiedAt: v.verification.verifiedAt },
        })
      }
      if (items.length >= STYLE_LIMIT) break
    }

    const result = {
      q: raw,
      interpretedTags: matched ? interpretedTags : [...interpretedTags, ...FALLBACK_GENRES],
      items,
      fallback: !matched,
      matchedTerms: terms.map((t) => t.term),
      generatedAt: Date.now(),
    }
    if (!matched) {
      result.message = '未能从描述中识别出风格词，已按热门流派为您推荐'
    } else if (items.length === 0) {
      result.message = mbDegraded ? 'MusicBrainz 暂时限速，结果不完整，请稍后重试' : `没有匹配「${lastNote ?? raw}」的已核实歌曲，试试更常见的风格词`
    }
    return result
  }

  /** 逐首核实候选直到 limit 首；未核实绝不输出。 */
  async function verifyToItems(candidates, { limit, category, usedKeys }) {
    const items = []
    const used = new Set(usedKeys ?? [])
    for (const c of candidates ?? []) {
      if (items.length >= limit) break
      const key = normKey(c.artist, c.title)
      if (!key || used.has(key)) continue
      const v = await verifier.verify({ artist: c.artist, title: c.title, durationMs: c.durationMs })
      if (!v) continue
      used.add(key)
      // 封面：本地曲用曲库封面路由；其余走图片模块（CAA/iTunes），失败 null 由前端兜底
      const coverUrl = c.coverUrl ?? await images.coverUrl({ artist: c.artist, title: c.title, releaseGroupIds: v.releaseGroupIds })
      items.push({
        artist: c.artist,
        title: c.title,
        album: c.album || v.matched?.album || undefined,
        durationMs: c.durationMs || v.matched?.durationMs || undefined,
        category,
        axis: null,
        reason: c.reason || (category === 'artist' ? '歌手推荐：与您常听风格相近' : '新歌推荐：近期值得一听'),
        trackId: c.trackId,
        coverUrl: coverUrl || undefined,
        verification: { source: v.verification.source, url: v.verification.url, verifiedAt: v.verification.verifiedAt },
      })
    }
    return items
  }

  /** 歌手名 slug（与 metadata CONTRACT 一致：小写、保留中日韩、其余非字母数字转-、去首尾-）。 */
  function artistSlug(name) {
    const s = String(name ?? '').toLowerCase().trim()
      .replace(/[^\p{L}\p{N}\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu, '-')
    return s.replace(/^-+|-+$/g, '') || 'artist'
  }

  /** 维基百科 live 兜底：action=query 取简介（REST summary 在本机网络下超时，已实测改用 action API）。
   * zh.wikipedia 对无 UA 请求回 HTML 拦截页（json() 会抛错 → 资料恒空，D4），必须带 UA；10s 超时，失败返回 null。 */
  async function liveWikiProfile(name) {
    try {
      const api = 'https://zh.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&redirects=1&titles='
      const resp = await fetch(api + encodeURIComponent(name), {
        headers: { 'User-Agent': 'dsh-music-plugin/0.1.0 ( local music plugin )', Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (!resp.ok) return null
      const j = await resp.json()
      const pages = j?.query?.pages ?? {}
      const page = Object.values(pages).find((p) => p?.extract)
      if (!page?.extract) return null
      return {
        intro: {
          text: page.extract,
          source: '维基百科',
          url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(name)}`,
          date: new Date().toISOString().slice(0, 10),
        },
        news: [], trivia: [], similarArtists: [], similarSongs: [],
      }
    } catch {
      return null
    }
  }

  /** 轻量歌手头像（六期批2）：{imageUrl: 原图, thumbnailUrl: 缩略图}，失败两项 null。不拉简介/歌曲。 */
  async function artistAvatar(name) {
    const raw = typeof name === 'string' ? name.trim().slice(0, 100) : ''
    if (!raw) {
      const err = new Error('缺少歌手名 name')
      err.code = 'BAD_REQUEST'
      throw err
    }
    const img = await images.artistAvatar(raw)
    return {
      imageUrl: img?.original ?? img?.thumbnail ?? null,
      thumbnailUrl: img?.thumbnail ?? null,
    }
  }

  /** 歌手页（三期）：资料（拾词歌手卡片缓存优先，缺失时维基 live 兜底）+ 该歌手真实歌曲（≤20，逐首核实）。
   * songs 中曲库已有歌曲带 trackId/inLibrary（客户端可直接播）；其余带 verification（试听/喜欢用）。 */
  async function artistPage(name) {
    const raw = typeof name === 'string' ? name.trim().slice(0, 100) : ''
    if (!raw) {
      const err = new Error('缺少歌手名 name')
      err.code = 'BAD_REQUEST'
      throw err
    }
    const a = await discover.findArtist(raw)
    if (!a) {
      const err = new Error(`未找到歌手「${raw}」`)
      err.code = 'NOT_FOUND'
      throw err
    }
    const cacheFile = join(storage.dataDir, 'cache', 'artists', `${artistSlug(a.name)}.json`)
    const cached = await readJson(cacheFile, null)
    let profile = cached?.data ?? null
    let message = null
    if (!profile) {
      const live = await liveWikiProfile(a.name)
      if (live) {
        // 九期点4：live 维基兜底成功即持久化（与 metadata/artist.js 同一缓存格式/路径，两条路径共享，
        // TTL 内重开零网络拉取）；写失败只告警，不影响本次返回。
        const data = { name: a.name, ...live }
        try {
          await writeJson(cacheFile, { version: 1, data, fetchedAt: Date.now() })
        } catch (err) {
          warn?.(`dsh-music: 回写歌手缓存失败 ${a.name}: ${err.message}`)
        }
        profile = data
      } else {
        message = '暂无该歌手资料'
      }
    }
    if (typeof library.ensureScanned === 'function') await library.ensureScanned()
    const tracks = library.snapshot()?.tracks ?? []
    const libMap = new Map()
    for (const t of tracks) libMap.set(normKey(t.artist ?? t.meta?.artist, t.title ?? t.meta?.title), t)
    const img = await images.artistImage(a.name)
    const imageUrl = img?.original ?? img?.thumbnail ?? null
    const thumbnailUrl = img?.thumbnail ?? null
    // 横幅专用：1200px 派生（维基原图派生失败回落缩略图/原图；非维基源用缩略图）
    const bannerUrl = img?.banner ?? thumbnailUrl ?? imageUrl
    if (profile) profile = { ...profile, imageUrl }
    const recs = await discover.browseRecordings(a.mbid, a.name)
    const songs = []
    const seen = new Set()
    const { keys: dislikedKeys } = await readDislikes()
    // 去括号版本后缀去重（Live/Remix 版不重复占位）
    const baseKey = (artist, title) => normKey(artist, String(title).replace(/[（(].*?[)）]/g, ''))
    for (const r of recs) {
      if (songs.length >= 20) break
      const key = baseKey(r.artist, r.title)
      if (!key || seen.has(key)) continue
      if (dislikedKeys.has(normKey(r.artist, r.title))) continue
      seen.add(key)
      const v = await verifier.verify({ artist: r.artist, title: r.title, durationMs: r.durationMs })
      if (!v) continue
      const lib = libMap.get(normKey(r.artist, r.title))
      const coverUrl = lib?.coverUrl ?? await images.coverUrl({ artist: r.artist, title: r.title, releaseGroupIds: v.releaseGroupIds })
      songs.push({
        artist: r.artist,
        title: r.title,
        album: v.matched?.album || undefined,
        durationMs: r.durationMs || v.matched?.durationMs || undefined,
        inLibrary: Boolean(lib),
        trackId: lib?.id,
        coverUrl: coverUrl || undefined,
        verification: { source: v.verification.source, url: v.verification.url, verifiedAt: v.verification.verifiedAt },
      })
    }
    if (songs.length === 0) message = message ?? '该歌手暂无可核实的歌曲'
    return { name: a.name, mbid: a.mbid, profile, imageUrl, thumbnailUrl, bannerUrl, songs, generatedAt: Date.now(), message }
  }

  async function generateInner({ taste } = {}) {
    const { events } = await history.read({ limit: HISTORY_LIMIT })
    // D3 冷启动：历史不足（<3 条播放事件）时放宽为「探索批次」——只需探索轴合格候选 ≥6 即出批，
    // 相近位为 0；批次明示 bootstrap，随收听增长自动回到 14+6 常规装配。核实前置不变。
    const bootstrap = events.length < BOOTSTRAP_HISTORY_EVENTS
    let snap = library.snapshot()
    if (!snap?.scannedAt) {
      await library.scan()
      snap = library.snapshot()
    }
    const tracks = snap?.tracks ?? []
    const { seedArtists, topArtistSet, profileValues, profile, libraryKeys, recentKeys } = await buildProfile(events, tracks)
    const { keys: dislikedKeys, artists: dislikedArtists } = await readDislikes()

    // ---- 探索轴轮换（quota.js，批间轮转 + 固定意外之喜位）----
    const state = await readJson(stateFile, {})
    const plan = planExploreSlots(state)

    // ---- 候选发现（MusicBrainz，无 LLM）；近 2 批推荐过的歌不再重复推荐 ----
    const recentRecommended = new Set(Array.isArray(state.recentRecommended) ? state.recentRecommended : [])
    const similar = await discover.buildSimilarCandidates({
      seedArtists, libraryKeys, recentKeys, extraKeys: recentRecommended, cursor: Number(state.cursors?.similar) || 0,
    })
    const exploreResult = await discover.buildExploreCandidates({
      slots: plan.slots, profileValues, cursors: state.cursors ?? {}, taste,
    })
    const deduped = [
      ...similar,
      ...exploreResult.candidates.filter((c) => !recentRecommended.has(normKey(c.artist, c.title))),
    ].filter((c) => !dislikedKeys.has(normKey(c.artist, c.title)))
    // ④ 避开不喜欢：标记过的歌直接排除；同歌手的其余曲目软降权（排到最后，仅在候选不足时补位）
    const isDislikedArtist = (c) => dislikedArtists.has(String(c.artist ?? '').trim().toLowerCase())
    const candidates = [
      ...deduped.filter((c) => !isDislikedArtist(c)),
      ...deduped.filter((c) => isDislikedArtist(c)),
    ]
    const needSimilar = bootstrap ? 0 : SIMILAR_SLOTS
    if (candidates.length < needSimilar + EXPLORE_SLOTS) {
      throw new Error(`候选发现不足（${candidates.length}/${needSimilar + EXPLORE_SLOTS}），MusicBrainz 可能限速，请稍后重试`)
    }

    // ---- 70/30 装配（曲库去重、避开高频歌手、探索轴值须与画像不同）----
    const picked = assembleBatch(candidates, {
      libraryKeys, topArtistSet, profileValues, exploreSlots: plan.slots, similarCount: needSimilar,
    })
    if (picked.length < needSimilar + EXPLORE_SLOTS) {
      throw new Error(`合格候选不足（装配 ${picked.length}/10），请稍后重试生成`)
    }

    // ---- 逐首联网核实；失败用同类替补（保证输出全部核实过）----
    const finalItems = []
    const need = { similar: needSimilar, explore: EXPLORE_SLOTS }
    const got = { similar: 0, explore: 0 }
    const extraPool = candidates.filter((c) => {
      const key = normKey(c.artist, c.title)
      return key && !libraryKeys.has(key) && !picked.some((p) => normKey(p.artist, p.title) === key)
    })
    const tryFill = async (cand, category, axis) => {
      const v = await verifier.verify({ artist: cand.artist, title: cand.title, durationMs: cand.durationMs })
      if (!v) return false
      const coverUrl = cand.coverUrl ?? await images.coverUrl({ artist: cand.artist, title: cand.title, releaseGroupIds: v.releaseGroupIds })
      finalItems.push({
        artist: cand.artist,
        title: cand.title,
        album: cand.album || v.matched.album || undefined,
        durationMs: cand.durationMs || v.matched.durationMs || undefined,
        category,
        axis: axis ?? null,
        reason: cand.reason || '根据你的收听历史挑选',
        coverUrl: coverUrl || undefined,
        genreHint: cand.genreHint || undefined,
        languageHint: cand.languageHint || undefined,
        eraHint: cand.eraHint || undefined,
        sceneHint: cand.sceneHint || undefined,
        verification: {
          source: v.verification.source,
          url: v.verification.url,
          verifiedAt: v.verification.verifiedAt,
        },
      })
      got[category]++
      return true
    }
    for (const item of picked) {
      if (got[item.category] >= need[item.category]) continue
      await tryFill(item, item.category, item.axis)
    }
    if (got.similar < need.similar || got.explore < need.explore) {
      const filledAxes = new Set(finalItems.filter((i) => i.category === 'explore').map((i) => i.axis))
      for (const c of extraPool) {
        if (got.similar >= need.similar && got.explore >= need.explore) break
        if (c.category === 'similar' && got.similar < need.similar) await tryFill(c, 'similar', null)
        else if (c.category === 'explore' && got.explore < need.explore
          && exploreCandidateOk(c, { topArtistSet, profileValues })) {
          // 替补优先补「尚未覆盖的轴」，保持探索轴多样性
          const slot = plan.slots.find((s) => s.axis === c.axis && !filledAxes.has(s.axis))
            ?? plan.slots.find((s) => !filledAxes.has(s.axis))
          if (!slot) continue
          if (await tryFill(c, 'explore', slot.axis)) filledAxes.add(slot.axis)
        }
      }
    }
    if (finalItems.length < needSimilar + EXPLORE_SLOTS) {
      warn?.(`dsh-music: 核实后仅 ${finalItems.length}/${needSimilar + EXPLORE_SLOTS} 首有效`)
    }

    const batch = {
      generatedAt: Date.now(),
      engine: 'traditional-musicbrainz',
      bootstrap,
      note: bootstrap ? '探索批次：基于公众热门流派与场景生成，收听增长后会逐步个性化' : null,
      profile,
      explorePlan: plan.slots.map((s) => ({ axis: s.axis, label: s.label })),
      stats: {
        historyEvents: events.length,
        librarySize: tracks.length,
        topArtists: seedArtists.slice(0, 3),
        similar: finalItems.filter((i) => i.category === 'similar').length,
        explore: finalItems.filter((i) => i.category === 'explore').length,
        verified: finalItems.length,
      },
      items: finalItems,
    }
    // 状态与批次记录（仅本地）
    await writeJson(stateFile, {
      nextAxis: plan.nextAxis,
      cursors: { ...(state.cursors ?? {}), ...exploreResult.cursors, similar: (Number(state.cursors?.similar) || 0) + 5 },
      recentRecommended: [
        ...(Array.isArray(state.recentRecommended) ? state.recentRecommended : []),
        ...finalItems.map((i) => normKey(i.artist, i.title)),
      ].slice(-RECENT_RECOMMENDED_MAX),
      updatedAt: Date.now(),
    })
    const batches = await readJson(historyFile, [])
    batches.push(batch)
    await writeJson(historyFile, batches.slice(-50))
    return batch
  }

  /** 三栏目入口：today(7+3 当日批次) + artist(高频歌手扩相似) + new(新增/近期发行)。
   * 当日已有批次则复用（todayFromCache=true），否则生成新批次（推进轮换）。
   * 全部候选逐首 MB 核实；item 结构同 /api/reco，可直接传 POST /api/download。 */
  async function sections(options = {}) {
    const taste = options?.taste ?? undefined
    if (sectionsBusy) {
      const err = new Error('推荐栏目正在生成中，请稍候')
      err.code = 'BUSY'
      throw err
    }
    sectionsBusy = true
    try {
      const { events } = await history.read({ limit: HISTORY_LIMIT })
      if (typeof library.ensureScanned === 'function') await library.ensureScanned()
      const snap = library.snapshot()
      const tracks = snap?.tracks ?? []
      const { seedArtists, libraryKeys, recentKeys, profile } = await buildProfile(events, tracks)

      // today：同一自然日「且数量达标（>= 14+6）」才复用最近一批；否则生成新批次（推进探索轴轮换）。
      // 旧版本（二期 10 首/批）的当日批次不足 20，必须重生成，否则活体会显示 10 首。
      const batches = await readJson(historyFile, [])
      const lastBatch = Array.isArray(batches) && batches.length > 0 ? batches[batches.length - 1] : null
      let today
      let todayBatch = null
      let todayGeneratedAt
      let todayFromCache = false
      // D3：探索批次只有 ≥6 首，但同日内仍应复用（否则每次进推荐页都重新生成）
      const sizeOk = (lastBatch?.items ?? []).length >= SIMILAR_SLOTS + EXPLORE_SLOTS || lastBatch?.bootstrap === true
      if (lastBatch && sameLocalDay(lastBatch.generatedAt, Date.now()) && sizeOk) {
        today = lastBatch.items ?? []
        todayBatch = lastBatch
        todayGeneratedAt = lastBatch.generatedAt
        todayFromCache = true
        // 旧批次（三期生成，无 coverUrl）：复用时就地回填并写回批次——
        // 本地曲走曲库封面路由，其余走图片模块（有 30 天缓存），失败保持 null 由前端兜底。
        if (today.some((i) => !i.coverUrl)) {
          let changed = false
          for (const it of today) {
            if (it.coverUrl) continue
            let coverUrl = null
            if (it.trackId) {
              const rec = library.getRecord?.(it.trackId)
              if (rec?.meta?.hasCover) coverUrl = `/dsh-music/cover/${it.trackId}`
            }
            if (!coverUrl) coverUrl = await images.coverUrl({ artist: it.artist, title: it.title })
            if (coverUrl) {
              it.coverUrl = coverUrl
              changed = true
            }
          }
          if (changed) {
            lastBatch.items = today
            await writeJson(historyFile, batches)
          }
        }
      } else {
        const batch = await generate(taste ? { taste } : {})
        today = batch.items
        todayBatch = batch
        todayGeneratedAt = batch.generatedAt
      }

      // 状态在 generate() 之后重读，避免覆盖其写入的轮换游标/防重复名单
      const state = await readJson(stateFile, {})
      const recentRecommended = new Set(Array.isArray(state.recentRecommended) ? state.recentRecommended : [])
      const usedKeys = new Set([...recentRecommended, ...today.map((i) => normKey(i.artist, i.title))])

      // artist：20 位歌手对象（高频歌手的关系歌手 + 同标签热门歌手补充，含歌手页核实记录）
      const artistResult = await discover.buildArtistList({
        seedArtists, exclude: new Set(seedArtists), cursor: Number(state.cursors?.artist) || 0, limit: 20,
      })
      // 歌手真实图（维基 action API 批量一次请求，失败 null 由前端兜底）
      const imgMap = await images.artistImages(artistResult.artists.map((a) => a.name))
      const artist = artistResult.artists.map((a) => ({ ...a, imageUrl: imgMap.get(a.name)?.thumbnail ?? null }))

      // new：真正的新发行（近 180 天，八期①）——高频歌手/相似歌手/口味流派来源；本地刚入库不算新歌
      const disliked = await readDislikes()
      const tasteGenres = (taste?.genres?.length ? taste.genres : profile.genres).slice(0, 4)
      const usedForNew = new Set(usedKeys)
      const newCands = (await discover.buildNewCandidates({
        tracks, getRecord: (id) => library.getRecord(id), seedArtists, libraryKeys, recentKeys, extraKeys: usedForNew,
        tasteGenres, dislikedKeys: disliked.keys, dislikedArtists: disliked.artists, limit: 20,
      })).filter((c) => !disliked.keys.has(normKey(c.artist, c.title)))
      const fresh = await verifyToItems(newCands, { limit: 20, category: 'new', usedKeys: usedForNew })

      // 持久化歌手轮换游标（merge 现有 state，不覆盖其余字段）
      await writeJson(stateFile, {
        ...state,
        cursors: { ...(state.cursors ?? {}), artist: artistResult.cursor },
        updatedAt: Date.now(),
      })
      return {
        today, artist, new: fresh, generatedAt: Date.now(), todayGeneratedAt, todayFromCache,
        // D3 明示：今日栏为冷启动「探索批次」（历史不足时），前端可据此显示说明
        exploreOnly: Boolean(todayBatch?.bootstrap),
        note: todayBatch?.note ?? null,
      }
    } finally {
      sectionsBusy = false
    }
  }

  return {
    generate,
    sections,
    styleSearch,
    artistPage,
    artistAvatar,
    isGenerating: () => generating,
    /** 最近一批（不触发生成）；无则 null。 */
    async last() {
      const batches = await readJson(historyFile, [])
      return Array.isArray(batches) && batches.length > 0 ? batches[batches.length - 1] : null
    },
    dispose() { /* 无常驻资源：MB 请求均为一次性 */ },
  }
}

export function registerRecoRoutes(webServer, { reco, logger }) {
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

  const parseTaste = (req) => {
    const url = new URL(req.url ?? '/', 'http://dsh-music.local')
    const parseList = (key) => (url.searchParams.get(key) ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20)
    const genres = parseList('genres')
    const languages = parseList('languages')
    return genres.length || languages.length ? { genres, languages } : undefined
  }

  const disposers = []
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/reco',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      try {
        const taste = parseTaste(req)
        const batch = await reco.generate(taste ? { taste } : {})
        return sendJson(res, 200, batch)
      } catch (err) {
        if (err.code === 'BUSY') return sendJson(res, 409, { error: err.message })
        warn(`dsh-music: 推荐服务错误: ${err.message}`)
        return sendJson(res, 502, { error: `推荐生成失败：${err.message}` })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/reco/status',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      const last = await reco.last()
      return sendJson(res, 200, {
        running: reco.isGenerating(),
        generatedAt: last?.generatedAt ?? null,
        stats: last?.stats ?? null,
        items: last?.items ?? [],
      })
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/reco/sections',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      try {
        const taste = parseTaste(req)
        return sendJson(res, 200, await reco.sections(taste ? { taste } : {}))
      } catch (err) {
        if (err.code === 'BUSY') return sendJson(res, 409, { error: err.message })
        warn(`dsh-music: 推荐栏目服务错误: ${err.message}`)
        return sendJson(res, 502, { error: `推荐栏目生成失败：${err.message}` })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/reco/artist-image',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      try {
        const url = new URL(req.url ?? '/', 'http://dsh-music.local')
        const name = url.searchParams.get('name') ?? ''
        return sendJson(res, 200, await reco.artistAvatar(name))
      } catch (err) {
        if (err.code === 'BAD_REQUEST') return sendJson(res, 400, { error: err.message })
        warn(`dsh-music: 歌手头像服务错误: ${err.message}`)
        return sendJson(res, 502, { error: `歌手头像获取失败：${err.message}` })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/reco/artist',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      try {
        const url = new URL(req.url ?? '/', 'http://dsh-music.local')
        const name = url.searchParams.get('name') ?? ''
        return sendJson(res, 200, await reco.artistPage(name))
      } catch (err) {
        if (err.code === 'BAD_REQUEST') return sendJson(res, 400, { error: err.message })
        if (err.code === 'NOT_FOUND') return sendJson(res, 404, { error: err.message })
        warn(`dsh-music: 歌手页服务错误: ${err.message}`)
        return sendJson(res, 502, { error: `歌手页加载失败：${err.message}` })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/reco/style',
    handler: async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      try {
        const url = new URL(req.url ?? '/', 'http://dsh-music.local')
        const q = url.searchParams.get('q') ?? ''
        return sendJson(res, 200, await reco.styleSearch(q))
      } catch (err) {
        warn(`dsh-music: 风格搜索服务错误: ${err.message}`)
        return sendJson(res, 502, { error: `风格搜索失败：${err.message}` })
      }
    },
  }))
  return disposers
}
