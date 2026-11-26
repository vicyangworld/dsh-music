#!/usr/bin/env node
/* 十三期：入库队列——运行中再提交并入当前批次（front=true 置顶到待下载列表顶部），不再 409。
 * 运行：node tests/download-queue-test.mjs */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createStorage } from '../bundle/host/storage.js'
import { createDownload, registerDownloadRoutes } from '../bundle/host/download.js'

const V = { source: 'MusicBrainz', url: 'https://musicbrainz.org/recording/q', verifiedAt: Date.now() }
const tmp = await mkdtemp(join(tmpdir(), 'dshm-dlq-'))
const storage = createStorage({ dataDir: join(tmp, 'data') })
const logger = { warn: () => {} }
const library = { rescan: async () => {}, findByFile: () => null }
const download = createDownload({ storage, library, config: { pipelineLockPath: join(tmp, 'q.lock'), outDirOverride: join(tmp, 'out') }, logger })

/* 可控的假管线：每首歌一个闸门，release(title) 放行 */
const gates = new Map()
const order = []
download.core.processItem = async (item) => {
  order.push(item.title)
  const g = gates.get(item.title)
  if (g && !g.open) await g.promise
  return { status: 'ok', note: null, file: null }
}
const gate = (title) => {
  const g = { open: false, promise: null, resolve: null }
  g.promise = new Promise((r) => { g.resolve = r })
  gates.set(title, g)
  return g
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))
const item = (title) => ({ artist: '甲', title, verification: V })
const titles = (snap) => snap.items.map((it) => `${it.title}:${it.status}`).join(' ')

try {
  const names = ['A', 'B', 'C', 'D', 'E', 'F']
  for (const n of names) await download.archiveVerification(item(n))
  assert.equal(await download.validate(names.map((n) => item(n))), null, '核实留档后校验通过')

  // ---- 运行中 enqueue(front) 插到待处理队首；enqueue() 排到队尾 ----
  gate('A')
  const first = download.enqueue([item('A'), item('B')])
  assert.equal(first.queued, 0, '空闲时起新批次')
  assert.equal(first.snapshot.total, 2)
  await tick(); await tick()
  assert.deepEqual(order, ['A'], 'A 正在下载（闸门未开）')
  assert.equal(download.isRunning(), true)
  const s1 = download.status()
  assert.equal(s1.pending, 1, 'B 排队中')
  assert.equal(titles(s1), 'A:downloading B:pending')

  const front = download.enqueue([item('C'), item('D')], { front: true })
  assert.equal(front.queued, 2, '并入运行中批次')
  assert.equal(front.snapshot.runId, first.snapshot.runId, '同一批次')
  assert.equal(front.snapshot.total, 4)
  const back = download.enqueue([item('E')])
  assert.equal(back.queued, 1)
  const s2 = download.status()
  assert.equal(titles(s2), 'A:downloading C:pending D:pending B:pending E:pending', 'front 插到待下载列表顶部，默认排队尾')
  assert.equal(s2.pending, 4)
  assert.equal(s2.queued, 3, 'status 带 queued 计数')

  gates.get('A').open = true; gates.get('A').resolve()
  for (let i = 0; i < 40 && download.isRunning(); i++) await tick(10)
  assert.equal(download.isRunning(), false, '批次结束')
  assert.deepEqual(order, ['A', 'C', 'D', 'B', 'E'], '执行顺序：正在下载的先完成，其后是置顶的 C、D，再是原来的 B，最后队尾 E')
  const done = download.status()
  assert.equal(done.done, 5)
  assert.equal(done.pending, 0)
  assert.ok(done.items.every((it) => it.status === 'ok'))
  const saved = JSON.parse(await readFile(join(tmp, 'data', 'downloads.json'), 'utf8'))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].items.length, 5, '一次运行记录包含并入的条目')

  // ---- 收尾阶段（finishing）再提交 → 等锁释放后起新批次，不撞自己 ----
  gates.clear(); order.length = 0
  const late = download.enqueue([item('F')])
  assert.equal(late.queued, 0, '空闲 → 新批次')
  for (let i = 0; i < 40 && download.isRunning(); i++) await tick(10)
  assert.deepEqual(order, ['F'])
  assert.equal(download.status().running, false)

  // ---- 路由：运行中 POST 不再 409，front 透传 ----
  const routes = []
  registerDownloadRoutes({ register: (r) => { routes.push(r); return () => {} } }, { download, logger })
  const post = routes.find((r) => r.path === '/dsh-music/api/download')
  const call = async (body) => {
    const res = { code: 0, body: '', writeHead(c, h) { this.code = c; this.head = h }, end(b) { this.body = b } }
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', url: '/dsh-music/api/download' })
    await post.handler(req, res)
    return { code: res.code, json: JSON.parse(res.body) }
  }
  gate('A'); order.length = 0
  const r1 = await call({ items: [item('A'), item('B')] })
  assert.equal(r1.code, 202)
  await tick(); await tick()
  const r2 = await call({ items: [item('C')], front: true })
  assert.equal(r2.code, 202, '运行中提交 → 202（并入队列），不再 409')
  assert.equal(r2.json.queued, 1)
  assert.equal(r2.json.total, 3)
  const r3 = await call({ items: [item('D')] })
  assert.equal(r3.code, 202)
  assert.equal(r3.json.queued, 1)
  assert.equal(titles(download.status()), 'A:downloading C:pending B:pending D:pending')
  gates.get('A').open = true; gates.get('A').resolve()
  for (let i = 0; i < 40 && download.isRunning(); i++) await tick(10)
  assert.deepEqual(order, ['A', 'C', 'B', 'D'])
  const r4 = await call({ items: [] })
  assert.equal(r4.code, 400, '空批次仍然 400')
  const r5 = await call({ items: [{ artist: 'x', title: 'y' }], front: true })
  assert.equal(r5.code, 400, '无核实仍然 400')

  console.log('全部通过（下载队列：front 置顶 / 队尾 / 收尾期新批次 / 路由 202）')
} finally {
  download.dispose()
  await tick(30)
  await rm(tmp, { recursive: true, force: true })
}
