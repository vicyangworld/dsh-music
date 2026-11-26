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
const AUTHORIZE_URL = 'https://graph.qq.com/oauth2.0/authorize'
/* QQ 音乐登录页（y.qq.com）用的授权页参数：authorize?which=Login&display=pc&response_type=code&redirect_uri=…&client_id=…&state=state（无 scope） */
const AUTHORIZE_PAGE = `https://graph.qq.com/oauth2.0/show?which=Login&display=pc&response_type=code&redirect_uri=${encodeURIComponent(WX_REDIRECT)}&client_id=${QQ_CLIENT_ID}&state=state`
/* 授权页表单里的 redirect_uri = 页面参数 decodeURIComponent 后的值（抓包：surl 是完全解码的 https://y.qq.com/），不能多编一层 */
const REDIRECT_URI_PLAIN = 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/'
/* 授权表单是浏览器顶层导航提交的：带上导航类请求头，和真实流量一致 */
const NAV_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}
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
/** 会话 cookie 罐（内存）。按浏览器的规则做事：带 Domain 属性的按域匹配，没带的是 host-only；
 *  Max-Age=0 / Expires 已过期 / 空值带过期属性 = 删除。真实抓包对照：check_sig 会用删除语义清掉
 *  p_skey_forbid，如果把它当成普通 cookie 带到 authorize，服务端直接判成未登录（踢回 show 页）。 */
function createJar() {
  const map = new Map() /* name → { value, domain, hostOnly }；domain '' = 来路不明（seed 进来的），所有主机都带 */
  const hostnameOf = (url) => { try { return new URL(String(url)).hostname } catch { return '' } }
  const matches = (c, host) => {
    if (!c.domain) return true /* seed 进来的（来路不明）cookie：所有主机都带 */
    if (!host) return false
    return c.hostOnly ? host === c.domain : host === c.domain || host.endsWith('.' + c.domain)
  }
  return {
    absorb(res, requestUrl) {
      const host = hostnameOf(requestUrl || (res && res.url) || '')
      const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
      for (const line of list) {
        const parts = String(line).split(';')
        const pair = parts[0]
        const i = pair.indexOf('=')
        if (i <= 0) continue
        const name = pair.slice(0, i).trim()
        const value = pair.slice(i + 1).trim()
        const attrs = {}
        for (const a of parts.slice(1)) {
          const j = a.indexOf('=')
          if (j > 0) attrs[a.slice(0, j).trim().toLowerCase()] = a.slice(j + 1).trim()
        }
        let expired = attrs['max-age'] != null && Number(attrs['max-age']) <= 0
        if (attrs.expires) {
          const t = Date.parse(attrs.expires)
          if (Number.isFinite(t) && t <= Date.now()) expired = true
        }
        if (value === '' && (attrs.expires != null || attrs['max-age'] != null)) expired = true
        if (expired) { map.delete(name); continue }
        const domain = String(attrs.domain || '').replace(/^\./, '').toLowerCase() || host
        if (!domain) continue
        map.set(name, { value, domain, hostOnly: !attrs.domain })
      }
    },
    /** 某个 URL（或主机名）会带上的 cookie；不传 = 全部 */
    header(url) {
      const host = url ? (hostnameOf(url) || String(url)) : ''
      return [...map.entries()]
        .filter(([, c]) => !host || matches(c, host))
        .map(([k, c]) => `${k}=${c.value}`).join('; ')
    },
    /** 某个 URL 会带上的 cookie 名（诊断用） */
    namesFor: (url) => [...map.entries()].filter(([, c]) => matches(c, hostnameOf(url) || String(url || ''))).map(([k]) => k),
    get: (name) => (map.get(name) || {}).value || '',
    names: () => [...map.keys()],
    set(name, value, domain = '') { if (name && value != null && value !== '') map.set(name, { value: String(value), domain, hostOnly: false }) },
    drop: (name) => { map.delete(name) },
    seed(header, domain = '') {
      for (const pair of String(header || '').split(';')) {
        const i = pair.indexOf('=')
        if (i > 0) map.set(pair.slice(0, i).trim(), { value: pair.slice(i + 1).trim(), domain, hostOnly: false })
      }
    },
    copyFrom(other) {
      for (const [name, c] of other.entries()) map.set(name, { ...c })
    },
    entries: () => [...map.entries()],
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
    jar.absorb(page, XLOGIN)
    const pageText = await page.text().catch(() => '')
    /* 官方轮询 URL 末尾的 pt_js_version = 登录页里 monorepo 版本号（c_login_2.js 的 CDN 路径） */
    const jsVer = (pageText.match(/monorepo\/([0-9a-f]+)\/ptlogin\/js/) || [])[1] || ''
    const t = Math.random()
    const show = `${PT_HOST}/ssl/ptqrshow?appid=${PT_APPID}&e=2&l=M&s=3&d=72&v=4&t=${t}&daid=${PT_DAID}&pt_3rd_aid=${QQ_CLIENT_ID}&u1=${encodeURIComponent(S_URL)}`
    const res = await request(show, { headers: { 'User-Agent': QQ_UA, Referer: XLOGIN, Accept: 'image/*,**' } })
    jar.absorb(res, show)
    const bytes = Buffer.from(await res.arrayBuffer())
    if (res.status !== 200 || bytes.length < 100 || !jar.get('qrsig')) {
      throw httpError(`获取 QQ 登录二维码失败（HTTP ${res.status}，${bytes.length} 字节）`, 502)
    }
    const matrix = pngToMatrix(bytes)
    return {
      qrsig: jar.get('qrsig'),
      /* 官方登录页轮询时带 login_sig = xlogin 下发的 pt_login_sig（缺了它，手机确认后服务端会判成二维码已失效） */
      loginSig: jar.get('pt_login_sig') || '',
      jsVer,
      cookies: jar.header(),
      /* 会话 cookie 罐（内存对象）：轮询/换票沿用同一个罐，服务端在扫码成功那一跳下发的
         ETK / superkey / RK / ptcz 等必须带到 check_sig → authorize，否则授权会被踢回登录页 */
      jar,
      matrix: matrix ? { size: matrix.size, modules: matrix.modules } : null,
      png: `data:image/png;base64,${bytes.toString('base64')}`,
    }
  }

  /** 轮询一次。返回 `{ code, message }`：801 未扫 / 802 已扫待确认 / 800 已失效 / 803 成功（附 cookie）/ 804 其它（风控等，需重开） */
  async function qrPoll(session) {
    const poll = `${PT_HOST}/ssl/ptqrlogin?u1=${encodeURIComponent(S_URL)}&ptqrtoken=${hash33(session.qrsig)}&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-${Date.now()}&js_ver=${PTUI_VERSION}&js_type=1&login_sig=${encodeURIComponent(session.loginSig || '')}&pt_uistyle=40&aid=${PT_APPID}&daid=${PT_DAID}&pt_3rd_aid=${QQ_CLIENT_ID}${session.jsVer ? `&pt_js_version=${session.jsVer}` : ''}`
    const res = await request(poll, { headers: { 'User-Agent': QQ_UA, Referer: XLOGIN, Accept: '*/*', Cookie: session.jar ? session.jar.header(poll) : session.cookies } })
    if (session.jar) session.jar.absorb(res, poll)
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

  /** 页面级跳转：优先最终落点 wx_redirect.html?…code=…，其次 location.href= / location.replace( / meta refresh 里的 qq.com 地址 */
  function safeUrl(raw, base) {
    try {
      const u = new URL(String(raw).replace(/&amp;/g, '&'), base)
      return /^https?:$/.test(u.protocol) && /(^|\.)qq\.com$/.test(u.hostname) ? u.href : ''
    } catch { return '' }
  }

  /** 从 HTML 里找下一个跳转：落点 URL / meta refresh / location 跳转 / 自动提交的表单（授权确认页） */
  function nextFromHtml(text, base, seen = []) {
    const t = String(text || '').slice(0, 262144)
      .replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&#0*38;/gi, '&').replace(/&#x0*26;/gi, '&')
    const final = t.match(/https?:\/\/y\.qq\.com\/portal\/wx_redirect\.html[^"'\s<>)]*/)
    if (final) return { url: final[0].replace(/&amp;/g, '&') }
    const m = t.match(/(?:location(?:\.href|\.replace|\.assign)?\s*[=(]\s*|http-equiv=["']?refresh["']?[^>]*?url=)["']?(https?:\/\/[^"'\s<>)]+)/i)
    if (m) {
      const url = safeUrl(m[1], base)
      if (url) return { url }
    }
    /* 授权确认页 / 中转页：<form action=…> + 隐藏字段 + 自动 submit —— 照着表单提交一次 */
    const form = t.match(/<form\b([^>]*)>([\s\S]*?)<\/form>/i)
    if (form) {
      const action = (form[1].match(/action=["']?([^"'\s>]+)/i) || [])[1] || ''
      const url = safeUrl(action, base)
      if (url && /graph\.qq\.com/.test(new URL(url).hostname)) {
        const method = /method=["']?post/i.test(form[1]) ? 'POST' : 'GET'
        const fields = new URLSearchParams()
        const re = /<input\b([^>]*)>/gi
        let input
        let count = 0
        while ((input = re.exec(form[2]))) {
          if (!/type=["']?hidden/i.test(input[1])) continue
          const name = (input[1].match(/name=["']?([^"'\s>]+)/i) || [])[1] || ''
          if (!name) continue
          const value = ((input[1].match(/value=("([^"]*)"|'([^']*)'|[^\s>]+)/i) || [])[1] || '')
          fields.append(name, value.replace(/^["']|["']$/g, ''))
          count++
        }
        if (count > 0) {
          if (method === 'GET') return { url: url + (url.includes('?') ? '&' : '?') + fields.toString() }
          return { url, method: 'POST', body: fields.toString() }
        }
      }
    }
    /* 兜底：页面里（例如内嵌 JSON 配置）出现的 qq.com 链接 —— 优先 OAuth 路径，排除静态资源 */
    const re2 = /https?:\/\/[^"'\s<>)\\]{8,400}/g
    const prefer = []
    const rest = []
    let m2
    while ((m2 = re2.exec(t))) {
      const u = safeUrl(m2[0], base)
      if (!u || seen.includes(u)) continue
      if (/\.(js|css|png|gif|jpe?g|webp|ico|svg|woff2?)(\?|$)/i.test(u) || /^https?:\/\/imgcache\.qq\.com\//.test(u)) continue
      if (/\/oauth2\.0\/|login_jump|wx_redirect/.test(u)) prefer.push(u)
      else rest.push(u)
    }
    const pick = prefer[0] || rest[0] || ''
    return pick ? { url: pick } : null
  }

  /** g_tk：QQ 互联的防 CSRF 值 = hash33 变体（种子 5381）作用于 p_skey cookie */
  function gtkOf(jar) {
    const str = jar.get('p_skey') || ''
    let hash = 5381
    for (let i = 0; i < str.length; i++) hash += (hash << 5) + str.charCodeAt(i)
    return hash & 0x7fffffff
  }

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16)
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16).toUpperCase()
    })
  }

  /**
   * login_jump 只是 iframe 里的一个 postMessage 页面（告诉父页 qclogin_success）；
   * 父页（authorize/show）收到后用表单 POST authorize 完成授权：openapi=1010（头像昵称）、from_ptlogin=1、update_auth=1、g_tk=hash33(p_skey)
   */
  function authorizeStep(jar) {
    const f = new URLSearchParams()
    f.set('response_type', 'code')
    f.set('client_id', QQ_CLIENT_ID)
    f.set('redirect_uri', REDIRECT_URI_PLAIN)
    f.set('scope', '')
    f.set('state', 'state')
    f.set('switch', '')
    f.set('from_ptlogin', '1')
    f.set('src', '1')
    f.set('update_auth', '1')
    f.set('openapi', '1010')
    f.set('g_tk', String(gtkOf(jar)))
    f.set('auth_time', String(Date.now()))
    /* 官方页 getUuid()：有 ui cookie 用它，否则生成一个并写回 cookie —— 表单里的 ui 和 cookie 必须一致 */
    const ui = jar.get('ui') || uuid()
    jar.set('ui', ui, 'graph.qq.com')
    f.set('ui', ui)
    return { url: AUTHORIZE_URL, method: 'POST', body: f.toString(), headers: { ...NAV_HEADERS, Referer: AUTHORIZE_PAGE, Origin: 'https://graph.qq.com' } }
  }

  /** 诊断信息（给用户看的错误文案用）：去掉标签、遮住长 token，只留前 200 字 */
  function describeBody(text) {
    const t = String(text || '')
    const urls = []
    const re = /https?:\/\/[^"'\s<>)\\]{8,200}/g
    let m
    while ((m = re.exec(t)) && urls.length < 4) urls.push(m[0].replace(/[A-Za-z0-9_\-]{17,}/g, '…'))
    const plain = t.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]{0,300}>/g, ' ').replace(/[A-Za-z0-9_\-]{17,}/g, '…').replace(/\s+/g, ' ').trim().slice(0, 200)
    return { len: t.length, plain, urls }
  }

  /** check_sig → login_jump → authorize → wx_redirect.html?code=… → musicu QQLogin 换音乐登录态 */
  async function exchange(jumpUrl, session) {
    /* 跳转地址由服务端下发（check_sig…），主机只认 qq.com 下的 http(s) 地址；错误文案带上 host/path 方便定位 */
    let parsed = null
    try { parsed = new URL(String(jumpUrl)) } catch { parsed = null }
    const hostOk = !!parsed && /^https?:$/.test(parsed.protocol) && /(^|\.)qq\.com$/.test(parsed.hostname)
    if (!hostOk) {
      const shown = parsed ? `${parsed.hostname}${parsed.pathname}`.slice(0, 80) : String(jumpUrl || '').slice(0, 60)
      throw httpError(`QQ 登录跳转地址异常（${shown}）`, 502)
    }
    // ptlogin2 的会话 cookie（qrsig / pt_login_sig 等）只在内存里跟着这条跳转链走
    const jar = createJar()
    if (session.jar) jar.copyFrom(session.jar)
    else jar.seed(session.cookies)
    let url = parsed.href
    let referer = XLOGIN
    let code = ''
    let lastStatus = 0
    let lastText = ''
    let post = null /* 下一跳是表单 POST 时：{ body } */
    const hops = []
    const seen = []
    for (let hop = 0; hop < 10 && url; hop++) {
      if (seen.includes(url)) {
        lastText = text || lastText
        break
      }
      seen.push(url)
      const init = { headers: { 'User-Agent': QQ_UA, Accept: 'text/html,application/json,*/*', Referer: referer, Cookie: jar.header(url) } }
      if (post) {
        init.method = 'POST'
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded'
        init.body = post.body
        if (post.headers) Object.assign(init.headers, post.headers)
      }
      post = null
      const res = await request(url, init)
      jar.absorb(res, url)
      lastStatus = res.status
      const text = await res.text().catch(() => '')
      const u = new URL(url)
      hops.push(`${u.hostname}${u.pathname}→${res.status}`)
      /* 授权表单这一跳最关键：被踢回 show = 服务端没认登录态。记下它带了哪些 cookie（只记名字）和跳去了哪 */
      if (/\/oauth2\.0\/authorize/.test(u.pathname)) {
        const to = res.headers.get('location')
        let toShown = '无跳转'
        if (to) { try { const t = new URL(to, url); toShown = t.hostname + t.pathname } catch { toShown = '？' } }
        hops[hops.length - 1] += `→${toShown}（cookie 名：${jar.namesFor(url).join(',') || '无'}）`
      }
      /* 到达落点（wx_redirect.html?…code=…）：授权码就在 URL 里，页面本身不用再解析 */
      if (url.includes('/portal/wx_redirect.html')) {
        code = u.searchParams.get('code') || ''
        break
      }
      /* 302 Location 优先；没有的话（graph 的页面有用 JS / meta / 表单跳的）从正文里找下一个 qq.com 落点 */
      let step = null
      const location = res.headers.get('location')
      if (location) step = { url: safeUrl(location, url) }
      /* login_jump 的 200 页只是 iframe 里的 postMessage（qclogin_success）→ 按官方授权页的逻辑提交 authorize 表单 */
      if (!step && /\/oauth2\.0\/login_jump/.test(u.pathname) && /qclogin_success/.test(text)) {
        /* 浏览器在 check_sig 之后就没有 p_skey_forbid 这个 cookie（服务端用删除语义清掉的）；保险起见授权前再丢一次 */
        jar.drop('p_skey_forbid')
        step = authorizeStep(jar)
      }
      if (!step) {
        const cb = text.match(/"callback"\s*:\s*"(https?:\/\/[^"\s]+)"/)
        if (cb) step = { url: safeUrl(cb[1].replace(/\\\//g, '/'), url) }
      }
      if (!step) step = nextFromHtml(text, url, seen)
      if (!step || !step.url) {
        lastText = text
        break
      }
      referer = url
      url = step.url
      if (step.method === 'POST') post = { body: step.body, headers: step.headers || null }
      if (url.includes('/portal/wx_redirect.html')) {
        code = new URL(url).searchParams.get('code') || ''
        break
      }
    }
    if (!code) {
      const d = describeBody(lastText)
      const detail = `跳转链 ${hops.join(' › ') || '（空）'}；末页 ${d.len} 字节${d.plain ? `「${d.plain}」` : ''}${d.urls.length ? `；页面链接 ${d.urls.join(' | ')}` : ''}`
      throw httpError(`QQ 登录成功但没拿到授权码（${detail.slice(0, 800)}）`, 502)
    }
    const body = JSON.stringify({
      comm: { g_tk: 5381, platform: 'yqq', ct: 24, cv: 0 },
      req: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code } },
    })
    const res = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { 'User-Agent': QQ_UA, Referer: WX_REDIRECT, Origin: 'https://y.qq.com', Accept: 'application/json, text/plain, */*', Cookie: jar.header('https://u.y.qq.com/') },
      body,
    })
    jar.absorb(res, 'https://u.y.qq.com/cgi-bin/musicu.fcg')
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
