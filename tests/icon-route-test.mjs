/* 图标路由冒烟：node tests/icon-route-test.mjs
 * 覆盖：GET/HEAD /dsh-music/icon.png 返回包内 icon.png（PNG 魔数、Content-Type、缓存头）；
 * 其它方法 405；图标缺失时 404 JSON（客户端据此退回内嵌 Logo）。 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { registerRoutes } from '../bundle/host/routes.js'

const routes = []
const webServer = { register: (r) => { routes.push(r); return () => {}; } }
registerRoutes(webServer, {
  library: {}, playback: {}, storage: {},
  logger: { warn: () => {} },
})
const icon = routes.find((r) => r.path === '/dsh-music/icon.png')
assert.ok(icon, '应注册 /dsh-music/icon.png')
assert.equal(icon.kind, 'exact')

function fakeReq(method, url) {
  const req = Readable.from([])
  req.method = method
  req.url = url
  return req
}
function fakeRes() {
  const out = { status: 0, headers: {}, chunks: [] }
  out.writeHead = (status, headers) => { out.status = status; out.headers = headers || {}; }
  out.end = (body) => { if (body) out.chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body))); }
  out.body = () => Buffer.concat(out.chunks);
  return out
}

const expected = await readFile(new URL('../bundle/icon.png', import.meta.url))
assert.ok(expected.length > 8 && expected[0] === 0x89 && expected[1] === 0x50, 'icon.png 应是 PNG')

let res = fakeRes()
await icon.handler(fakeReq('GET', '/dsh-music/icon.png'), res)
assert.equal(res.status, 200)
assert.equal(res.headers['Content-Type'], 'image/png')
assert.equal(res.headers['Cache-Control'], 'private, max-age=86400')
assert.ok(res.body().equals(expected), '应原样返回包内 icon.png')

res = fakeRes()
await icon.handler(fakeReq('HEAD', '/dsh-music/icon.png'), res)
assert.equal(res.status, 200)
assert.equal(res.body().length, 0, 'HEAD 不带正文')

res = fakeRes()
await icon.handler(fakeReq('POST', '/dsh-music/icon.png'), res)
assert.equal(res.status, 405)
assert.equal(JSON.parse(res.body().toString('utf8')).error, '方法不允许')

console.log('全部通过（4 项）')
