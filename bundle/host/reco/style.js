/** 风格描述 → MusicBrainz 标签映射（批3，传统算法，无 LLM）。
 * 词典候选标签全部经 MB 活体核实存在（2026-11-13 实测计数，docs/verification-v2 可复跑）：
 *   流派 jazz/rock/pop/classical/electronic/folk/blues/soul/"hip hop"/funk/reggae/metal/punk/
 *        country/ambient/post-rock/"new age"/indie/dance/latin/world；
 *   场景 night/chill/workout/study/party/rain/driving/romantic/sad/sleep；
 *   年代 60s/70s/80s/90s/00s/2010s/oldies；
 *   语言 cantonese/mandopop/chinese/japanese/korean/french/spanish/italian/portuguese/english/latin。
 * 注意 MB 部分小语种标签命中录音少（cantonese:6、mandopop:52），属源侧覆盖，非 bug。 */

export const KIND_LABEL = { genre: '流派', scene: '场景', era: '年代', language: '语言' }

/** term=触发词（中文子串 / 英文词边界），tags=MB 标签，kind=轴。 */
export const STYLE_DICT = [
  // 流派
  { term: '爵士', tags: ['jazz'], kind: 'genre' },
  { term: '摇滚', tags: ['rock'], kind: 'genre' },
  { term: '古典', tags: ['classical'], kind: 'genre' },
  { term: '管弦', tags: ['classical'], kind: 'genre' },
  { term: '电子', tags: ['electronic'], kind: 'genre' },
  { term: '民谣', tags: ['folk'], kind: 'genre' },
  { term: '布鲁斯', tags: ['blues'], kind: 'genre' },
  { term: '灵魂乐', tags: ['soul'], kind: 'genre' },
  { term: '说唱', tags: ['hip hop'], kind: 'genre' },
  { term: '嘻哈', tags: ['hip hop'], kind: 'genre' },
  { term: '放克', tags: ['funk'], kind: 'genre' },
  { term: '雷鬼', tags: ['reggae'], kind: 'genre' },
  { term: '金属', tags: ['metal'], kind: 'genre' },
  { term: '朋克', tags: ['punk'], kind: 'genre' },
  { term: '乡村', tags: ['country'], kind: 'genre' },
  { term: '氛围', tags: ['ambient'], kind: 'genre' },
  { term: '后摇', tags: ['post-rock'], kind: 'genre' },
  { term: '新世纪', tags: ['new age'], kind: 'genre' },
  { term: '独立音乐', tags: ['indie'], kind: 'genre' },
  { term: '舞曲', tags: ['dance'], kind: 'genre' },
  { term: '流行', tags: ['pop'], kind: 'genre' },
  { term: '世界音乐', tags: ['world'], kind: 'genre' },
  // 场景
  { term: '深夜', tags: ['night'], kind: 'scene' },
  { term: '夜晚', tags: ['night'], kind: 'scene' },
  { term: '放松', tags: ['chill'], kind: 'scene' },
  { term: '休闲', tags: ['chill'], kind: 'scene' },
  { term: '运动', tags: ['workout'], kind: 'scene' },
  { term: '健身', tags: ['workout'], kind: 'scene' },
  { term: '学习', tags: ['study'], kind: 'scene' },
  { term: '专注', tags: ['study'], kind: 'scene' },
  { term: '派对', tags: ['party'], kind: 'scene' },
  { term: '雨天', tags: ['rain'], kind: 'scene' },
  { term: '驾驶', tags: ['driving'], kind: 'scene' },
  { term: '公路', tags: ['driving'], kind: 'scene' },
  { term: '浪漫', tags: ['romantic'], kind: 'scene' },
  { term: '伤感', tags: ['sad'], kind: 'scene' },
  { term: '悲伤', tags: ['sad'], kind: 'scene' },
  { term: '助眠', tags: ['sleep'], kind: 'scene' },
  { term: '睡前', tags: ['sleep'], kind: 'scene' },
  // 年代
  { term: '复古', tags: ['oldies'], kind: 'era' },
  { term: '怀旧', tags: ['oldies'], kind: 'era' },
  // 语言/地区
  { term: '粤语', tags: ['cantonese'], kind: 'language' },
  { term: '国语', tags: ['mandopop'], kind: 'language' },
  { term: '华语', tags: ['mandopop'], kind: 'language' },
  { term: '中文', tags: ['chinese'], kind: 'language' },
  { term: '中国风', tags: ['chinese'], kind: 'language' },
  { term: '日语', tags: ['japanese'], kind: 'language' },
  { term: '日文', tags: ['japanese'], kind: 'language' },
  { term: '韩语', tags: ['korean'], kind: 'language' },
  { term: '韩文', tags: ['korean'], kind: 'language' },
  { term: '法语', tags: ['french'], kind: 'language' },
  { term: '法文', tags: ['french'], kind: 'language' },
  { term: '西语', tags: ['spanish'], kind: 'language' },
  { term: '西班牙语', tags: ['spanish'], kind: 'language' },
  { term: '意大利语', tags: ['italian'], kind: 'language' },
  { term: '葡萄牙语', tags: ['portuguese'], kind: 'language' },
  { term: '英语', tags: ['english'], kind: 'language' },
]

/** 英文词直接命中（词边界），tags 即自身（词典里对应中文词条已存在则合并 kind）。 */
const EN_ALIASES = [
  ['jazz', 'genre'], ['rock', 'genre'], ['pop', 'genre'], ['classical', 'genre'],
  ['electronic', 'genre'], ['folk', 'genre'], ['blues', 'genre'], ['soul', 'genre'],
  ['hip hop', 'genre'], ['funk', 'genre'], ['reggae', 'genre'], ['metal', 'genre'],
  ['punk', 'genre'], ['country', 'genre'], ['ambient', 'genre'], ['post rock', 'genre'],
  ['new age', 'genre'], ['indie', 'genre'], ['dance', 'genre'], ['latin', 'genre'],
  ['night', 'scene'], ['chill', 'scene'], ['workout', 'scene'], ['study', 'scene'],
  ['party', 'scene'], ['rain', 'scene'], ['driving', 'scene'], ['romantic', 'scene'],
  ['sad', 'scene'], ['sleep', 'scene'],
  ['60s', 'era'], ['70s', 'era'], ['80s', 'era'], ['90s', 'era'], ['00s', 'era'],
  ['2010s', 'era'], ['oldies', 'era'],
  ['cantonese', 'language'], ['mandopop', 'language'], ['japanese', 'language'],
  ['korean', 'language'], ['french', 'language'], ['spanish', 'language'],
  ['italian', 'language'], ['portuguese', 'language'], ['english', 'language'],
]

/** 数字年代短语：60年代 / 八十年代 → 对应 MB 年代标签。 */
const ERA_CN = { '六十年代': '60s', '七十年代': '70s', '八十年代': '80s', '九十年代': '90s' }

/** 解析一段风格描述 → 命中的 MB 标签集合（按 kind 分组）。纯函数，无 IO。
 * 返回 {terms:[{term,tags,kind}], byKind:{genre:[],scene:[],era:[],language:[]}} */
export function interpretStyle(q) {
  const text = String(q ?? '').toLowerCase()
  const terms = []
  const seen = new Set()
  const add = (term, tags, kind) => {
    const key = tags.join('+')
    if (seen.has(key)) return
    seen.add(key)
    terms.push({ term, tags, kind })
  }
  for (const d of STYLE_DICT) {
    if (text.includes(d.term)) add(d.term, d.tags, d.kind)
  }
  for (const [word, kind] of EN_ALIASES) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(text)) {
      // post rock → MB 标签是 post-rock；hip hop 保持原样（MB 实测可搜）
      const tag = word === 'post rock' ? 'post-rock' : word
      add(word, [tag], kind)
    }
  }
  for (const [phrase, tag] of Object.entries(ERA_CN)) {
    if (text.includes(phrase)) add(phrase, [tag], 'era')
  }
  const byKind = { genre: [], scene: [], era: [], language: [] }
  for (const t of terms) {
    for (const tag of t.tags) if (!byKind[t.kind].includes(tag)) byKind[t.kind].push(tag)
  }
  return { terms, byKind }
}

/** 生成 MB 查询序列（按优先级的降级链）。
 * 组合命中不足时逐级放宽：流派+场景 AND → 单流派 → 单场景 → 年代+流派 → 流派 → 场景 → 年代 → 语言 → 热门回退。 */
export function styleQueryPlan(byKind) {
  const plan = []
  const push = (query, note) => {
    if (query && !plan.some((p) => p.query === query)) plan.push({ query, note })
  }
  const { genre = [], scene = [], era = [], language = [] } = byKind
  const g = genre[0], s = scene[0], e = era[0], l = language[0]
  if (g && s) push(`tag:"${g}" AND tag:"${s}"`, `${g} + ${s}`)
  if (g && e) push(`tag:"${g}" AND tag:"${e}"`, `${g} + ${e}`)
  if (g && l) push(`tag:"${g}" AND tag:"${l}"`, `${g} + ${l}`)
  if (s && e) push(`tag:"${s}" AND tag:"${e}"`, `${s} + ${e}`)
  push(g && `tag:"${g}"`, g)
  push(s && `tag:"${s}"`, s)
  push(l && `tag:"${l}"`, l)
  push(e && `tag:"${e}"`, e)
  // 第二命中标签兜底
  if (genre[1]) push(`tag:"${genre[1]}"`, genre[1])
  if (scene[1]) push(`tag:"${scene[1]}"`, scene[1])
  return plan
}

/** 完全未命中时的热门流派回退（明示 fallback）。 */
export const FALLBACK_GENRES = ['rock', 'jazz', 'classical', 'electronic']
export function fallbackPlan() {
  return FALLBACK_GENRES.map((g) => ({ query: `tag:"${g}"`, note: g }))
}
