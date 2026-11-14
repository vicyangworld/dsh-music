/** 八期④ 口味数据层测试：node scripts/v8-taste-test.mjs
 * 覆盖：喜欢/不喜欢互斥、likes.json v1→v2 迁移、不喜欢不下载不删文件、
 * 口味事件进历史（默认 read 过滤、includeTaste 返回）、stats 只算播放并输出
 * dislikeEvents/undislikeEvents、stats 路由合并 dislikes 摘要、dislike/dislikes/taste
 * 路由 200/400/404/405。全部临时目录，零网络、零真实 ~/Music。 */
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'
import { createLikes, likeKey, registerLikesRoutes } from '../bundle/host/likes.js'
import { createHistory, registerHistoryRoutes } from '../bundle/host/history.js'

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

const tmp = await mkdtemp(join(tmpdir(), 'dshm-v8taste-'))
try {
  const likedDir = join(tmp, 'liked')
  await mkdir(likedDir, { recursive: true })
  await writeFile(join(likedDir, 'Beyond - 光辉岁月.m4a'), Buffer.from('dummy'))
  const storage = createStorage({ dataDir: join(tmp, 'data') })
  const logger = { warn: () => {} }
  const library = createLibrary({ storage, config: { directories: [{ path: likedDir, source: 'spotify-liked' }] }, logger })
  await library.scan()
  const gloryId = library.snapshot().tracks[0].id
  const history = createHistory({ storage, library, logger })
  const downloads = []
  const download = {
    core: { checkVerification: async () => null },
    isRunning: () => false,
    start: (items) => { downloads.push(items); return { runId: 'fake', total: 1 } },
    archiveVerification: async () => {},
  }
  const likes = createLikes({ storage, library, download, logger, history })

  // ---- 曲库内曲：喜欢 → 不喜欢（互斥）→ 再喜欢 ----
  const r1 = await likes.set({ trackId: gloryId, liked: true })
  assert(r1.liked === true && r1.disliked === false && r1.trackId === gloryId, '喜欢曲库内曲：liked=true 且 disliked 清零')
  assert(downloads.length === 0, '曲库内曲喜欢不触发下载')

  const r2 = await likes.setDislike({ trackId: gloryId, disliked: true })
  assert(r2.disliked === true && r2.liked === false && r2.clearedLike === true, '不喜欢清掉喜欢标记（互斥）')
  assert(downloads.length === 0, '不喜欢绝不触发下载')
  const t1 = await likes.tasteOf({ trackId: gloryId })
  assert(t1.liked === false && t1.disliked === true && t1.inLibrary === true, 'taste 状态 liked=false disliked=true')
  const st = await stat(join(likedDir, 'Beyond - 光辉岁月.m4a'))
  assert(st.size > 0, '不喜欢绝不删本地文件（红线）')

  // 文件已是 v2 且两表互斥
  const saved = JSON.parse(await readFile(join(storage.dataDir, 'likes.json'), 'utf8'))
  assert(saved.v === 2 && Object.keys(saved.items).length === 0 && Object.keys(saved.dislikes).length === 1, 'likes.json 升 v2 且喜欢表已清空')

  const r3 = await likes.set({ trackId: gloryId, liked: true })
  assert(r3.liked === true && r3.disliked === false, '再喜欢清掉不喜欢（反向互斥）')
  const saved2 = JSON.parse(await readFile(join(storage.dataDir, 'likes.json'), 'utf8'))
  assert(Object.keys(saved2.items).length === 1 && Object.keys(saved2.dislikes).length === 0, 'v2 文件喜欢表 1 条、不喜欢表 0 条')

  // ---- 非曲库曲：不喜欢只记信号，绝不下载 ----
  const r4 = await likes.setDislike({ artist: '不存在歌手', title: '不存在歌', disliked: true })
  assert(r4.disliked === true && r4.inLibrary === false, '非曲库曲不喜欢成功（inLibrary=false）')
  assert(downloads.length === 0, '非曲库曲不喜欢不调用下载')
  const dislikes = await likes.listDislikes()
  assert(dislikes.total === 1 && dislikes.items[0].title === '不存在歌' && dislikes.items[0].inLibrary === false, '不喜欢列表返回条目且实时解析曲库状态')

  // ---- 口味事件进历史：默认 read 过滤，includeTaste 返回 ----
  const evDefault = await history.read({ limit: 100 })
  assert(evDefault.events.every((e) => (e.type ?? 'play') === 'play') && evDefault.total === 0, '历史 read 默认过滤口味事件（reco 不受污染）')
  const evAll = await history.read({ limit: 100, includeTaste: true })
  assert(evAll.total === 2, `includeTaste 返回全部事件（含 2 条口味，实际 ${evAll.total}）`)
  const tasteEvents = evAll.events.filter((e) => e.type !== 'play')
  assert(tasteEvents.length === 2 && tasteEvents.every((e) => typeof e.reason === 'string'), '口味事件带 type/reason')
  assert(tasteEvents.some((e) => e.type === 'dislike' && e.trackId === gloryId), '曲库内曲不喜欢事件带 trackId')
  assert(tasteEvents.some((e) => e.type === 'dislike' && e.trackId === null && e.title === '不存在歌'), '非曲库曲不喜欢事件 trackId=null')

  // ---- 不喜欢后取消 → undislike 事件；喜欢标记独立 ----
  const r5 = await likes.setDislike({ trackId: gloryId, disliked: true })
  assert(r5.disliked === true, '再次不喜欢成功')
  const r5b = await likes.setDislike({ trackId: gloryId, disliked: false })
  assert(r5b.disliked === false && r5b.liked === false, '取消不喜欢后 liked 仍为 false（互斥语义）')
  const r5c = await likes.set({ trackId: gloryId, liked: true })
  assert(r5c.liked === true && r5c.disliked === false, '取消不喜欢后可重新喜欢')
  const after = await history.read({ limit: 100, includeTaste: true })
  assert(after.events.filter((e) => e.type === 'undislike').length === 1, '取消不喜欢写入 undislike 事件')
  assert((await likes.listDislikes()).total === 1, '取消后不喜欢列表只剩 1 条')

  // ---- stats：只算播放；taste 计数分离 ----
  await history.append({ trackId: gloryId, completion: 1 })
  const s = await history.stats()
  assert(s.totalPlays === 1 && s.uniqueSongs === 1, 'stats 只统计播放事件')
  assert(s.dislikeEvents === 3 && s.undislikeEvents === 1, `stats 口味计数 dislike=3 undislike=1（实际 ${s.dislikeEvents}/${s.undislikeEvents}）`)
  assert(s.topSongs.length === 1 && s.topSongs[0].trackId === gloryId, 'topSongs 不受口味事件影响')

  // ---- 路由 ----
  const likeRoutes = routesOf((ws) => registerLikesRoutes(ws, { likes, logger }))
  const historyRoutes = routesOf((ws) => registerHistoryRoutes(ws, { history, likes, logger }))
  const dislikeRoute = likeRoutes.find((r) => r.path === '/dsh-music/api/library/dislike')
  const dislikesRoute = likeRoutes.find((r) => r.path === '/dsh-music/api/library/dislikes')
  const tasteRoute = likeRoutes.find((r) => r.path === '/dsh-music/api/library/taste')
  assert(Boolean(dislikeRoute && dislikesRoute && tasteRoute), 'dislike/dislikes/taste 三条路由已注册（exact）')

  const rd = await call(dislikeRoute, { method: 'POST' }, { trackId: gloryId, disliked: true })
  assert(rd.status === 200 && rd.body.disliked === true, 'POST /dislike 200 且 disliked=true')
  const rd405 = await call(dislikeRoute, { method: 'GET' })
  assert(rd405.status === 405, 'GET /dislike → 405')
  const rdBad = await call(dislikeRoute, { method: 'POST' }, { artist: '', title: '' })
  assert(rdBad.status === 400 && /缺少歌手名/.test(rdBad.body.error), '缺 artist/title → 400 中文')
  const rd404 = await call(dislikeRoute, { method: 'POST' }, { trackId: 'ffffffffffffffff', disliked: true })
  assert(rd404.status === 404, '未知 trackId → 404')

  const dl = await call(dislikesRoute, { method: 'GET' })
  assert(dl.status === 200 && Array.isArray(dl.body.items) && dl.body.total === 2, 'GET /dislikes 200 返回 items/total（2 条）')
  const tasteResp = await call(tasteRoute, { method: 'GET' }, undefined)
  assert(tasteResp.status === 400, 'GET /taste 缺参数 → 400')
  const tasteResp2 = await call(tasteRoute, { method: 'GET', url: `/dsh-music/api/library/taste?trackId=${gloryId}` })
  assert(tasteResp2.status === 200 && tasteResp2.body.liked === false && tasteResp2.body.disliked === true, 'GET /taste 返回 liked=false disliked=true')
  const likeRoute = likeRoutes.find((r) => r.path === '/dsh-music/api/library/like')
  const lr = await call(likeRoute, { method: 'POST' }, { trackId: gloryId, liked: true })
  assert(lr.status === 200 && lr.body.disliked === false, 'like 路由响应含 disliked:false')

  const statsRoute = historyRoutes.find((r) => r.path === '/dsh-music/api/history/stats')
  const sr = await call(statsRoute, { method: 'GET' })
  assert(sr.status === 200 && sr.body.dislikes && sr.body.dislikes.count === 1, 'stats 路由合并 dislikes 摘要（count=1）')
  assert(sr.body.dislikes.events === 4 && sr.body.dislikes.songs.length === 1, 'stats.dislikes 含 events 计数与 songs 摘要')
  const histRoute = historyRoutes.find((r) => r.path === '/dsh-music/api/history')
  const hr = await call(histRoute, { method: 'GET', url: '/dsh-music/api/history?limit=50&includeTaste=1' })
  assert(hr.status === 200 && hr.body.events.some((e) => e.type === 'dislike'), 'GET /history?includeTaste=1 返回口味事件')

  // ---- v1 迁移 ----
  const v1Dir = join(tmp, 'v1')
  const v1Storage = createStorage({ dataDir: v1Dir })
  const key = likeKey('老歌手', '老歌')
  await mkdir(v1Dir, { recursive: true })
  await writeFile(join(v1Dir, 'likes.json'), JSON.stringify({ v: 1, items: { [key]: { key, artist: '老歌手', title: '老歌', likedAt: 1 } } }))
  const likesV1 = createLikes({ storage: v1Storage, library, download, logger })
  const v1list = await likesV1.list()
  assert(v1list.total === 1 && v1list.items[0].title === '老歌', 'v1 likes.json 读取兼容')
  await likesV1.setDislike({ artist: '老歌手', title: '老歌', disliked: true })
  const mig = JSON.parse(await readFile(join(v1Dir, 'likes.json'), 'utf8'))
  assert(mig.v === 2 && Object.keys(mig.items).length === 0 && Object.keys(mig.dislikes).length === 1, 'v1 读取后写入自动迁移 v2')
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures === 0 ? '全部通过' : `${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
