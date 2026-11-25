#!/usr/bin/env node
/**
 * QQ 音乐 / 网易云「喜欢列表只读导入」host 侧测试（无网络：fetch 全部打桩）。
 *
 * 覆盖：weapi 加密可逆（AES 两层 + 原始 RSA）、网易云扫码状态机 / 登录态回退 / 喜欢列表归一化、
 * QQ Cookie 解析 / g_tk / 分页 / 旧接口兜底、likes.importItems 去重与 👎 跳过、
 * liked-sync 编排（登录→同步→增量移除→409/401）、路由状态码、accounts.json 0600 与脱敏。
 *
 * 用法：node tests/liked-sync-test.mjs
 */
import assert from 'node:assert/strict'
import { createDecipheriv, createPublicKey } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { createNetease, weapiEncrypt, rsaRaw } from '../bundle/host/providers/netease.js'
import { createQQMusic, parseQQCookie, gtk, QQ_UA } from '../bundle/host/providers/qqmusic.js'
import { createQQLogin, hash33, parsePtuiCb, pngToMatrix } from '../bundle/host/providers/qqlogin.js'
import { parseCookie } from '../bundle/host/providers/common.js'
import { createStorage } from '../bundle/host/storage.js'
import { createLikes } from '../bundle/host/likes.js'
import { createAccounts } from '../bundle/host/accounts.js'
import { createLikedSync, registerLikedSyncRoutes } from '../bundle/host/liked-sync.js'

/* ---------------- 极简测试框架 ---------------- */
const results = []
async function test(name, fn) {
  try {
    await fn()
    results.push(['PASS', name])
  } catch (err) {
    results.push(['FAIL', name, err])
  }
}
const jsonRes = (value, init = {}) => new Response(JSON.stringify(value), {
  status: init.status || 200,
  headers: init.headers || { 'content-type': 'application/json' },
})
/** 打桩 fetch：按 (path, form, headers) 分发；返回 undefined → 404 */
function mockFetch(handler) {
  const calls = []
  const fn = async (url, init = {}) => {
    const u = new URL(url)
    const body = typeof init.body === 'string' ? init.body : ''
    const form = Object.fromEntries(new URLSearchParams(body))
    const rec = { url: u, path: u.pathname, query: u.searchParams, method: init.method, headers: init.headers || {}, body, form, cookie: init.headers?.Cookie || init.headers?.cookie || '' }
    calls.push(rec)
    const out = handler(rec, calls.length)
    return out === undefined ? jsonRes({ code: 404 }, { status: 404 }) : out
  }
  fn.calls = calls
  return fn
}
const fakeLibrary = (tracks = []) => ({
  tracks,
  ensureScanned: async () => {},
  snapshot: () => ({ tracks, scannedAt: 1 }),
  getRecord: () => undefined,
})
const fakeRes = () => ({
  status: 0, headers: null, body: null,
  writeHead(status, headers) { this.status = status; this.headers = headers },
  end(body) { this.body = body },
})
const fakeReq = (method, url, body = '') => {
  const req = Readable.from(body ? [Buffer.from(body)] : [])
  req.method = method
  req.url = url
  return req
}
const parse = (res) => JSON.parse(res.body)
const expectStatus = (promise, status) => assert.rejects(promise, (err) => Boolean(err) && err.status === status)

/* ================= 1. 公共工具 ================= */
await test('parseCookie：Cookie: 前缀 / 换行 / 引号值', () => {
  const pairs = parseCookie('Cookie: a=1;\n  b="x y" ; pgv_pvid=abc; ; =bad; c')
  assert.deepEqual(pairs, { a: '1', b: 'x y', pgv_pvid: 'abc' })
  assert.deepEqual(parseCookie(''), {})
  assert.deepEqual(parseCookie(null), {})
})

/* ================= 2. weapi 加密 ================= */
const PRESET_KEY = '0CoJUm6Qyw8W8jud'
const IV = '0102030405060708'
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`
const aesDec = (b64, key) => {
  const d = createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(IV, 'utf8'))
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8')
}
await test('weapiEncrypt：两层 AES-CBC 可逆还原原文', () => {
  const secret = 'abcdefghijklmnop'
  const payload = { uid: 42, limit: '30', csrf_token: 'abc' }
  const enc = weapiEncrypt(payload, secret)
  assert.equal(aesDec(aesDec(enc.params, secret), PRESET_KEY), JSON.stringify(payload))
  assert.equal(enc.encSecKey.length, 256)
  assert.match(enc.encSecKey, /^[0-9a-f]+$/)
})
await test('weapiEncrypt：encSecKey == 反序 key 的原始 RSA（m^65537 mod n）', () => {
  const secret = 'Zyxwvutsrqponmlk'
  const jwk = createPublicKey(PUBLIC_KEY_PEM).export({ format: 'jwk' })
  const n = BigInt('0x' + Buffer.from(jwk.n, 'base64url').toString('hex'))
  const m = BigInt('0x' + Buffer.from(secret.split('').reverse().join(''), 'utf8').toString('hex'))
  const expected = (m ** BigInt(65537) % n).toString(16).padStart(256, '0')
  assert.equal(weapiEncrypt({}, secret).encSecKey, expected)
  assert.equal(rsaRaw('abc').length, 256)
})
await test('weapiEncrypt：默认随机 16 位 base62 key，两次结果不同', () => {
  const a = weapiEncrypt({ a: 1 })
  const b = weapiEncrypt({ a: 1 })
  assert.notEqual(a.params, b.params)
  assert.notEqual(a.encSecKey, b.encSecKey)
})

/* ================= 3. 网易云 ================= */
await test('网易云：扫码 key → 801 等待 → 803 拿到 MUSIC_U cookie', async () => {
  let polls = 0
  const fetchImpl = mockFetch((rec) => {
    if (rec.path === '/api/login/qrcode/unikey') return jsonRes({ code: 200, unikey: 'K1' })
    if (rec.path === '/api/login/qrcode/client/login') {
      polls++
      if (polls === 1) return jsonRes({ code: 801, message: '等待扫码' })
      return new Response(JSON.stringify({ code: 803, message: '授权登录成功' }), {
        headers: [['set-cookie', '__csrf=CSRF1; Path=/'], ['set-cookie', 'MUSIC_U=TOKEN123; Path=/; HttpOnly'], ['content-type', 'application/json']],
      })
    }
  })
  const ne = createNetease({ fetchImpl })
  const key = await ne.qrKey()
  assert.equal(key.key, 'K1')
  assert.equal(key.url, 'https://music.163.com/login?codekey=K1')
  assert.equal(fetchImpl.calls[0].form.type, '3')
  assert.match(fetchImpl.calls[0].headers['User-Agent'], /Mozilla/)
  assert.equal(fetchImpl.calls[0].headers['Referer'], 'https://music.163.com/')
  assert.deepEqual(await ne.qrPoll('K1'), { code: 801, message: '等待扫码' })
  assert.equal(fetchImpl.calls[1].form.key, 'K1')
  const done = await ne.qrPoll('K1')
  assert.equal(done.code, 803)
  assert.equal(done.cookie, 'MUSIC_U=TOKEN123; __csrf=CSRF1')
})
await test('网易云：unikey 非 200 → 502；803 无 MUSIC_U → 502', async () => {
  const bad = createNetease({ fetchImpl: mockFetch(() => jsonRes({ code: 400, msg: '参数错误' })) })
  await expectStatus(bad.qrKey(), 502)
  const noCookie = createNetease({ fetchImpl: mockFetch(() => jsonRes({ code: 803 })) })
  await expectStatus(noCookie.qrPoll('x'), 502)
})
await test('网易云：账号信息 plain 301 → 自动回退 weapi（加密表单 + cookie 透传）', async () => {
  const fetchImpl = mockFetch((rec) => {
    if (rec.path === '/api/w/nuser/account/get') return jsonRes({ code: 301, message: '需要登录' })
    if (rec.path === '/weapi/w/nuser/account/get') return jsonRes({ code: 200, profile: { userId: 42, nickname: '小明', avatarUrl: 'https://p/1.jpg' }, account: { id: 42 } })
  })
  const ne = createNetease({ fetchImpl })
  const account = await ne.account('MUSIC_U=T')
  assert.equal(account.uid, '42')
  assert.equal(account.nickname, '小明')
  assert.equal(account.avatarUrl, 'https://p/1.jpg')
  const weapiCall = fetchImpl.calls[1]
  assert.match(weapiCall.form.params, /^[A-Za-z0-9+/=]+$/)
  assert.equal(weapiCall.form.encSecKey.length, 256)
  assert.match(weapiCall.cookie, /MUSIC_U=T/)
  assert.match(weapiCall.cookie, /__remember_me=true/)
  assert.equal(weapiCall.headers['Content-Type'], 'application/x-www-form-urlencoded')
})
await test('网易云：plain / weapi 都 301 → 401；profile 为空 → 401', async () => {
  const ne = createNetease({ fetchImpl: mockFetch(() => jsonRes({ code: 301 })) })
  await expectStatus(ne.account('MUSIC_U=bad'), 401)
  const empty = createNetease({ fetchImpl: mockFetch(() => jsonRes({ code: 200, account: null, profile: null })) })
  await expectStatus(empty.account('MUSIC_U=bad'), 401)
})
await test('网易云：喜欢歌单（摘要无 trackIds → 歌单详情补全）→ 歌曲详情归一化（时间戳/歌手/专辑/下架计数）', async () => {
  const fetchImpl = mockFetch((rec) => {
    if (rec.path === '/api/user/playlist') {
      // 线上实测：摘要只有 trackCount，不带 trackIds
      return jsonRes({
        code: 200,
        playlist: [
          { id: 1, name: '别人的歌单', creator: { userId: 7 }, trackCount: 1 },
          { id: 9, name: '小明喜欢的音乐', creator: { userId: 42 }, trackCount: 3 },
        ],
      })
    }
    if (rec.path === '/api/v6/playlist/detail') {
      // trackIds 全量；tracks 只带前 n 首的完整信息（这里只给第 1 首）
      assert.equal(rec.form.id, '9')
      return jsonRes({
        code: 200,
        playlist: {
          id: 9, trackCount: 3,
          trackIds: [{ id: 111, at: 1700000000000 }, { id: 222 }, { id: 333 }],
          tracks: [{ id: 111, name: '歌111', ar: [{ name: '周杰伦' }, { name: '' }, { name: '费玉清' }], al: { name: '专辑111' }, dt: 269000 }],
        },
      })
    }
    if (rec.path === '/api/v3/song/detail') {
      const ids = JSON.parse(rec.form.c).map((x) => x.id)
      return jsonRes({ code: 200, songs: ids.filter((id) => id !== 333).map((id) => ({
        id, name: `歌${id}`, ar: [{ name: 'A' }], al: { name: `专辑${id}` }, dt: 269000,
      })) })
    }
  })
  const ne = createNetease({ fetchImpl })
  const out = await ne.likedTracks('MUSIC_U=T', '42')
  assert.equal(out.tracks.length, 2)
  assert.equal(out.unavailable, 1)
  assert.equal(out.playlist.name, '小明喜欢的音乐')
  assert.equal(out.playlist.trackCount, 3)
  assert.deepEqual(out.tracks[0], { platformId: '111', title: '歌111', artist: '周杰伦 / 费玉清', album: '专辑111', durationMs: 269000, likedAt: 1700000000000 })
  assert.equal(out.tracks[1].likedAt, null)
  const detailCalls = fetchImpl.calls.filter((c) => c.path === '/api/v3/song/detail')
  assert.equal(detailCalls.length, 1)
  assert.deepEqual(JSON.parse(detailCalls[0].form.c).map((x) => x.id), [222, 333])
})
await test('网易云：歌单接口失败 → 回退 like/get（无序 ids）', async () => {
  const fetchImpl = mockFetch((rec) => {
    if (rec.path === '/api/user/playlist' || rec.path === '/weapi/user/playlist') return jsonRes({ code: 400 })
    if (rec.path === '/api/song/like/get') return jsonRes({ code: 200, ids: [5, 6], count: 2 })
    if (rec.path === '/api/v3/song/detail') return jsonRes({ code: 200, songs: [{ id: 5, name: '五', ar: [{ name: 'A' }], dt: 1 }, { id: 6, name: '六', ar: [{ name: 'B' }], dt: 2 }] })
  })
  const ne = createNetease({ fetchImpl })
  const out = await ne.likedTracks('MUSIC_U=T', '42')
  assert.deepEqual(out.tracks.map((t) => t.platformId), ['5', '6'])
  assert.equal(fetchImpl.calls.find((c) => c.path === '/api/song/like/get').form.uid, '42')
})
await test('网易云：歌单摘要成功但详情失败 → 回退 like/get', async () => {
  const fetchImpl = mockFetch((rec) => {
    if (rec.path === '/api/user/playlist') return jsonRes({ code: 200, playlist: [{ id: 9, name: '我喜欢的音乐', creator: { userId: 42 }, trackCount: 2 }] })
    if (rec.path === '/api/v6/playlist/detail' || rec.path === '/weapi/v6/playlist/detail') return jsonRes({ code: 400 })
    if (rec.path === '/api/song/like/get') return jsonRes({ code: 200, ids: [5, 6], count: 2 })
    if (rec.path === '/api/v3/song/detail') return jsonRes({ code: 200, songs: [{ id: 5, name: '五', ar: [{ name: 'A' }], dt: 1 }, { id: 6, name: '六', ar: [{ name: 'B' }], dt: 2 }] })
  })
  const out = await createNetease({ fetchImpl }).likedTracks('MUSIC_U=T', '42')
  assert.deepEqual(out.tracks.map((t) => t.platformId), ['5', '6'])
})
await test('网易云：歌曲详情分块 ≤500 / 非 JSON 响应 → 502', async () => {
  let idsAsked = 0
  const fetchImpl = mockFetch((rec) => {
    if (rec.path === '/api/user/playlist') return jsonRes({ code: 200, playlist: [{ id: 1, name: 'x喜欢的音乐', creator: { userId: 42 }, trackIds: Array.from({ length: 1201 }, (_, i) => ({ id: i + 1 })) }] })
    if (rec.path === '/api/v3/song/detail') { idsAsked += JSON.parse(rec.form.c).length; return jsonRes({ code: 200, songs: [] }) }
  })
  const ne = createNetease({ fetchImpl })
  const out = await ne.likedTracks('MUSIC_U=T', '42')
  assert.equal(out.tracks.length, 0)
  assert.equal(out.unavailable, 1201)
  assert.equal(idsAsked, 1201)
  assert.equal(fetchImpl.calls.filter((c) => c.path === '/api/v3/song/detail').length, 3)
  const html = createNetease({ fetchImpl: async () => new Response('<html>', { status: 200 }) })
  await expectStatus(html.qrKey(), 502)
})

/* ================= 4. QQ 音乐 ================= */
await test('QQ：Cookie 解析（Cookie: 前缀 / o 前缀 uin / 双 keyst 名 / 丢噪音）', () => {
  const a = parseQQCookie('Cookie: pgv_pvid=abc; sensorsdata=1;\n  uin=o0123456; qm_keyst=Q_H_ABC; qqmusic_nick=%E9%98%BF%E5%BC%BA')
  assert.equal(a.error, undefined)
  assert.equal(a.keyst, 'Q_H_ABC')
  assert.equal(a.uin, '123456')
  assert.equal(a.musicid, '123456')
  assert.equal(a.nickname, '阿强')
  assert.match(a.cookie, /uin=o0123456/)
  assert.doesNotMatch(a.cookie, /qqmusic_nick=/)
  assert.match(a.cookie, /qm_keyst=Q_H_ABC/)
  assert.match(a.cookie, /qqmusic_key=Q_H_ABC/)
  assert.doesNotMatch(a.cookie, /pgv|sensors/)
  const b = parseQQCookie('wxuin=WX1; qqmusic_key=Q_W_1')
  assert.equal(b.musicid, 'WX1')
  assert.match(b.cookie, /wxuin=WX1/)
  assert.doesNotMatch(b.cookie, /(^|; )uin=/)
  assert.match(parseQQCookie('uin=o1; foo=bar').error, /qm_keyst/)
  assert.match(parseQQCookie('qm_keyst=X').error, /uin/)
  // 整段粘贴：cURL（-H 'cookie: …'）/ 请求头里的 cookie: 行 / -b '…' 三种形态都能抽出 Cookie
  const curl = parseQQCookie("curl 'https://u.y.qq.com/cgi-bin/musicu.fcg' -H 'accept: */*' -H 'cookie: pgv=p; uin=o0123456; qm_keyst=Q_H_CURL; qqmusic_nick=%E9%98%BF%E5%BC%BA' -H 'origin: https://y.qq.com'")
  assert.equal(curl.keyst, 'Q_H_CURL')
  assert.equal(curl.uin, '123456')
  assert.equal(curl.nickname, '阿强')
  assert.doesNotMatch(curl.cookie, /pgv/)
  const hdr = parseQQCookie('accept: */*\ncookie: wxuin=WX9; qqmusic_key=Q_W_HDR\nreferer: https://y.qq.com/')
  assert.equal(hdr.keyst, 'Q_W_HDR')
  assert.equal(hdr.musicid, 'WX9')
  const dashB = parseQQCookie("curl 'https://y.qq.com/' -b 'uin=o0777; qm_keyst=Q_H_B'")
  assert.equal(dashB.keyst, 'Q_H_B')
  assert.equal(dashB.uin, '777')
})
await test('QQ：g_tk 确定性且为 31 位非负整数', () => {
  assert.equal(gtk('abc'), gtk('abc'))
  assert.ok(Number.isInteger(gtk('Q_H_ABC')) && gtk('Q_H_ABC') >= 0 && gtk('Q_H_ABC') < 2 ** 31)
})
const DISS_OK = { code: 0, subcode: 0, data: { hostname: '阿强', encrypt_uin: 'oi4z', disslist: [
  { diss_name: '自定义歌单', dirid: 0, tid: 555, song_cnt: 12 },
  { diss_name: '我喜欢', dirid: 201, tid: 777, song_cnt: 650 },
] } }
await test('QQ：probe 校验 Cookie → 「我喜欢」tid / 昵称（带 keyst 的 g_tk 与 Cookie）', async () => {
  const fetchImpl = mockFetch((rec) => {
    if (rec.path.endsWith('/fcg_user_created_diss')) return jsonRes(DISS_OK)
  })
  const qq = createQQMusic({ fetchImpl })
  const probed = await qq.probe('uin=o0123456; qm_keyst=Q_H_ABC')
  assert.deepEqual(probed.likedDir, { tid: '777', name: '我喜欢', songCount: 650 })
  assert.equal(probed.nickname, '阿强')
  assert.equal(probed.uin, '123456')
  assert.match(probed.cookie, /qm_keyst=Q_H_ABC/)
  const call = fetchImpl.calls[0]
  assert.equal(call.query.get('hostuin'), '123456')
  assert.equal(call.query.get('g_tk'), String(gtk('Q_H_ABC')))
  assert.match(call.cookie, /qqmusic_key=Q_H_ABC/)
  assert.match(call.headers.Cookie, /uin=o0123456/)
  assert.equal(call.headers['User-Agent'], QQ_UA)
  assert.equal(call.headers.Referer, 'https://y.qq.com/portal/profile.html')
})
await test('QQ：code 1000 → 401；Cookie 缺字段 → 400；歌单里无 dirid 201 → 回退个人主页', async () => {
  const expired = createQQMusic({ fetchImpl: mockFetch(() => jsonRes({ code: 1000 })) })
  await expectStatus(expired.probe('uin=o1; qm_keyst=X'), 401)
  await expectStatus(expired.probe('uin=o1'), 400)
  const fetchImpl = mockFetch((rec) => {
    if (rec.path.endsWith('/fcg_user_created_diss')) return jsonRes({ ...DISS_OK, data: { ...DISS_OK.data, disslist: [{ diss_name: '自定义歌单', dirid: 0, tid: 555, song_cnt: 12 }] } })
    if (rec.path.endsWith('/fcg_get_profile_homepage.fcg')) return jsonRes({ code: 0, data: { hostname: '阿强', mymusic: [{ id: 888, num0: 3 }, { id: 999, num0: 0 }] } })
  })
  const qq = createQQMusic({ fetchImpl })
  const probed = await qq.probe('uin=o1; qm_keyst=X')
  assert.deepEqual(probed.likedDir, { tid: '888', name: '我喜欢', songCount: 3 })
  assert.equal(fetchImpl.calls[1].query.get('cid'), '205360838')
  assert.equal(fetchImpl.calls[1].query.get('userid'), '1')
})
await test('QQ：musicu 分页 300/页（650 → 3 次）→ 归一化（singer/album/interval）', async () => {
  const page = (begin, count) => Array.from({ length: count }, (_, i) => ({
    mid: `m${begin + i}`, name: `歌${begin + i}`, singer: [{ name: 'A' }, { name: 'B' }], album: { mid: 'al', name: '专辑' }, interval: 200,
  }))
  const fetchImpl = mockFetch((rec) => {
    if (rec.path.endsWith('/fcg_user_created_diss')) return jsonRes(DISS_OK)
    const data = JSON.parse(rec.query.get('data'))
    const { song_begin, song_num, disstid } = data.req_0.param
    assert.equal(disstid, 777)
    assert.equal(song_num, 300)
    assert.equal(data.comm.uin, 123456)
    if (song_begin === 0) return jsonRes({ code: 0, req_0: { code: 0, data: { code: 0, songlist: page(0, 300), total_song_num: 650 } } })
    if (song_begin === 300) return jsonRes({ code: 0, req_0: { code: 0, data: { code: 0, songlist: page(300, 300), total_song_num: 650 } } })
    if (song_begin === 600) return jsonRes({ code: 0, req_0: { code: 0, data: { code: 0, songlist: page(600, 50), total_song_num: 650 } } })
  })
  const qq = createQQMusic({ fetchImpl })
  const out = await qq.likedTracks('uin=o123456; qm_keyst=X')
  assert.equal(out.tracks.length, 650)
  assert.equal(out.dir.tid, '777')
  assert.deepEqual(out.tracks[0], { platformId: 'm0', title: '歌0', artist: 'A / B', album: '专辑', durationMs: 200000, likedAt: null })
  assert.equal(fetchImpl.calls.filter((c) => c.path === '/cgi-bin/musicu.fcg').length, 3)
  assert.equal(fetchImpl.calls.at(-1).headers.cookie, fetchImpl.calls.at(-2).headers.cookie)
})
await test('QQ：musicu 失败 → 旧接口 cdlist 兜底；musicu 1000 → 401（不兜底）', async () => {
  const fetchImpl = mockFetch((rec) => {
    if (rec.path.endsWith('/fcg_user_created_diss')) return jsonRes(DISS_OK)
    if (rec.path === '/cgi-bin/musicu.fcg') return jsonRes({ code: 0, req_0: { code: -1, data: null } })
    if (rec.path.includes('fcg_ucc_getcdinfo_byids_cp')) return jsonRes({ code: 0, cdlist: [{ dissname: '我喜欢', songlist: [
      { mid: 'x1', name: '旧接口一', singer: [{ name: 'S' }], albumname: '旧专辑', interval: 61 }, { id: 5, name: '无 mid 用 id', singer: [] }, { mid: '', name: '' },
    ] }] })
  })
  const qq = createQQMusic({ fetchImpl })
  const out = await qq.likedTracks('uin=o1; qm_keyst=X')
  assert.equal(out.tracks.length, 2)
  assert.deepEqual(out.tracks[0], { platformId: 'x1', title: '旧接口一', artist: 'S', album: '旧专辑', durationMs: 61000, likedAt: null })
  assert.equal(out.tracks[1].platformId, '5')
  assert.equal(fetchImpl.calls[2].query.get('disstid'), '777')
  const auth = createQQMusic({ fetchImpl: mockFetch((rec) => rec.path.endsWith('/fcg_user_created_diss') ? jsonRes(DISS_OK) : rec.path === '/cgi-bin/musicu.fcg' ? jsonRes({ code: 1000 }) : undefined) })
  await expectStatus(auth.likedTracks('uin=o1; qm_keyst=X'), 401)
})

/* ================= 5. likes.importItems ================= */
/* 真实的 QQ 二维码图（ptqrshow 下发，111×111 = 37 模块 × 3px，1-bit 灰度，无静区） */
const QQ_QR_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAG8AAABvAQAAAADKvqPNAAAACXBIWXMAAAsTAAALEwEAmpwYAAABbklEQVQ4jbXVu63rMAwG4N9QoU5eQIDWUKeV7AX8WMBZSZ3WEKAF7M6FYB7aySluI6a4JzCMfAUdijQZ0D8f/EdWwFGC8XkAZokzOTrRJ3dQFTlo25958nWM9huOp7vCt+yprEkdX3Amji2U7PhJskXAjum+fo/fIJePwzFHvr8L22Ad4HbtiNzOJZXYUx0C7SjreR+hSdq9NV4diTulSGA1yNDl4oc8xWmSjqi2UBbtLp8l1i6VBeiiWgkijbYInBK9UiGBtOg8wc7RTt6J3Lztnpdw09zQNqsJtGm3+7J4K5J/Aj73/MI8lWyS1lReJx2noqeSTdb55OTVi7JBFQmU43Tc0BfJvLPSPAt2jIUk8iBsUBe4oUrkTIqewcE7yRbvWRj5FPw9WYn3ztk99whjciSR57cjDHfse0G1+OwcIPBDnpGUaEK5tNvwiW2zS+ijW/wntkHek0e8N6qBE8k7Zwp8ijzpIvHP/iZ+AHMLa6ev3zhsAAAAAElFTkSuQmCC', 'base64')
await test('QQ 扫码：hash33 / parsePtuiCb / 1-bit PNG → 模块矩阵（37×37，定位图案）', async () => {
  assert.equal(hash33(''), 0)
  assert.equal(hash33('abc'), 108966)
  assert.deepEqual(parsePtuiCb("ptuiCB('66','0','','0','二维码未失效。', '')"), ['66', '0', '', '0', '二维码未失效。', ''])
  assert.equal(parsePtuiCb("window.x = 1"), null)
  const m = pngToMatrix(QQ_QR_PNG)
  assert.equal(m.size, 33, '37 块去掉四周 2 模块白边 → 33×33（版本 4）')
  assert.equal(m.modules.filter(Boolean).length, 563)
  const row = (y) => m.modules.slice(y * 33, y * 33 + 7).join('')
  assert.equal(row(0), '1111111', '左上定位图案顶边')
  assert.equal(row(3), '1011101', '定位图案 3×3 实心中心')
  assert.equal(row(6), '1111111')
  assert.equal(row(32).length, 7)
  assert.equal(pngToMatrix(Buffer.from('not a png')), null)
  assert.equal(pngToMatrix(await readFile(new URL('../bundle/icon.png', import.meta.url))), null, '彩色 PNG 不在支持范围 → null')
})

await test('QQ 扫码：xlogin → ptqrshow（qrsig）→ 轮询 66/67/0 → check_sig 跳转链拿 code → musicu QQLogin 换登录态', async () => {
  let polls = 0
  const fn = mockFetch(async (call) => {
    const u = String(call.url.href || call.url)
    if (u.startsWith('https://xui.ptlogin2.qq.com/cgi-bin/xlogin?')) {
      return new Response('<html></html>', { headers: [['set-cookie', 'pt_login_sig=LS1; Path=/; Domain=ptlogin2.qq.com'], ['content-type', 'text/html']] })
    }
    if (u.startsWith('https://xui.ptlogin2.qq.com/ssl/ptqrshow?')) {
      return new Response(QQ_QR_PNG, { headers: [['set-cookie', 'qrsig=QRSIG1; Path=/; Domain=ptlogin2.qq.com; HttpOnly'], ['content-type', 'image/png']] })
    }
    if (u.startsWith('https://xui.ptlogin2.qq.com/ssl/ptqrlogin?')) {
      polls++
      assert.match(call.headers.Cookie, /qrsig=QRSIG1/)
      assert.match(call.headers.Cookie, /pt_login_sig=LS1/)
      assert.match(u, /ptqrtoken=\d+/)
      /* 官方页轮询带 login_sig=pt_login_sig：缺了它手机确认后服务端会判「二维码已失效」 */
      assert.match(u, /login_sig=LS1(&|$)/)
      assert.match(u, /pt_3rd_aid=100497308/)
      if (polls === 1) return new Response("ptuiCB('66','0','','0','二维码未失效。', '')", { headers: { 'content-type': 'application/javascript' } })
      if (polls === 2) return new Response("ptuiCB('67','0','','0','手机QQ扫码成功。', '')")
      return new Response("ptuiCB('0','0','https://ssl.ptlogin2.qq.com/check_sig?pttype=1&uin=123456&service=ptqrlogin&ptsigx=abc&s_url=https%3A%2F%2Fgraph.qq.com%2Foauth2.0%2Flogin_jump','0','登录成功！', '阿强')", { headers: { 'content-type': 'application/javascript' } })
    }
    if (u.startsWith('https://ssl.ptlogin2.qq.com/check_sig?')) {
      assert.match(call.headers.Cookie, /pt_login_sig=LS1/)
      return new Response(null, { status: 302, headers: [['location', 'https://graph.qq.com/oauth2.0/login_jump?ptclient=1&pt_aid=100497308'], ['set-cookie', 'p_skey=PS1; Domain=qq.com; Path=/; HttpOnly']] })
    }
    if (u.startsWith('https://graph.qq.com/oauth2.0/login_jump?')) {
      assert.match(call.headers.Cookie, /p_skey=PS1/, '跳转链带上 check_sig 下发的 cookie')
      return new Response(null, { status: 302, headers: { location: 'https://graph.qq.com/oauth2.0/authorize?which=Login&display=pc&response_type=code&client_id=100497308&state=state' } })
    }
    if (u.startsWith('https://graph.qq.com/oauth2.0/authorize?')) {
      return new Response(null, { status: 302, headers: { location: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https%3A%2F%2Fy.qq.com%2F&use_customer_cb=0&code=CODE123&state=state' } })
    }
    if (u === 'https://u.y.qq.com/cgi-bin/musicu.fcg' && call.method === 'POST') {
      const body = JSON.parse(call.body)
      assert.equal(body.req.module, 'QQConnectLogin.LoginServer')
      assert.equal(body.req.method, 'QQLogin')
      assert.deepEqual(body.req.param, { code: 'CODE123' })
      assert.equal(body.comm.platform, 'yqq')
      assert.equal(call.headers.Referer, 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https%3A%2F%2Fy.qq.com%2F')
      return new Response(JSON.stringify({ code: 0, req: { code: 0, data: {} } }), {
        headers: [['set-cookie', 'qm_keyst=QK1; Domain=y.qq.com; Path=/; Max-Age=2592000; HttpOnly'], ['set-cookie', 'uin=o0123456; Domain=.qq.com; Path=/'], ['content-type', 'application/json']],
      })
    }
    return undefined
  })
  const login = createQQLogin({ fetchImpl: fn })
  const created = await login.qrCreate()
  assert.equal(created.qrsig, 'QRSIG1')
  assert.match(created.cookies, /pt_login_sig=LS1/)
  assert.equal(created.loginSig, 'LS1')
  assert.match(created.cookies, /qrsig=QRSIG1/)
  assert.equal(created.matrix.size, 33)
  assert.ok(created.png.startsWith('data:image/png;base64,'))
  assert.equal((await login.qrPoll(created)).code, 801)
  assert.equal((await login.qrPoll(created)).code, 802)
  const done = await login.qrPoll(created)
  assert.equal(done.code, 803)
  assert.equal(done.cookie, 'qqmusic_key=QK1; qm_keyst=QK1; uin=o0123456; qqmusic_uin=o0123456')
  assert.doesNotMatch(done.cookie, /p_skey|pt_login_sig|qrsig/, 'QQ 登录中间 cookie 不进入音乐登录态')

  // 换票失败 → 502；风控返回码 → 804
  const fn2 = mockFetch(async (call) => {
    if (String(call.url.href || call.url).startsWith('https://xui.ptlogin2.qq.com/ssl/ptqrshow?')) return new Response(QQ_QR_PNG, { headers: [['set-cookie', 'qrsig=Q2; Path=/']] })
    if (String(call.url.href || call.url).startsWith('https://xui.ptlogin2.qq.com/ssl/ptqrlogin?')) {
      fn2.round = (fn2.round || 0) + 1
      return fn2.round === 1
        ? new Response("ptuiCB('317','0','','0','请用手机QQ扫码登录', '')")
        : new Response("ptuiCB('0','0','https://ssl.ptlogin2.qq.com/check_sig?pttype=1&uin=1','0','登录成功！', '')")
    }
    if (String(call.url.href || call.url).startsWith('https://ssl.ptlogin2.qq.com/check_sig?')) return new Response(null, { status: 302, headers: { location: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&code=C2&state=state' } })
    if (String(call.url.href || call.url) === 'https://u.y.qq.com/cgi-bin/musicu.fcg') return jsonRes({ code: 0, req: { code: 1001, msg: '登录态无效' } })
    return new Response('<html></html>')
  })
  const login2 = createQQLogin({ fetchImpl: fn2 })
  const created2 = await login2.qrCreate()
  assert.equal((await login2.qrPoll(created2)).code, 804)
  await assert.rejects(login2.qrPoll(created2), (err) => err.status === 502 && /换票失败（code 0\/1001/.test(err.message))
})

const tmp = await mkdtemp(join(tmpdir(), 'dshm-likedsync-'))
try {
  const dataDir = join(tmp, 'data')
  await writeFile(join(tmp, 'x'), '')
  const storage = createStorage({ dataDir })
  const track = { id: 'a'.repeat(16), artist: '周杰伦', title: '晴天' }
  /* 本地入库曲目的歌手分隔写法与网易云导入条目不同（「 / 」vs「、」）→ 应按宽松 key 对上 */
  const track2 = { id: 'b'.repeat(16), artist: '周杰伦 / 费玉清', title: '千里之外' }
  const likes = createLikes({ storage, library: fakeLibrary([track, track2]), download: null, logger: null, history: null })
  await storage.ready
  await storage.writeJson(join(dataDir, 'likes.json'), {
    v: 2,
    items: { '周杰伦::晴天': { key: '周杰伦::晴天', artist: '周杰伦', title: '晴天', album: null, durationMs: null, likedAt: 1 } },
    dislikes: { '周杰伦::七里香': { key: '周杰伦::七里香', artist: '周杰伦', title: '七里香', dislikedAt: 2 } },
  })
  await test('importItems：精确/宽松去重、👎 跳过、多平台来源合并、只标记不下载', async () => {
    const first = await likes.importItems('netease', [
      { platformId: '1', artist: '周杰伦', title: '晴天' },
      { platformId: '2', artist: '周杰伦、费玉清', title: '千里之外', album: '十一月的萧邦', durationMs: 354000, likedAt: 1700000000000 },
      { platformId: '3', artist: '周杰伦', title: '七里香' },
      { platformId: '4', artist: '林俊杰', title: '江南' },
      { platformId: '5', artist: '', title: '无歌手' },
      { platformId: '6', artist: '林俊杰', title: '' },
    ])
    assert.deepEqual(first, { source: 'netease', added: 2, existed: 1, skippedDisliked: 1 })
    const second = await likes.importItems('qq', [{ platformId: 'q1', artist: '周杰伦/费玉清', title: '千里之外' }])
    assert.deepEqual(second, { source: 'qq', added: 0, existed: 1, skippedDisliked: 0 })
    const saved = JSON.parse(await readFile(join(dataDir, 'likes.json'), 'utf8'))
    assert.equal(saved.v, 2)
    assert.equal(Object.keys(saved.items).length, 3)
    assert.deepEqual(saved.items['周杰伦::晴天'].sources, { netease: { id: '1', likedAt: null } })
    const far = saved.items['周杰伦、费玉清::千里之外']
    assert.equal(far.likedAt, 1700000000000)
    assert.equal(far.album, '十一月的萧邦')
    assert.deepEqual(Object.keys(far.sources).sort(), ['netease', 'qq'])
    assert.deepEqual(far.sources.qq, { id: 'q1', likedAt: null })
    assert.ok(saved.items['林俊杰::江南'].likedAt > 0)
    assert.deepEqual(saved.dislikes['周杰伦::七里香'].key, '周杰伦::七里香')
    const list = await likes.list()
    assert.equal(list.total, 3)
    assert.equal(list.items.find((i) => i.key === '周杰伦::晴天').inLibrary, true)
    const farItem = list.items.find((i) => i.key === '周杰伦、费玉清::千里之外')
    assert.equal(farItem.inLibrary, true, '导入条目按宽松 key 对上本地曲目（分隔符差异）')
    assert.equal(farItem.trackId, 'b'.repeat(16))
    assert.equal(list.items.find((i) => i.key === '林俊杰::江南').inLibrary, false)
  })

  /* ================= 6. liked-sync 编排 ================= */
  const accounts = createAccounts({ storage, logger: null })
  let neteaseRound = 0
  let release = null
  const T = (id, artist, title) => ({ platformId: id, artist, title, album: null, durationMs: null, likedAt: null })
  const fakeNetease = {
    qrKey: async () => ({ key: 'K9', url: 'https://music.163.com/login?codekey=K9' }),
    qrPoll: async (key) => (key === 'K9' ? { code: 803, message: '授权登录成功', cookie: 'MUSIC_U=SECRET_N; __csrf=c' } : { code: 801, message: '等待扫码' }),
    account: async () => ({ uid: '42', nickname: '小明', avatarUrl: null }),
    likedTracks: async (cookie, uid) => {
      assert.equal(cookie, 'MUSIC_U=SECRET_N; __csrf=c')
      assert.equal(uid, '42')
      if (release) await release
      neteaseRound++
      return {
        playlist: { id: 9, name: '我喜欢的音乐', trackCount: 3, trackIds: [] },
        tracks: neteaseRound === 1 ? [T('a', '周杰伦', '晴天'), T('b', '林俊杰', '江南'), T('c', '陈奕迅', '十年')] : [T('b', '林俊杰', '江南'), T('c', '陈奕迅', '十年'), T('d', '王菲', '红豆'), T('3', '周杰伦', '七里香')],
        unavailable: 1,
      }
    },
  }
  const fakeQQ = {
    probe: async (cookie) => {
      if (!/qm_keyst=/.test(cookie)) { const e = new Error('Cookie 中缺少 qm_keyst'); e.status = 400; throw e }
      return { uin: '123456', nickname: '阿强', likedDir: { tid: '777', name: '我喜欢', songCount: 1 }, cookie: 'uin=o123456; qm_keyst=SECRET_Q' }
    },
    likedTracks: async (cookie) => {
      assert.match(cookie, /SECRET_Q/)
      return { dir: { tid: '777', name: '我喜欢', songCount: 1 }, tracks: [T('q1', '周杰伦', '晴天')] }
    },
  }
  let qqQrPolls = 0
  const fakeQQLogin = {
    qrCreate: async () => ({ qrsig: 'QRSIG_X', cookies: 'pt_login_sig=LS9; qrsig=QRSIG_X', matrix: { size: 21, modules: new Array(441).fill(0) }, png: 'data:image/png;base64,AAAA' }),
    qrPoll: async (session) => {
      assert.equal(session.qrsig, 'QRSIG_X')
      qqQrPolls++
      return qqQrPolls === 1 ? { code: 801, message: '二维码未失效' } : { code: 803, message: '登录成功', cookie: 'qm_keyst=SECRET_QR; uin=o123456' }
    },
  }
  const likedSync = createLikedSync({ likes, accounts, storage, logger: null, netease: fakeNetease, qqmusic: fakeQQ, qqlogin: fakeQQLogin })

  await test('liked-sync：未登录同步 → 401；扫码 → 登录；状态脱敏', async () => {
    let st = await likedSync.status()
    assert.equal(st.enabled, true)
    assert.equal(st.providers.netease.connected, false)
    assert.equal(st.providers.qq.label, 'QQ 音乐')
    await expectStatus(likedSync.sync('netease'), 401)
    await expectStatus(likedSync.sync('kugou'), 404)
    const qr = await likedSync.neteaseQrCreate()
    assert.equal(qr.key, 'K9')
    assert.equal(qr.url, 'https://music.163.com/login?codekey=K9')
    await expectStatus(likedSync.neteaseQrPoll('UNKNOWN'), 404)
    const polled = await likedSync.neteaseQrPoll('K9')
    assert.equal(polled.code, 803)
    assert.deepEqual(polled.account, { uid: '42', nickname: '小明' })
    st = await likedSync.status()
    assert.equal(st.providers.netease.connected, true)
    assert.equal(st.providers.netease.account.nickname, '小明')
    assert.doesNotMatch(JSON.stringify(st), /SECRET|MUSIC_U|qm_keyst/)
  })
  await test('liked-sync：accounts.json 权限 0600、含 cookie；summary 脱敏', async () => {
    const file = join(dataDir, 'accounts.json')
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.netease.cookie, 'MUSIC_U=SECRET_N; __csrf=c')
    assert.equal(saved.netease.uid, '42')
    assert.ok(saved.netease.loginAt > 0)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    const summary = JSON.stringify(await accounts.summary())
    assert.doesNotMatch(summary, /SECRET/)
    assert.match(summary, /"nickname":"小明"/)
  })
  await test('liked-sync：首轮同步 → 全部新增；次轮 → 增量 + 云端移除报数（本地保留）+ 👎 跳过', async () => {
    // 前一节 importItems 已把 晴天 / 江南 标进喜欢 → 首轮只有「十年」是新增
    const r1 = await likedSync.sync('netease')
    assert.equal(r1.provider, 'netease')
    assert.equal(r1.total, 3)
    assert.equal(r1.added, 1)
    assert.equal(r1.existed, 2)
    assert.equal(JSON.parse(await readFile(join(dataDir, 'likes.json'), 'utf8')).items['林俊杰::江南'].sources.netease.id, 'b', '已在喜欢的曲只补来源 id')
    assert.equal(r1.removed, 0)
    assert.equal(r1.unavailable, 1)
    assert.equal(r1.playlistName, '我喜欢的音乐')
    assert.ok(r1.durationMs >= 0)
    const r2 = await likedSync.sync('netease')
    assert.equal(r2.total, 4)
    assert.equal(r2.added, 1)
    assert.equal(r2.existed, 2)
    assert.equal(r2.skippedDisliked, 1)
    assert.equal(r2.removed, 1)
    assert.deepEqual(r2.removedItems, [{ title: '晴天', artist: '周杰伦' }])
    const saved = JSON.parse(await readFile(join(dataDir, 'likes.json'), 'utf8'))
    assert.ok(saved.items['周杰伦::晴天'], '云端移除的曲本地标记保留')
    assert.equal(saved.dislikes['周杰伦::七里香'] !== undefined, true, '本地 👎 不被平台喜欢覆盖')
    assert.equal(saved.items['周杰伦::七里香'], undefined)
    const st = await likedSync.status()
    assert.equal(st.providers.netease.lastResult.removed, 1)
    assert.equal(st.providers.netease.knownCount, 4)
    const state = JSON.parse(await readFile(join(dataDir, 'liked-sync.json'), 'utf8'))
    assert.deepEqual(state.netease.ids, ['b', 'c', 'd', '3'])
    assert.equal(state.netease.known.d.title, '红豆')
    assert.equal(state.netease.known.a, undefined)
  })
  await test('liked-sync：并发同步 → 409', async () => {
    let open
    release = new Promise((r) => { open = r })
    const first = likedSync.sync('netease')
    await expectStatus(likedSync.sync('netease'), 409)
    assert.equal((await likedSync.status()).providers.netease.busy, true)
    open()
    await first
    release = null
    assert.equal((await likedSync.status()).providers.netease.busy, false)
  })
  await test('liked-sync：QQ 粘贴 Cookie（空/非法 → 400）→ 登录 → 同步合并来源 → 刷新 → 断开清状态', async () => {
    await expectStatus(likedSync.qqConnect({}), 400)
    await expectStatus(likedSync.qqConnect({ cookie: 'foo=bar' }), 400)
    const connected = await likedSync.qqConnect({ cookie: 'pgv=1; uin=o123456; qm_keyst=SECRET_Q' })
    assert.deepEqual(connected.account, { uid: '123456', nickname: '阿强' })
    assert.deepEqual(connected.likedDir, { tid: '777', name: '我喜欢', songCount: 1 })
    const r = await likedSync.sync('qq')
    assert.equal(r.existed, 1)
    assert.equal(r.added, 0)
    const saved = JSON.parse(await readFile(join(dataDir, 'likes.json'), 'utf8'))
    assert.deepEqual(Object.keys(saved.items['周杰伦::晴天'].sources).sort(), ['netease', 'qq'])
    const refreshed = await likedSync.refresh('qq')
    assert.equal(refreshed.account.nickname, '阿强')
    await likedSync.refresh('netease')
    const accountsSaved = JSON.parse(await readFile(join(dataDir, 'accounts.json'), 'utf8'))
    assert.equal(accountsSaved.netease.cookie, 'MUSIC_U=SECRET_N; __csrf=c', '刷新登录态保留原 cookie')
    await likedSync.disconnect('qq')
    const st = await likedSync.status()
    assert.equal(st.providers.qq.connected, false)
    assert.equal(st.providers.qq.lastSyncAt, null)
    assert.equal(st.providers.netease.connected, true, '断开 QQ 不影响网易云')
    assert.equal(JSON.parse(await readFile(join(dataDir, 'accounts.json'), 'utf8')).qq, undefined)
  })

  await test('liked-sync：QQ 扫码（未知 key → 404）→ 801 等待 → 803 登录落盘；qrsig 不出内存；未启用 → 503', async () => {
    const qr = await likedSync.qqQrCreate()
    assert.equal(typeof qr.key, 'string')
    assert.equal(qr.matrix.size, 21)
    assert.ok(qr.png.startsWith('data:image/png;base64,'))
    assert.doesNotMatch(JSON.stringify(qr), /QRSIG|pt_login_sig/)
    await expectStatus(likedSync.qqQrPoll('nope'), 404)
    const waiting = await likedSync.qqQrPoll(qr.key)
    assert.equal(waiting.code, 801)
    const done = await likedSync.qqQrPoll(qr.key)
    assert.equal(done.code, 803)
    assert.deepEqual(done.account, { uid: '123456', nickname: '阿强' })
    const saved = JSON.parse(await readFile(join(dataDir, 'accounts.json'), 'utf8'))
    assert.equal(saved.qq.uid, '123456')
    assert.equal(saved.qq.cookie, 'uin=o123456; qm_keyst=SECRET_Q', '以 probe 归一化后的 cookie 落盘')
    assert.equal((await likedSync.status()).providers.qq.connected, true)
    await expectStatus(likedSync.qqQrPoll(qr.key), 404, '803 后会话即销毁')
    const noLogin = createLikedSync({ likes, accounts, storage, logger: null, netease: fakeNetease, qqmusic: fakeQQ, qqlogin: null })
    await expectStatus(noLogin.qqQrCreate(), 503)
    noLogin.dispose()
  })

  /* ================= 7. 路由 ================= */
  await test('路由：status / 405 / 404 / 400 / 正常 200；likedSync=null 仅保留 status', async () => {
    const routes = []
    const webServer = { register: (r) => { routes.push(r); return () => {} } }
    registerLikedSyncRoutes(webServer, { likedSync, logger: null })
    const byPath = Object.fromEntries(routes.map((r) => [r.path, r]))
    assert.equal(routes.length, 1 + 5 + 6)
    let res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/status'].handler(fakeReq('GET', '/dsh-music/api/liked-sync/status'), res)
    assert.equal(res.status, 200)
    assert.equal(parse(res).providers.netease.connected, true)
    assert.equal(res.headers['Cache-Control'], 'no-store')
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/status'].handler(fakeReq('POST', '/dsh-music/api/liked-sync/status'), res)
    assert.equal(res.status, 405)
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/netease/qr/poll'].handler(fakeReq('GET', '/dsh-music/api/liked-sync/netease/qr/poll?key=nope'), res)
    assert.equal(res.status, 404)
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/qq/connect'].handler(fakeReq('POST', '/dsh-music/api/liked-sync/qq/connect', '{bad'), res)
    assert.equal(res.status, 400)
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/qq/connect'].handler(fakeReq('POST', '/dsh-music/api/liked-sync/qq/connect', '[1]'), res)
    assert.equal(res.status, 400)
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/qq/connect'].handler(fakeReq('POST', '/dsh-music/api/liked-sync/qq/connect', '{}'), res)
    assert.equal(res.status, 400)
    assert.match(parse(res).error, /粘贴/)
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/qq/connect'].handler(fakeReq('POST', '/x', JSON.stringify({ cookie: 'uin=o1; qm_keyst=K' })), res)
    assert.equal(res.status, 200)
    assert.equal(parse(res).account.uid, '123456')
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/qq/sync'].handler(fakeReq('POST', '/x'), res)
    assert.equal(res.status, 200)
    assert.equal(parse(res).provider, 'qq')
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/qq/disconnect'].handler(fakeReq('POST', '/x'), res)
    assert.equal(parse(res).ok, true)
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/qq/sync'].handler(fakeReq('POST', '/x'), res)
    assert.equal(res.status, 401)
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/netease/refresh'].handler(fakeReq('POST', '/x'), res)
    assert.equal(res.status, 200)
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/netease/qr'].handler(fakeReq('POST', '/x'), res)
    assert.equal(parse(res).key, 'K9')
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/qq/qr/poll'].handler(fakeReq('GET', '/x?key=nope'), res)
    assert.equal(res.status, 404)
    res = fakeRes()
    await byPath['/dsh-music/api/liked-sync/qq/qr'].handler(fakeReq('POST', '/x'), res)
    assert.equal(res.status, 200)
    assert.equal(parse(res).matrix.size, 21)
    assert.match(parse(res).png, /^data:image\/png;base64,/)
    assert.doesNotMatch(res.body, /QRSIG/)
    // 内部错误 → 500（不泄漏细节）
    const broken = createLikedSync({ likes, accounts, storage, logger: null, netease: { ...fakeNetease, account: async () => { throw new Error('boom') } }, qqmusic: fakeQQ })
    const routes2 = []
    registerLikedSyncRoutes({ register: (r) => { routes2.push(r); return () => {} } }, { likedSync: broken, logger: null })
    res = fakeRes()
    await routes2.find((r) => r.path === '/dsh-music/api/liked-sync/netease/qr').handler(fakeReq('POST', '/x'), res)
    assert.equal(parse(res).key, 'K9')
    res = fakeRes()
    await routes2.find((r) => r.path === '/dsh-music/api/liked-sync/netease/qr/poll').handler(fakeReq('GET', '/x?key=K9'), res)
    assert.equal(res.status, 500)
    assert.match(parse(res).error, /内部错误/)
    assert.doesNotMatch(res.body, /boom/)
    broken.dispose()
    // likedSync=null：仅 status，enabled:false
    const routes3 = []
    registerLikedSyncRoutes({ register: (r) => { routes3.push(r); return () => {} } }, { likedSync: null, logger: null })
    assert.equal(routes3.length, 1)
    res = fakeRes()
    await routes3[0].handler(fakeReq('GET', '/x'), res)
    assert.deepEqual(parse(res), { enabled: false, providers: {} })
    likedSync.dispose()
  })
} finally {
  await rm(tmp, { recursive: true, force: true })
}

/* ---------------- 结果 ---------------- */
let failed = 0
for (const [status, name, err] of results) {
  if (status === 'PASS') console.log(`PASS: ${name}`)
  else {
    failed++
    console.log(`FAIL: ${name}`)
    console.log(String(err && err.stack || err).split('\n').slice(0, 6).map((l) => '      ' + l).join('\n'))
  }
}
console.log(failed ? `\n${failed} 项失败 / ${results.length}` : `\n全部通过（${results.length} 项）`)
process.exit(failed ? 1 : 0)
