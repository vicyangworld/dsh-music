/** 五期批1 历史统计测试：node scripts/v5b1-test.mjs
 * 覆盖：聚合正确性（含逾期事件/坏行/跳过/平均完整度）、近7天窗口、空历史、
 * append 新字段 durationSeconds、路由 GET 200 / POST 405。临时目录。 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createHistory, registerHistoryRoutes } from '../bundle/host/history.js'

let failures = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!cond) failures++
}
const localDate = (offsetDays = 0) => {
  const d = new Date(Date.now() - offsetDays * 86400000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const tmp = await mkdtemp(join(tmpdir(), 'dshm-v5b1-'))
try {
  const storage = createStorage({ dataDir: tmp })
  const stubLibrary = {
    getRecord: (id) => {
      if (id === 'trackA') return { meta: { artist: '测试歌手', title: '测试歌曲', duration: 120 } }
      if (id === 'tB') return { meta: { artist: '另一歌手', title: '另一首歌', duration: 60 } }
      return undefined
    },
  }
  const history = createHistory({ storage, library: stubLibrary, logger: { warn: () => {} } })

  // ---- append 记录 durationSeconds ----
  const entry = await history.append({ trackId: 'trackA', completion: 1 })
  assert(entry.durationSeconds === 120, 'append 写入 durationSeconds（供统计）')

  // ---- 手工构造历史：A×3（含1跳过）+ B×2（含1跳过）+ 10天前 C + 坏行 ----
  const now = Date.now()
  const lines = [
    { trackId: 'tA', artist: '测试歌手', title: '测试歌曲', timestamp: now, completion: 1, skipped: false, durationSeconds: 120 },
    { trackId: 'tA', artist: '测试歌手', title: '测试歌曲', timestamp: now - 3600000, completion: 0.5, skipped: false, durationSeconds: 120 },
    { trackId: 'tA', artist: '测试歌手', title: '测试歌曲', timestamp: now - 7200000, completion: 0.1, skipped: true, durationSeconds: 120 },
    { trackId: 'tB', artist: '另一歌手', title: '另一首歌', timestamp: now - 1000, completion: 0.8, skipped: false, durationSeconds: 60 },
    { trackId: 'tB', artist: '另一歌手', title: '另一首歌', timestamp: now - 2000, completion: 0, skipped: true, durationSeconds: 60 },
    { trackId: 'tC', artist: '老歌手', title: '旧歌', timestamp: now - 10 * 86400000, completion: 1, skipped: false, durationSeconds: 200 },
  ]
  const bad = '{not valid json'
  await writeFile(join(tmp, 'history.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n' + bad + '\n')

  const s = await history.stats()
  assert(s.totalPlays === 6, `totalPlays=6（实际 ${s.totalPlays}）`)
  assert(s.totalSeconds === 440, `totalSeconds=440（120×1.6 + 60×0.8 + 200×1，实际 ${s.totalSeconds}）`)
  assert(s.uniqueSongs === 3, `uniqueSongs=3（实际 ${s.uniqueSongs}）`)
  assert(s.uniqueArtists === 3, `uniqueArtists=3（实际 ${s.uniqueArtists}）`)
  assert(s.topSongs.length === 3 && s.topSongs[0].title === '测试歌曲' && s.topSongs[0].plays === 3, 'topSongs 首位=3 次播放')
  assert(s.topArtists.length === 3 && s.topArtists[0].name === '测试歌手' && s.topArtists[0].plays === 3, 'topArtists 首位=3 次播放')
  assert(s.daily.length === 7, 'daily 恰好 7 天')
  assert(s.daily[s.daily.length - 1].date === localDate(0), 'daily 末日=今天（本地日期）')
  assert(s.daily[s.daily.length - 1].plays === 5, `今天 5 次（A×3+B×2；10天前事件不在窗口，实际 ${s.daily[s.daily.length - 1].plays}）`)
  assert(s.daily[0].plays === 0, '窗口最早一天 0 次')
  assert(s.skippedCount === 2, `skippedCount=2（实际 ${s.skippedCount}）`)
  assert(s.avgCompletion === 0.567, `avgCompletion≈0.567（实际 ${s.avgCompletion}）`)

  // ---- topSongs 带 trackId（七期批1）：最近事件 id + 在库校验 ----
  const songBy = (t) => s.topSongs.find((x) => x.title === t)
  assert(songBy('测试歌曲')?.trackId === null, 'topSongs 歌曲 trackId 不在曲库 → null')
  assert(songBy('另一首歌')?.trackId === 'tB', 'topSongs 歌曲 trackId 在曲库 → 保留 id')
  assert(songBy('旧歌')?.trackId === null, 'topSongs 旧歌（30 天前）trackId → null')
  assert(typeof s.topSongs[0].trackId === 'string' || s.topSongs[0].trackId === null, 'topSongs 每条都有 trackId 字段')

  // ---- 最近事件优先：文件顺序 tB(新) 在前、tA(旧) 在后，时间戳取新 ----
  const latestDir = join(tmp, 'latest')
  await mkdir(latestDir, { recursive: true })
  const latestStorage = { dataDir: latestDir, readJson: async () => null, writeJson: async () => {} }
  const latestLines = [
    { trackId: 'tB', artist: '另一歌手', title: '另一首歌', timestamp: now, completion: 1, durationSeconds: 60 },
    { trackId: 'tA', artist: '另一歌手', title: '另一首歌', timestamp: now - 5000, completion: 1, durationSeconds: 60 },
  ]
  await writeFile(join(latestDir, 'history.jsonl'), latestLines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  const hLatest = createHistory({ storage: latestStorage, library: stubLibrary, logger: { warn: () => {} } })
  const sLatest = await hLatest.stats()
  assert(sLatest.topSongs[0]?.trackId === 'tB', `最近事件 trackId 优先（实际 ${sLatest.topSongs[0]?.trackId}）`)

  // ---- 空历史 ----
  const emptyDir = join(tmp, 'empty')
  const emptyStorage = { dataDir: emptyDir, readJson: async () => null, writeJson: async () => {} }
  const hEmpty = createHistory({ storage: emptyStorage, library: stubLibrary, logger: { warn: () => {} } })
  const e = await hEmpty.stats()
  assert(e.totalPlays === 0 && e.totalSeconds === 0 && e.uniqueSongs === 0 && e.topSongs.length === 0, '空历史全零')
  assert(e.daily.length === 7 && e.daily.every((d) => d.plays === 0), '空历史 daily 仍 7 天全 0')
  assert(e.avgCompletion === 0, '空历史 avgCompletion=0')

  // ---- 路由：GET 200 / POST 405 ----
  const routes = []
  registerHistoryRoutes({ register: (r) => { routes.push(r); return () => {} } }, { history, logger: { warn: () => {} } })
  const statRoute = routes.find((r) => r.path === '/dsh-music/api/history/stats')
  assert(statRoute?.kind === 'exact', 'stats 路由已注册（exact）')
  let captured = null
  await statRoute.handler({ method: 'GET' }, { writeHead() {}, end: (b) => { captured = JSON.parse(b) } })
  assert(captured?.totalPlays === 6, '路由 GET 返回聚合 JSON')
  let code = 0
  await statRoute.handler({ method: 'POST' }, { writeHead: (c) => { code = c }, end: () => {} })
  assert(code === 405, 'stats POST → 405')
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures === 0 ? '全部通过' : `${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)