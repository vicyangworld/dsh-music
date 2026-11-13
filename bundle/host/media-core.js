/** 媒体管线共享核心：下载产物原语 + Range 流式。
 * 被 download.js（入库下载）与 preview.js（试听缓存）共用，保证同一套管线语义：
 * ytsearch5 时长择优 → itag 140 优先（YT Music ~128k AAC 上限）→ ffmpeg 原流拷贝+封面+标签。
 * 锁不在此模块（由调用方持同一把管线锁，见 lock.js）；本模块自身绝不并发执行两个下载。 */
import { mkdir, readdir, stat, writeFile, readFile } from 'node:fs/promises'
import { createReadStream, stat as statCb } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createToolRunner } from './binaries.js'

const VERIFICATION_MAX_AGE_MS = 30 * 24 * 3600 * 1000
// D1 修复（QA 三期批3）：核实来源白名单 + musicbrainz.org 域名 + 留档交叉比对。
// 当前唯一可信联网来源是 MusicBrainz（reco/verify.js、search.js、候选核实管线都写它；
// spotify-sync 收藏曲不经下载管线，不需要 source）。留档两处：
//   cache/verifications/<norm-key>.json（verify.js 写，单对象 {verification}）
//   verifications/<raw-key>.json（archiveVerification 写，数组 [{verification}]）
const TRUSTED_SOURCE = 'musicbrainz'
const TRUSTED_HOSTS = new Set(['musicbrainz.org', 'www.musicbrainz.org'])

/** MB 缓存 key 规范（与 reco/verify.js norm 一致：小写+去常见标点空白）。 */
function mbNorm(s) {
  return String(s ?? '').toLowerCase().replace(/[\s'"’·・\-—–,，.。!！?？:：;；()（）\[\]【】]/g, '')
}
function archiveKey(artist, title, raw) {
  const src = raw ? `${artist}::${title}` : mbNorm(`${artist}::${title}`)
  return createHash('sha1').update(src).digest('hex').slice(0, 16)
}

/** 与 sync.py sanitize 一致：去文件系统非法字符，截断 180。 */
export function sanitize(name) {
  return String(name).replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 180)
}

/** 核实记录留档（红线 12）：verifications/<sha16 raw key>.json（数组）。
 * 独立导出供 search.js 等非 core 持有者使用；archiveHasMatch 会读这里。 */
export async function archiveVerificationFile(dataDir, item) {
  const key = createHash('sha1').update(`${item.artist}::${item.title}`).digest('hex').slice(0, 16)
  const dir = join(dataDir, 'verifications')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${key}.json`)
  let records = []
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'))
    if (Array.isArray(saved)) records = saved
  } catch { /* 首次 */ }
  records.push({ artist: item.artist, title: item.title, verification: item.verification, receivedAt: Date.now() })
  await writeFile(file, JSON.stringify(records.slice(-20), null, 1), 'utf8')
}

export function createMediaCore({ storage, config = {}, logger } = {}) {
  const warn = (msg) => logger?.warn?.(msg)
  // D1 分发修复：二进制全部经 PATH 探测（config 可覆盖），缺失给中文引导，不硬编码本机路径
  const tools = createToolRunner({ config, logger })
  const run = (name, args, opts) => tools.run(name, args, opts)

  /** 泛化 pick_candidate：ytsearch5，按时长接近度排序择优；时长未知取相关性首位。 */
  async function pickCandidate(query, targetS) {
    const stdout = await run('yt-dlp', ['-J', '--flat-playlist', '--no-warnings', `ytsearch5:${query}`], { timeout: 90000 })
    const entries = (JSON.parse(stdout).entries ?? []).filter((e) => e && e.id)
    if (entries.length === 0) return null
    if (Number.isFinite(targetS) && targetS > 0) {
      entries.sort((a, b) => Math.abs(Number(a.duration || 0) - targetS) - Math.abs(Number(b.duration || 0) - targetS))
    }
    return entries[0]
  }

  async function probeDuration(path) {
    try {
      const stdout = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', path], { timeout: 30000 })
      const d = Number.parseFloat(stdout.trim())
      return Number.isFinite(d) ? d : null
    } catch {
      return null
    }
  }

  /** 封面下载（node22 全局 fetch，20s 超时）；失败返回 null，不阻塞管线。 */
  async function fetchCover(url, dest) {
    if (!url) return null
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!resp.ok) return null
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length <= 1000) return null
      await writeFile(dest, buf)
      return dest
    } catch {
      return null
    }
  }

  /** 留档交叉比对（D1 修复）：提交的核实 url 必须出现在本机联网核实留档中。
   * 合法路径的留档由核实生产者写入：reco/verify.js（cache/verifications，单对象）、
   * search.js 补全（verifications，数组，经 archiveVerification）。伪造 url 没进过
   * 本机 MB 检索流程 → 无留档 → 拒绝。比对 pathname（recording/xxx 尾段），容忍尾斜杠。 */
  async function archiveHasMatch(item) {
    const v = item.verification
    let want
    try {
      want = new URL(String(v?.url ?? '')).pathname.replace(/\/+$/, '')
    } catch {
      return false
    }
    if (!want) return false
    const candidates = [
      join(storage.dataDir, 'cache', 'verifications', `${archiveKey(item.artist, item.title, false)}.json`),
      join(storage.dataDir, 'verifications', `${archiveKey(item.artist, item.title, true)}.json`),
    ]
    for (const file of candidates) {
      let data
      try {
        data = JSON.parse(await readFile(file, 'utf8'))
      } catch {
        continue
      }
      const records = Array.isArray(data) ? data : [data]
      for (const rec of records) {
        const u = rec?.verification?.url
        if (!u) continue
        try {
          if (new URL(u).pathname.replace(/\/+$/, '') === want) return true
        } catch { /* 坏记录跳过 */ }
      }
    }
    return false
  }

  /** 核实前置校验（async，D1 后含联网留档比对）：source 白名单 + MB https 域名 +
   * 30 天时效 + 留档交叉。返回错误消息或 null。 */
  async function checkVerification(item) {
    const v = item.verification
    if (!v || typeof v !== 'object') return '缺少联网核实记录 verification，禁止下载未经核实的歌曲'
    if (typeof v.source !== 'string' || v.source.trim().toLowerCase() !== TRUSTED_SOURCE) {
      return '核实来源 source 不受信任（当前仅支持 MusicBrainz），禁止下载'
    }
    let url
    try {
      url = new URL(String(v.url ?? ''))
    } catch {
      return '核实记录缺少有效来源链接 url'
    }
    if (url.protocol !== 'https:' || !TRUSTED_HOSTS.has(url.hostname)) {
      return '核实链接域名必须为 musicbrainz.org（https），禁止下载'
    }
    const ts = typeof v.verifiedAt === 'number' ? v.verifiedAt : Date.parse(v.verifiedAt)
    if (!Number.isFinite(ts)) return '核实记录缺少有效时间 verifiedAt'
    const age = Date.now() - ts
    if (age > VERIFICATION_MAX_AGE_MS) return '核实记录已过期（超过 30 天），请重新核实'
    if (age < -300000) return '核实记录时间在未来，无效'
    if (!(await archiveHasMatch(item))) {
      return '核实记录在本机留档中不存在（未经过本机联网核实），禁止下载'
    }
    return null
  }

  /** 核实记录留档（红线 12）：~/.dsh/dsh-music/verifications/。 */
  async function archiveVerification(item) {
    return archiveVerificationFile(storage.dataDir, item)
  }

  /** 泛化 process：单曲下载到 outDir + 封面标签封装。outDir 参数化供入库/试听共用。 */
  async function processItem(item, outDir, workdir) {
    const q = `${item.artist} - ${item.title}`
    const stem = sanitize(q)
    const targetS = Number.isFinite(item.durationMs) && item.durationMs > 0 ? item.durationMs / 1000 : null
    for (const ext of ['.m4a', '.opus']) {
      try {
        const st = await stat(join(outDir, stem + ext))
        if (st.size > 10000) return { status: 'skip', note: '文件已存在', file: join(outDir, stem + ext) }
      } catch { /* 不存在 */ }
    }
    const cand = await pickCandidate(q, targetS)
    if (!cand) return { status: 'fail', note: '搜索无结果' }
    const base = join(workdir, cand.id)
    let got = null
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      try {
        await run('yt-dlp', ['-f', '140/bestaudio[ext=m4a]/251/bestaudio/best',
          '--no-playlist', '--no-warnings', '--quiet',
          '-o', `${base}.%(ext)s`, `https://www.youtube.com/watch?v=${cand.id}`], { timeout: 240000 })
      } catch (err) {
        if (attempt === 1) return { status: 'fail', note: `下载失败: ${err.message.slice(0, 120)}` }
      }
      const files = await readdir(workdir)
      got = files.find((f) => f.startsWith(`${cand.id}.`) && !f.endsWith('.part')) ?? null
    }
    if (!got) return { status: 'fail', note: '下载失败：无产物' }
    const src = join(workdir, got)
    const d = await probeDuration(src)
    if (!d) return { status: 'fail', note: '下载文件不可读' }
    const coverUrl = item.coverUrl || cand.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${cand.id}/hqdefault.jpg`
    const cover = await fetchCover(coverUrl, join(workdir, `${cand.id}.cover.jpg`))
    const isOpus = /\.(opus|webm)$/.test(got)
    const final = join(outDir, stem + (isOpus ? '.opus' : '.m4a'))
    const cmd = ['-y', '-v', 'error', '-i', src]
    if (cover) cmd.push('-i', cover, '-map', '1:v', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic')
    cmd.push('-map', '0:a', '-c:a', 'copy',
      '-metadata', `title=${item.title}`,
      '-metadata', `artist=${item.artist}`,
      '-metadata', `album=${item.album || ''}`,
      final)
    await run('ffmpeg', cmd, { timeout: 60000 })
    const mismatch = targetS !== null && Math.abs(d - targetS) > 20
    return {
      status: mismatch ? 'mismatch' : 'ok',
      note: `dur=${d.toFixed(0)}s${targetS !== null ? ` target=${targetS.toFixed(0)}s` : ''}${cover ? '' : '（无封面）'}`,
      file: final,
    }
  }

  function killAll() {
    tools.killAll()
  }

  return { run, pickCandidate, probeDuration, fetchCover, checkVerification, archiveHasMatch, archiveVerification, processItem, killAll }
}

/** Range 流式服务（曲库音频与试听共用）：200/206/416 + HEAD，Accept-Ranges。
 * 调用方已完成路径安全校验；本函数只负责 stat 与传输。 */
export function serveRangeFile(req, res, { filePath, mime, warn, sendError }) {
  const statP = new Promise((resolve, reject) => {
    statCb(filePath, (err, st) => (err ? reject(err) : resolve(st)))
  })
  return statP.then((st) => {
    if (!st.isFile()) throw new Error('not-file')
    const size = st.size
    const range = parseRange(req.headers.range, size)
    const baseHeaders = {
      'Accept-Ranges': 'bytes',
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=600',
    }
    if (range === 'unsatisfiable') {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 })
      return res.end()
    }
    const head = req.method === 'HEAD'
    if (range === null) {
      res.writeHead(200, { ...baseHeaders, 'Content-Length': size })
      if (head) return res.end()
      return streamFile(filePath, 0, size - 1, res, warn)
    }
    const { start, end } = range
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    })
    if (head) return res.end()
    return streamFile(filePath, start, end, res, warn)
  }).catch(() => sendError(404, '音频文件不存在'))
}

/** 解析单段 Range；无法解析时忽略（按 RFC 返回 200 全量），不可满足返回标记。 */
function parseRange(header, size) {
  if (!header || size === 0) return header && size === 0 ? 'unsatisfiable' : null
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!m) return null
  const [, a, b] = m
  if (a === '' && b === '') return null
  let start
  let end
  if (a === '') {
    const n = Number(b)
    if (n === 0) return 'unsatisfiable'
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(a)
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (!Number.isFinite(start) || start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}

function streamFile(path, start, end, res, warn) {
  const stream = createReadStream(path, { start, end })
  let closed = false
  const cleanup = () => {
    if (!closed) {
      closed = true
      stream.destroy()
    }
  }
  res.on('close', cleanup)
  stream.on('error', (err) => {
    warn(`dsh-music: 音频流错误 ${path}: ${err.message}`)
    cleanup()
    if (!res.headersSent) {
      res.writeHead(500)
      res.end()
    } else res.destroy()
  })
  stream.on('end', () => {
    closed = true
  })
  stream.pipe(res)
}