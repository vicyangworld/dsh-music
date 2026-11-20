/** 十一批3 聚合搜索测试：node scripts/v11-search-test.mjs
 * 覆盖：type=both 空查询零网络；路由 400/405；真实 MB 一次 both 查询返回
 * artists[{name,disambiguation}] 与 songs[{artist,title,album,verification}] 契约字段、
 * remote 合并、失败降级不抛异常。临时数据目录；MB 全局限速（2 次请求）。 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'
import { createSearch, registerSearchRoutes } from '../bundle/host/search.js'

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

const tmp = await mkdtemp(join(tmpdir(), 'dshm-v11search-'))
try {
  const storage = createStorage({ dataDir: tmp })
  const logger = { warn: () => {} }
  const library = createLibrary({ storage, config: {}, logger })
  await library.scan()
  const search = createSearch({ library, storage, logger })
  const [route] = routesOf((fakeWebServer) => registerSearchRoutes(fakeWebServer, { search, logger }))

  // ---- 离线：both 空查询 ----
  const empty = await search.search('', 'both')
  assert(empty.local.length === 0 && empty.artists.length === 0 && empty.songs.length === 0, 'both：空查询返回三组空数组')
  assert(empty.type === 'both' && empty.remoteError === null, 'both：空查询 type/remoteError 正常')

  // ---- 路由（零网络） ----
  const r405 = await call(route, { method: 'POST', url: '/dsh-music/api/library/search' })
  assert(r405.status === 405, '路由：POST → 405')
  const r400 = await call(route, { method: 'GET', url: '/dsh-music/api/library/search?q=x&type=bogus' })
  assert(r400.status === 400 && /song、artist 或 both/.test(r400.body.error), '路由：非法 type → 400 且提示含 both')
  const rEmpty = await call(route, { method: 'GET', url: '/dsh-music/api/library/search?q=&type=both' })
  assert(rEmpty.status === 200 && Array.isArray(rEmpty.body.artists) && Array.isArray(rEmpty.body.songs), '路由：both 空查询 → 200 且 artists/songs 为数组')
  assert(route.path === '/dsh-music/api/library/search' && route.kind === 'exact', '路由：路径与 kind 不变')

  // ---- 真实 MB：一次 both（歌手+录音并行，全局限速共 2 请求） ----
  const r = await search.search('陈奕迅', 'both')
  assert(r.type === 'both', 'both：type 标记')
  assert(Array.isArray(r.artists) && r.artists.length > 0, `both：artists 非空（${r.artists.length} 条）`)
  assert(r.artists.every((a) => typeof a.name === 'string' && 'disambiguation' in a), 'both：artists 契约字段 name/disambiguation 齐全')
  assert(Array.isArray(r.songs) && r.songs.length > 0, `both：songs 非空（${r.songs.length} 条）`)
  assert(r.songs.every((s) => typeof s.artist === 'string' && typeof s.title === 'string' && 'album' in s && s.verification && s.verification.source === 'MusicBrainz'), 'both：songs 契约字段 artist/title/album/verification 齐全')
  assert(r.songs.every((s) => s.verification && /^https:\/\/musicbrainz\.org\/recording\//.test(s.verification.url)), 'both：songs verification URL 指向 MB recording')
  assert(Array.isArray(r.remote) && r.remote.length === r.artists.length + r.songs.length, 'both：remote 为 artists+songs 合并（向后兼容）')
  const localKeys = new Set(r.local.map((x) => `${x.artist}::${x.title}`))
  assert(r.songs.every((s) => !localKeys.has(`${s.artist}::${s.title}`)), 'both：songs 与本地去重')
  if (r.remoteError) console.log(`NOTE: remoteError=${r.remoteError}`)
  else assert(r.remoteError === null, 'both：无 remoteError')

  // ---- 老口径不回归：song/artist 仍可用（零额外网络由去重逻辑保证本地命中时也仅 1 请求） ----
  const rSong = await search.search('光辉岁月', 'song')
  assert(Array.isArray(rSong.local) && Array.isArray(rSong.remote) && rSong.type === 'song' && !('artists' in rSong), 'song 口径：老响应形状不变（无 artists 字段）')
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
