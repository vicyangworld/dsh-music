/** 七期批2 真实 starter provisioning 冒烟（联网 + 真实落盘）。
 * 用法：node scripts/v7b2-starter-smoke.mjs
 * - 状态/缓存用临时 dataDir（证明用户 ~/.dsh/dsh-music 零改动）
 * - 音频只写插件自己的 ~/Music/dsh-music/starter/（任务指定目录）
 * - 逐首联网复核 Commons 许可（Public domain）→ 串行下载 → 128k AAC + 标签
 * - 完成后用临时 library 复扫产物，验证可被曲库识别（标题/歌手/时长）
 * 输出每首：status/license/sourceUrl/file/size；最后打印 summary JSON。 */
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createStarter } from '../bundle/host/starter.js'
import { createLibrary } from '../bundle/host/library.js'

const dataDir = await mkdtemp(join(tmpdir(), 'dshm-starter-smoke-'))
const storage = createStorage({ dataDir })
const starter = createStarter({
  storage,
  library: { scan: async () => {}, findByFile: () => undefined },
  config: {},
  logger: { warn: (m) => console.log('[warn]', m) },
})
const startedAt = Date.now()
console.log('dataDir(临时):', dataDir)
console.log('状态文件:', starter.stateFile, '| 音频目录: ~/Music/dsh-music/starter')
console.log('provision 启动:', starter.provision())
let state
for (;;) {
  state = await starter.state()
  if (['done', 'failed', 'deferred'].includes(state.status)) break
  await new Promise((r) => setTimeout(r, 2000))
}
console.log(`\n终态 ${state.status}（ok=${state.ok} failed=${state.failed}）耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
for (const t of state.tracks) {
  let size = null
  if (t.file) size = (await stat(t.file).catch(() => null))?.size ?? null
  console.log(JSON.stringify({
    status: t.status, title: t.title, artist: t.artist, composer: t.composer,
    license: t.license, source: t.sourceUrl, author: t.author, verifiedAt: t.verifiedAt,
    file: t.file, bytes: size, note: t.note,
  }))
}
// 产物可被曲库识别（临时缓存目录，不影响真实缓存）
const lib = createLibrary({ storage: createStorage({ dataDir: join(dataDir, 'libcache') }), config: { directories: [{ source: 'dsh-music', path: join(process.env.HOME, 'Music', 'dsh-music', 'starter') }] }, logger: { warn: () => {} } })
await lib.scan()
const snap = lib.snapshot()
console.log('\n曲库识别：', snap.tracks.length, '首')
for (const tr of snap.tracks) console.log(JSON.stringify({ title: tr.title, artist: tr.artist, duration: tr.duration, format: tr.format, cover: tr.coverUrl }))
await rm(dataDir, { recursive: true, force: true })
process.exit(state.ok >= 1 ? 0 : 1)
