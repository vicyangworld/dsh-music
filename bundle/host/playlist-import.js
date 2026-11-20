/** 十二期方案A：公开歌单链接导入（QQ 音乐 / 网易云，仅元数据）。
 * 流程：链接解析（短链跟随跳转/正文提取歌单 ID）→ 拉取歌单元数据（标题/歌手/专辑/时长，
 * 不碰音频）→ 本地曲库匹配（简繁归一 artist::title）→ 缺口走现有下载管线串行下载入库。
 * 接口逻辑参考 GoMusic（MIT，Bistutu/GoMusic logic/qqmusic.go、logic/neteasy.go、
 * misc/utils/qqmusic_sign.go），按本插件风格重写为 ESM；GPL 项目代码零引用。
 * 红线：不并发跑下载管线（复用 download 单批串行语义）；音频只走现有 YT Music 管线，
 * 只写 ~/Music/dsh-music；QQ/网易仅作元数据源；下载前经 download.validate 联网核实。 */
import { createHash } from 'node:crypto'
import { normalizeZh } from './t2s.js'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const HTTP_TIMEOUT_MS = 20000
const MAX_SONGS_DEFAULT = 500
const PAGE_SIZE = 30
const NETEASE_CHUNK = 200
const QQ_PLATFORMS = ['-1', 'android', 'iphone', 'h5', 'wxfshare', 'iphone_wx', 'windows']

const LINK_HINT = '仅支持 QQ 音乐（y.qq.com 歌单/分享短链）与网易云音乐（music.163.com 歌单链接）的公开歌单链接。私有歌单请先在对应 App 里设置为公开，或改用导出的公开链接。'

/** —— QQ u6 端点公开签名（GoMusic misc/utils/qqmusic_sign.go 的 JS 移植）—— */
export function qqSign(payload) {
  const digest = createHash('md5').update(payload, 'utf8').digest()
  const hash = digest.toString('hex').toUpperCase()
  const mask = [212, 45, 80, 68, 195, 163, 163, 203, 157, 220, 254, 91, 204, 79, 104, 6]
  const encoded = Buffer.from(digest.map((b, i) => b ^ mask[i]))
  const middle = encoded.toString('base64').replace(/=+$/, '').replace(/[+/]/g, '')
  const select = (value, indices) => indices.map((i) => value[i]).join('')
  return 'zzb' + (select(hash, [21, 4, 9, 26, 16, 20, 27, 30]) + middle + select(hash, [18, 11, 3, 2, 1, 7, 6, 25])).toLowerCase()
}

/** —— 链接解析：纯函数，返回 {provider, id} 或抛中文错误。短链（无 ID）返回 {provider, resolve:url}。—— */
export function parsePlaylistLink(input) {
  const urlMatch = /https?:\/\/[^\s"'<>]+/.exec(String(input ?? '').trim())
  if (!urlMatch) throw Object.assign(new Error('未识别到链接。' + LINK_HINT), { code: 'IMPORT_INVALID_LINK' })
  const raw = urlMatch[0]
  let u
  try { u = new URL(raw) } catch { throw Object.assign(new Error('链接格式无效。' + LINK_HINT), { code: 'IMPORT_INVALID_LINK' }) }
  const host = u.hostname.toLowerCase()
  const path = u.pathname
  const playlistId = (re) => { const m = re.exec(path); return m ? m[1] : null }

  if (host === 'y.qq.com' || host === 'i.y.qq.com' || host === 'i2.y.qq.com' || host === 'u.y.qq.com') {
    const id = playlistId(/(?:^|\/)playlist(?:\/index)?\/(\d+)/) ?? (/(?:^|\/)taoge(?:\/index)?\/(\d+)/.test(path) ? null : null)
    if (id) return { provider: 'qq', id }
    if (/songDetail|\/album|\/taoge|\/ranking/.test(path)) throw Object.assign(new Error('目前仅支持歌单链接，不支持单曲/专辑/排行。' + LINK_HINT), { code: 'IMPORT_INVALID_LINK' })
    throw Object.assign(new Error('QQ 音乐链接里没有歌单 ID。' + LINK_HINT), { code: 'IMPORT_INVALID_LINK' })
  }
  if (host === 'c6.y.qq.com' || host === 'c.y.qq.com') {
    // 分享短链：页面内跳转，不带歌单 ID，需要联网 resolve
    return { provider: 'qq', resolve: raw }
  }
  if (host === 'music.163.com' || host === 'y.music.163.com') {
    if (/\/song|\/album|\/dj|\/radio/.test(path)) throw Object.assign(new Error('目前仅支持歌单链接，不支持单曲/专辑/电台。' + LINK_HINT), { code: 'IMPORT_INVALID_LINK' })
    const id = u.searchParams.get('id')
      || playlistId(/(?:^|\/)playlist(?:\/index)?\/(\d+)/)
      || /playlist(?:\/index)?\/(\d+)/.exec(u.hash)?.[1] || null
    if (id && /^\d+$/.test(id)) return { provider: 'netease', id }
    throw Object.assign(new Error('网易云音乐链接里没有歌单 ID。' + LINK_HINT), { code: 'IMPORT_INVALID_LINK' })
  }
  if (host === '163cn.tv' || host === '163cn.com') return { provider: 'netease', resolve: `https://${host}${path}` }
  throw Object.assign(new Error('不支持的链接来源。' + LINK_HINT), { code: 'IMPORT_INVALID_LINK' })
}

/** —— HTTP 小工具（可注入 fetchImpl 供测试）—— */
function makeHttp(fetchImpl, logger) {
  const warn = (msg) => logger?.warn?.(msg)
  async function request(url, { method = 'GET', headers = {}, body = null, timeoutMs = HTTP_TIMEOUT_MS, redirect = 'follow' } = {}) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetchImpl(url, { method, headers: { 'User-Agent': UA, ...headers }, body, redirect, signal: ctrl.signal })
      const text = await res.text()
      return { status: res.status, text, url: res.url || url }
    } catch (err) {
      warn(`dsh-music: 歌单导入请求失败 ${url.slice(0, 80)}: ${err.message}`)
      throw Object.assign(new Error(`网络请求失败：${err.message}`), { code: 'IMPORT_NETWORK' })
    } finally {
      clearTimeout(timer)
    }
  }
  return { request }
}

/** 短链 → 歌单 ID：优先最终跳转 URL；200 不跳时从正文提取 playlist 地址。 */
async function resolveShortLink(http, link) {
  const r = await http.request(link.resolve, { headers: { Referer: 'https://y.qq.com/' } })
  const fromUrl = /(?:^|\/)playlist(?:\/index)?\/(\d+)/.exec(r.url) || /[?&]id=(\d+)/.exec(r.url)
  if (fromUrl) return { provider: link.provider, id: fromUrl[1] }
  const inBody = /(?:^|[\/.])playlist(?:\/index)?\/(\d+)/.exec(r.text) || null
  if (inBody) return { provider: link.provider, id: inBody[1] }
  throw Object.assign(new Error('分享链接里没有有效的歌单 ID（歌单可能已删除或未公开）。'), { code: 'IMPORT_INVALID_LINK' })
}

/** —— QQ 元数据：主端点（u6 + sign，分页）+ legacy 兜底，取更全者。—— */
async function fetchQq(http, id, { maxSongs }) {
  const results = await Promise.allSettled([
    fetchQqPages(http, id, maxSongs),
    fetchQqLegacy(http, id),
  ])
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
  if (!ok.length) {
    const reason = results[0].status === 'rejected' ? results[0].reason : results[1].reason
    throw Object.assign(new Error(`QQ 音乐歌单暂时不可访问（请确认歌单已公开）：${reason.message}`), { code: 'IMPORT_PLAYLIST_UNAVAILABLE' })
  }
  const best = ok.reduce((a, b) => (b.tracks.length > a.tracks.length ? b : a))
  const total = Math.max(...ok.map((x) => x.total), best.tracks.length)
  return { ...best, total }
}

async function fetchQqPages(http, id, maxSongs) {
  const tracks = []
  const seenIds = new Set()
  const seenPages = new Set()
  let name = null
  let total = 0
  for (let begin = 0; begin < maxSongs;) {
    const count = Math.min(PAGE_SIZE, maxSongs - begin)
    const page = await fetchQqPage(http, id, begin, count)
    const data = page?.req_0?.data
    if (!data) throw new Error('QQ 音乐返回无效数据')
    if (name === null && data.dirinfo?.title) name = data.dirinfo.title
    total = Math.max(total, data.dirinfo?.songnum ?? 0)
    if (!Array.isArray(data.songlist) || !data.songlist.length) {
      if (begin < total && begin > 0) break // 尾页拿不满不重试
      if (begin === 0) throw new Error('QQ 音乐未返回歌曲（歌单可能为空或未公开）')
      break
    }
    const fingerprint = JSON.stringify(data.songlist.map((s) => s.id ?? s.mid))
    if (seenPages.has(fingerprint)) break // 上游忽略分页参数，防重复
    seenPages.add(fingerprint)
    let added = 0
    for (const song of data.songlist) {
      const tid = String(song.id ?? '') !== '0' && String(song.id ?? '') !== '' ? String(song.id) : String(song.mid ?? '')
      if (!song.name || !tid || seenIds.has(tid)) continue
      seenIds.add(tid)
      tracks.push({ id: tid, title: song.name, artist: (song.singer ?? []).map((s) => s.name).filter(Boolean).join(' / ') || '未知歌手' })
      added++
    }
    if (!added) break
    begin += data.songlist.length
    if (begin >= total) break
  }
  if (!tracks.length) throw new Error('QQ 音乐未返回有效歌曲')
  return { provider: 'qq', name: name || 'QQ 音乐歌单', total: Math.max(total, tracks.length), tracks }
}

async function fetchQqPage(http, id, begin, count) {
  const payload = JSON.stringify({
    req_0: { module: 'music.srfDissInfo.aiDissInfo', method: 'uniform_get_Dissinfo', param: { disstid: Number(id), enc_host_uin: '', tag: 1, userinfo: 1, song_begin: begin, song_num: count } },
    comm: { g_tk: 5381, uin: 0, format: 'json', platform: '' },
  })
  let lastErr = null
  for (const platform of QQ_PLATFORMS) {
    const body = JSON.parse(JSON.stringify(payload))
    const withPlatform = body.replace('"platform":""', `"platform":"${platform}"`)
    const url = `https://u6.y.qq.com/cgi-bin/musics.fcg?sign=${qqSign(withPlatform)}&_=${Date.now()}`
    try {
      const r = await http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/' }, body: withPlatform })
      if (r.status !== 200) { lastErr = new Error(`HTTP ${r.status}`); continue }
      const page = JSON.parse(r.text)
      if (page.code !== 0 || page.req_0?.code !== 0 || !page.req_0?.data) { lastErr = new Error(`QQ 音乐拒绝访问 (code=${page.code})`); continue }
      return page
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(`QQ 音乐主接口请求失败：${lastErr?.message ?? '未知错误'}`)
}

async function fetchQqLegacy(http, id) {
  const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${id}&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`
  const r = await http.request(url, { headers: { Referer: 'https://y.qq.com/' } })
  let body = r.text.trim()
  const cb = /^jsonCallback\((.*)\)\s*;?\s*$/.exec(body) // legacy 可能包 jsonCallback(...)
  if (cb) body = cb[1]
  let data
  try { data = JSON.parse(body) } catch { throw new Error('QQ 音乐旧接口返回无效数据') }
  if (data.code !== 0 || data.subcode !== 0) throw new Error(`QQ 音乐旧接口业务错误 (code=${data.code}, subcode=${data.subcode})`)
  const cd = (data.cdlist ?? [])[0]
  if (!cd) throw new Error('QQ 音乐旧接口未返回歌单')
  const tracks = []
  const seen = new Set()
  for (const song of cd.songlist ?? []) {
    const tid = String(song.songid ?? '') || String(song.songmid ?? '')
    if (!song.songname || !tid || seen.has(tid)) continue
    seen.add(tid)
    tracks.push({ id: tid, title: song.songname, artist: (song.singer ?? []).map((s) => s.name).filter(Boolean).join(' / ') || '未知歌手' })
  }
  if (!tracks.length) throw new Error('QQ 音乐旧接口未返回歌曲')
  return { provider: 'qq', name: cd.dissname || 'QQ 音乐歌单', total: Math.max(cd.songnum ?? 0, tracks.length), tracks }
}

/** —— 网易元数据：v6 歌单详情（含部分 tracks 种子）+ v3 批量补歌名。—— */
async function fetchNetease(http, id, { maxSongs }) {
  const r = await http.request('https://music.163.com/api/v6/playlist/detail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
    body: `id=${encodeURIComponent(id)}&n=100000`,
  })
  let data
  try { data = JSON.parse(r.text) } catch { throw Object.assign(new Error('网易云返回了无效数据'), { code: 'IMPORT_PLAYLIST_UNAVAILABLE' }) }
  if (data.code === 401 || data.code === 403) throw Object.assign(new Error('该网易云歌单未公开，请先在网易云 App 里设置为公开'), { code: 'IMPORT_PRIVATE' })
  if (data.code !== 200 || !data.playlist) throw Object.assign(new Error(`网易云歌单不存在、未公开或暂时不可访问 (code=${data.code})`), { code: 'IMPORT_PLAYLIST_UNAVAILABLE' })
  const pl = data.playlist
  const ids = (pl.trackIds ?? []).map((x) => String(x.id)).filter(Boolean).slice(0, maxSongs)
  const seeds = new Map()
  for (const song of pl.tracks ?? []) {
    if (song?.name) seeds.set(String(song.id), neteaseTrack(song))
  }
  const tracks = []
  const missing = []
  for (const tid of ids) {
    if (seeds.has(tid)) tracks.push(seeds.get(tid))
    else missing.push(tid)
  }
  for (let i = 0; i < missing.length; i += NETEASE_CHUNK) {
    const chunk = missing.slice(i, i + NETEASE_CHUNK)
    const c = JSON.stringify(chunk.map((x) => ({ id: x })))
    const dr = await http.request('https://music.163.com/api/v3/song/detail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
      body: `c=${encodeURIComponent(c)}`,
    })
    let d
    try { d = JSON.parse(dr.text) } catch { continue } // 补详情失败：保留已拿到的，不整体失败
    if (d.code !== 200) continue
    const got = new Map((d.songs ?? []).filter((s) => s.name).map((s) => [String(s.id), neteaseTrack(s)]))
    for (const tid of chunk) if (got.has(tid)) tracks.push(got.get(tid))
  }
  if (!tracks.length && (pl.trackIds ?? []).length) throw Object.assign(new Error('网易云未返回歌曲列表，请检查歌单访问权限'), { code: 'IMPORT_PLAYLIST_UNAVAILABLE' })
  return { provider: 'netease', name: pl.name || '网易云歌单', total: Math.max(pl.trackCount ?? 0, tracks.length), tracks }
}

function neteaseTrack(song) {
  return {
    id: String(song.id),
    title: song.name,
    artist: (song.ar ?? song.artists ?? []).map((a) => a.name).filter(Boolean).join(' / ') || '未知歌手',
    album: song.al?.name ?? song.album?.name ?? null,
    durationMs: typeof song.dt === 'number' ? song.dt : null,
  }
}

/** —— 主服务 —— */
export function createPlaylistImport({ library, download, config = {}, logger, fetchImpl, verifier } = {}) {
  const warn = (msg) => logger?.warn?.(msg)
  const http = makeHttp(fetchImpl ?? ((u, o) => fetch(u, o)), logger)
  const maxSongs = Number(config.importMaxSongs) > 0 ? Number(config.importMaxSongs) : MAX_SONGS_DEFAULT
  let state = { running: false, error: null, summary: null, startedAt: null, finishedAt: null }

  const localKey = (artist, title) => `${normalizeZh(artist).trim()}::${normalizeZh(title).trim()}`

  /** 解析链接（含短联网 resolve）并拉取歌单元数据。 */
  async function fetchPlaylist(url) {
    let link
    try { link = parsePlaylistLink(url) } catch (err) { throw err }
    if (link.resolve) link = await resolveShortLink(http, link)
    if (!/^\d+$/.test(link.id)) throw Object.assign(new Error('歌单 ID 无效。' + LINK_HINT), { code: 'IMPORT_INVALID_LINK' })
    return link.provider === 'qq' ? fetchQq(http, link.id, { maxSongs }) : fetchNetease(http, link.id, { maxSongs })
  }

  /** 本地匹配：精确（归一 artist::title）优先，标题兜底标 fuzzy。 */
  function matchLocal(playlist) {
    const tracks = library.snapshot().tracks
    const exact = new Map()
    const titleOnly = new Map()
    for (const t of tracks) {
      exact.set(localKey(t.artist, t.title), t)
      if (!titleOnly.has(normalizeZh(t.title).trim())) titleOnly.set(normalizeZh(t.title).trim(), t)
    }
    return playlist.tracks.map((p) => {
      const hit = exact.get(localKey(p.artist, p.title)) ?? null
      if (hit) return { ...p, matchedTrackId: hit.id, fuzzy: false }
      const loose = titleOnly.get(normalizeZh(p.title).trim()) ?? null
      return { ...p, matchedTrackId: loose ? loose.id : null, fuzzy: !!loose }
    })
  }

  /** 等待当前下载批次结束（管线单批串行）。 */
  async function waitDownload() {
    for (let i = 0; i < 720; i++) { // 上限 ~60 分钟
      if (!download.isRunning()) return true
      await new Promise((r) => setTimeout(r, 5000))
    }
    return false
  }

  /** 导入主流程。dryRun 只取元数据+本地匹配；否则缺口串行分批（≤20/批）走下载管线。 */
  async function run({ url, dryRun = false, limit = 0 }) {
    if (state.running) return { busy: true }
    state = { running: true, error: null, summary: null, startedAt: Date.now(), finishedAt: null }
    const snap = state
    ;(async () => {
      try {
        const playlist = await fetchPlaylist(url)
        const matched = matchLocal(playlist)
        const matchedCount = matched.filter((m) => m.matchedTrackId && !m.fuzzy).length
        const fuzzyCount = matched.filter((m) => m.matchedTrackId && m.fuzzy).length
        const missing = matched.filter((m) => !m.matchedTrackId).map((m) => ({ artist: m.artist, title: m.title, album: m.album ?? undefined, durationMs: m.durationMs ?? undefined }))
        const failures = []
        let queued = 0
        let downloadedIds = []
        if (!dryRun && missing.length) {
          let items = missing
          if (limit > 0) items = items.slice(0, limit)
          // 红线：缺口先逐首联网核实（MusicBrainz，留档与下载管线 checkVerification 对齐），未核实到的跳过
          const verified = []
          for (const m of items) {
            const rec = verifier ? await verifier.verify({ artist: m.artist, title: m.title, durationMs: m.durationMs }) : null
            if (rec?.verification) {
              verified.push({ ...m, durationMs: m.durationMs ?? rec.matched?.durationMs, verification: rec.verification })
            } else {
              failures.push({ artist: m.artist, title: m.title, reason: 'MusicBrainz 未核实到该歌曲，已跳过下载（可稍后重试，或在搜索里手动核实后下载）' })
            }
          }
          items = verified
          for (let i = 0; i < items.length; i += 20) {
            if (!download || typeof download.start !== 'function') { failures.push({ reason: '下载管线不可用' }); break }
            const batch = items.slice(i, i + 20)
            if (download.isRunning() && !(await waitDownload())) { failures.push({ reason: '等待下载管线超时，余批次未执行', remaining: items.length - i }); break }
            const verr = await download.validate(batch)
            if (verr) { failures.push({ reason: verr }); continue }
            for (const item of batch) await download.archiveVerification(item)
            const job = download.start(batch)
            queued += batch.length
            await new Promise((resolve) => {
              const poll = () => (job.running === false ? resolve() : setTimeout(poll, 1000))
              poll()
            })
            for (const it of job.items ?? []) {
              if (it.status === 'ok' || it.status === 'done') downloadedIds.push(it.trackId)
              else if (it.status === 'fail') failures.push({ artist: it.artist, title: it.title, reason: it.note || '下载失败' })
            }
          }
        }
        snap.summary = {
          provider: playlist.provider,
          playlistId: playlist.id ?? null,
          name: playlist.name,
          total: playlist.total,
          fetched: playlist.tracks.length,
          matched: matchedCount,
          fuzzyMatched: fuzzyCount,
          missing: missing.length,
          queued,
          downloaded: downloadedIds.filter(Boolean).length,
          downloadedTrackIds: downloadedIds.filter(Boolean),
          failures: failures.slice(0, 50),
          dryRun: !!dryRun,
          limited: limit > 0 && missing.length > limit ? { requested: limit, of: missing.length } : null,
          sample: matched.slice(0, 30).map((m) => ({ title: m.title, artist: m.artist, matched: !!m.matchedTrackId, fuzzy: m.fuzzy })),
        }
      } catch (err) {
        snap.error = err.code === 'IMPORT_PRIVATE' || err.code === 'IMPORT_PLAYLIST_UNAVAILABLE' || err.code === 'IMPORT_INVALID_LINK' || err.code === 'IMPORT_NETWORK'
          ? err.message
          : `歌单导入失败：${err.message}`
        warn(`dsh-music: 歌单导入失败: ${err.message}`)
      } finally {
        snap.running = false
        snap.finishedAt = Date.now()
      }
    })()
    return { busy: false, started: true }
  }

  return {
    parsePlaylistLink,
    qqSign,
    run,
    isRunning: () => state.running,
    status: () => JSON.parse(JSON.stringify(state)),
    dispose() {},
  }
}

export function registerImportRoutes(webServer, { importer, logger }) {
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
  const readBody = (req, limit = 64 * 1024) => new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('请求体过大')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

  const disposers = []
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/import-playlist',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '方法不允许' })
      try {
        let body
        try { body = JSON.parse((await readBody(req)) || '{}') } catch { return sendJson(res, 400, { error: '请求体不是合法 JSON' }) }
        const url = typeof body?.url === 'string' ? body.url : ''
        if (!url.trim()) return sendJson(res, 400, { error: '缺少 url。请粘贴 QQ 音乐或网易云音乐的公开歌单链接。' + LINK_HINT })
        try { importer.parsePlaylistLink(url) } catch (err) {
          if (err.code === 'IMPORT_INVALID_LINK') return sendJson(res, 400, { error: err.message })
          throw err
        }
        const dryRun = body.dryRun === true
        const limit = Number.isInteger(body?.limit) && body.limit > 0 ? Math.min(body.limit, 100) : 0
        const r = await importer.run({ url, dryRun, limit })
        if (r.busy) return sendJson(res, 409, { error: '已有歌单导入在运行，请等当前轮结束' })
        return sendJson(res, 202, { started: true, dryRun })
      } catch (err) {
        warn(`dsh-music: 歌单导入服务错误: ${err.message}`)
        return sendJson(res, 500, { error: '歌单导入服务内部错误' })
      }
    },
  }))
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-music/api/import-playlist/status',
    handler: (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '方法不允许' })
      return sendJson(res, 200, importer.status())
    },
  }))
  return disposers
}
