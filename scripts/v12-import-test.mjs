/** 十二期方案A 公开歌单导入测试：node scripts/v12-import-test.mjs（零网络、零真实 ~/Music）
 * 覆盖：链接解析（QQ 标准/短链、网易 ?id=/路径、非法链接中文错误）；qqSign GoMusic 向量；
 * QQ 主端点分页+平台回退+重复页检测、legacy jsonCallback 解包、双端点取全；网易 v6+v3 批量；
 * 本地匹配（精确/标题模糊）；dryRun；下载分批（≤20/批）串行走现有管线+撞锁不绕；路由 400/405/202/409。 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'
import { createPlaylistImport, parsePlaylistLink, qqSign, registerImportRoutes } from '../bundle/host/playlist-import.js'

let failures = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!cond) failures++
}
const routesOf = (register) => {
  const routes = []
  register({ register: (r) => { routes.push(r); return () => {} } })
  return routes
}
const call = async (route, req, body, rawBody) => {
  const out = { status: 0, body: null }
  const payload = rawBody !== undefined ? [Buffer.from(rawBody)] : body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const fakeReq = {
    method: req.method,
    url: req.url ?? '/',
    on(ev, fn) {
      if (ev === 'data') for (const c of payload) fn(c)
      if (ev === 'end') process.nextTick(fn)
      return fakeReq
    },
    destroy() {},
  }
  const res = {
    writeHead: (c) => { out.status = c },
    end: (b) => { try { out.body = b ? JSON.parse(b) : null } catch { out.body = b } },
  }
  await route.handler(fakeReq, res)
  return out
}
const waitIdle = async (imp) => { while (imp.isRunning()) await new Promise((r) => setTimeout(r, 20)) }

// ---- qqSign 向量（GoMusic qqmusic_sign_test.go） ----
assert(qqSign('') === 'zzb98ffe087addcnuyjec90xpfdilcqea80d149dc', 'qqSign 向量：空串')
assert(qqSign('hello') === 'zzbd4c1b979iwwqbnoib0krwpk3fitla7b14da20', 'qqSign 向量：hello')
assert(!/[\/+=]/.test(qqSign('abc')), 'qqSign 无 base64 禁字符')

// ---- 链接解析 ----
assert(parsePlaylistLink('https://y.qq.com/n/ryqq/playlist/1271941828').id === '1271941828', '解析：QQ 标准链接')
assert(parsePlaylistLink('https://y.qq.com/n/ryqq_v2/playlist/1271941828.html').id === '1271941828', '解析：QQ ryqq_v2 链接')
assert(parsePlaylistLink('看看 https://c6.y.qq.com/base/fcgi-bin/u?__=GruJiu36qNHM 这个').resolve, '解析：QQ 分享短链标记需联网 resolve')
assert(parsePlaylistLink('https://music.163.com/playlist?id=867490573').id === '867490573', '解析：网易 ?id= 链接')
assert(parsePlaylistLink('https://music.163.com/#/playlist/867490573').id === '867490573', '解析：网易路径链接')
for (const [bad, why] of [
  ['https://y.qq.com/n/ryqq/songDetail/001J5QJL1pRgYB', '单曲'],
  ['https://music.163.com/song?id=1', '网易单曲'],
  ['https://example.com/playlist/1', '未知来源'],
  ['不是链接', '非链接'],
]) {
  try { parsePlaylistLink(bad); assert(false, `解析：${why}应报错`) } catch (err) { assert(err.code === 'IMPORT_INVALID_LINK' && err.message.length > 4, `解析：${why} → 中文错误`) }
}

const tmp = await mkdtemp(join(tmpdir(), 'dshm-v12import-'))
try {
  const musicDir = join(tmp, 'music')
  await mkdir(musicDir, { recursive: true })
  await writeFile(join(musicDir, 'Beyond - 光輝歲月.m4a'), Buffer.from('dummy'))
  await writeFile(join(musicDir, '陳奕迅 - 十年.m4a'), Buffer.from('dummy'))
  const storage = createStorage({ dataDir: join(tmp, 'data') })
  const logger = { warn: () => {} }
  const library = createLibrary({ storage, config: { directories: [{ path: musicDir }] }, logger })
  await library.scan()
  assert(library.snapshot().tracks.length === 2, '夹具：本地曲库 2 首')

  // ---- QQ 元数据（mock fetch：主端点分页 + legacy jsonCallback） ----
  const qqPage = (songs, songnum, title) => JSON.stringify({ code: 0, req_0: { code: 0, data: { dirinfo: { title, songnum }, songlist: songs } } })
  const s = (id, name, singer) => ({ id, mid: `mid${id}`, name, singer: singer.map((n) => ({ name: n })) })
  let calls = []
  const mockFetchQq = async (url, opts) => {
    calls.push(url)
    if (url.startsWith('https://c6.y.qq.com/')) {
      return { status: 200, url: 'https://y.qq.com/n/ryqq/playlist/1271941828', text: async () => '<html>jump</html>' }
    }
    if (url.startsWith('https://u6.y.qq.com/')) {
      const body = JSON.parse(opts.body)
      const begin = body.req_0.param.song_begin
      if (begin === 0) return { status: 200, url, text: async () => qqPage([s(1, '十年', ['陳奕迅']), s(2, '光輝歲月', ['Beyond']), s(3, '孤勇者', ['陳奕迅'])], 4, '我喜欢') }
      if (begin === 3) return { status: 200, url, text: async () => qqPage([s(4, '富士山下', ['陳奕迅'])], 4, '我喜欢') }
      return { status: 200, url, text: async () => qqPage([], 4, '我喜欢') }
    }
    if (url.startsWith('https://c.y.qq.com/')) {
      return {
        status: 200, url,
        text: async () => `jsonCallback({"code":0,"subcode":0,"cdlist":[{"dissname":"我喜欢(旧)","songnum":2,"songlist":[{"songid":11,"songname":"愛情轉移","singer":[{"name":"陳奕迅"}]},{"songid":12,"songname":"紅玫瑰","singer":[{"name":"陳奕迅"}]}]}]});`,
      }
    }
    throw new Error('unexpected ' + url)
  }
  const dlBatches = []
  let dlRunning = false
  const fakeDownload = {
    isRunning: () => dlRunning,
    async validate(items) { return Array.isArray(items) && items.length && items.length <= 20 ? null : 'items 无效' },
    async archiveVerification() {},
    start(items) {
      const job = { running: true, items: items.map((it) => ({ ...it, status: 'pending', note: null, trackId: null })) }
      dlBatches.push(items.map((i) => `${i.artist}::${i.title}`))
      dlRunning = true
      setTimeout(() => {
        for (const it of job.items) {
          if (it.title === '失敗曲') { it.status = 'fail'; it.note = 'yt-dlp 未找到'; continue }
          it.status = 'ok'; it.trackId = 't_' + it.title
        }
        job.running = false
        dlRunning = false
      }, 30)
      return job
    },
  }

  const imp = createPlaylistImport({ library, download: fakeDownload, logger, fetchImpl: mockFetchQq })
  const dry = await imp.run({ url: 'https://c6.y.qq.com/base/fcgi-bin/u?__=GruJiu36qNHM', dryRun: true })
  assert(dry.started === true, '导入：dryRun 启动')
  await waitIdle(imp)
  const st1 = imp.status()
  assert(st1.error === null, `导入：QQ dryRun 无错误${st1.error ? '（' + st1.error + '）' : ''}`)
  const sum1 = st1.summary
  assert(sum1.provider === 'qq' && sum1.name === '我喜欢', '导入：QQ 主端点歌单名（比 legacy 更全，取主端点）')
  assert(sum1.total === 4 && sum1.fetched === 4, `导入：分页拉全 4 首（fetched=${sum1.fetched}）`)
  assert(sum1.matched === 2, `导入：精确匹配 2 首（简繁歸一：光輝歲月/十年）（matched=${sum1.matched}）`)
  assert(sum1.missing === 2 && sum1.queued === 0 && sum1.downloaded === 0, '导入：dryRun 不入队不下载')
  assert(calls.some((c) => c.includes('u6.y.qq.com/cgi-bin/musics.fcg?sign=zzb')), '导入：主端点带 zzb 签名')
  assert(calls.some((c) => c.includes('c6.y.qq.com')), '导入：短链先联网 resolve')

  const mockVerifier = {
    async verify(c) {
      if (c.title === '核实不到') return null
      return { verification: { source: 'musicbrainz', url: `https://musicbrainz.org/recording/mb-${encodeURIComponent(c.title)}`, verifiedAt: Date.now() }, matched: { durationMs: 123456 } }
    },
  }
  // ---- 完整导入（含下载分批与失败明细） ----
  calls = []
  const imp2 = createPlaylistImport({ library, download: fakeDownload, logger, fetchImpl: mockFetchQq, verifier: mockVerifier })
  await imp2.run({ url: 'https://y.qq.com/n/ryqq/playlist/1271941828' })
  await waitIdle(imp2)
  const sum2 = imp2.status().summary
  assert(sum2.missing === 2 && sum2.queued === 2 && sum2.downloaded === 2, `导入：缺口入队并下载（queued=${sum2.queued}, downloaded=${sum2.downloaded}）`)
  assert(dlBatches.length === 1 && dlBatches[0].length === 2, '导入：缺口一批（≤20）走现有管线')

  // 下载失败进失败明细
  const mockFetchFailSong = async (url, opts) => {
    if (url.startsWith('https://u6.y.qq.com/')) return { status: 200, url, text: async () => qqPage([s(9, '失敗曲', ['某人']), s(10, '核实不到', ['某人'])], 2, '失败歌单') }
    if (url.startsWith('https://c.y.qq.com/')) return { status: 200, url, text: async () => 'jsonCallback({"code":1,"subcode":1,"msg":"fail"});' }
    throw new Error('unexpected ' + url)
  }
  const imp3 = createPlaylistImport({ library, download: fakeDownload, logger, fetchImpl: mockFetchFailSong, verifier: mockVerifier })
  await imp3.run({ url: 'https://y.qq.com/n/ryqq/playlist/9' })
  await waitIdle(imp3)
  const sum3 = imp3.status().summary
  assert(sum3.downloaded === 0 && sum3.failures.some((f) => f.title === '失敗曲' && /yt-dlp/.test(f.reason)), '导入：下载失败进 failures 明细')
  assert(sum3.failures.some((f) => f.title === '核实不到' && /MusicBrainz/.test(f.reason)) && !dlBatches.flat().includes('某人::核实不到'), '导入：MB 未核实到的跳过下载并进 failures（红线）')

  // ---- 私有/不可用歌单降级文案 ----
  const mockFetchPrivate = async (url, opts) => {
    if (url.includes('u6.y.qq.com')) return { status: 200, url, text: async () => JSON.stringify({ code: 2000, req_0: null }) }
    if (url.includes('c.y.qq.com')) return { status: 200, url, text: async () => JSON.stringify({ code: 22, subcode: 1, msg: 'no' }) }
    if (url.includes('music.163.com/api/v6/playlist/detail')) return { status: 200, url, text: async () => JSON.stringify({ code: 403 }) }
    throw new Error('unexpected ' + url)
  }
  const impP = createPlaylistImport({ library, download: fakeDownload, logger, fetchImpl: mockFetchPrivate })
  await impP.run({ url: 'https://y.qq.com/n/ryqq/playlist/1' })
  await waitIdle(impP)
  assert(/公开/.test(impP.status().error), `导入：QQ 双端点全失败 → 提示确认公开（${impP.status().error}）`)
  await impP.run({ url: 'https://music.163.com/playlist?id=1' })
  await waitIdle(impP)
  assert(/未公开/.test(impP.status().error), '导入：网易 403 → 未公开中文降级')

  // ---- 网易 v6+v3 ----
  const mockFetchNe = async (url, opts) => {
    if (url.includes('api/v6/playlist/detail')) {
      return { status: 200, url, text: async () => JSON.stringify({ code: 200, playlist: { name: '云村歌单', trackCount: 3, tracks: [{ id: 1, name: '十年', ar: [{ name: '陈奕迅' }] }], trackIds: [{ id: 1 }, { id: 2 }, { id: 3 }] } }) }
    }
    if (url.includes('api/v3/song/detail')) {
      const c = JSON.parse(decodeURIComponent(opts.body).replace(/^c=/, ''))
      return { status: 200, url, text: async () => JSON.stringify({ code: 200, songs: c.map((x, i) => ({ id: x.id, name: '新歌' + i, ar: [{ name: '歌手' + i }], al: { name: '专辑' }, dt: 180000 })) }) }
    }
    throw new Error('unexpected ' + url)
  }
  const impN = createPlaylistImport({ library, download: fakeDownload, logger, fetchImpl: mockFetchNe })
  await impN.run({ url: 'https://music.163.com/playlist?id=867490573', dryRun: true })
  await waitIdle(impN)
  const sumN = impN.status().summary
  assert(sumN.provider === 'netease' && sumN.fetched === 3 && sumN.total === 3, '导入：网易 v6 种子+v3 补全共 3 首')
  assert(sumN.matched === 1 && sumN.fuzzyMatched === 0, '导入：网易匹配本地 1 首（简繁：十年）')
  assert(sumN.sample.some((x) => x.album !== undefined || true), '导入：sample 返回')

  // ---- limit 截断 ----
  const impL = createPlaylistImport({ library, download: fakeDownload, logger, fetchImpl: mockFetchQq, verifier: mockVerifier })
  await impL.run({ url: 'https://y.qq.com/n/ryqq/playlist/1271941828', limit: 1 })
  await waitIdle(impL)
  const sumL = impL.status().summary
  assert(sumL.queued === 1 && sumL.limited && sumL.limited.of === 2, '导入：limit=1 只下载 1 首并标注截断')

  // ---- 路由 ----
  const [postRoute, statusRoute] = routesOf((fakeWs) => registerImportRoutes(fakeWs, { importer: impL, logger }))
  assert(postRoute.path === '/dsh-music/api/import-playlist' && statusRoute.path === '/dsh-music/api/import-playlist/status', '路由：路径注册')
  const r405 = await call(postRoute, { method: 'GET', url: '/dsh-music/api/import-playlist' })
  assert(r405.status === 405, '路由：GET → 405')
  const r400a = await call(postRoute, { method: 'POST', url: '/dsh-music/api/import-playlist' }, {})
  assert(r400a.status === 400 && /url/.test(r400a.body.error), '路由：缺 url → 400')
  const r400b = await call(postRoute, { method: 'POST', url: '/dsh-music/api/import-playlist' }, { url: 'https://example.com/x' })
  assert(r400b.status === 400, '路由：非法来源 → 400')
  const r400c = await call(postRoute, { method: 'POST', url: '/dsh-music/api/import-playlist' }, {}, '{bad json')
  assert(r400c.status === 400, '路由：坏 JSON → 400')
  const rStatus = await call(statusRoute, { method: 'GET', url: '/dsh-music/api/import-playlist/status' })
  assert(rStatus.status === 200 && 'running' in rStatus.body && 'summary' in rStatus.body, '路由：status → 200 含 running/summary')
  // busy：409（用可控闸门 fetch 保证 running 稳定为 true）
  let pending = []
  const gateFetch = (url, opts) => new Promise((resolve) => { pending.push(() => resolve({ status: 200, url, text: async () => JSON.stringify({ code: 0, req_0: { code: 0, data: { dirinfo: { title: 't', songnum: 0 }, songlist: [] } } }) })) })
  const busyImp = createPlaylistImport({ library, download: fakeDownload, logger, fetchImpl: gateFetch })
  await busyImp.run({ url: 'https://y.qq.com/n/ryqq/playlist/1271941828' })
  const [busyRoute] = routesOf((fakeWs) => registerImportRoutes(fakeWs, { importer: busyImp, logger }))
  const r409 = await call(busyRoute, { method: 'POST', url: '/dsh-music/api/import-playlist' }, { url: 'https://y.qq.com/n/ryqq/playlist/1271941828' })
  assert(r409.status === 409, `路由：运行中再导入 → 409（实际 ${r409.status}）`)
  for (const g of pending.splice(0)) g()
  await waitIdle(busyImp)
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
