/** LRC 歌词解析：syncedLyrics → 逐句 {time, text}；纯文本兜底。零依赖。 */

/** 解析单行 LRC 时间标签 [mm:ss.xx] / [mm:ss.xxx] / [mm:ss]，返回秒数；非法返回 null。 */
function parseTag(tag) {
  const m = /^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(tag.trim())
  if (!m) return null
  const min = Number(m[1])
  const sec = Number(m[2])
  if (sec >= 60) return null
  let frac = 0
  if (m[3] !== undefined) {
    // .xx → 百分秒；.xxx → 毫秒
    frac = m[3].length === 3 ? Number(m[3]) / 1000 : Number(m[3]) / 100
  }
  return min * 60 + sec + frac
}

/**
 * 解析 syncedLyrics 字符串为按时间升序的 lines。
 * 一行可带多个时间标签（复用同文本）；空文本行保留（间奏）；无时间标签的行忽略。
 * @returns {{time:number, text:string}[]}
 */
export function parseLrc(synced) {
  if (typeof synced !== 'string' || synced.trim() === '') return []
  const lines = []
  for (const raw of synced.split(/\r?\n/)) {
    const tags = []
    let rest = raw
    // 连续提取行首时间标签
    for (;;) {
      const m = /^\s*\[([^\]]*)\]/.exec(rest)
      if (!m) break
      // 跳过非时间元标签（如 [ar:...] [ti:...] [offset:...]）
      const t = parseTag(m[1])
      if (t !== null) tags.push(t)
      rest = rest.slice(m[0].length)
    }
    if (tags.length === 0) continue
    const text = rest.trim()
    for (const time of tags) lines.push({ time: Math.round(time * 1000) / 1000, text })
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

/** 纯文本歌词 → lines（time=null），保留空行作为分段。 */
export function plainToLines(plain) {
  if (typeof plain !== 'string' || plain.trim() === '') return []
  return plain.split(/\r?\n/).map((text) => ({ time: null, text: text.trim() }))
}

/** 从 LRCLIB 记录构造统一歌词载荷。instrumental 视为无词。 */
export function fromLrclibRecord(rec) {
  if (!rec || rec.instrumental) return null
  const synced = typeof rec.syncedLyrics === 'string' && rec.syncedLyrics.trim() !== ''
  const lines = synced ? parseLrc(rec.syncedLyrics) : plainToLines(rec.plainLyrics)
  if (lines.length === 0) return null
  return {
    synced,
    lines,
    plain: typeof rec.plainLyrics === 'string' && rec.plainLyrics.trim() !== '' ? rec.plainLyrics : null,
  }
}