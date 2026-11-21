#!/usr/bin/env node
/** Standalone preview of the actual Harness client artifact and life service.
 * Only three locally synthesized studies are exposed as the preview library.
 * No user music directories, platform accounts or remote content are accessed.
 *
 * npm run build && npm run preview
 * PORT=4174 npm run preview -- --data-dir /tmp/echo-review-1
 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { createStorage } from '../bundle/host/storage.js'
import { createPlayback } from '../bundle/host/playback.js'
import { registerRoutes } from '../bundle/host/routes.js'
import { createHistory, registerHistoryRoutes } from '../bundle/host/history.js'
import { createLikes, registerLikesRoutes } from '../bundle/host/likes.js'
import { createLifeService, registerLifeRoutes } from '../bundle/host/life.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dataIndex = args.indexOf('--data-dir')
if (dataIndex !== -1 && !args[dataIndex + 1]) throw new Error('--data-dir requires a directory')
const dataDir = resolve(dataIndex !== -1 ? args[dataIndex + 1]
  : process.env.ECHO_PREVIEW_DATA_DIR || join(tmpdir(), `dsh-music-echo-preview-${process.getuid?.() ?? 'local'}`))
const port = Number(process.env.PORT || 4173)
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535')
await mkdir(dataDir, { recursive: true, mode: 0o700 })
const marker = join(dataDir, 'preview-environment.json')
try {
  const parsed = JSON.parse(await readFile(marker, 'utf8'))
  if (parsed.kind !== 'echo-isolated-preview') throw new Error('Not an ECHO preview directory')
} catch (err) {
  if (err.code !== 'ENOENT') throw err
  try {
    await stat(join(dataDir, 'echo-life.json'))
    throw new Error('The selected directory already contains a life archive without a preview marker. Choose an isolated preview directory.')
  } catch (inner) { if (inner.code !== 'ENOENT') throw inner }
  await writeFile(marker, JSON.stringify({ kind: 'echo-isolated-preview', version: 1 }), { mode: 0o600 })
}
const audioDir = join(dataDir, 'synthetic-audio')
await mkdir(audioDir, { recursive: true, mode: 0o700 })

// Original oscillator studies, not samples or melodies from existing music.
function makeStudy(kind, duration = 90) {
  const rate = 22050
  const count = rate * duration
  const pcm = Buffer.alloc(44 + count * 2)
  pcm.write('RIFF', 0); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVE', 8)
  pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20)
  pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(rate, 24); pcm.writeUInt32LE(rate * 2, 28)
  pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(count * 2, 40)
  const frequencies = kind === 0 ? [130.81, 196, 261.63, 329.63]
    : kind === 1 ? [110, 164.81, 220, 277.18] : [146.83, 220, 293.66, 369.99]
  for (let i = 0; i < count; i++) {
    const time = i / rate
    const fade = Math.min(1, time / 2.5, (duration - time) / 3)
    const period = kind === 0 ? 0.48 : kind === 1 ? 2.8 : 0.78
    const position = time % period
    const note = frequencies[Math.floor(time / period) % frequencies.length]
    const envelope = kind === 1 ? 0.35 + 0.25 * Math.sin(time * 0.45) : Math.exp(-position * (kind === 0 ? 7 : 4))
    const tone = Math.sin(2 * Math.PI * note * time)
      + (kind === 0 ? 0.36 : 0.11) * Math.sin(2 * Math.PI * note * 2 * time)
      + (kind === 2 ? 0.22 : 0.04) * Math.sin(2 * Math.PI * note * 3 * time)
    const pad = 0.12 * Math.sin(2 * Math.PI * frequencies[0] * 0.5 * time) * (0.6 + 0.4 * Math.sin(time * 0.17))
    const value = Math.max(-0.9, Math.min(0.9, (tone * envelope * 0.16 + pad) * fade))
    pcm.writeInt16LE(Math.round(value * 32767), 44 + i * 2)
  }
  return pcm
}

const studies = [
  { id: 'ec00000000000001', title: '折线 · 原创合成试听', genre: 'electronic', kind: 0 },
  { id: 'ec00000000000002', title: '潮汐 · 原创合成试听', genre: 'ambient', kind: 1 },
  { id: 'ec00000000000003', title: '余响 · 原创合成试听', genre: 'instrumental', kind: 2 },
]
const records = new Map()
const tracks = []
for (const study of studies) {
  const filePath = join(audioDir, `${study.id}.wav`)
  try { await stat(filePath) } catch (err) {
    if (err.code !== 'ENOENT') throw err
    await writeFile(filePath, makeStudy(study.kind), { mode: 0o600 })
  }
  const track = {
    id: study.id, title: study.title, artist: 'ECHO Preview', album: '原创合成音轨 / 仅用于预览',
    duration: 90, durationMs: 90000, format: 'wav', source: 'echo-preview', genre: study.genre,
    audioUrl: `/dsh-music/audio/${study.id}`, coverUrl: null,
  }
  tracks.push(track)
  records.set(study.id, { id: study.id, filePath, source: 'echo-preview', format: 'wav', mime: 'audio/wav', meta: { ...track, hasCover: false } })
}
const scannedAt = Date.now()
const snapshot = () => ({ tracks, scannedAt, preview: true, note: '仅包含三段本地原创合成试听音轨。' })
const library = {
  getRecord: (id) => records.get(id), snapshot,
  ensureScanned: async () => snapshot(), rescan: async () => snapshot(),
  roots: () => [audioDir],
}
const logger = { warn: (message) => console.warn(message) }
const storage = createStorage({ dataDir })
await storage.ready
const playback = createPlayback({ validateTrack: (id) => records.has(id) })
const history = createHistory({ storage, library, logger })
const likes = createLikes({ storage, library, history, logger, download: {
  core: { checkVerification: async () => '独立预览不提供联网下载。' },
  isRunning: () => false,
} })
const life = createLifeService({ storage, library, logger })
const registrations = []
const webServer = { register(def) {
  registrations.push(def)
  return () => { const index = registrations.indexOf(def); if (index >= 0) registrations.splice(index, 1) }
} }
registerRoutes(webServer, { library, playback, storage, logger })
registerHistoryRoutes(webServer, { history, likes, logger })
registerLikesRoutes(webServer, { likes, logger })
registerLifeRoutes(webServer, { life, logger })

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' })
  res.end(body)
}
async function body(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 65536) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

const previewEntry = join(repo, 'src/preview/entry.jsx')
let previewBuild = null
let previewMtime = null
let building = null
async function previewScript() {
  const mtime = (await stat(previewEntry)).mtimeMs
  if (previewBuild && previewMtime === mtime) return previewBuild
  if (!building) {
    building = build({
      entryPoints: [previewEntry], absWorkingDir: repo, bundle: true, write: false,
      format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent',
    }).then((result) => {
      previewBuild = Buffer.from(result.outputFiles[0].contents)
      previewMtime = mtime
      return previewBuild
    }).finally(() => { building = null })
  }
  return building
}
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ECHO · 生命原型</title><style>html,body,#root{margin:0;min-height:100%;width:100%;height:100%;}body{background:#efeee8;color:#2e3733;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}*{box-sizing:border-box}button,input,textarea{font:inherit}</style></head><body><div id="root"></div><script src="/preview.js"></script></body></html>`

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  try {
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return }
    const registered = registrations.find((r) => r.kind === 'exact' && r.path === url.pathname)
      || registrations.find((r) => r.kind === 'prefix' && (url.pathname === r.path || url.pathname.startsWith(`${r.path}/`)))
    if (registered) return await registered.handler(req, res)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(req.method === 'HEAD' ? undefined : html); return
    }
    if (url.pathname === '/preview.js' || url.pathname === '/client/index.js' || url.pathname === '/bundle/client/index.js') {
      const content = url.pathname === '/preview.js' ? await previewScript() : await readFile(join(repo, 'bundle/client/index.js'))
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': content.length, 'Cache-Control': 'no-store' })
      res.end(req.method === 'HEAD' ? undefined : content); return
    }
    if (url.pathname === '/dsh-music/api/onboarding/state' || url.pathname === '/dsh-music/api/onboarding/complete') {
      return json(res, 200, { completed: true, mode: 'local', libraryConfigured: true, libraryPath: '独立预览 / 原创合成试听', starter: null, taste: null })
    }
    if (url.pathname === '/dsh-music/api/sync/availability') return json(res, 200, { available: false, hint: '独立预览不连接音乐平台。' })
    if (url.pathname === '/dsh-music/api/sync/status') return json(res, 200, { running: false, available: false, result: null, error: null })
    if (url.pathname === '/dsh-music/api/download/status') return json(res, 200, { running: false, total: 0, done: 0, items: [], error: null, finishedAt: 0 })
    if (url.pathname === '/dsh-music/api/curation/interpret') return json(res, req.method === 'GET' ? 200 : 503, { available: false, error: req.method === 'GET' ? undefined : '预览未连接模型服务。' })
    if (url.pathname === '/dsh-music/api/lyrics') return json(res, 200, { synced: false, lines: [], text: '', source: null })
    if (url.pathname === '/dsh-music/api/reco/artist-image') return json(res, 200, { imageUrl: null, thumbnailUrl: null })
    if (url.pathname === '/dsh-music/api/artist') return json(res, 200, { name: 'ECHO Preview', biography: '本地合成的原创试听音轨。', sections: [], sources: [] })
    if (url.pathname === '/dsh-music/api/reco/sections' || url.pathname === '/dsh-music/api/reco/sections/refresh') {
      return json(res, 200, { today: tracks.map((track) => ({ ...track, trackId: track.id, inLibrary: true })), artist: [], new: [], generatedAt: scannedAt, exploreOnly: true, note: '独立预览仅展示原创合成试听音轨；没有调用联网推荐。' })
    }
    if (url.pathname === '/dsh-music/api/reco/status' || url.pathname === '/dsh-music/api/reco') return json(res, 200, { running: false, items: [], generatedAt: 0 })
    if (url.pathname === '/dsh-music/api/library/search' || url.pathname === '/dsh-music/api/reco/style') {
      const q = (url.searchParams.get('q') || '').toLowerCase()
      const found = tracks.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(q))
      return json(res, 200, { items: found, tracks: found, local: found, remote: [], total: found.length })
    }
    if (url.pathname === '/dsh-music/api/library/preview' && req.method === 'POST') {
      const input = await body(req)
      const found = tracks.find((track) => track.title === input.title && track.artist === input.artist)
      return found ? json(res, 200, { status: 'ready', audioUrl: found.audioUrl }) : json(res, 404, { error: '独立预览只有三段原创合成试听。' })
    }
    if (url.pathname === '/dsh-music/api/library/preview/status') return json(res, 200, { status: 'idle' })
    return json(res, 404, { error: '独立预览未提供这个功能。安装插件后可使用宿主支持的能力。' })
  } catch (err) {
    console.error(`Preview ${url.pathname}: ${err.message}`)
    if (!res.headersSent) return json(res, 500, { error: err.message })
    res.destroy()
  }
})
server.listen(port, '127.0.0.1', () => {
  console.log(`ECHO preview: http://127.0.0.1:${server.address().port}`)
  console.log(`Isolated preview data: ${dataDir}`)
  console.log('Audio: three original locally synthesized studies; no user music directories are read.')
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
