/** 二期批1 后端测试：node scripts/v2b1-test.mjs
 * 覆盖：mode 三态校验/旧字段同步与推导、nextTrack 三模式决策、随机不重复、
 * findByFile 映射、download status 形状。临时目录，不污染真实数据。 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'
import { createPlayback } from '../bundle/host/playback.js'
import { createDownload } from '../bundle/host/download.js'

let failures = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!cond) failures++
}

const tmp = await mkdtemp(join(tmpdir(), 'dshm-v2b1-'))
try {
  const storage = createStorage({ dataDir: tmp })
  const library = createLibrary({ storage, config: {}, logger: { warn: () => {} } })
  await library.scan()
  const tracks = library.snapshot().tracks
  const ids = tracks.slice(0, 4).map((t) => t.id)
  const playback = createPlayback({ validateTrack: (id) => library.getRecord(id) !== undefined })

  // ---- mode 校验与同步 ----
  playback.report({ queue: ids, trackId: ids[0] })
  assert(playback.get().mode === 'sequential', '默认 mode=sequential')
  playback.report({ mode: 'single' })
  assert(playback.get().mode === 'single' && playback.get().repeat === 'one' && playback.get().shuffle === false, 'mode=single 同步 repeat=one')
  playback.report({ mode: 'shuffle' })
  assert(playback.get().mode === 'shuffle' && playback.get().shuffle === true, 'mode=shuffle 同步 shuffle=true')
  let badMode = false
  try { playback.report({ mode: 'loop' }) } catch { badMode = true }
  assert(badMode, '非法 mode 拒绝')
  // 旧字段推导（织音现有上报路径兼容）
  playback.report({ repeat: 'one', shuffle: false })
  assert(playback.get().mode === 'single', '旧字段 repeat=one → mode=single')
  playback.report({ repeat: 'all', shuffle: false })
  assert(playback.get().mode === 'sequential', '旧字段 repeat=all → mode=sequential')
  playback.report({ shuffle: true })
  assert(playback.get().mode === 'shuffle', '旧字段 shuffle=true → mode=shuffle')

  // ---- nextTrack：顺序 ----
  playback.report({ mode: 'sequential', trackId: ids[0], queue: ids })
  assert(playback.nextTrack().trackId === ids[1], '顺序：队列下一首')
  assert(playback.nextTrack(ids[3]).trackId === ids[0], '顺序：末尾回绕到首')
  assert(playback.nextTrack('ffffffffffffffff').trackId === ids[0], '顺序：当前不在队列 → 首首')

  // ---- nextTrack：单曲 ----
  playback.report({ mode: 'single', trackId: ids[2] })
  const r1 = playback.nextTrack()
  assert(r1.trackId === ids[2] && r1.reason === 'replay', '单曲：重播当前')

  // ---- nextTrack：随机不重复 ----
  playback.report({ mode: 'shuffle', trackId: ids[0], queue: ids })
  const picks = [playback.nextTrack().trackId, playback.nextTrack().trackId, playback.nextTrack().trackId]
  assert(picks.every((p) => p !== ids[0]), '随机：不立即重复当前曲')
  assert(new Set(picks).size === 3, '随机：一轮内 3 次抽取互不重复')
  const p4 = playback.nextTrack().trackId
  assert(p4 !== picks[2], '随机：轮尽重置后仍避开刚播的')
  // 队列变化重置
  playback.report({ queue: ids.slice(0, 2) })
  const p5 = playback.nextTrack()
  assert(ids.slice(0, 2).includes(p5.trackId), '随机：队列变化后在新队列内选')

  // ---- nextTrack：空队列 ----
  playback.report({ queue: [] })
  const rEmpty = playback.nextTrack()
  assert(rEmpty.trackId === null && rEmpty.reason === 'empty', '空队列返回 null/empty')

  // ---- findByFile ----
  const glory = tracks.find((t) => t.artist === 'Beyond' && t.title.includes('光輝歲月'))
  const rec = library.findByFile(glory ? library.getRecord(glory.id).filePath : '')
  assert(rec !== undefined && rec.id === glory.id, 'findByFile：产物路径 → trackId 映射')
  assert(library.findByFile('/nonexistent/x.m4a') === undefined, 'findByFile：未知路径返回 undefined')

  // ---- download status 形状 ----
  const download = createDownload({ storage, library, config: { pipelineLockPath: join(tmp, 't.lock') }, logger: { warn: () => {} } })
  const st = download.status()
  assert(st.running === false && Array.isArray(st.items), 'download/status 空闲形状正确')
  download.dispose()

  library.dispose()
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures === 0 ? '全部通过' : `${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)