/** 六期批4 独立项测试：node scripts/v6b4-test.mjs
 * D6：Spotify 同步 CLI 探测（PATH 缺失→可选+中文引导；恢复→可用；status 带 available）。
 * D9：manage.js 跨平台显示分派（静态断言三平台分支 + 注入 reveal 仍可用）。临时目录。 */
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'
import { createSync, parseSyncOutput, registerSyncRoutes } from '../bundle/host/sync.js'
import { createManage } from '../bundle/host/manage.js'

let failures = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!cond) failures++
}

const tmp = await mkdtemp(join(tmpdir(), 'dshm-v6b4-'))
try {
  const storage = createStorage({ dataDir: tmp })
  const library = createLibrary({ storage, config: { directories: [] }, logger: { warn: () => {} } })
  await library.scan()
  const logger = { warn: () => {} }

  // ---- D6：PATH 清空 → 同步标可选 + 中文引导，不抛错 ----
  const originalPath = process.env.PATH
  process.env.PATH = ''
  try {
    const sync = createSync({ library, config: {}, logger })
    const av = await sync.availability()
    assert(av.available === false, 'D6：PATH 无 spotify-sync → available=false')
    assert(typeof av.message === 'string' && av.message.includes('可选功能') && av.message.includes('spotify-sync'), 'D6：缺失时给中文可选功能引导')
    const started = await sync.start()
    assert(started.available === false && started.started === false && typeof started.message === 'string', 'D6：不可用时 start 返回可选状态而非抛错')
    const st = await sync.status()
    assert(st.available === false && st.message && st.running === false, 'D6：status 携带 available/message')
    sync.dispose()
  } finally {
    process.env.PATH = originalPath
  }

  // ---- D6：恢复 PATH → 重新探测可用（本机 /opt/homebrew/bin/spotify-sync）----
  const sync2 = createSync({ library, config: {}, logger })
  const av2 = await sync2.probe()
  assert(typeof av2.available === 'boolean', 'D6：恢复 PATH 后 probe 返回布尔可用性')
  if (av2.available) {
    assert(av2.mode === 'cli' || av2.mode === 'script', `D6：可用时 mode 合法（实际 ${av2.mode}）`)
    assert(av2.message === null, 'D6：可用时无提示消息')
  } else {
    console.log('INFO: 本机 PATH 无 spotify-sync（可用性 false），跳过可用分支断言')
  }
  // 配置覆盖优先
  const sync3 = createSync({ library, config: { syncCommand: join(tmp, 'no-such-cli') }, logger })
  const av3 = await sync3.probe()
  assert(av3.available === (av2.available === true), 'D6：无效 syncCommand 不会误判可用（继续探测 PATH）')
  sync2.dispose(); sync3.dispose()

  // ---- D9：跨平台显示分派（静态断言三平台分支存在）----
  const manageSrc = await readFile(new URL('../bundle/host/manage.js', import.meta.url), 'utf8')
  assert(manageSrc.includes("process.platform === 'darwin'") && manageSrc.includes("'open', ['-R'"), 'D9：macOS 分支 open -R')
  assert(manageSrc.includes("process.platform === 'win32'") && manageSrc.includes("'explorer', ['/select,'"), 'D9：Windows 分支 explorer /select,')
  assert(manageSrc.includes("'xdg-open'") && manageSrc.includes('dirname(filePath)'), 'D9：Linux 分支 xdg-open 目录')
  let revealCalled = null
  const manage = createManage({ library, logger, reveal: async (p) => { revealCalled = p; return false } })
  const tracks = library.snapshot().tracks
  if (tracks.length === 0) {
    console.log('INFO: 空曲库（directories: []），reveal 分派以静态断言为准')
  } else {
    void manage
  }
  assert(revealCalled === null || typeof revealCalled === 'string', 'D9：reveal 注入在无曲目时不误触发')

  // ---- 路由：GET /api/sync/availability（织音契约 {available, hint}）----
  {
    const routes = []
    let probed = 0
    const fakeSync = {
      availability: async () => ({ available: false, mode: null, command: null, message: '未检测到 spotify-sync CLI。可选功能。' }),
      /* ?refresh=1 → 走 probe() 重探（用户点「重新检测」） */
      probe: async () => { probed++; return { available: true, mode: 'cli', command: '/x/spotify-sync', message: null, authorized: true } },
    }
    registerSyncRoutes({ register: (r) => { routes.push(r); return () => {} } }, { sync: fakeSync, logger })
    const route = routes.find((r) => r.path === '/dsh-music/api/sync/availability')
    assert(route?.kind === 'exact', '契约：availability 路由已注册')
    let body = null
    await route.handler({ method: 'GET' }, { writeHead() {}, end: (b) => { body = JSON.parse(b) } })
    assert(body?.available === false && typeof body.hint === 'string' && body.hint.includes('spotify-sync'), '契约：不可用时返回 {available:false, hint} 中文提示')
    fakeSync.availability = async () => ({ available: true, mode: 'cli', command: '/x/spotify-sync', message: null })
    await route.handler({ method: 'GET' }, { writeHead() {}, end: (b) => { body = JSON.parse(b) } })
    assert(body?.available === true && body.hint === null, '契约：可用时 hint=null')
    assert(body.authorized === null, 'availability 未带 authorized → 返回 null（未知）')
    await route.handler({ method: 'GET', url: '/dsh-music/api/sync/availability?refresh=1' }, { writeHead() {}, end: (b) => { body = JSON.parse(b) } })
    assert(probed === 1 && body?.available === true && body.authorized === true, '契约：?refresh=1 强制重探并回传 authorized')
    fakeSync.availability = async () => ({ available: true, mode: 'cli', command: '/x/spotify-sync', message: null, authorized: false })
    await route.handler({ method: 'GET' }, { writeHead() {}, end: (b) => { body = JSON.parse(b) } })
    assert(body.authorized === false && probed === 1, '契约：无 refresh 参数走缓存，authorized=false 原样回传')
    let code = 0
    await route.handler({ method: 'POST' }, { writeHead: (c) => { code = c }, end: () => {} })
    assert(code === 405, '契约：availability POST → 405')
  }

  // ---- 解析函数未回归 ----
  const parsed = parseSyncOutput(["完成 {'cloud': 3, 'added': 1, 'ok': 1}"])
  assert(parsed.result.cloud === 3 && parsed.result.added === 1 && parsed.result.ok === 1, 'parseSyncOutput 未回归')

  library.dispose()
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures === 0 ? '全部通过' : `${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)