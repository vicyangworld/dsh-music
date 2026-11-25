/**
 * 网易云音乐（只读）客户端：扫码登录 + 「我喜欢的音乐」歌单。
 *
 * - 非官方接口（与开源 NeteaseCloudMusicApi 同源），只读：不写账号、不拉音源。
 * - 两种通道：plain `/api/...`（表单直传）与 weapi（AES-128-CBC ×2 + 原始 RSA）。
 *   接口层两种都试，哪个先返回 code 200 用哪个；都失败时把“未登录”优先抛成 401。
 * - 零外部依赖：仅 node: 内置模块。
 */
import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto'
import { cleanText, fetchJson, httpError, parseCookie, readSetCookies } from './common.js'

export const NETEASE_ORIGIN = 'https://music.163.com'
export const NETEASE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'

const PRESET_KEY = '0CoJUm6Qyw8W8jud'
const IV = '0102030405060708'
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`

// 与官方 Web 端 weapi 相同：AES-CBC(PKCS7) 两次，第二次用 16 位随机 base62 key；
// 再把 key 反序后用 1024bit 公钥做“无填充”RSA（即直接 modPow），服务端用私钥还原。
function aesCbc(text, key) {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'))
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64')
}

export function rsaRaw(input) {
  const key = createPublicKey(PUBLIC_KEY_PEM)
  const size = Math.ceil((key.asymmetricKeyDetails?.modulusLength || 1024) / 8)
  const buf = Buffer.alloc(size, 0)
  Buffer.from(input, 'utf8').copy(buf, size - Buffer.byteLength(input))
  return publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, buf).toString('hex')
}

export function randomSecretKey() {
  const bytes = randomBytes(16)
  let secretKey = ''
  for (let i = 0; i < 16; i++) secretKey += BASE62[bytes[i] % 62]
  return secretKey
}

/** secretKey 可注入（测试解密用）；生产路径随机。 */
export function weapiEncrypt(object, secretKey = randomSecretKey()) {
  const text = JSON.stringify(object)
  return {
    params: aesCbc(aesCbc(text, PRESET_KEY), secretKey),
    encSecKey: rsaRaw(secretKey.split('').reverse().join('')),
  }
}

function describe(j) {
  if (!j) return '无响应'
  if (j.code === 'ERR') return j.message
  const msg = j.message || j.msg || ''
  return `code ${j.code}${msg ? ' ' + msg : ''}`
}

function isNotLogin(j) {
  const c = Number(j && j.code)
  return c === 301 || c === 302
}

export function createNetease({ fetchImpl, timeoutMs = 15000 } = {}) {
  const baseCookie = {
    __remember_me: 'true',
    os: 'pc',
    appver: '3.0.18.203152',
    osver: 'Microsoft-Windows-10-Professional-build-22631-64bit',
    channel: 'netease',
    versioncode: '140',
  }

  function cookieHeader(cookie) {
    const pairs = { ...baseCookie, ...parseCookie(typeof cookie === 'string' ? cookie : '') }
    return Object.entries(pairs)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  async function post(path, form, cookie) {
    const { json, res } = await fetchJson(
      NETEASE_ORIGIN + path,
      {
        method: 'POST',
        headers: {
          'User-Agent': NETEASE_UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: '*/*',
          Referer: NETEASE_ORIGIN + '/',
          Origin: NETEASE_ORIGIN,
          Cookie: cookieHeader(cookie),
        },
        body: new URLSearchParams(form).toString(),
      },
      fetchImpl,
      timeoutMs,
    )
    return { json, res }
  }

  /** plain 通道：表单直传 */
  async function plain(path, params, cookie) {
    const { json } = await post(path, params, cookie)
    return json
  }

  /** weapi 通道：加密表单（/api/x → /weapi/x） */
  async function weapi(path, params, cookie) {
    const csrf = parseCookie(typeof cookie === 'string' ? cookie : '').__csrf || ''
    const { json } = await post('/weapi/' + path.replace(/^\/api\//, ''), weapiEncrypt({ ...params, csrf_token: csrf }), cookie)
    return json
  }

  async function either(what, path, params, cookie) {
    let first = null
    try {
      first = await plain(path, params, cookie)
      if (first && Number(first.code) === 200) return first
    } catch (err) {
      first = { code: 'ERR', message: err.message }
    }
    let second = null
    try {
      second = await weapi(path, params, cookie)
      if (second && Number(second.code) === 200) return second
    } catch (err) {
      second = { code: 'ERR', message: err.message }
    }
    if (isNotLogin(first) || isNotLogin(second)) {
      throw httpError('网易云登录已失效，请重新扫码登录', 401, { code: isNotLogin(first) ? first.code : second.code })
    }
    throw httpError(`${what}失败（${describe(first)}；${describe(second)}）`, 502)
  }

  /** 生成扫码登录 key；二维码内容由客户端本地渲染 */
  async function qrKey() {
    const j = await plain('/api/login/qrcode/unikey', { type: '3', noToken: 'true' })
    if (!j || Number(j.code) !== 200 || !j.unikey) throw httpError(`获取网易云登录二维码失败（${describe(j)}）`, 502)
    return {
      key: String(j.unikey),
      url: `${NETEASE_ORIGIN}/login?codekey=${encodeURIComponent(j.unikey)}`,
    }
  }

  /** 轮询扫码状态：801 等待扫码 / 802 待确认 / 803 成功（附 cookie）/ 800 过期 */
  async function qrPoll(key) {
    const { json, res } = await post('/api/login/qrcode/client/login', { key, type: '3', noToken: 'true' })
    const code = Number(json && json.code)
    if (code === 803) {
      const jar = {}
      for (const line of readSetCookies(res)) {
        const m = /^([^=]+)=([^;]*)/.exec(line.trim())
        if (m) jar[m[1].trim()] = m[2]
      }
      if (!jar.MUSIC_U) throw httpError('扫码成功但未拿到登录凭据，请重新扫码', 502)
      const cookie = ['MUSIC_U', '__csrf'].filter((k) => jar[k]).map((k) => `${k}=${jar[k]}`).join('; ')
      return { code: 803, message: json.message || '授权登录成功', cookie }
    }
    if (code === 800 || code === 801 || code === 802) return { code, message: json.message || '' }
    throw httpError(`查询扫码状态失败（${describe(json)}）`, 502)
  }

  /** 读取账号信息；登录态失效 → 401 */
  async function account(cookie) {
    const j = await either('获取网易云账号信息', '/api/w/nuser/account/get', {}, cookie)
    const data = j.data && typeof j.data === 'object' ? j.data : j
    const profile = data.profile || j.profile || null
    if (!profile || !profile.userId) throw httpError('网易云登录已失效，请重新扫码登录', 401)
    return {
      uid: String(profile.userId),
      nickname: cleanText(profile.nickname, 64),
      avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl : null,
    }
  }

  /** trackIds 归一：[{ id, at }] → [{ id: String, likedAt }] */
  function toTrackIds(value) {
    return (Array.isArray(value) ? value : [])
      .map((t) => ({ id: String(t.id), likedAt: t.at ? Number(t.at) || null : null }))
  }

  /** 「我喜欢的音乐」歌单（按喜欢时间倒序，带 at 时间戳）
   *  user/playlist 的摘要线上已不带 trackIds（只有 trackCount）→ 再取 v6/playlist/detail：
   *  trackIds 全量；tracks 只带前 n 首完整信息，其余交给 songDetails 补齐。 */
  async function likedPlaylist(cookie, uid) {
    const j = await either('获取网易云「我喜欢的音乐」', '/api/user/playlist', { uid, limit: '30', offset: '0', includeVideo: 'true' }, cookie)
    const list = Array.isArray(j.playlist) ? j.playlist : []
    const mine = list.filter((p) => p && p.creator && String(p.creator.userId) === String(uid))
    const liked = mine.find((p) => /喜欢的音乐$/.test(p.name || '')) || mine[0]
    if (!liked) throw httpError('未找到网易云「我喜欢的音乐」歌单', 502)
    const out = {
      id: String(liked.id),
      name: cleanText(liked.name, 100),
      trackCount: Number(liked.trackCount) || 0,
      trackIds: toTrackIds(liked.trackIds),
      details: new Map(),
    }
    if (out.trackIds.length === 0) {
      const d = await either('获取网易云「我喜欢的音乐」详情', '/api/v6/playlist/detail', { id: out.id, n: '500', s: '0' }, cookie)
      const p = d.playlist && typeof d.playlist === 'object' ? d.playlist : {}
      out.trackIds = toTrackIds(p.trackIds)
      out.trackCount = Number(p.trackCount) || out.trackCount || out.trackIds.length
      for (const s of Array.isArray(p.tracks) ? p.tracks : []) {
        if (s && s.id != null) out.details.set(String(s.id), s)
      }
    }
    return out
  }

  /** 回退：喜欢列表（无序、无时间） */
  async function likedIds(cookie, uid) {
    const j = await either('获取网易云喜欢列表', '/api/song/like/get', { uid }, cookie)
    const ids = Array.isArray(j.ids) ? j.ids : []
    return { trackIds: ids.map((id) => ({ id: String(id), likedAt: null })), trackCount: Number(j.count) || ids.length }
  }

  /** 歌曲详情：id → { name, ar[], al, dt }（下架歌曲会缺席） */
  async function songDetails(cookie, ids) {
    const out = new Map()
    const chunkSize = 500
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      const j = await either('获取网易云歌曲详情', '/api/v3/song/detail', { c: JSON.stringify(chunk.map((id) => ({ id: Number(id) }))) }, cookie)
      for (const s of Array.isArray(j.songs) ? j.songs : []) out.set(String(s.id), s)
    }
    return out
  }

  /** 归一化后的喜欢列表：[{ platformId, title, artist, album, durationMs, likedAt }] */
  async function likedTracks(cookie, uid) {
    let list
    try {
      list = await likedPlaylist(cookie, uid)
    } catch (err) {
      if (err && err.status === 401) throw err
      list = await likedIds(cookie, uid)
    }
    if (list.trackIds.length === 0) return { playlist: list, tracks: [], unavailable: 0 }
    const known = list.details instanceof Map ? list.details : new Map()
    const missing = list.trackIds.map((t) => t.id).filter((id) => !known.has(id))
    const details = missing.length > 0 ? await songDetails(cookie, missing) : new Map()
    for (const [id, song] of known) if (!details.has(id)) details.set(id, song)
    const tracks = []
    for (const t of list.trackIds) {
      const s = details.get(t.id)
      if (!s) continue
      tracks.push({
        platformId: t.id,
        title: cleanText(s.name, 200),
        artist: (Array.isArray(s.ar) ? s.ar : [])
          .map((a) => cleanText(a && a.name, 80))
          .filter(Boolean)
          .join(' / '),
        album: cleanText(s.al && s.al.name, 120) || null,
        durationMs: s.dt ? Number(s.dt) : null,
        likedAt: t.likedAt,
      })
    }
    return { playlist: list, tracks, unavailable: list.trackIds.length - tracks.length }
  }

  return { qrKey, qrPoll, account, likedPlaylist, likedIds, songDetails, likedTracks }
}
