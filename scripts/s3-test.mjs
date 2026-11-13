/** S3 独立测试（不依赖 DSH 运行时）：node scripts/s3-test.mjs
 * 覆盖：共享锁语义、历史追加/读取/校验、下载核实前置、sync 输出解析、S1-003 修复。
 * 数据写临时 owned 目录，不触碰真实 ~/.dsh/dsh-music 与 ~/.config/spotify-sync。 */
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'
import { createHistory } from '../bundle/host/history.js'
import { createDownload, sanitize } from '../bundle/host/download.js'
import { createPipelineLock } from '../bundle/host/lock.js'
import { parseSyncOutput } from '../bundle/host/sync.js'
import { createPlayback } from '../bundle/host/playback.js'

let failures = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!cond) failures++
}

const tmp = await mkdtemp(join(tmpdir(), 'dshm-s3-test-'))
try {
  const storage = createStorage({ dataDir: tmp })
  const library = createLibrary({ storage, config: {}, logger: { warn: () => {} } })
  await library.scan()
  const glory = library.snapshot().tracks.find((t) => t.artist === 'Beyond' && t.title.includes('光輝歲月'))

  // ---- 锁（临时路径，语义与 sync.py 一致）----
  const lockPath = join(tmp, 'test.lock')
  const lockA = createPipelineLock(lockPath)
  const lockB = createPipelineLock(lockPath)
  assert(await lockA.acquire() === true, '锁 A 首次获取成功')
  assert(await lockB.acquire() === false, '锁 B 撞锁返回 false（不绕锁）')
  await lockA.release()
  assert(await lockB.acquire() === true, 'A 释放后 B 可获取')
  await lockB.release()

  // ---- 历史 ----
  const history = createHistory({ storage, library, logger: { warn: () => {} } })
  const entry = await history.append({ trackId: glory.id, completion: 0.95, skipped: false })
  assert(entry.artist === 'Beyond' && entry.title === '光輝歲月', '历史条目自动补全 artist/title')
  assert(entry.completion === 0.95 && entry.skipped === false, '完整度/跳过字段正确')
  await history.append({ trackId: glory.id, completion: 0.1, skipped: true, reason: 'user-skip' })
  const { events, total } = await history.read({})
  assert(total === 2 && events[0].skipped === true, '读取 newest-first，共 2 条')
  const raw = (await readFile(history.file, 'utf8')).trim().split('\n')
  assert(raw.length === 2 && raw.every((l) => JSON.parse(l).trackId === glory.id), 'JSONL append-only 落盘')
  let unknownRejected = false
  try { await history.append({ trackId: 'ffffffffffffffff', completion: 1 }) } catch (e) { unknownRejected = e.code === 'UNKNOWN_TRACK' }
  assert(unknownRejected, '未知 trackId 拒绝落历史（S1-003 关联）')
  let badCompletion = false
  try { await history.append({ trackId: glory.id, completion: 5 }) } catch { badCompletion = true }
  assert(badCompletion, 'completion>1 拒绝')

  // ---- 下载核实前置（D1：source 白名单 + MB 域名 + 留档交叉比对）----
  const download = createDownload({ storage, library, config: { pipelineLockPath: lockPath }, logger: { warn: () => {} } })
  const validV = { source: 'MusicBrainz', url: 'https://musicbrainz.org/recording/xxx', verifiedAt: Date.now() }
  assert(await download.validate([{ artist: 'A', title: 'B' }]) !== null, '无核实记录 → 拒绝')
  assert(await download.validate([{ artist: 'A', title: 'B', verification: { source: 'x', url: 'https://x', verifiedAt: Date.now() - 40 * 86400000 } }]) !== null, '核实过期（>30天）→ 拒绝')
  assert(await download.validate([{ artist: 'A', title: 'B', verification: { source: '', url: 'https://x', verifiedAt: Date.now() } }]) !== null, '核实缺来源 → 拒绝')
  assert(await download.validate([{ artist: 'A', title: 'B', verification: { source: 'fake', url: 'https://example.com/x', verifiedAt: Date.now() } }]) !== null, 'D1：伪造 source(fake) → 拒绝')
  assert(await download.validate([{ artist: 'A', title: 'B', verification: { source: 'MusicBrainz', url: 'https://example.com/recording/xxx', verifiedAt: Date.now() } }]) !== null, 'D1：非 musicbrainz.org 域名 → 拒绝')
  assert(await download.validate([{ artist: 'A', title: 'B', verification: { ...validV, url: 'https://musicbrainz.org/recording/not-archived-000' } }]) !== null, 'D1：形状合法但无本机留档 → 拒绝')
  await download.archiveVerification({ artist: 'A', title: 'B', verification: validV })
  assert(await download.validate([{ artist: 'A', title: 'B', verification: validV }]) === null, '有效核实（有留档）→ 通过')
  assert(await download.validate([]) !== null, '空批次拒绝')
  assert(sanitize('a/b\\c:d*e?f"g<h>i|j') === 'a_b_c_d_e_f_g_h_i_j', 'sanitize 与 sync.py 一致')
  const vfiles = await readFile(join(tmp, 'verifications', (await import('node:crypto')).createHash('sha1').update('A::B').digest('hex').slice(0, 16) + '.json'), 'utf8')
  assert(JSON.parse(vfiles)[0].verification.source === 'MusicBrainz', '核实记录留档')

  // ---- sync 输出解析 ----
  const parsed = parseSyncOutput([
    '云端收藏 55 首 | 新增 2 | 移除 1',
    '  + Artist - Title',
    '[1/2] OK       Artist - Title  (dur=200s target=201s)',
    '[2/2] FAIL     X - Y  (timeout)',
    "完成 {'ts': '2026-11-12 20:00:00', 'cloud': 55, 'added': 2, 'removed': 1, 'ok': 1, 'mismatch': 0, 'skip': 0, 'fail': 1}",
  ])
  assert(parsed.result.cloud === 55 && parsed.result.added === 2 && parsed.result.removed === 1, '解析云端/新增/移除')
  assert(parsed.result.ok === 1 && parsed.result.fail === 1 && parsed.result.ts === '2026-11-12 20:00:00', '解析完成汇总')
  assert(parsed.tracks.length === 2 && parsed.tracks[1].status === 'fail', '解析逐曲结果')

  // ---- S1-003 playback 校验 ----
  const playback = createPlayback({ validateTrack: (id) => library.getRecord(id) !== undefined })
  playback.report({ trackId: glory.id, queue: [glory.id] })
  assert(playback.get().trackId === glory.id, '合法 trackId/queue 通过')
  let badTrack = false
  try { playback.report({ trackId: 'ffffffffffffffff' }) } catch { badTrack = true }
  assert(badTrack, 'S1-003：未知 trackId 被拒')
  let badQueue = false
  try { playback.report({ queue: [glory.id, 'ffffffffffffffff'] }) } catch { badQueue = true }
  assert(badQueue, 'S1-003：queue 未知 id 被拒')
  assert(playback.get().trackId === glory.id, '非法上报不改变既有状态')

  library.dispose()
  download.dispose()
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures === 0 ? '全部通过' : `${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)