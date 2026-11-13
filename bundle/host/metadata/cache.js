/** metadata 缓存：仅写 ~/.dsh/dsh-music/cache/{lyrics,lyrics/web,artists}。原子写，零依赖。 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

/** 稳定 slug：小写、NFKC 归一、保留字母数字（含中日韩）、其余转 '-'、去首尾 '-'。 */
export function slugify(s) {
  const out = String(s ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return out || 'unknown'
}

export function createMetadataCache(dataDir) {
  const lyricsDir = join(dataDir, 'cache', 'lyrics')
  const webDir = join(lyricsDir, 'web')
  const artistsDir = join(dataDir, 'cache', 'artists')
  const ready = Promise.all([
    mkdir(webDir, { recursive: true }),
    mkdir(artistsDir, { recursive: true }),
  ])
  return {
    lyricsDir,
    webDir,
    artistsDir,
    ready,
    lyricsFile(id) {
      return join(lyricsDir, `${id}.json`)
    },
    webLyricsFile(slug) {
      return join(webDir, `${slug}.json`)
    },
    artistFile(slug) {
      return join(artistsDir, `${slug}.json`)
    },
    async readJson(file) {
      try {
        return JSON.parse(await readFile(file, 'utf8'))
      } catch {
        return null
      }
    },
    async writeJson(file, value) {
      await ready
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
      await writeFile(tmp, JSON.stringify(value), 'utf8')
      await rename(tmp, file)
    },
  }
}