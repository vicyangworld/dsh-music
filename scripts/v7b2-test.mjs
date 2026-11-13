/** 七期批2 隔离测试：onboarding 状态机 + starter 库 provisioning。
 * 全部依赖注入/临时目录，真实用户数据零改动、零网络。
 * node scripts/v7b2-test.mjs
 * 覆盖：
 *  A. starter：逐首许可核实→串行下载→转码；许可失败/下载失败优雅跳过；撞锁 deferred；署名落盘。
 *  B. onboarding：空库 completed=false；既有库自动 completed（老用户零打扰）；
 *     libraryMode=starter 启动 provisioning；libraryPath 校验并挂载自定义曲库；prefs 校验。
 *  C. 路由：GET 200 / POST 200 / 非法 JSON 400 / 错误路径 400 / 方法 405。
 *  D. 真实 library.addDirectory 集成（临时目录，假音频文件）。 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createStarter } from '../bundle/host/starter.js'
import { createOnboarding, registerOnboardingRoutes } from '../bundle/host/onboarding.js'
import { createLibrary } from '../bundle/host/library.js'

let failures = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (fn, timeoutMs = 5000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true
    await sleep(20)
  }
  return false
}

const tmp = await mkdtemp(join(tmpdir(), 'dshm-v7b2-'))
const events = []
try {
  // ================= A. starter provisioning =================
  const starterData = join(tmp, 'starter-data')
  const outDir = join(tmp, 'music', 'starter')
  const storage = createStorage({ dataDir: starterData })
  const scanCalls = { n: 0 }
  const stubLibrary = {
    scan: async () => { scanCalls.n++ },
    findByFile: (file) => (String(file).includes('好歌') ? { id: 'track-good' } : undefined),
  }
  const catalog = [
    {
      id: 'good', artist: '测试演奏者', title: '好歌', composer: '测试作曲家', album: 'PD 测试',
      commonsTitle: 'File:Good.flac',
    },
    { id: 'bad', artist: '某演奏者', title: '坏许可', commonsTitle: 'File:Bad.flac' },
  ]
  const deps = {
    catalog,
    outDir,
    verify: async (item) => {
      events.push(`verify:${item.id}`)
      if (item.id === 'bad') return { ok: false, error: '许可不是公有领域/CC0（CC BY-SA）' }
      return {
        ok: true, mime: 'audio/flac', license: 'Public domain', downloadUrl: 'https://upload.wikimedia.org/good.flac',
        licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
        sourceUrl: `https://commons.wikimedia.org/wiki/${item.commonsTitle.replace(/ /g, '_')}`,
        author: '测试演奏者', verifiedAt: Date.now(),
      }
    },
    download: async (url, dest) => {
      events.push(`download:${String(url).includes('good') ? 'good' : 'other'}`)
      await writeFile(dest, Buffer.alloc(60000, 1))
      return 60000
    },
    transcode: async (src, out, item) => {
      events.push(`transcode:${item.id}`)
      await writeFile(out, Buffer.alloc(20000, 2))
    },
    lock: { acquire: async () => true, release: async () => {} },
  }
  const starter = createStarter({ storage, library: stubLibrary, config: { dataDir: starterData }, logger: { warn: () => {} }, deps })

  assert(starter.provision() === true, 'starter.provision 启动返回 true')
  const okState = await waitFor(async () => ['done', 'failed', 'deferred'].includes((await starter.state()).status)) && await starter.state()
  assert(okState.status === 'done', `starter 终态 done（实际 ${okState.status}）`)
  assert(okState.ok === 1 && okState.failed === 1 && okState.done === 2, `starter 计数 ok=1 failed=1 done=2（实际 ${okState.ok}/${okState.failed}/${okState.done}）`)
  const good = okState.tracks.find((t) => t.id === 'good')
  const bad = okState.tracks.find((t) => t.id === 'bad')
  assert(good?.status === 'ok' && typeof good.file === 'string' && good.file.endsWith('.m4a'), 'starter 好曲 status=ok 且有产物路径')
  assert(good?.license === 'Public domain' && String(good.sourceUrl).startsWith('https://commons.wikimedia.org/wiki/') && good.author === '测试演奏者', 'starter 好曲署名完整（许可/来源URL/作者）')
  assert(typeof good?.verifiedAt === 'number', 'starter 好曲留有 verifiedAt 核实时间')
  assert(good?.source === good?.sourceUrl && String(good.source).startsWith('https://commons.wikimedia.org/wiki/'), 'starter 状态含 Client 契约别名 source（=来源URL）')
  assert(good?.trackId === 'track-good', 'starter 入库后映射 trackId')
  assert(bad?.status === 'fail' && /许可/.test(bad.note ?? ''), 'starter 许可不通过 → fail 并说明原因（优雅跳过）')
  assert(events.indexOf('verify:good') < events.indexOf('download:good'), 'starter 先核实许可再下载')
  assert(events.filter((e) => e.startsWith('download:')).length === 1, 'starter 失败曲不下载（串行且只下合法曲）')
  assert(scanCalls.n >= 1, 'starter 完成后自动重扫入库')
  const persistedStarter = JSON.parse(await readFile(join(starterData, 'starter.json'), 'utf8'))
  const pgood = persistedStarter.tracks.find((t) => t.id === 'good')
  assert(pgood?.license === 'Public domain' && pgood.licenseUrl && pgood.sourceUrl && pgood.author, 'starter.json 落盘含署名/许可/来源')
  // 失败不影响后续：把 bad 换成下载抛错，验证 fail 且状态 failed
  const data2 = join(tmp, 'starter-data2')
  const out2 = join(tmp, 'music2', 'starter')
  const storage2 = createStorage({ dataDir: data2 })
  const starterFail = createStarter({
    storage: storage2,
    library: stubLibrary,
    logger: { warn: () => {} },
    deps: {
      catalog: [catalog[0]],
      outDir: out2,
      verify: async () => ({ ok: true, mime: 'audio/flac', license: 'Public domain', licenseUrl: 'x', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Good.flac', author: 'A', verifiedAt: Date.now() }),
      download: async () => { throw new Error('网络超时') },
      transcode: async () => {},
      lock: { acquire: async () => true, release: async () => {} },
    },
  })
  starterFail.provision()
  const failState = await waitFor(async () => ['done', 'failed', 'deferred'].includes((await starterFail.state()).status)) && await starterFail.state()
  assert(failState.status === 'failed' && failState.tracks[0].status === 'fail' && /网络超时/.test(failState.tracks[0].note), '下载失败优雅跳过：不抛异常，状态 failed + 中文原因')
  // 撞锁 → deferred，不阻塞
  const data3 = join(tmp, 'starter-data3')
  const starterLocked = createStarter({
    storage: createStorage({ dataDir: data3 }),
    library: stubLibrary,
    logger: { warn: () => {} },
    deps: {
      catalog: [catalog[0]],
      outDir: join(tmp, 'music3', 'starter'),
      verify: async () => ({ ok: true, mime: 'audio/flac', license: 'Public domain' }),
      download: async () => {},
      transcode: async () => {},
      lock: { acquire: async () => false, release: async () => {} },
    },
  })
  starterLocked.provision()
  const lockedState = await waitFor(async () => ['done', 'failed', 'deferred'].includes((await starterLocked.state()).status)) && await starterLocked.state()
  assert(lockedState.status === 'deferred' && /下载管线正在运行/.test(lockedState.note ?? ''), '撞锁 deferred：说明原因不绕锁')

  // ================= B. onboarding 状态机 =================
  const makeStubLibrary = (tracks = []) => ({
    tracks,
    added: [],
    snapshot: () => ({ tracks, scannedAt: 1 }),
    ensureScanned: async () => ({ tracks, scannedAt: 1 }),
    addDirectory: async (p) => { tracks.push({ id: `custom-${p}` }); return true },
  })
  // B1 空库 + starter 完成
  const ob1StartCalled = { n: 0 }
  const on1 = createOnboarding({
    storage: createStorage({ dataDir: join(tmp, 'ob1') }),
    library: makeStubLibrary(),
    starter: { state: async () => ({ status: 'idle', total: 4, done: 0, tracks: [] }), provision: () => { ob1StartCalled.n++; return true } },
    logger: { warn: () => {} },
  })
  const s1 = await on1.state()
  assert(s1.completed === false && s1.libraryConfigured === false, 'onboarding 空库首启：completed=false / libraryConfigured=false')
  const done1 = await on1.complete({ prefs: { taste: { genres: ['jazz'], languages: ['日语'] } }, libraryMode: 'starter' })
  assert(!done1.error && done1.state.completed === true && done1.state.mode === 'starter' && done1.state.libraryConfigured === false, 'complete(starter)：completed=true / mode=starter / libraryConfigured=false')
  assert(done1.startedStarter === true && ob1StartCalled.n === 1, 'complete(starter) 触发 starter provisioning（一次）')
  assert(JSON.stringify(done1.state.prefs.taste) === JSON.stringify({ genres: ['jazz'], languages: ['日语'] }), 'complete 保存 taste 偏好')
  const on1b = createOnboarding({
    storage: createStorage({ dataDir: join(tmp, 'ob1') }),
    library: makeStubLibrary(),
    starter: { state: async () => ({ status: 'done', total: 4, done: 3, tracks: [] }), provision: () => true },
    logger: { warn: () => {} },
  })
  const s1b = await on1b.state()
  assert(s1b.completed === true && s1b.mode === 'starter', 'onboarding 状态跨实例持久化（本地 onboarding.json）')

  // B2 既有非空曲库 → 自动 completed（老用户零打扰）
  const on2 = createOnboarding({
    storage: createStorage({ dataDir: join(tmp, 'ob2') }),
    library: makeStubLibrary([{ id: 'existing-1' }, { id: 'existing-2' }]),
    starter: { state: async () => ({ status: 'idle', total: 4, done: 0, tracks: [] }), provision: () => { throw new Error('不应启动') } },
    logger: { warn: () => {} },
  })
  const s2 = await on2.state()
  assert(s2.completed === true && s2.mode === 'existing' && s2.libraryConfigured === true, '既有非空曲库自动 completed=true / mode=existing')
  const s2Again = await createOnboarding({
    storage: createStorage({ dataDir: join(tmp, 'ob2') }),
    library: makeStubLibrary(),
    starter: { state: async () => ({ status: 'idle', total: 4, done: 0, tracks: [] }), provision: () => { throw new Error('不应启动') } },
    logger: { warn: () => {} },
  }).state()
  assert(s2Again.completed === true && s2Again.mode === 'existing', '自动 completed 已落盘（库为空后也不回退）')

  // B3 用户自选曲库
  const customMusic = join(tmp, 'my-music')
  await mkdir(customMusic, { recursive: true })
  const lib3 = makeStubLibrary()
  const on3 = createOnboarding({
    storage: createStorage({ dataDir: join(tmp, 'ob3') }),
    library: lib3,
    starter: { state: async () => null, provision: () => true },
    logger: { warn: () => {} },
  })
  const done3 = await on3.complete({ libraryMode: 'local', libraryPath: customMusic, prefs: { taste: { genres: [] } } })
  assert(!done3.error && done3.state.mode === 'custom' && done3.state.libraryConfigured === true, 'complete(local)：mode=custom / libraryConfigured=true')
  assert(done3.state.libraryPath && done3.state.libraryPath.length > 0, 'complete(local)：回传规范化 libraryPath')
  assert(lib3.tracks.length === 1, 'complete(local)：自定义目录已挂载并扫描')
  // 「使用我已有的音乐库」不带路径 → 采用已扫描曲库
  const on3b = createOnboarding({
    storage: createStorage({ dataDir: join(tmp, 'ob3b') }),
    library: makeStubLibrary([{ id: 'liked-1' }]),
    starter: { state: async () => null, provision: () => { throw new Error('不应启动') } },
    logger: { warn: () => {} },
  })
  const done3b = await on3b.complete({ libraryMode: 'local', prefs: { taste: { genres: ['jazz'] } } })
  assert(!done3b.error && done3b.state.mode === 'existing' && done3b.state.libraryConfigured === true && done3b.state.libraryPath === null, 'complete(local) 不带路径：采用已扫描曲库（mode=existing）')
  const badPath = await on3.complete({ libraryMode: 'local', libraryPath: join(tmp, 'no-such-dir') })
  assert(Boolean(badPath.error) && /不存在/.test(badPath.error), '不存在的曲库路径 → 中文 400（不挂载）')
  const badPrefs = await on3.complete({ libraryMode: 'skip', prefs: 'not-an-object' })
  assert(Boolean(badPrefs.error) && /JSON 对象/.test(badPrefs.error), '非法 prefs → 中文错误')
  const bigPrefs = await on3.complete({ libraryMode: 'skip', prefs: { blob: 'x'.repeat(5000) } })
  assert(Boolean(bigPrefs.error) && /过大/.test(bigPrefs.error), '超大 prefs → 拒绝（上限 4KB）')

  // B4 重启恢复自定义曲库
  const lib4 = makeStubLibrary()
  const on4 = createOnboarding({
    storage: createStorage({ dataDir: join(tmp, 'ob3') }),
    library: lib4,
    starter: { state: async () => null, provision: () => true },
    logger: { warn: () => {} },
  })
  await on4.state()
  assert(lib4.tracks.length === 1, 'onboarding 重启后自动恢复用户自选曲库根')

  // ================= C. 路由 =================
  const onRoute = createOnboarding({
    storage: createStorage({ dataDir: join(tmp, 'ob-route') }),
    library: makeStubLibrary(),
    starter: { state: async () => ({ status: 'idle', total: 0, done: 0, tracks: [] }), provision: () => true },
    logger: { warn: () => {} },
  })
  const routes = []
  registerOnboardingRoutes({ register: (r) => { routes.push(r); return () => {} } }, { onboarding: onRoute, logger: { warn: () => {} } })
  const stateRoute = routes.find((r) => r.path === '/dsh-music/api/onboarding/state')
  const completeRoute = routes.find((r) => r.path === '/dsh-music/api/onboarding/complete')
  assert(stateRoute?.kind === 'exact' && completeRoute?.kind === 'exact', 'onboarding 两条路由已注册（exact）')
  const callRoute = async (route, method, bodyText) => {
    let code = 0
    let payload = null
    const req = {
      method,
      on: (evt, fn) => {
        if (evt === 'data' && bodyText) fn(Buffer.from(bodyText))
        if (evt === 'end') fn()
      },
    }
    const res = {
      writeHead: (c) => { code = c },
      end: (b) => { try { payload = JSON.parse(b) } catch { payload = b } },
    }
    await route.handler(req, res)
    return { code, payload }
  }
  const rState = await callRoute(stateRoute, 'GET')
  assert(rState.code === 200 && rState.payload.completed === false && rState.payload.starter?.status === 'idle', 'GET state 200 返回 completed/libraryConfigured/starter')
  const rPost = await callRoute(completeRoute, 'POST', JSON.stringify({ libraryMode: 'skip' }))
  assert(rPost.code === 200 && rPost.payload.ok === true && rPost.payload.state.completed === true, 'POST complete 200 返回 ok+state')
  const rBadJson = await callRoute(completeRoute, 'POST', '{oops')
  assert(rBadJson.code === 400 && /JSON/.test(rBadJson.payload.error), 'POST 非法 JSON → 400 中文')
  const rBadPath = await callRoute(completeRoute, 'POST', JSON.stringify({ libraryMode: 'local', libraryPath: '/definitely/not/here' }))
  assert(rBadPath.code === 400 && /不存在/.test(rBadPath.payload.error), 'POST 错误曲库路径 → 400 中文')
  const rGetOnPost = await callRoute(completeRoute, 'GET')
  assert(rGetOnPost.code === 405, 'complete GET → 405')
  const rPostOnState = await callRoute(stateRoute, 'POST')
  assert(rPostOnState.code === 405, 'state POST → 405')

  // ================= D. 真实 library.addDirectory =================
  const realMusic = join(tmp, 'real-music')
  await mkdir(realMusic, { recursive: true })
  await writeFile(join(realMusic, '歌手A - 歌名B.mp3'), Buffer.alloc(2048, 3))
  const realLibrary = createLibrary({
    storage: createStorage({ dataDir: join(tmp, 'lib-real') }),
    config: { directories: [] },
    logger: { warn: () => {} },
  })
  const added = await realLibrary.addDirectory(realMusic, 'custom')
  const snap = realLibrary.snapshot()
  assert(added === true && snap.tracks.length === 1 && snap.tracks[0].title === '歌名B', 'library.addDirectory 运行时挂载并扫描（文件名回退解析标签）')
  assert(realLibrary.roots().some((r) => r.endsWith('real-music')), 'library.roots() 含新挂载目录（音频路由越界防线可覆盖）')
} finally {
  await sleep(120)
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
console.log(failures === 0 ? '全部通过' : `${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
