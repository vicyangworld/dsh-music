/** 多样性度量（S4 反茧房）：对比推荐 vs 收听历史/曲库的流派/语言/年代分布，
 * 量化探索位带来的新增覆盖。纯函数、无 IO，便于单测；数据由调用方注入。
 * 流派来源：MusicBrainz 歌手标签（artistTags: Map artist→tags[]，发现缓存/活体查询均可）；
 * 语言来源：文字系统启发式；年代：本地标签无年代字段，历史侧记为未知，探索侧按 eraHint 计新增。 */

/** 语言启发式：按文字系统判定（华语/日语/韩语/欧美）。 */
export function detectLanguage(text) {
  const s = String(text ?? '')
  if (/[\u3040-\u30ff]/.test(s)) return '日语'
  if (/[\uac00-\ud7af]/.test(s)) return '韩语'
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(s)) return '华语'
  return '欧美'
}

/** 语言分布：items=[{artist,title}] → {语言: 计数}（按条目数）。 */
export function languageDistribution(items) {
  const dist = {}
  for (const it of items ?? []) {
    const lang = detectLanguage(`${it.artist ?? ''} ${it.title ?? ''}`)
    dist[lang] = (dist[lang] ?? 0) + 1
  }
  return dist
}

/** 历史流派分布：按播放权重（完整度+未跳过加成，跳过 0.1）累加歌手 MB 标签。
 * artistTags: Map artist→tags[]；无标签的歌手计入「未知」。 */
export function historyGenreDistribution(events, artistTags) {
  const dist = {}
  for (const e of events ?? []) {
    if (!e?.artist) continue
    const w = e.skipped ? 0.1 : (Number(e.completion) || 0) + 0.3
    const tags = artistTags?.get(e.artist)
    if (!tags || tags.length === 0) {
      dist['未知'] = (dist['未知'] ?? 0) + w
      continue
    }
    for (const t of tags) dist[t] = (dist[t] ?? 0) + w
  }
  for (const k of Object.keys(dist)) dist[k] = Math.round(dist[k] * 100) / 100
  return dist
}

/** 歌手集合的流派标签并集（小写）。 */
export function genreSetOf(artists, artistTags) {
  const set = new Set()
  for (const a of artists ?? []) {
    for (const t of artistTags?.get(a) ?? []) set.add(String(t).toLowerCase())
  }
  return set
}

/** 核心度量：推荐 vs 历史。
 * 输入：events（历史，newest-first）、tracks（曲库扁平 {artist,title}）、
 *       batches（reco-history.json 批次数组）、artistTags（Map artist→tags[]）。
 * 输出：历史/曲库画像 + 每批新增覆盖 + 跨批汇总。 */
export function computeDiversity({ events = [], tracks = [], batches = [], artistTags = new Map() }) {
  const histArtists = [...new Set(events.map((e) => e.artist).filter(Boolean))]
  const histGenres = genreSetOf(histArtists, artistTags)
  const histLangs = new Set(Object.keys(languageDistribution(events)))
  const histTop = [...new Set(events.slice(0, 60).map((e) => e.artist).filter(Boolean))]
  const libLangs = languageDistribution(tracks)
  const libArtists = [...new Set(tracks.map((t) => t.artist).filter(Boolean))]
  const libGenres = genreSetOf(libArtists, artistTags)
  // 画像基线 = 历史 ∪ 曲库（推荐系统实际使用的 profileValues 口径）
  const baseGenres = new Set([...histGenres, ...libGenres])
  const baseLangs = new Set([...histLangs, ...Object.keys(libLangs)])

  const perBatch = batches.map((b) => {
    const items = b.items ?? []
    const similar = items.filter((i) => i.category === 'similar')
    const explore = items.filter((i) => i.category === 'explore')
    // 新增覆盖以「批次生成时的画像」为基线（引擎实际避重口径）；
    // 不用当前曲库——推荐歌曲下载入库后会回流进曲库，稀释新增覆盖度量。
    const batchGenres = Array.isArray(b.profile?.genres) && b.profile.genres.length > 0
      ? new Set(b.profile.genres.map((g) => String(g).toLowerCase()))
      : baseGenres
    const batchLangs = Array.isArray(b.profile?.languages) && b.profile.languages.length > 0
      ? new Set(b.profile.languages)
      : baseLangs
    // 探索位新增覆盖：轴标签（hint）相对批次画像
    const hintValues = (field) => [...new Set(explore.map((i) => i[field]).filter(Boolean))]
    const newGenres = hintValues('genreHint').filter((g) => !batchGenres.has(String(g).toLowerCase()))
    const newLanguages = hintValues('languageHint').filter((l) => !batchLangs.has(l))
    const newEras = hintValues('eraHint') // 历史侧无年代数据，探索年代均计新增
    const newScenes = hintValues('sceneHint').filter((s) => s !== '意外之喜')
    // MB 标签实测口径：探索歌手的全部标签中不在批次画像里的（含意外之喜位）
    const exploreArtistTags = genreSetOf(explore.map((i) => i.artist), artistTags)
    const tagNewGenres = [...exploreArtistTags].filter((g) => !batchGenres.has(g))
    // 相近位与历史的歌手重合度
    const overlap = similar.filter((i) => histArtists.includes(i.artist)).length
    // 探索位避开高频歌手校验
    const topSet = new Set(histTop.slice(0, 3))
    const exploreAvoidsTop = explore.every((i) => !topSet.has(i.artist))
    return {
      generatedAt: b.generatedAt,
      engine: b.engine ?? 'unknown',
      plan: (b.explorePlan ?? []).map((p) => p.axis),
      counts: { similar: similar.length, explore: explore.length, total: items.length },
      allVerified: items.length > 0 && items.every((i) => i.verification?.source && i.verification?.url && Number.isFinite(i.verification.verifiedAt)),
      axes: [...new Set(explore.map((i) => i.axis).filter(Boolean))],
      newGenres, newLanguages, newEras, newScenes, tagNewGenres,
      wildcard: explore.filter((i) => i.axis === 'wildcard').map((i) => `${i.artist} - ${i.title}`),
      similarArtistOverlap: { count: overlap, of: similar.length },
      similarLanguages: languageDistribution(similar),
      exploreAvoidsTop,
    }
  })

  const union = (field) => [...new Set(perBatch.flatMap((p) => p[field]))]
  const exploreItems = batches.flatMap((b) => (b.items ?? []).filter((i) => i.category === 'explore'))
  const allItems = batches.flatMap((b) => b.items ?? [])
  const keys = allItems.map((i) => `${i.artist}::${i.title}`)
  return {
    history: {
      events: events.length,
      uniqueArtists: histArtists.length,
      languages: languageDistribution(events),
      genres: historyGenreDistribution(events, artistTags),
      genreSet: [...histGenres],
    },
    library: { tracks: tracks.length, uniqueArtists: libArtists.length, languages: libLangs, genreSet: [...libGenres] },
    baseline: { genres: [...baseGenres], languages: [...baseLangs] },
    perBatch,
    overall: {
      batches: batches.length,
      items: allItems.length,
      newGenres: union('newGenres'),
      newLanguages: union('newLanguages'),
      newEras: union('newEras'),
      newScenes: union('newScenes'),
      tagNewGenres: union('tagNewGenres'),
      uniqueExploreArtists: [...new Set(exploreItems.map((i) => i.artist))],
      repeatRate: keys.length > 0 ? Math.round((1 - new Set(keys).size / keys.length) * 100) : 0,
      quotaOk: perBatch.every((p) => p.counts.similar >= 7 && p.counts.explore >= 3),
      axesPerBatchOk: perBatch.every((p) => p.axes.length >= 3),
      verifiedOk: perBatch.every((p) => p.allVerified),
      avoidsTopOk: perBatch.every((p) => p.exploreAvoidsTop),
    },
  }
}
