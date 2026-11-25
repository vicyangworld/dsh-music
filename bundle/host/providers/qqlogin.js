/**
 * QQ 扫码登录（QQ 音乐网页版同款链路，只读、不写账号）：
 *   xlogin 页面 cookie → ssl/ptqrshow（二维码图 + qrsig）→ ssl/ptqrlogin 轮询（66 未扫 / 67 已扫待确认 / 65 失效 / 0 成功）
 *   → 成功后沿 check_sig → graph login_jump → authorize 跳转到 y.qq.com/portal/wx_redirect.html 拿到 OAuth code
 *   → musicu.fcg QQConnectLogin.LoginServer.QQLogin { code } 换登录态（qm_keyst / qqmusic_key + uin）。
 * 与 y.qq.com/portal/wx_redirect.html 内联脚本（login_type=1 分支）一致；零外部依赖，仅 node: 内置模块。
 * 中间产物（qrsig、p_skey 等 QQ 登录 cookie）只留在内存会话里，换到音乐登录态后即丢弃，不落盘、不进日志。
 */
import { inflateSync } from 'node:zlib'
import { QQ_UA } from './qqmusic.js'

const PT_HOST = 'https://xui.ptlogin2.qq.com'
const PT_APPID = '716027609' // QQ 音乐网页版在 QQ 互联里使用的 ptlogin appid
const PT_DAID = '383'
const QQ_CLIENT_ID = '100497308' // QQ 音乐的 QQ 互联 client_id（pt_3rd_aid）
const S_URL = 'https://graph.qq.com/oauth2.0/login_jump'
const PTUI_VERSION = '26111016' // xlogin 页面下发的 ptui_version（2026-11）
const WX_REDIRECT = 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https%3A%2F%2Fy.qq.com%2F'
const XLOGIN = `${PT_HOST}/cgi-bin/xlogin?appid=${PT_APPID}&daid=${PT_DAID}&style=33&login_text=%E7%99%BB%E5%BD%95&hide_title_bar=1&hide_border=1&target=self&s_url=${encodeURIComponent(S_URL)}&pt_3rd_aid=${QQ_CLIENT_ID}&theme=2&hide_close_icon=1&hide_title_bar=1`
const COOKIE_FIELDS = ['uin', 'qqmusic_uin', 'wxuin', 'wxrefresh_token', 'psrf_qqaccess_token', 'psrf_qqunionid', 'psrf_musickey_createtime', 'psrf_qqopenid', 'qqmusic_nick']

function httpError(message, status = 502, extra) {
  const err = new Error(message)
  err.status = status
  if (extra) Object.assign(err, extra)
  return err
}

/** ptlogin 的 ptqrtoken：qrsig 的 hash33 */
export function hash33(text) {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash += (hash << 5) + text.charCodeAt(i)
  return hash & 0x7fffffff
}

/** 解析 `ptuiCB('0','0','https://…','0','登录成功！', 'nick')` → 参数数组（非 ptuiCB 返回 null） */
export function parsePtuiCb(text) {
  const s = String(text || '').trim()
  if (!/^ptuiCB\s*\(/.test(s)) return null
  const args = []
  const re = /'((?:\\.|[^'\\])*)'/g
  let m
  while ((m = re.exec(s))) args.push(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
  return args
}

/**
 * 1-bit 灰度 PNG（QQ 二维码图：111×111 = 37 模块 × 3px，无静区）→ `{ size, modules }`（1 = 黑块），
 * 供前端按模块画成清晰 SVG。其它格式返回 null，调用方退回直接显示 PNG。
 */
export function pngToMatrix(input) {
  try {
    const b = Buffer.isBuffer(input) ? input : Buffer.from(input)
    if (b.length < 57 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null
    let off = 8
    let width = 0
    let height = 0
    const idat = []
    while (off + 12 <= b.length) {
      const len = b.readUInt32BE(off)
      const type = b.toString('latin1', off + 4, off + 8)
      const data = b.subarray(off + 8, off + 8 + len)
      if (type === 'IHDR') {
        width = data.readUInt32BE(0)
        height = data.readUInt32BE(4)
        if (data[8] !== 1 || data[9] !== 0 || data[12] !== 0) return null // 只支持非隔行 1-bit 灰度
      } else if (type === 'IDAT') idat.push(data)
      else if (type === 'IEND') break
      off += 12 + len
    }
    if (!(width > 0 && height > 0 && width === height) || !idat.length) return null
    const raw = inflateSync(Buffer.concat(idat))
    const stride = Math.ceil(width / 8)
    if (raw.length < height * (stride + 1)) return null
    const lines = []
    let prev = Buffer.alloc(stride)
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)]
      const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
      for (let i = 0; i < stride; i++) {
        const a = i >= 1 ? line[i - 1] : 0
        const up = prev[i]
        const c = i >= 1 ? prev[i - 1] : 0
        let v = line[i]
        if (filter === 1) v = (v + a) & 255
        else if (filter === 2) v = (v + up) & 255
        else if (filter === 3) v = (v + ((a + up) >> 1)) & 255
        else if (filter === 4) {
          const p = a + up - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - c)
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)) & 255
        }
        line[i] = v
      }
      lines.push(line)
      prev = line
    }
    const dark = (x, y) => ((lines[y][x >> 3] >> (7 - (x & 7))) & 1) === 0
    // 模块边长：每个模块内像素必须同色（整图是方阵，边长能整除像素宽）
    for (const m of [3, 4, 2, 5, 6, 7, 8, 1]) {
      if (width % m !== 0) continue
      const size = width / m
      if (size < 21 || size > 177) continue
      let blocky = true
      const modules = new Uint8Array(size * size)
      for (let y = 0; y < size && blocky; y++) {
        for (let x = 0; x < size; x++) {
          const v = dark(x * m, y * m)
          for (let dy = 0; dy < m && blocky; dy++) for (let dx = 0; dx < m; dx++) if (dark(x * m + dx, y * m + dy) !== v) { blocky = false; break }
          modules[y * size + x] = v ? 1 : 0
        }
      }
      if (!blocky) continue
      // 去掉图片自带的白边（QQ 的图四周有 2 模块留白），交给前端按标准 4 模块静区绘制
      const trimmed = trimLightBorder(size, modules)
      return trimmed || { size, modules: Array.from(modules) }
    }
    return null
  } catch {
    return null
  }
}

/** 去掉四边全亮的行列；剩余边长必须是合法 QR 尺寸（21 + 4k），否则返回 null（保留原图） */
function trimLightBorder(size, modules) {
  let top = 0
  let bottom = size - 1
  let left = 0
  let right = size - 1
  const rowDark = (y) => { for (let x = left; x <= right; x++) if (modules[y * size + x]) return true; return false }
  const colDark = (x) => { for (let y = top; y <= bottom; y++) if (modules[y * size + x]) return true; return false }
  while (top < bottom && !rowDark(top)) top++
  while (bottom > top && !rowDark(bottom)) bottom--
  while (left < right && !colDark(left)) left++
  while (right > left && !colDark(right)) right--
  const n = bottom - top + 1
  if (n !== right - left + 1 || n < 21 || n > 177 || (n - 21) % 4 !== 0) return null
  const out = new Uint8Array(n * n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = modules[(top + y) * size + left + x]
  return { size: n, modules: Array.from(out) }
}

/** 简易 cookie 罐：按名字记值（域名/路径属性按 qq.com 全量回传，仅用于这条固定跳转链） */
function createJar() {
  const map = new Map()
  return {
    absorb(res) {
      const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
      for (const line of list) {
        const pair = String(line).split(';')[0]
        const i = pair.indexOf('=')
        if (i > 0) map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
      }
    },
    header() {
      return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    get: (name) => map.get(name) || '',
    names: () => [...map.keys()],
    seed(header) {
      for (const pair of String(header || '').split(';')) {
        const i = pair.indexOf('=')
        if (i > 0) map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
      }
    },
  }
}

export function createQQLogin({ fetchImpl, timeoutMs = 15000 } = {}) {
  const fetch = fetchImpl || globalThis.fetch
  if (typeof fetch !== 'function') throw new Error('QQ 扫码登录需要 fetch')

  async function request(url, init) {
    const ac = AbortSignal.timeout(timeoutMs)
    const signal = init.signal ? AbortSignal.any([init.signal, ac]) : ac
    let res
    try {
      res = await fetch(url, { ...init, signal, redirect: 'manual' })
    } catch (err) {
      if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw httpError('连接超时', 504)
      throw httpError(`网络请求失败：${(err && err.message) || err}`, 502)
    }
    if (!res || typeof res.status !== 'number') throw httpError('接口无响应', 502)
    return res
  }

  /** 创建扫码会话：拿二维码图（同时得到 qrsig） */
  async function qrCreate() {
    const jar = createJar()
    const page = await request(XLOGIN, { headers: { 'User-Agent': QQ_UA, Accept: 'text/html,*/*' } })
    jar.absorb(page)
    await page.arrayBuffer().catch(() => {})
    const t = Math.random()
    const show = `${PT_HOST}/ssl/ptqrshow?appid=${PT_APPID}&e=2&l=M&s=3&d=72&v=4&t=${t}&daid=${PT_DAID}&pt_3rd_aid=${QQ_CLIENT_ID}&u1=${encodeURIComponent(S_URL)}`
    const res = await request(show, { headers: { 'User-Agent': QQ_UA, Referer: XLOGIN, Accept: 'image/*,**' } })
    jar.absorb(res)
    const bytes = Buffer.from(await res.arrayBuffer())
    if (res.status !== 200 || bytes.length < 100 || !jar.get('qrsig')) {
      throw httpError(`获取 QQ 登录二维码失败（HTTP ${res.status}，${bytes.length} 字节）`, 502)
    }
    const matrix = pngToMatrix(bytes)
    return {
      qrsig: jar.get('qrsig'),
      /* 官方登录页轮询时带 login_sig = xlogin 下发的 pt_login_sig（缺了它，手机确认后服务端会判成二维码已失效） */
      loginSig: jar.get('pt_login_sig') || '',
      cookies: jar.header(),
      matrix: matrix ? { size: matrix.size, modules: matrix.modules } : null,
      png: `data:image/png;base64,${bytes.toString('base64')}`,
    }
  }

  /** 轮询一次。返回 `{ code, message }`：801 未扫 / 802 已扫待确认 / 800 已失效 / 803 成功（附 cookie）/ 804 其它（风控等，需重开） */
  async function qrPoll(session) {
    const poll = `${PT_HOST}/ssl/ptqrlogin?u1=${encodeURIComponent(S_URL)}&ptqrtoken=${hash33(session.qrsig)}&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-${Date.now()}&js_ver=${PTUI_VERSION}&js_type=1&login_sig=${encodeURIComponent(session.loginSig || '')}&pt_uistyle=40&aid=${PT_APPID}&daid=${PT_DAID}&pt_3rd_aid=${QQ_CLIENT_ID}`
    const res = await request(poll, { headers: { 'User-Agent': QQ_UA, Referer: XLOGIN, Accept: '*/*', Cookie: session.cookies } })
    const text = await res.text()
    const args = parsePtuiCb(text)
    if (!args) throw httpError(`QQ 扫码状态返回异常（HTTP ${res.status}）`, 502)
    const code = String(args[0])
    if (code === '66') return { code: 801, message: '二维码未失效' }
    if (code === '67') return { code: 802, message: '手机QQ扫码成功，等待确认' }
    if (code === '65') return { code: 800, message: '二维码已失效' }
    if (code !== '0') return { code: 804, message: args[4] || `返回码 ${code}` }
    const cookie = await exchange(args[2], session)
    return { code: 803, message: '登录成功', cookie }
  }

  /** check_sig → login_jump → authorize → wx_redirect.html?code=… → musicu QQLogin 换音乐登录态 */
  async function exchange(jumpUrl, session) {
    if (typeof jumpUrl !== 'string' || !/^https:\/\/(ssl\.ptlogin2\.qq\.com|graph\.qq\.com)\//.test(jumpUrl)) {
      throw httpError('QQ 登录跳转地址异常', 502)
    }
    // ptlogin2 的会话 cookie（qrsig / pt_login_sig 等）只在内存里跟着这条跳转链走
    const jar = createJar()
    jar.seed(session.cookies)
    let url = jumpUrl
    let code = ''
    for (let hop = 0; hop < 6 && url; hop++) {
      const res = await request(url, { headers: { 'User-Agent': QQ_UA, Accept: 'text/html,*/*', Cookie: jar.header() } })
      jar.absorb(res)
      await res.arrayBuffer().catch(() => {})
      const loc = res.headers.get('location')
      if (!loc) break
      url = new URL(loc, url).href
      if (url.includes('/portal/wx_redirect.html')) {
        code = new URL(url).searchParams.get('code') || ''
        break
      }
    }
    if (!code) throw httpError('QQ 登录成功但没拿到授权码（跳转链异常）', 502)
    const body = JSON.stringify({
      comm: { g_tk: 5381, platform: 'yqq', ct: 24, cv: 0 },
      req: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code } },
    })
    const res = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { 'User-Agent': QQ_UA, Referer: WX_REDIRECT, Origin: 'https://y.qq.com', Accept: 'application/json, text/plain, */*', Cookie: jar.header() },
      body,
    })
    jar.absorb(res)
    let json = null
    try { json = JSON.parse(await res.text()) } catch { json = null }
    const ok = json && Number(json.code) === 0 && json.req && Number(json.req.code) === 0
    if (!ok) {
      const desc = json ? `code ${json.code}/${json.req && json.req.code}${json.req && json.req.msg ? ' ' + json.req.msg : ''}` : `HTTP ${res.status}`
      throw httpError(`QQ 音乐登录换票失败（${desc}）`, 502)
    }
    const data = (json.req.data && typeof json.req.data === 'object') ? json.req.data : {}
    const keyst = jar.get('qm_keyst') || jar.get('qqmusic_key') || data.musickey || data.qm_keyst || data.qqmusic_key || ''
    const uin = jar.get('uin') || jar.get('qqmusic_uin') || jar.get('wxuin') || data.musicid || data.uin || data.wxuin || ''
    if (!keyst || !uin) {
      const seen = [...jar.names(), ...Object.keys(data)].filter((k) => !/skey|token|sig/i.test(k)).join(',')
      throw httpError(`QQ 登录成功但未返回音乐登录态（字段：${seen || '无'}）`, 502)
    }
    const parts = [`qqmusic_key=${keyst}`, `qm_keyst=${keyst}`, `uin=${uin}`, `qqmusic_uin=${uin}`]
    for (const key of COOKIE_FIELDS) {
      if (key === 'uin' || key === 'qqmusic_uin') continue
      const v = jar.get(key) || (data[key] != null ? String(data[key]) : '')
      if (v) parts.push(`${key}=${v}`)
    }
    return parts.join('; ')
  }

  return { qrCreate, qrPoll }
}
