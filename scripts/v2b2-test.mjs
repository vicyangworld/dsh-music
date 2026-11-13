/** 二期批2 后端测试：node scripts/v2b2-test.mjs
 * 沙箱曲库（临时目录+假音频文件），验证删除确认机制/来源策略/越界防线/Finder 显示。
 * 绝不触碰真实 ~/Music 与凭据。 */
import { mkdtemp, rm, writeFile, mkdir, stat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'
import { createManage } from '../bundle/host/manage.js'

let failures = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!cond) failures++
}
const exists = (p) => stat(p).then(() => true, () => false)

const tmp = await mkdtemp(join(tmpdir(), 'dshm-v2b2-'))
try {
  const liked = join(tmp, 'liked'); const dsh = join(tmp, 'dsh'); const apple = join(tmp, 'apple')
  await mkdir(liked, { recursive: true }); await mkdir(dsh, { recursive: true }); await mkdir(apple, { recursive: true })
  await writeFile(join(liked, 'Beyond - 收藏曲.m4a'), Buffer.from('dummy-audio'))
  await writeFile(join(dsh, '测试歌手 - 下载曲.m4a'), Buffer.from('dummy-audio'))
  await writeFile(join(apple, 'Apple - 库曲.mp3'), Buffer.from('dummy-audio'))

  const storage = createStorage({ dataDir: join(tmp, 'data') })
  const library = createLibrary({
    storage,
    config: { directories: [
      { path: liked, source: 'spotify-liked' },
      { path: dsh, source: 'dsh-music' },
      { path: apple, source: 'apple-music' },
    ] },
    logger: { warn: () => {} },
  })
  await library.scan()
  const tracks = library.snapshot().tracks
  assert(tracks.length === 3, `沙箱曲库 3 首（实际 ${tracks.length}）`)
  const bySource = Object.fromEntries(tracks.map((t) => [t.source, t]))

  const revealCalls = []
  const manage = createManage({ library, logger: { warn: () => {} }, reveal: async (p) => { revealCalls.push(p); return true } })

  // ---- dsh-music：直接删 ----
  const r1 = await manage.remove(bySource['dsh-music'].id)
  assert(r1.deleted === true, 'dsh-music 无需 confirm 直接删')
  assert(!(await exists(join(dsh, '测试歌手 - 下载曲.m4a'))), 'dsh-music 文件已删除')
  assert(library.snapshot().tracks.length === 2, '删后重扫曲库 3→2')

  // ---- spotify-liked：需二次确认 ----
  const r2 = await manage.remove(bySource['spotify-liked'].id)
  assert(r2.deleted === false && r2.requiresConfirm === true, 'spotify-liked 默认返回需确认标记')
  assert(await exists(join(liked, 'Beyond - 收藏曲.m4a')), '未确认时收藏文件仍在')
  const r3 = await manage.remove(bySource['spotify-liked'].id, true)
  assert(r3.deleted === true, 'confirm=true 才真删收藏')
  assert(!(await exists(join(liked, 'Beyond - 收藏曲.m4a'))), '确认后收藏文件已删除')

  // ---- apple-music：拒删 ----
  let appleBlocked = false
  try { await manage.remove(bySource['apple-music'].id, true) } catch (e) { appleBlocked = e.status === 403 }
  assert(appleBlocked, 'apple-music 拒删（403，即使 confirm=true）')
  assert(await exists(join(apple, 'Apple - 库曲.mp3')), 'apple-music 文件完好')

  // ---- 非法/未知 id ----
  let badId = false
  try { await manage.remove('../../etc/passwd') } catch (e) { badId = e.status === 404 }
  assert(badId, '路径穿越型 id 拒绝（404）')
  let unknown = false
  try { await manage.remove('ffffffffffffffff') } catch (e) { unknown = e.status === 404 }
  assert(unknown, '未知 id 拒绝（404）')

  // ---- reveal ----
  const rv = await manage.revealTrack(bySource['apple-music'].id)
  const expectedReal = await realpath(join(apple, 'Apple - 库曲.mp3'))
  assert(rv.filePath === expectedReal && rv.revealed === true, 'reveal 返回 filePath（realpath 规范形）且调用 open -R')
  assert(revealCalls.length === 1, 'reveal 恰好调用一次显示命令')

  library.dispose()
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures === 0 ? '全部通过' : `${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)