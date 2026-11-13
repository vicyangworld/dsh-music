/** 独立扫描测试（不依赖 DSH 运行时）：node scripts/scan-test.mjs
 * 验证：三目录扫描（含缺失目录优雅跳过）、标签/封面、id 稳定、基线数量。 */
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'

const storage = createStorage({})
const library = createLibrary({
  storage,
  config: {},
  logger: { warn: (m) => console.error('[warn]', m) },
})

const t0 = Date.now()
const { tracks, scannedAt } = await library.scan()
const elapsedMs = Date.now() - t0
const bySource = {}
for (const t of tracks) bySource[t.source] = (bySource[t.source] ?? 0) + 1
console.log(JSON.stringify({ total: tracks.length, bySource, elapsedMs, scannedAt }, null, 2))

const glory = tracks.find((t) => t.artist === 'Beyond' && t.title.includes('光輝歲月'))
console.log('测试曲目样本:', JSON.stringify(glory, null, 2))

let failures = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!cond) failures++
}

assert(tracks.length >= 55, `曲库总数 ${tracks.length} ≥ 55`)
assert(bySource['spotify-liked'] === 55, `spotify-liked 55 首（实际 ${bySource['spotify-liked']}）`)
assert(bySource['apple-music'] === 6, `apple-music 6 首（实际 ${bySource['apple-music']}）`)
assert(!('dsh-music' in bySource), '缺失目录 dsh-music 优雅跳过（不报错、不入库）')
assert(glory !== undefined, '找到 Beyond《光輝歲月》')
assert(glory && Math.abs(glory.duration - 302.8) < 2, `光辉岁月时长≈302.8s（实际 ${glory?.duration}）`)
assert(glory && glory.album === '命運派對', `光辉岁月专辑=命運派對（实际 ${glory?.album}）`)
assert(glory && glory.coverUrl === `/dsh-music/cover/${glory.id}`, '光辉岁月有内嵌封面 coverUrl')
assert(tracks.every((t) => /^[a-f0-9]{16}$/.test(t.id)), '全部 id 为 16 位十六进制（URL 安全）')
assert(new Set(tracks.map((t) => t.id)).size === tracks.length, 'id 无碰撞')
assert(tracks.every((t) => !('filePath' in t)), '对外 JSON 不泄露本地绝对路径')

const t1 = Date.now()
const second = await library.rescan()
console.log(`重扫耗时（缓存命中）: ${Date.now() - t1}ms`)
assert(
  tracks.map((t) => t.id).join(',') === second.tracks.map((t) => t.id).join(','),
  '重扫后 id 序列完全稳定',
)

library.dispose()
process.exit(failures === 0 ? 0 : 1)