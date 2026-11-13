/** 七期批2：默认 starter 曲库 provisioning。
 * 4 首公有领域（Public domain）录音，逐首联网复核许可（Wikimedia Commons 元数据）、
 * 串行下载 → 转 128k AAC 带标签写入 ~/Music/dsh-music/starter/，
 * 署名/许可/来源留档 ~/.dsh/dsh-music/starter.json（仅本地）。
 * 失败逐首跳过不阻塞 onboarding；与其余下载管线共享同一把锁（不并发）。
 * 红线：只写 ~/Music/dsh-music/；不触 spotify-liked；不读 refresh_token。 */
import { mkdir, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createPipelineLock } from './lock.js'
import { createToolRunner } from './binaries.js'
import { sanitize } from './media-core.js'

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const USER_AGENT = 'dsh-music/0.2.0 (starter library provisioning; local-first music plugin)'
const PD_LICENSE_URL = 'https://creativecommons.org/publicdomain/mark/1.0/'

/** 精选公有领域录音（2026-11-13 于 Commons 逐首核实 License=Public domain）。
 * 保留 commonsTitle 以便 provisioning 时再次联网复核（不信任静态目录）。 */
export const STARTER_CATALOG = [
  {
    id: 'chopin-nocturne-op9-no3',
    artist: 'Xuan He',
    title: 'Nocturne No. 3 in B Major, Op. 9 No. 3',
    composer: 'Frédéric Chopin',
    album: '公有领域古典 · 肖邦夜曲',
    commonsTitle: 'File:Chopin - Nocturne No. 3 in B major, Op. 9 No. 3 (Xuan He).flac',
  },
  {
    id: 'chopin-nocturne-b108',
    artist: 'Diana Hughes',
    title: 'Nocturne No. 21 in C minor, B. 108',
    composer: 'Frédéric Chopin',
    album: '公有领域古典 · 肖邦夜曲',
    commonsTitle: 'File:Chopin - Nocturne No. 21 in C minor, B. 108 (Diana Hughes).flac',
  },
  {
    id: 'debussy-clair-de-lune',
    artist: 'Laurens Goedhart',
    title: 'Clair de lune (Suite bergamasque)',
    composer: 'Claude Debussy',
    album: '公有领域古典 · 德彪西',
    commonsTitle: 'File:Clair de lune (Claude Debussy) Suite bergamasque.ogg',
  },
  {
    id: 'satie-gymnopedie-no1',
    artist: 'Michael Laucke',
    title: 'Gymnopédie No. 1',
    composer: 'Erik Satie',
    album: '公有领域古典 · 萨蒂',
    commonsTitle: 'File:Satie Gymnopedie No 1 performed by Michael Laucke.flac',
  },
]

function stripHtml(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function commonsPageUrl(fileTitle) {
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle.replace(/ /g, '_'))}`
}

function stripQuery(url) {
  const s = String(url ?? '')
  const i = s.indexOf('?')
  return i >= 0 ? s.slice(0, i) : s
}

/** 默认联网复核：Commons API imageinfo + extmetadata，返回许可证据或失败原因。 */
async function fetchLicense(catalogItem) {
  const url = `${COMMONS_API}?action=query&format=json&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata&titles=${encodeURIComponent(catalogItem.commonsTitle)}`
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(25000) })
  if (!resp.ok) throw new Error(`Commons API HTTP ${resp.status}`)
  const data = await resp.json()
  const pages = data?.query?.pages ?? {}
  const page = Object.values(pages)[0]
  if (!page || page.missing !== undefined) return { ok: false, error: '来源文件不存在' }
  const info = page.imageinfo?.[0] ?? {}
  const em = info.extmetadata ?? {}
  const license = String(em.License?.value ?? '').trim().toLowerCase()
  const shortName = stripHtml(em.LicenseShortName?.value)
  const usage = stripHtml(em.UsageTerms?.value)
  const pd = license === 'pd' || /public domain|cc0|cc-zero|public-domain/i.test(`${shortName} ${usage}`)
  return {
    ok: pd,
    error: pd ? null : `许可不是公有领域/CC0（${shortName || usage || license || '未知'}）`,
    downloadUrl: stripQuery(info.url),
    mime: info.mime,
    year: null,
    license: shortName || usage || (pd ? 'Public domain' : ''),
    licenseUrl: PD_LICENSE_URL,
    author: stripHtml(em.Artist?.value) || catalogItem.artist,
    credit: stripHtml(em.Credit?.value),
    sourceUrl: commonsPageUrl(catalogItem.commonsTitle),
    verifiedAt: Date.now(),
  }
}

/** 默认下载：fetch 流式落盘（大文件不整块进内存），校验最小体积。 */
async function fetchToFile(url, dest) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(300000),
  })
  if (!resp.ok || !resp.body) throw new Error(`下载失败 HTTP ${resp.status}`)
  await pipeline(Readable.fromWeb(resp.body), createWriteStream(dest))
  const st = await stat(dest)
  if (st.size < 50000) throw new Error('下载文件异常（过小）')
  return st.size
}

export function createStarter({ storage, library, config = {}, logger, deps = {} }) {
  const warn = (msg) => logger?.warn?.(msg)
  const catalog = Array.isArray(deps.catalog) && deps.catalog.length > 0 ? deps.catalog : STARTER_CATALOG
  const outDir = deps.outDir ?? config.starterOutDir ?? join(homedir(), 'Music', 'dsh-music', 'starter')
  const verify = deps.verify ?? fetchLicense
  const download = deps.download ?? fetchToFile
  const tools = deps.tools ?? createToolRunner({ config, logger })
  const lock = deps.lock ?? createPipelineLock(config.pipelineLockPath)
  const stateFile = join(storage.dataDir, 'starter.json')

  let state = null
  let running = null
  let disposed = false

  function emptyState() {
    return {
      status: 'idle',
      total: catalog.length,
      done: 0,
      ok: 0,
      failed: 0,
      startedAt: null,
      finishedAt: null,
      note: null,
      tracks: catalog.map((it) => ({
        id: it.id,
        title: it.title,
        artist: it.artist,
        composer: it.composer ?? null,
        album: it.album ?? null,
        license: null,
        licenseUrl: null,
        sourceUrl: null,
        author: null,
        verifiedAt: null,
        status: 'pending',
        note: null,
        file: null,
        trackId: null,
      })),
    }
  }

  async function persist() {
    if (!state) return
    try {
      await storage.writeJson(stateFile, state)
    } catch (err) {
      warn(`dsh-music: 写 starter.json 失败: ${err.message}`)
    }
  }

  let loading = null
  async function load() {
    if (state) return
    if (!loading) {
      loading = (async () => {
        const saved = await storage.readJson(stateFile, null)
        if (!state) state = saved && typeof saved === 'object' && Array.isArray(saved.tracks) ? saved : emptyState()
        loading = null
      })()
    }
    return loading
  }

  function snapshot() {
    const snap = state ? JSON.parse(JSON.stringify(state)) : emptyState()
    // Client 契约别名：source = sourceUrl（欢迎页署名展示）
    for (const t of snap.tracks) t.source = t.sourceUrl ?? null
    return snap
  }

  async function transcodeDefault(src, out, item, lic) {
    const args = ['-y', '-v', 'error', '-i', src, '-map', '0:a', '-c:a', 'aac', '-b:a', '128k',
      '-metadata', `title=${item.title}`,
      '-metadata', `artist=${item.artist}`,
      '-metadata', `album=${item.album ?? ''}`,
      '-metadata', `composer=${item.composer ?? ''}`,
      '-metadata', `comment=License: ${lic.license}; Source: ${lic.sourceUrl}`,
      out]
    await tools.run('ffmpeg', args, { timeout: 240000 })
  }
  const transcode = deps.transcode ?? transcodeDefault

  /** 启动 provisioning（后台、串行）；返回是否真的启动。 */
  function provision() {
    if (disposed || running) return false
    running = (async () => {
      await load()
      state = emptyState()
      state.status = 'running'
      state.startedAt = Date.now()
      await persist()
      const acquired = await lock.acquire()
      if (!acquired) {
        state.status = 'deferred'
        state.note = '下载管线正在运行（与 Spotify 同步/下载共享锁），已跳过 starter 下载；可在设置里手动重试'
        state.finishedAt = Date.now()
        await persist()
        return
      }
      const workdir = join(storage.dataDir, 'tmp', `starter-${Date.now().toString(36)}`)
      try {
        await mkdir(outDir, { recursive: true })
        await mkdir(workdir, { recursive: true })
        for (let i = 0; i < catalog.length; i++) {
          if (disposed) break
          const item = catalog[i]
          const track = state.tracks[i]
          try {
            track.status = 'verifying'
            await persist()
            const lic = await verify(item)
            if (!lic?.ok) throw new Error(lic?.error || '许可核实未通过')
            track.license = lic.license ?? null
            track.licenseUrl = lic.licenseUrl ?? null
            track.sourceUrl = lic.sourceUrl ?? null
            track.author = lic.author ?? null
            track.verifiedAt = lic.verifiedAt ?? Date.now()
            if (disposed) break
            track.status = 'downloading'
            await persist()
            const src = join(workdir, `${sanitize(item.id)}${mimeExt(lic.mime)}`)
            await download(lic.downloadUrl, src)
            if (disposed) break
            track.status = 'tagging'
            await persist()
            const out = join(outDir, `${sanitize(`${item.artist} - ${item.title}`)}.m4a`)
            await transcode(src, out, item, lic)
            track.file = out
            track.status = 'ok'
            track.note = null
            state.ok++
          } catch (err) {
            track.status = 'fail'
            track.note = String(err?.message ?? err).slice(0, 160)
            state.failed++
          }
          state.done++
          await persist()
        }
        // 自动入库：重扫曲库并把产物映射回 trackId
        try {
          await library.scan()
          for (const track of state.tracks) {
            if (track.file) {
              const rec = library.findByFile(track.file)
              if (rec) track.trackId = rec.id
            }
          }
        } catch (err) {
          warn(`dsh-music: starter 入库重扫失败: ${err.message}`)
        }
        state.status = state.ok > 0 ? 'done' : 'failed'
        if (state.ok === 0) state.note = 'starter 曲目全部失败（网络或来源不可用），已跳过，可直接进入推荐探索'
      } catch (err) {
        state.status = 'failed'
        state.note = String(err?.message ?? err).slice(0, 160)
        warn(`dsh-music: starter provisioning 异常: ${state.note}`)
      } finally {
        await lock.release()
        state.finishedAt = Date.now()
        await persist()
      }
    })()
      .catch((err) => {
        warn(`dsh-music: starter 后台任务异常: ${err?.message ?? err}`)
      })
      .finally(() => {
        running = null
      })
    return true
  }

  return {
    stateFile,
    /** 读取当前状态（与持久化对齐；未运行时从 starter.json 载入）。 */
    async state() {
      await load()
      return snapshot()
    },
    /** 手动重试：仅在未运行时启动（已完成状态下用于补齐失败曲目）。 */
    provision,
    isRunning: () => Boolean(running),
    dispose() {
      disposed = true
    },
  }
}

function mimeExt(mime) {
  if (/ogg|opus/i.test(String(mime ?? ''))) return '.ogg'
  if (/mp3/i.test(String(mime ?? ''))) return '.mp3'
  if (/wav/i.test(String(mime ?? ''))) return '.wav'
  return '.flac'
}
