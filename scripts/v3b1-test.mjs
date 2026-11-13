/** 三期批1 后端测试：node scripts/v3b1-test.mjs
 * 沙箱曲库+假 processItem，验证 likes 语义（喜欢才入库/unlike 不删文件）与
 * preview（核实前置/缓存命中/busy/文件名安全/LRU）。绝不触碰真实 ~/Music 与管线。 */
import { mkdtemp, rm, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { Writable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'
import { createDownload } from '../bundle/host/download.js'
import { createLikes, likeKey } from '../bundle/host/likes.js'
import { createPreview, previewKey } from '../bundle/host/preview.js'
import { createMediaCore } from '../bundle/host/media-core.js'

let failures = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!cond) failures++
}

const tmp = await mkdtemp(join(tmpdir(), 'dshm-v3b1-'))
const V = { source: 'MusicBrainz', url: 'https://musicbrainz.org/recording/x', verifiedAt: Date.now() }
try {
  const liked = join(tmp, 'liked'); const dsh = join(tmp, 'dsh')
  await mkdir(liked, { recursive: true }); await mkdir(dsh, { recursive: true })
  await writeFile(join(liked, 'Beyond - 光辉岁月.m4a'), Buffer.from('dummy'))
  const storage = createStorage({ dataDir: join(tmp, 'data') })
  const logger = { warn: () => {} }
  const library = createLibrary({ storage, config: { directories: [
    { path: liked, source: 'spotify-liked' },
    { path: dsh, source: 'dsh-music' },
  ] }, logger })
  await library.scan()
  const gloryId = library.snapshot().tracks[0].id

  // ---- media-core 抽出后 download 仍工作（validate/checkVerification 走 core，D1 留档比对）----
  const download = createDownload({ storage, library, config: { pipelineLockPath: join(tmp, 't.lock'), outDirOverride: join(tmp, 'out') }, logger })
  assert(download.core && typeof download.core.processItem === 'function', 'download 暴露 media-core')
  assert(await download.validate([{ artist: 'A', title: 'B', verification: V }]) !== null, 'D1：无留档 → 拒绝')
  await download.archiveVerification({ artist: 'A', title: 'B', verification: V })
  assert(await download.validate([{ artist: 'A', title: 'B', verification: V }]) === null, 'core.checkVerification 生效（有效核实+留档通过）')
  assert(await download.validate([{ artist: 'A', title: 'B' }]) !== null, 'core.checkVerification 生效（无核实拒绝）')

  const likes = createLikes({ storage, library, download, logger })

  // ---- 曲库内曲：标记不下载 ----
  const r1 = await likes.set({ trackId: gloryId, liked: true })
  assert(r1.liked === true && r1.inLibrary === true && r1.trackId === gloryId, '曲库曲 liked=true 标记且识别在库')
  assert(r1.downloading === undefined || r1.downloading === false, '曲库曲不触发下载')
  const r2 = await likes.set({ trackId: gloryId, liked: false })
  assert(r2.liked === false, 'unlike 成功')
  assert(await likes.statusOf('Beyond', '光辉岁月') === false, 'unlike 后状态为未喜欢')

  // ---- 非曲库曲：喜欢才下载入库 ----
  const fakeStarts = []
  const spyDownload = {
    core: download.core,
    isRunning: () => false,
    start: (items) => { fakeStarts.push(items); return { runId: 'fake', total: 1 } },
    archiveVerification: async () => {},
  }
  const likes2 = createLikes({ storage, library, download: spyDownload, logger })
  // D1：合法核实需本机留档——先由核实生产者留档
  await download.archiveVerification({ artist: '_testartist_', title: '_testtitle_', verification: V })
  const r3 = await likes2.set({ artist: '_testartist_', title: '_testtitle_', verification: V, liked: true })
  assert(r3.liked === true && r3.downloading === true && r3.inLibrary === false, '非曲库曲 liked=true → 自动下载入库')
  assert(fakeStarts.length === 1 && fakeStarts[0][0].artist === '_testartist_', 'download.start 恰好调用一次')
  const r4 = await likes2.set({ artist: '_testartist_', title: '_testtitle_', liked: true })
  assert(r4.downloading === false && /缺少联网核实记录/.test(r4.message ?? ''), '无 verification 只标记不下载（消息中文）')
  const r5 = await likes2.set({ artist: '_testartist_', title: '_testtitle_', liked: false })
  assert(r5.liked === false, '非曲库曲 unlike 成功')
  await likes2.set({ artist: '_testartist_', title: '_testtitle_', liked: true })
  const r6 = await likes2.set({ artist: '_testartist_', title: '_testtitle_', liked: false })
  assert(await likes2.statusOf('_testartist_', '_testtitle_') === false, 'unlike 后彻底去标记')
  // unlike 不删文件断言：文件仍在曲库
  const r7 = await likes.set({ trackId: gloryId, liked: true })
  await likes.set({ trackId: gloryId, liked: false })
  const st = await stat(join(liked, 'Beyond - 光辉岁月.m4a'))
  assert(st.size > 0, 'unlike 绝不删除本地文件（红线）')

  // ---- 简繁 key 一致 ----
  assert(likeKey('Beyond', '光輝歲月') === likeKey('Beyond', '光辉岁月'), 'likeKey 简繁归一同 key')

  // ---- likes list ----
  const l1 = await likes.list()
  assert(l1.items.length === 0, '全部 unlike 后列表空')

  // ---- preview：核实前置 + 假管线下载 + 缓存命中 + 文件名安全 ----
  const previewDir = join(tmp, 'data', 'cache', 'preview')
  const pv = createPreview({ storage, config: { pipelineLockPath: join(tmp, 'p.lock') }, logger })
  // 直接注入 ready 缓存文件模拟已下载
  await mkdir(previewDir, { recursive: true })
  const key16 = previewKey('Preview艺人', 'Preview曲目')
  await writeFile(join(previewDir, `${key16}.m4a`), Buffer.from('x'.repeat(20000)))
  const hit = await pv.findCached(key16)
  assert(hit && hit.fileKey === `${key16}.m4a`, 'preview 缓存命中')
  assert(await pv.checkVerification({ artist: 'a', title: 'b' }) !== null, 'preview 核实前置（无 verification 拒绝）')
  assert(await pv.checkVerification({ artist: 'a', title: 'b', verification: { source: 'fake', url: 'https://example.com/x', verifiedAt: Date.now() } }) !== null, 'D1：preview 拒绝伪造核实')
  assert(await pv.checkVerification({ artist: 'a', title: 'b', verification: V }) !== null, 'D1：preview 无留档拒绝')
  await pv.archive({ artist: 'a', title: 'b', verification: V })
  assert(await pv.checkVerification({ artist: 'a', title: 'b', verification: V }) === null, 'preview 有效核实（有留档）通过')
  // 播放流安全：非法 fileKey 拒绝（穿越/格式）；合法文件走 Range 流式
  let err404 = 0
  let lastCode = null
  let lastHeaders = null
  const fakeRes = new Writable({ write(c, e, cb) { cb() } })
  fakeRes.writeHead = (code, headers) => { lastCode = code; lastHeaders = headers }
  fakeRes.end = () => {}
  const sendError = (code) => { err404 = code }
  await pv.serve({ method: 'GET', headers: {} }, fakeRes, '../../.config/spotify-sync/refresh_token', sendError)
  assert(err404 === 404, 'preview 播放流：穿越 fileKey 拒绝 404（不触文件）')
  await pv.serve({ method: 'GET', headers: {} }, fakeRes, 'zzzzzzzzzzzzzzzz.m4a', sendError)
  assert(err404 === 404, 'preview 播放流：未知 hash 404')
  err404 = 0
  lastCode = null
  await pv.serve({ method: 'GET', headers: { range: 'bytes=0-1023' } }, fakeRes, `${key16}.m4a`, sendError)
  await new Promise((r) => setTimeout(r, 100))
  assert(err404 === 0 && lastCode === 206 && lastHeaders?.['Content-Range'] === 'bytes 0-1023/20000', `preview 播放流：合法文件 Range 206（实际 ${lastCode}）`)

  // status 初始
  assert(pv.status().status === 'idle', 'preview 初始 idle')

  // ---- LRU：>30 个文件裁剪 + 无管线时 fail 收尾（ytdlp 指向不存在路径，零网络）----
  for (let i = 0; i < 35; i++) {
    await writeFile(join(previewDir, `${String(i).padStart(16, '0')}.m4a`), Buffer.from('x'.repeat(20000)))
  }
  await pv.trimLru()
  const remain = (await readdir(previewDir)).filter((n) => /^[a-f0-9]{16}\.(m4a|opus)$/.test(n))
  assert(remain.length === 30, `LRU 保留 30 个（实际 ${remain.length}）`)
  // D1：ytdlpPath 指向目录 → spawn EACCES（确定性失败，零网络），错误须中文「试听失败：」前缀
  const pv2 = createPreview({ storage, config: { pipelineLockPath: join(tmp, 'p2.lock'), ytdlpPath: tmp }, logger })
  await pv2.start({ artist: 'Fail艺人', title: 'Fail曲目', verification: V })
  for (let i = 0; i < 40; i++) {
    if (!pv2.status().running) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const fs2 = pv2.status()
  assert(fs2.running === false && fs2.status === 'fail', `管线不可用时 fail 收尾不悬挂（实际 ${fs2.status}）`)
  assert(typeof fs2.error === 'string' && fs2.error.startsWith('试听失败：'), `D1：试听错误统一「试听失败：」中文前缀（实际 ${fs2.error?.slice(0, 60)}）`)
  // D1：binaries 缺二进制 → 中文引导错误（不再 raw ENOENT）
  const { createToolRunner } = await import('../bundle/host/binaries.js')
  const runner = createToolRunner({ config: {}, logger })
  let guide = null
  try { await runner.run('definitely-not-a-real-binary-xyz', ['--version']) } catch (e) { guide = e }
  assert(guide?.code === 'BINARY_MISSING' && /未找到/.test(guide.message) && /安装/.test(guide.message), `D1：缺二进制给中文安装引导（实际 ${guide?.message?.slice(0, 60)}）`)
  // D1：配置路径失效时回退 PATH（本机 yt-dlp 在 PATH，能真正跑通 --version）
  const fallbackRunner = createToolRunner({ config: { ytdlpPath: join(tmp, 'no-such-yt-dlp') }, logger })
  const ver = await fallbackRunner.run('yt-dlp', ['--version']).catch((e) => `ERR:${e.message}`)
  assert(typeof ver === 'string' && !ver.startsWith('ERR:') && /^\d{4}\./.test(ver.trim()), `D1：失效配置回退 PATH 成功（yt-dlp ${String(ver).trim().slice(0, 20)}）`)
  pv.dispose()
  pv2.dispose()
  download.dispose()
  library.dispose()
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures === 0 ? '全部通过' : `${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)