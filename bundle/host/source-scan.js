/** 十三期：导入曲目的音源后台扫描。
 * 导入只标 ♥（不下载）。这里在后台逐首用 MusicBrainz 搜（复用 search.js：命中即核实 + 留档），
 * 把最佳已核实候选写进 likes.json 条目的 source 字段：
 *   source: { status: 'found' | 'none', checkedAt, query, hit: { artist, title, album, durationMs, verification } }
 * 前端据此把行尾「入库」换成"可入库"样式；点歌 / 点入库直接用 hit，不再当场搜索（也就不会"没找到"）。
 * 约束：串行、跟随 reco/mb.js 的全局限速（≤1 req/s）；found 不再扫；none 7 天内不重扫（可 force）。
 * 评分：歌名归一后完全一致 ≫ 去括号/feat 后一致 ≫ 包含；歌手覆盖加分；MusicBrainz score 微调。 */
import { normalizeZh } from './t2s.js'

const NONE_TTL_MS = 7 * 24 * 3600 * 1000
const GAP_MS = 400
const MAX_QUEUE = 5000

const PUNCT = /[\s·・,，、;；&+!-/:-@[-`{-~\u2000-\u206f\u3000-\u303f\uff00-\uffef\u2014\u2026（）()「」『』【】《》〈〉“”‘’]/g

/** 比较用归一：简繁 → 小写 → 去空白与标点。 */
export function normText(value) {
  return normalizeZh(String(value ?? '')).toLowerCase().replace(PUNCT, '')
}

/** 去掉括号补充、feat./ft. 尾巴，用于第二次匹配与兜底查询。 */
export function cleanTitle(value) {
  return String(value ?? '')
    .replace(/[（(【[][^）)】\]]*[）)】\]]/g, ' ')
    .replace(/\b(?:feat|ft|featuring|with)\b.*$/i, ' ')
    .replace(/[!-/:-@[-`{-~\u2014\u2026·、，。！？；：""''…～]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function artistsOf(artist) {
  return String(artist ?? '').split(/\s*(?:\/|、|,|，|;|；|&|\+|feat\.?|ft\.?)\s*/i).map((a) => normText(a)).filter(Boolean)
}

/** 从联网候选里挑最像的一首；没有歌名对得上的就返回 null。 */
export function pickHit(item, remote = []) {
  const wantT = normText(item.title)
  const wantC = normText(cleanTitle(item.title))
  const wantA = artistsOf(item.artist)
  let best = null
  for (const x of remote) {
    if (!x || x.kind === 'artist' || !x.verification || !x.title) continue
    const xt = normText(x.title)
    let score = 0
    if (xt === wantT) score += 30
    else if (wantC && normText(cleanTitle(x.title)) === wantC) score += 24
    else if (xt && wantT && (xt.includes(wantT) || wantT.includes(xt))) score += 10
    else continue
    const xa = normText(x.artist)
    let cover = 0
    for (const a of wantA) if (a && xa.includes(a)) cover++
    if (wantA.length) score += cover * 6 - (cover === 0 ? 4 : 0)
    const mbScore = Number((String((x.verification.note || '')).match(/score=(\d+)/) || [])[1])
    if (Number.isFinite(mbScore)) score += Math.min(3, Math.floor(mbScore / 30))
    if (!best || score > best.score) best = { x, score }
  }
  return best ? best.x : null
}

/** 只保留入库需要的字段（hit 原样交给下载管线的 validate：artist/title + verification）。 */
export function sanitizeHit(hit) {
  if (!hit) return null
  return {
    kind: 'song',
    id: hit.id || null,
    artist: hit.artist,
    title: hit.title,
    album: hit.album || null,
    durationMs: Number.isFinite(hit.durationMs) ? hit.durationMs : null,
    source: hit.source || 'musicbrainz',
    verification: hit.verification,
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function createSourceScan({ likes, search, logger, now = () => Date.now() }) {
  const warn = (msg) => logger?.warn?.(msg)
  const queue = []
  const queued = new Set()
  const state = { running: false, pending: 0, done: 0, found: 0, error: null, startedAt: null, finishedAt: null }
  let disposed = false

  function status() {
    return { ...state, pending: queue.length }
  }

  /** 把 key 排进扫描队列（去重；超过上限的先丢弃，下一轮 scheduleMissing 会补上）。 */
  function schedule(keys) {
    if (disposed) return 0
    for (const key of Array.isArray(keys) ? keys : []) {
      if (queued.has(key) || queue.length >= MAX_QUEUE) continue
      queued.add(key)
      queue.push(key)
    }
    state.pending = queue.length
    pump()
    return queue.length
  }

  /** 所有还没入库的喜欢条目（found 的由 scanKey 跳过；none 的按 TTL 跳过）。 */
  async function scheduleMissing({ force = false } = {}) {
    const keys = await likes.missingKeys()
    if (force) state.force = true
    return schedule(keys)
  }

  async function scanKey(key) {
    const item = await likes.get(key)
    if (!item) return true
    if (await likes.inLibrary(key)) return true
    const prev = item.source
    if (prev && prev.status === 'found' && prev.hit) return true
    if (!state.force && prev && prev.status === 'none' && now() - (Number(prev.checkedAt) || 0) < NONE_TTL_MS) return true
    const queries = [...new Set([`${item.artist || ''} ${item.title || ''}`.trim(), item.title, cleanTitle(item.title)].filter((q) => q && q.length >= 2))]
    let hit = null
    let used = null
    for (const q of queries) {
      let res
      try {
        res = await search.search(q, 'song')
      } catch (err) {
        // 联网失败：本轮停摆，key 回到队首，下次 schedule 再来
        state.error = err.message
        queue.unshift(key)
        queued.add(key)
        return false
      }
      hit = pickHit(item, (res && res.remote) || [])
      if (hit) { used = q; break }
      if (disposed) return false
    }
    if (disposed) return false
    await likes.setSource(key, { status: hit ? 'found' : 'none', checkedAt: now(), query: used, hit: sanitizeHit(hit) })
    state.done += 1
    if (hit) state.found += 1
    return true
  }

  let pumping = null
  function pump() {
    if (pumping || disposed) return pumping
    if (!queue.length) return null
    pumping = (async () => {
      state.running = true
      state.startedAt = now()
      state.finishedAt = null
      try {
        while (queue.length && !disposed) {
          const key = queue.shift()
          queued.delete(key)
          const ok = await scanKey(key)
          if (!ok) break
          await sleep(GAP_MS)
        }
      } catch (err) {
        warn(`dsh-music: 音源后台扫描出错: ${err.message}`)
        state.error = err.message
      } finally {
        state.running = false
        state.finishedAt = now()
        state.pending = queue.length
        state.force = false
        pumping = null
      }
    })()
    return pumping
  }

  function dispose() {
    disposed = true
    queue.length = 0
    queued.clear()
  }

  return { schedule, scheduleMissing, status, scanKey, dispose }
}
