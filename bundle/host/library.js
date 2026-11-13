/** 曲库扫描：三目录、五格式、内嵌标签与封面探测。
 * 对音乐源目录只读；标签缓存只写 ~/.dsh/dsh-music/library-cache.json。
 * id = sha1(source:相对路径) 前 16 位，跨重扫稳定（文件不移动即不变）。 */
import { readdir, stat, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, relative, extname, basename } from 'node:path'
import { createTagReader } from './tags.js'

const FORMATS = {
  '.m4a': { format: 'm4a', mime: 'audio/mp4' },
  '.opus': { format: 'opus', mime: 'audio/ogg' },
  '.mp3': { format: 'mp3', mime: 'audio/mpeg' },
  '.flac': { format: 'flac', mime: 'audio/flac' },
  '.wav': { format: 'wav', mime: 'audio/wav' },
}

export const DEFAULT_DIRECTORIES = [
  { path: '~/Music/spotify-liked', source: 'spotify-liked' },
  { path: '~/Music/dsh-music', source: 'dsh-music' },
  { path: '~/Music/Music/Media.localized', source: 'apple-music' },
]

export function expandHome(p) {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

export function trackId(source, relPath) {
  return createHash('sha1').update(`${source}:${relPath}`).digest('hex').slice(0, 16)
}

/** 无标签时的文件名回退：遵循「歌手 - 标题」命名约定。 */
export function parseFileName(name) {
  const idx = name.indexOf(' - ')
  if (idx > 0) {
    return { artist: name.slice(0, idx).trim() || '未知歌手', title: name.slice(idx + 3).trim() || name.trim() }
  }
  return { artist: '未知歌手', title: name.trim() || '未知标题' }
}

export function createLibrary({ storage, config = {}, logger }) {
  const reader = createTagReader(config)
  const directories = (config.directories ?? DEFAULT_DIRECTORIES).map((d) => ({
    source: d.source,
    path: expandHome(d.path),
  }))
  const cache = { version: 1, entries: {} }
  let cacheLoaded = false
  let byId = new Map()
  let tracks = []
  let scannedAt = 0
  let roots = []
  let scanning = null
  let disposed = false

  const warn = (msg) => logger?.warn?.(msg)

  async function loadCache() {
    if (cacheLoaded) return
    const saved = await storage.readJson(storage.libraryCacheFile, null)
    if (saved && saved.version === 1 && saved.entries && typeof saved.entries === 'object') {
      Object.assign(cache.entries, saved.entries)
    }
    cacheLoaded = true
  }

  /** 递归收集音频文件；跳过隐藏项与符号链接（防越界），缺失目录优雅跳过。 */
  async function walk(dir, out) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (disposed) return
      if (ent.name.startsWith('.')) continue
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        await walk(full, out)
      } else if (ent.isFile()) {
        const fmt = FORMATS[extname(ent.name).toLowerCase()]
        if (fmt) out.push({ path: full, fmt })
      }
    }
  }

  async function probeEntry(file, source, root) {
    const st = await stat(file.path)
    const id = trackId(source, relative(root, file.path))
    const cached = cache.entries[file.path]
    let meta
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      meta = cached
    } else {
      let probed
      try {
        probed = await reader.probe(file.path)
      } catch (err) {
        warn(`dsh-music: 读取标签失败 ${file.path}: ${err.message}`)
        probed = { title: null, artist: null, album: null, duration: null, hasCover: false, coverCodec: null }
      }
      const fallback = parseFileName(basename(file.path, extname(file.path)))
      meta = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        title: probed.title || fallback.title,
        artist: probed.artist || fallback.artist,
        album: probed.album,
        duration: probed.duration,
        hasCover: probed.hasCover,
        coverCodec: probed.coverCodec,
      }
      cache.entries[file.path] = meta
    }
    return { id, filePath: file.path, format: file.fmt.format, mime: file.fmt.mime, source, meta }
  }

  function snapshot() {
    return { tracks, scannedAt }
  }

  async function scan() {
    if (scanning) return scanning
    const job = (async () => {
      await loadCache()
      const records = []
      const liveRoots = []
      for (const dir of directories) {
        let root
        try {
          root = await realpath(dir.path)
        } catch {
          continue // 目录不存在：优雅跳过
        }
        liveRoots.push(root)
        const files = []
        await walk(dir.path, files)
        let cursor = 0
        const workers = Array.from({ length: Math.min(4, files.length) }, async () => {
          while (cursor < files.length && !disposed) {
            const file = files[cursor++]
            try {
              records.push(await probeEntry(file, dir.source, dir.path))
            } catch (err) {
              warn(`dsh-music: 扫描文件失败 ${file.path}: ${err.message}`)
            }
          }
        })
        await Promise.all(workers)
      }
      if (disposed) return snapshot()
      records.sort(
        (a, b) =>
          a.meta.artist.localeCompare(b.meta.artist, 'zh') || a.meta.title.localeCompare(b.meta.title, 'zh'),
      )
      byId = new Map(records.map((r) => [r.id, r]))
      tracks = records.map((r) => ({
        id: r.id,
        title: r.meta.title,
        artist: r.meta.artist,
        album: r.meta.album,
        duration: r.meta.duration,
        format: r.format,
        source: r.source,
        audioUrl: `/dsh-music/audio/${r.id}`,
        coverUrl: r.meta.hasCover ? `/dsh-music/cover/${r.id}` : null,
      }))
      scannedAt = Date.now()
      roots = liveRoots
      const live = new Set(records.map((r) => r.filePath))
      for (const key of Object.keys(cache.entries)) {
        if (!live.has(key)) delete cache.entries[key]
      }
      try {
        await storage.writeJson(storage.libraryCacheFile, cache)
      } catch (err) {
        warn(`dsh-music: 写曲库缓存失败: ${err.message}`)
      }
      return snapshot()
    })()
    scanning = job
    try {
      return await job
    } finally {
      scanning = null
    }
  }

  return {
    directories,
    reader,
    scan,
    rescan: scan,
    /** 首个请求到达时若尚未扫描则等待扫描完成。 */
    ensureScanned() {
      return scannedAt === 0 ? scan() : Promise.resolve(snapshot())
    },
    snapshot,
    getRecord(id) {
      return byId.get(id)
    },
    /** 按文件绝对路径查内部记录（下载产物 → trackId 映射用）。 */
    findByFile(path) {
      for (const rec of byId.values()) {
        if (rec.filePath === path) return rec
      }
      return undefined
    },
    /** 已 realpath 的曲库根目录，供路由做越界防线。 */
    roots() {
      return roots
    },
    /** 运行时追加音乐目录（onboarding「使用我已有的音乐库」）：去重后重扫。
     * 只读用户目录；返回值 = 是否真的新增并触发扫描。 */
    async addDirectory(path, source = 'custom') {
      const p = expandHome(String(path ?? '').trim())
      if (!p) return false
      if (directories.some((d) => d.path === p)) return false
      directories.push({ source, path: p })
      await scan()
      return true
    },
    dispose() {
      disposed = true
      reader.killAll()
    },
  }
}