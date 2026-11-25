/**
 * QQ 音乐（只读）客户端：粘贴 Cookie 登录 + 「我喜欢」歌单。
 *
 * - 非官方接口，只读：不写账号、不拉音源。
 * - 登录态只需 Cookie 里的 uin（或 wxuin）+ qm_keyst / qqmusic_key；服务端不需要 sign 的旧接口即可读到「我喜欢」。
 * - 零外部依赖：仅 node: 内置模块。
 */
import { cleanText, fetchJson, httpError, parseCookie } from './common.js'

export const QQ_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
export const QQ_REFERER = 'https://y.qq.com/portal/profile.html'
const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const MAX_SONGS = 20000
const PAGE_SIZE = 300

/** QQ 系 g_tk：对 keyst 做的 32 位哈希 */
export function gtk(key) {
  let hash = 5381
  for (let i = 0; i < key.length; i++) hash += (hash << 5) + key.charCodeAt(i)
  return hash & 0x7fffffff
}

/**
 * 解析粘贴的 Cookie 文本 → 登录所需字段。返回 `{ error }` 或 `{ keyst, uin, wxuin, musicid, cookie, nickname }`。
 * `cookie` 只保留登录字段，丢掉 pgv / 埋点等噪音。
 */
export function parseQQCookie(text) {
  const pairs = parseCookie(text)
  const keyst = pairs.qqmusic_key || pairs.qm_keyst || ''
  // uin 形如 o0123456789：去掉 o 前缀与前导零得到 QQ 号（QQ 号不以 0 开头）
  const rawUin = pairs.qqmusic_uin || pairs.uin || ''
  const uin = rawUin.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  const wxuin = pairs.wxuin || ''
  const musicid = uin || wxuin
  if (!keyst) return { error: 'Cookie 中缺少 qm_keyst / qqmusic_key（登录态），请先登录 y.qq.com 再复制 Cookie' }
  if (!musicid) return { error: 'Cookie 中缺少 uin / wxuin（账号标识），请先登录 y.qq.com 再复制 Cookie' }
  const parts = [`qqmusic_key=${keyst}`, `qm_keyst=${keyst}`]
  // 原样保留登录态字段（服务端给什么格式就回传什么），不夹带 pgv / 埋点等噪音
  for (const key of ['uin', 'qqmusic_uin', 'wxuin', 'wxrefresh_token', 'psrf_qqaccess_token', 'psrf_qqunionid', 'psrf_musickey_createtime', 'psrf_qqopenid']) {
    if (pairs[key]) parts.push(`${key}=${pairs[key]}`)
  }
  let nickname = ''
  try {
    nickname = cleanText(pairs.qqmusic_nick ? decodeURIComponent(pairs.qqmusic_nick) : '', 64)
  } catch {
    nickname = ''
  }
  return { keyst, uin, wxuin, musicid, cookie: parts.join('; '), nickname }
}

function describe(j) {
  if (!j) return '无响应'
  const msg = j.msg || j.message || ''
  return `code ${j.code}${j.subcode ? '/' + j.subcode : ''}${msg ? ' ' + msg : ''}`
}

function isAuthFail(j) {
  const c = Number(j && j.code)
  return c === 1000 || c === 1001 || c === -1000 || (j && /未登录|not\s*login/i.test(String(j.msg || j.message || '')))
}

export function createQQMusic({ fetchImpl, timeoutMs = 15000 } = {}) {
  async function get(url, cookie) {
    const { json } = await fetchJson(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': QQ_UA,
          Accept: 'application/json, text/plain, */*',
          Referer: QQ_REFERER,
          Cookie: cookie,
        },
      },
      fetchImpl,
      timeoutMs,
    )
    return json
  }

  function auth(authInput) {
    const a = typeof authInput === 'string' ? parseQQCookie(authInput) : authInput
    if (!a || a.error) throw httpError((a && a.error) || 'QQ 音乐 Cookie 无效', 400)
    return a
  }

  /** 「我喜欢」歌单：优先歌单列表里 dirid===201 的项，回退个人主页 mymusic[0] */
  async function likedDir(authInput) {
    const a = auth(authInput)
    const g = gtk(a.keyst)
    const uin = encodeURIComponent(a.musicid)
    const j = await get(
      `https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostUin=0&hostuin=${uin}&sin=0&size=200&g_tk=${g}&loginUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`,
      a.cookie,
    )
    if (isAuthFail(j)) throw httpError('QQ 音乐 Cookie 已失效或未登录，请重新登录 y.qq.com 后复制 Cookie', 401)
    if (!j || Number(j.code) !== 0 || !j.data) throw httpError(`获取 QQ 音乐歌单失败（${describe(j)}）`, 502)
    const fav = (Array.isArray(j.data.disslist) ? j.data.disslist : []).find((d) => d && d.dirid === 201)
    if (fav && fav.tid) {
      return { tid: String(fav.tid), name: cleanText(fav.diss_name, 100) || '我喜欢', songCount: Number(fav.song_cnt) || 0, nickname: cleanText(j.data.hostname, 64) || a.nickname }
    }
    const home = await get(
      `https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?g_tk=${g}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&cid=205360838&userid=${uin}&reqfrom=1`,
      a.cookie,
    )
    if (isAuthFail(home)) throw httpError('QQ 音乐 Cookie 已失效或未登录，请重新登录 y.qq.com 后复制 Cookie', 401)
    const data = home && home.data
    const my = data && Array.isArray(data.mymusic) ? data.mymusic[0] : null
    if (my && my.id) {
      const nick = data.hostname || (data.creator && (data.creator.nick || data.creator.hostname)) || a.nickname
      return { tid: String(my.id), name: '我喜欢', songCount: Number(my.num0) || 0, nickname: cleanText(nick, 64) }
    }
    throw httpError('未找到 QQ 音乐「我喜欢」歌单（账号可能未登录或 Cookie 已失效）', 401)
  }

  /** 新接口（musicu.fcg uniform_get_Dissinfo，分页，匿名可达；带 Cookie 可读私有歌单） */
  async function songsViaMusicu(a, tid) {
    const songs = []
    let begin = 0
    let total = Infinity
    while (begin < total && songs.length < MAX_SONGS) {
      const payload = {
        comm: { g_tk: gtk(a.keyst), uin: a.uin ? Number(a.uin) : 0, format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, platform: 'yqq.json', needNewCode: 0 },
        req_0: {
          module: 'music.srfDissInfo.aiDissInfo',
          method: 'uniform_get_Dissinfo',
          param: { disstid: Number(tid), song_begin: begin, song_num: PAGE_SIZE, userinfo: 1, tag: 1, orderlist: 1 },
        },
      }
      const j = await get(MUSICU + '?data=' + encodeURIComponent(JSON.stringify(payload)), a.cookie)
      const r0 = (j && j.req_0) || {}
      const d = r0.data || {}
      if (isAuthFail(j) || isAuthFail(r0) || isAuthFail(d)) throw httpError('QQ 音乐 Cookie 已失效或未登录，请重新登录 y.qq.com 后复制 Cookie', 401)
      if (Number(r0.code) !== 0 || Number(d.code) !== 0) throw httpError(`获取 QQ 音乐「我喜欢」歌曲失败（${describe(j)} / ${describe(r0)} / ${describe(d)}）`, 502)
      const list = Array.isArray(d.songlist) ? d.songlist : []
      songs.push(...list)
      const n = Number(d.total_song_num ?? (d.dirinfo && d.dirinfo.song_num) ?? list.length)
      total = Number.isFinite(n) ? n : list.length
      if (list.length === 0) break
      begin += list.length
    }
    return songs
  }

  /** 旧接口兜底：一次性返回整张歌单（部分账号会被判 privacy error，失败就放弃） */
  async function songsViaLegacy(a, tid) {
    const j = await get(
      `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&nosigned=1&disstid=${encodeURIComponent(tid)}&g_tk=${gtk(a.keyst)}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`,
      a.cookie,
    )
    if (isAuthFail(j)) throw httpError('QQ 音乐 Cookie 已失效或未登录，请重新登录 y.qq.com 后复制 Cookie', 401)
    const cd = j && Array.isArray(j.cdlist) ? j.cdlist[0] : null
    if (!cd || !Array.isArray(cd.songlist)) throw httpError(`获取 QQ 音乐「我喜欢」歌曲失败（${describe(j)}）`, 502)
    return cd.songlist
  }

  function normalize(raw) {
    const tracks = []
    for (const s of raw) {
      if (!s) continue
      const platformId = s.mid || (s.id != null ? String(s.id) : '')
      const title = cleanText(s.name || s.title, 200)
      if (!platformId || !title) continue
      tracks.push({
        platformId,
        title,
        artist: (Array.isArray(s.singer) ? s.singer : [])
          .map((x) => cleanText(x && x.name, 80))
          .filter(Boolean)
          .join(' / '),
        album: cleanText((s.album && (s.album.name || s.album.title)) || s.albumname, 120) || null,
        durationMs: s.interval ? Number(s.interval) * 1000 : null,
        likedAt: null,
      })
    }
    return tracks
  }

  /** 校验 Cookie 并返回账号摘要（顺带探测「我喜欢」歌单） */
  async function probe(authInput) {
    const a = auth(authInput)
    const dir = await likedDir(a)
    return { uin: a.musicid, nickname: dir.nickname, likedDir: { tid: dir.tid, name: dir.name, songCount: dir.songCount }, cookie: a.cookie }
  }

  /** 归一化后的喜欢列表：[{ platformId, title, artist, album, durationMs, likedAt }] */
  async function likedTracks(authInput) {
    const a = auth(authInput)
    const dir = await likedDir(a)
    let raw
    try {
      raw = await songsViaMusicu(a, dir.tid)
    } catch (err) {
      if (err && err.status === 401) throw err
      raw = await songsViaLegacy(a, dir.tid)
    }
    return { dir, tracks: normalize(raw) }
  }

  return { probe, likedTracks, parseCookie: parseQQCookie }
}
