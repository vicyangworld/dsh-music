/** 拾词 metadata 管线自测（不依赖运行中的服务器，直接 import 模块 + 真实曲目记录）。
 * 运行：node scripts/content/selftest.mjs */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { createMetadataCache, slugify } from '../../bundle/host/metadata/cache.js'
import { createEmbeddedLyrics } from '../../bundle/host/metadata/embedded.js'
import { createLyricsPipeline } from '../../bundle/host/metadata/lyrics.js'
import { createArtistContent } from '../../bundle/host/metadata/artist.js'
import { parseLrc } from '../../bundle/host/metadata/lrc.js'
import { trackId } from '../../bundle/host/library.js'

const dataDir = join(homedir(), '.dsh', 'dsh-music')
const cache = createMetadataCache(dataDir)
const embedded = createEmbeddedLyrics({})
const logger = { warn: (m) => console.error('  WARN:', m) }

const rel = 'Beyond - 光輝歲月.m4a'
const id = trackId('spotify-liked', rel)
const filePath = join(homedir(), 'Music', 'spotify-liked', rel)
const realRecord = {
  id, filePath, format: 'm4a', mime: 'audio/mp4', source: 'spotify-liked',
  meta: { title: '光輝歲月', artist: 'Beyond', album: '命運派對', duration: 302.834649, hasCover: true },
}
const missId = 'ffffffffffffffff'
const missRecord = {
  id: missId, filePath: '/nonexistent-xyz.m4a', format: 'm4a', mime: 'audio/mp4', source: 'spotify-liked',
  meta: { title: '一首绝不存在的歌xyz123', artist: '不存在歌手xyz', album: null, duration: null },
}
const library = {
  getRecord: (x) => (x === id ? realRecord : x === missId ? missRecord : undefined),
  ensureScanned: async () => {},
}
const lyrics = createLyricsPipeline({ library, cache, embedded, logger })
const artist = createArtistContent({ cache, logger })

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}

console.log('曲目 id（光輝歲月）:', id)

console.log('\n[1] LRC 解析单元')
const sample = '[00:28.64] 鐘聲響起歸家的訊號\n[00:33.07] 在他生命裡彷彿帶點唏噓\n[ar:Beyond]\n[01:07.38] 今天只有殘留的軀殼'
const parsed = parseLrc(sample)
check('解析 3 行（跳过元标签）', parsed.length === 3, `len=${parsed.length}`)
check('首行 time=28.64', parsed[0]?.time === 28.64, `t=${parsed[0]?.time}`)
check('首行文本正确', parsed[0]?.text === '鐘聲響起歸家的訊號')

console.log('\n[2] 光辉岁月 首次打开（应 LRCLIB 同步命中）')
const r1 = await lyrics.get(id)
check('source=lrclib', r1.source === 'lrclib', `source=${r1.source}`)
check('synced=true', r1.synced === true)
check('lines>20', r1.lines.length > 20, `lines=${r1.lines.length}`)
check('首句带时间', r1.lines[0]?.time > 0 && r1.lines[0]?.text, JSON.stringify(r1.lines[0]))
check('首次 cached=false', r1.cached === false)
check('响应不含 filePath', !('filePath' in r1))

console.log('\n[3] 光辉岁月 二次打开（缓存秒开）')
const t0 = Date.now()
const r2 = await lyrics.get(id)
const dt = Date.now() - t0
check('cached=true', r2.cached === true)
check('source 一致', r2.source === r1.source)
check('lines 一致', r2.lines.length === r1.lines.length)
check('秒开 (<50ms)', dt < 50, `${dt}ms`)

console.log('\n[4] LRCLIB 无命中降级')
const r3 = await lyrics.get(missId)
check('source=none', r3.source === 'none', `source=${r3.source}`)
check('有中文提示', typeof r3.message === 'string' && r3.message.length > 0, r3.message)
check('lines 为空', r3.lines.length === 0)
check('synced=false', r3.synced === false)
const r3b = await lyrics.get(missId)
check('降级也缓存（二次 cached=true）', r3b.cached === true)

console.log('\n[5] 歌手维基 live 兜底（Beyond，无缓存时）')
const a = await artist.get('Beyond')
check('返回 name', a.name === 'Beyond')
check('intro 或 message 至少其一', !!a.intro || !!a.message, a.intro ? 'intro 命中' : `message=${a.message}`)
if (a.intro) check('intro 带 source+date', !!a.intro.source && !!a.intro.date, `${a.intro.source} / ${a.intro.date}`)

console.log('\n[6] slug 工具')
check('Beyond→beyond', slugify('Beyond') === 'beyond')
check('保留中文', slugify('光輝歲月') === '光輝歲月')
check('artist-title', slugify('Beyond - 光輝歲月') === 'beyond-光輝歲月', slugify('Beyond - 光輝歲月'))

// 清理测试用的 none 缓存，避免污染
await rm(cache.lyricsFile(missId), { force: true })

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)