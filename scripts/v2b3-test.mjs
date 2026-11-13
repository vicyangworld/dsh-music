/** 二期批3 后端测试：node scripts/v2b3-test.mjs
 * 曲库只读扫描 + 真实 MusicBrainz 补全冒烟（2 次请求，全局限速）。临时数据目录。 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'
import { createSearch } from '../bundle/host/search.js'
import { normalizeZh } from '../bundle/host/t2s.js'

let failures = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!cond) failures++
}

const tmp = await mkdtemp(join(tmpdir(), 'dshm-v2b3-'))
try {
  const storage = createStorage({ dataDir: tmp })
  const library = createLibrary({ storage, config: {}, logger: { warn: () => {} } })
  await library.scan()
  const search = createSearch({ library, storage, logger: { warn: () => {} } })

  // ---- T2S 归一 ----
  assert(normalizeZh('光輝歲月') === '光辉岁月', 'T2S：光輝歲月→光辉岁月')
  assert(normalizeZh('BEYOND') === 'beyond', 'T2S：大小写归一')

  // ---- 本地搜索 ----
  const r1 = await search.search('光辉岁月', 'song')
  assert(r1.local.some((t) => t.title.includes('光輝歲月') && t.artist === 'Beyond'), '简体「光辉岁月」命中繁体曲库曲')
  // O1（Chief 定）：本地有命中仍联网补全；remote 与本地去重，本地在前
  assert(r1.remoteError === null, 'O1：本地有命中仍联网补全（无错误）')
  const r1LocalKeys = new Set(r1.local.map((t) => `${normalizeZh(t.artist)}::${normalizeZh(t.title)}`))
  assert(r1.remote.every((x) => x.kind === 'artist' || !r1LocalKeys.has(`${normalizeZh(x.artist)}::${normalizeZh(x.title)}`)), 'O1：remote 与本地去重')
  assert(r1.local.every((t) => t.audioUrl && t.id), 'local 项为完整 track（可直接播）')

  const r2 = await search.search('beyond', 'song')
  assert(r2.local.length > 0 && r2.local.every((t) => normalizeZh(t.artist).includes('beyond') || normalizeZh(t.title).includes('beyond')), '大小写不敏感匹配 Beyond')

  const r3 = await search.search('伍佰', 'artist')
  assert(r3.local.length > 0 && r3.local.every((t) => t.artist.includes('伍佰')), 'type=artist 仅按歌手过滤')
  if (r3.remoteError) {
    console.log('INFO: MB 暂不可用（限速），降级分支:', r3.remoteError)
    assert(r3.remote.length === 0, 'O1：联网失败时 artist 口径静默降级（本地结果不受影响）')
  } else {
    assert(r3.remote.every((a) => a.kind === 'artist'), 'O1：artist 口径本地命中时仍返回联网歌手项')
  }

  const r4 = await search.search('', 'song')
  assert(r4.local.length === 0 && r4.remote.length === 0, '空 q 返回空')

  const r5 = await search.search('   ', 'song')
  assert(r5.local.length === 0 && r5.remote.length === 0, '纯空白 q 返回空')

  // ---- 联网补全（真实 MB，本地无匹配才触发）----
  const r6 = await search.search('Coldplay Yellow', 'song')
  if (r6.remoteError) {
    console.log('INFO: MB 暂不可用，降级路径生效:', r6.remoteError)
    assert(r6.local.length === 0 && Array.isArray(r6.remote), 'MB 失败优雅降级（remoteError + 空 remote）')
  } else {
    assert(r6.remote.length > 0, '本地无匹配 → MB recording 补全有结果')
    const hit = r6.remote[0]
    assert(hit.kind === 'song' && hit.artist && hit.title && hit.id, 'remote 项含 kind/artist/title/id')
    assert(hit.verification && hit.verification.source === 'MusicBrainz' && /^https:\/\/musicbrainz\.org\/recording\//.test(hit.verification.url) && Number.isFinite(hit.verification.verifiedAt), 'remote 项自带核实记录（可传 download）')
    // D1：补全项必须已写本机留档（下载/试听的留档交叉比对依赖它）
    const { readFile, readdir } = await import('node:fs/promises')
    const vdir = join(tmp, 'verifications')
    const vfiles = await readdir(vdir).catch(() => [])
    assert(vfiles.length > 0, 'D1：搜索补全项已写核实留档')
    let archived = false
    for (const f of vfiles) {
      const recs = JSON.parse(await readFile(join(vdir, f), 'utf8'))
      if (Array.isArray(recs) && recs.some((r) => r.verification?.url === hit.verification.url)) archived = true
    }
    assert(archived, 'D1：留档内容与补全项核实 url 一致')
    assert(hit.durationMs === null || Number.isFinite(hit.durationMs), 'durationMs 为 null 或数字')
  }

  const r7 = await search.search('Coldplay', 'artist')
  if (r7.remoteError) {
    console.log('INFO: MB artist 补全降级:', r7.remoteError)
    assert(true, 'artist 补全降级路径不报错')
  } else {
    assert(r7.remote.length > 0 && r7.remote.every((a) => a.kind === 'artist' && a.artist && a.id), 'type=artist 联网补全返回 artist 条目')
  }

  library.dispose()
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures === 0 ? '全部通过' : `${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)