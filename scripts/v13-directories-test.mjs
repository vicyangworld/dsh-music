/** v13 设置页目录管理测试：node scripts/v13-directories-test.mjs（零网络、临时目录）
 * 覆盖：list/add/remove 生命周期；持久化（模拟重启：同一 storage 重建 createLibrary 仍生效）；
 * 默认目录可移除且移除被持久化；add 去重；路由 405/400/200；onboarding 场景（addDirectory 后重启不丢）。 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'
import { registerRoutes } from '../bundle/host/routes.js'

let failures = 0
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  if (!cond) failures++
}
const logger = { warn: () => {} }

const tmp = await mkdtemp(join(tmpdir(), 'dshm-v13dir-'))
try {
  const dataDir = join(tmp, 'data')
  const musicA = join(tmp, 'musicA')
  const musicB = join(tmp, 'musicB')
  await mkdir(musicA, { recursive: true })
  await mkdir(musicB, { recursive: true })
  await writeFile(join(musicA, '歌手A - 歌一.m4a'), Buffer.from('x'))
  await writeFile(join(musicB, '歌手B - 歌二.m4a'), Buffer.from('x'))

  const storage = createStorage({ dataDir })
  const config = { directories: [{ path: musicA, source: 'default' }] }
  const lib = createLibrary({ storage, config, logger })

  let list = await lib.listDirectories()
  assert(list.length === 1 && list[0].path === musicA && list[0].source === 'default', '列表：初始目录含默认项并标 source')

  // add：新目录入库并重扫
  assert((await lib.addDirectory(musicB)) === true, '新增：返回 true')
  list = await lib.listDirectories()
  assert(list.some((d) => d.path === musicB && d.source === 'custom'), '新增：custom 目录在列表')
  assert(lib.snapshot().tracks.length === 2, `新增：重扫后 2 首（实际 ${lib.snapshot().tracks.length}）`)
  assert((await lib.addDirectory(musicB)) === false, '新增：重复添加返回 false')

  // 持久化：同 storage 重建（模拟重启，无 config.directories 默认表）
  const lib2 = createLibrary({ storage, config: {}, logger })
  list = await lib2.listDirectories()
  assert(list.some((d) => d.path === musicA) && list.some((d) => d.path === musicB), '持久化：重启后自定义目录仍在（根治 addDirectory 丢失）')
  await lib2.scan()
  assert(lib2.snapshot().tracks.length === 2, '持久化：重启重扫仍 2 首')

  // remove：移除默认目录也允许，且持久化
  assert((await lib2.removeDirectory(musicA)) === true, '移除：默认目录可移除返回 true')
  assert((await lib2.removeDirectory(musicA)) === false, '移除：重复移除返回 false')
  list = await lib2.listDirectories()
  assert(list.length === 1 && list[0].path === musicB, '移除：列表只剩 musicB')
  assert(lib2.snapshot().tracks.length === 1, '移除：重扫后剩 1 首')
  const lib3 = createLibrary({ storage, config, logger })
  list = await lib3.listDirectories()
  assert(list.length === 1 && list[0].path === musicB, '持久化：默认目录的移除在重启后仍生效')

  // onboarding 场景：addDirectory(source) 持久化
  assert((await lib3.addDirectory(musicA, 'onboarding')) === true, 'onboarding：addDirectory(source) 成功')
  const lib4 = createLibrary({ storage, config: {}, logger })
  list = await lib4.listDirectories()
  assert(list.some((d) => d.path === musicA && d.source === 'onboarding'), 'onboarding：重启后不丢（不再依赖 onboarding.json 重放）')

  // ---- 路由 ----
  const routes = []
  registerRoutes({ register: (r) => { routes.push(r); return () => {} } }, { library: lib4, playback: null, storage, logger })
  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]))
  const dirsRoute = byPath['/dsh-music/api/library/directories']
  const addRoute = byPath['/dsh-music/api/library/directories/add']
  const rmRoute = byPath['/dsh-music/api/library/directories/remove']
  assert(!!dirsRoute && !!addRoute && !!rmRoute, '路由：三端点已注册')
  assert(routes.some((r) => r.path === '/dsh-music/api/library'), '路由：原有 /api/library 不受影响')

  const call = async (route, method, body, rawBody) => {
    const out = { status: 0, body: null }
    const payload = rawBody !== undefined ? [Buffer.from(rawBody)] : body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const fakeReq = {
      method, url: route.path,
      on(ev, fn) {
        if (ev === 'data') for (const c of payload) fn(c)
        if (ev === 'end') process.nextTick(fn)
        return fakeReq
      },
      destroy() {},
    }
    const res = { writeHead: (c) => { out.status = c }, end: (b) => { try { out.body = b ? JSON.parse(b) : null } catch { out.body = b } } }
    await route.handler(fakeReq, res)
    return out
  }
  const g = await call(dirsRoute, 'GET')
  assert(g.status === 200 && Array.isArray(g.body.directories) && g.body.directories.length === 2, '路由：GET 列表 200')
  assert((await call(dirsRoute, 'POST')).status === 405, '路由：列表 POST → 405')
  assert((await call(addRoute, 'POST', {})).status === 400, '路由：add 缺 path → 400')
  assert((await call(addRoute, 'POST', null, 'nope')).status === 400, '路由：add 坏 JSON → 400')
  assert((await call(addRoute, 'GET')).status === 405, '路由：add GET → 405')
  const a = await call(addRoute, 'POST', { path: musicB })
  assert(a.status === 200 && a.body.added === false, '路由：add 重复 → added:false')
  assert(typeof a.body.library?.tracks?.length === 'number', '路由：add 返回曲库快照')
  const r = await call(rmRoute, 'POST', { path: musicA })
  assert(r.status === 200 && r.body.removed === true && r.body.directories.length === 1, '路由：remove → removed:true 且列表更新')
  assert((await call(rmRoute, 'POST', { path: musicA })).body.removed === false, '路由：remove 不存在 → removed:false')
  assert((await call(rmRoute, 'POST', {})).status === 400, '路由：remove 缺 path → 400')
} finally {
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
