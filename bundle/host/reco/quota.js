/** 历史特征提取 + 批次配额规划（纯函数，无 IO，便于测试）。
 * 特征：近期高频歌手（探索位要避开）、口味画像字段交给 LLM 在 prompt 里推断。 */

const AXES = ['genre', 'language', 'era', 'scene']
const AXIS_LABEL = { genre: '流派', language: '语言', era: '年代', scene: '场景', wildcard: '意外之喜' }

/** 近 N 次播放内的高频歌手。权重 = 完整度 + 未跳过 0.3；跳过记 0.1。 */
export function topArtists(events, { window = 60, top = 5 } = {}) {
  const recent = events.slice(0, window)
  const weight = new Map()
  for (const e of recent) {
    if (!e?.artist) continue
    const w = e.skipped ? 0.1 : (Number(e.completion) || 0) + 0.3
    weight.set(e.artist, (weight.get(e.artist) ?? 0) + w)
  }
  return [...weight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([artist, score]) => ({ artist, score: Math.round(score * 100) / 100 }))
}

/** 探索轴轮换（三期：每批 6 个探索位 = 4 轴各 1 + 2 个「意外之喜」位）。
 * 4 轴每批全覆盖（保证探索轴多样性），两批的起始顺序轮换（+2），池内取值由游标轮转。
 * state: { nextAxis: number }，由调用方持久化。 */
export function planExploreSlots(state) {
  const next = Number.isFinite(state?.nextAxis) ? ((state.nextAxis % AXES.length) + AXES.length) % AXES.length : 0
  const order = [0, 1, 2, 3].map((i) => AXES[(next + i) % AXES.length])
  const slots = [
    ...order.map((axis) => ({ axis })),
    { axis: 'wildcard' }, { axis: 'wildcard' },
  ]
  return { slots: slots.map((s) => ({ ...s, label: AXIS_LABEL[s.axis] })), nextAxis: (next + 2) % AXES.length }
}

/** 归一化歌手+标题（去空白/标点、小写），用于去重比对。 */
export function normKey(artist, title) {
  const s = `${artist ?? ''}::${title ?? ''}`.toLowerCase()
  return s.replace(/[\s'"’·・\-—–,，.。!！?？:：;；()（）\[\]【】]/g, '')
}

/** 探索位合法性：与历史画像不同的轴值 ≥1 种，且不在高频歌手名单。 */
export function exploreCandidateOk(cand, { topArtistSet, profileValues }) {
  if (!cand?.artist || !cand?.title) return false
  if (topArtistSet.has(cand.artist)) return false
  const hints = [cand.genreHint, cand.languageHint, cand.eraHint, cand.sceneHint].filter(Boolean)
  return hints.some((h) => !profileValues.has(String(h).toLowerCase()))
}

/** 把候选装配成「相近 N + 探索 M」：按类别顺序取用，跳过重复/已在曲库/不合格者。
 * similarCount 默认 7（二期 10 首批次）；三期 20 首批次传 14。 */
export function assembleBatch(candidates, { libraryKeys, topArtistSet, profileValues, exploreSlots, similarCount = 7 }) {
  const used = new Set(libraryKeys)
  const items = []
  const take = (category, axis, predicate) => {
    for (const c of candidates) {
      if (c.__taken) continue
      if (c.category !== category) continue
      const key = normKey(c.artist, c.title)
      if (!key || used.has(key)) continue
      if (predicate && !predicate(c)) continue
      c.__taken = true
      used.add(key)
      items.push({
        artist: String(c.artist).slice(0, 120),
        title: String(c.title).slice(0, 160),
        album: c.album ? String(c.album).slice(0, 160) : undefined,
        durationMs: Number.isFinite(Number(c.durationMs)) && c.durationMs > 0 ? Math.round(c.durationMs) : undefined,
        category,
        axis: axis ?? null,
        reason: String(c.reason ?? '').slice(0, 200) || '根据你的收听历史挑选',
        genreHint: c.genreHint ? String(c.genreHint).slice(0, 40) : undefined,
        languageHint: c.languageHint ? String(c.languageHint).slice(0, 40) : undefined,
        eraHint: c.eraHint ? String(c.eraHint).slice(0, 40) : undefined,
        sceneHint: c.sceneHint ? String(c.sceneHint).slice(0, 40) : undefined,
      })
      return true
    }
    return false
  }
  // 相近位
  for (let i = 0; i < similarCount; i++) take('similar', null, null)
  // 3 个探索位：优先取与槽位同轴的候选（保证轴覆盖），该轴无候选时才放宽
  for (const slot of exploreSlots) {
    const ok = (c) => exploreCandidateOk(c, { topArtistSet, profileValues })
    if (!take('explore', slot.axis, (c) => c.axis === slot.axis && ok(c))) {
      take('explore', slot.axis, ok)
    }
  }
  for (const c of candidates) delete c.__taken
  return items
}
