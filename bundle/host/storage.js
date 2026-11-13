/** 本地数据目录与 JSON 缓存工具。只写 ~/.dsh/dsh-music/，不写任何音乐源目录。 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function createStorage(config = {}) {
  const dataDir = config.dataDir || join(homedir(), '.dsh', 'dsh-music')
  const coversDir = join(dataDir, 'cache', 'covers')
  const ready = mkdir(coversDir, { recursive: true })
  return {
    dataDir,
    coversDir,
    ready,
    libraryCacheFile: join(dataDir, 'library-cache.json'),
    /** 封面缓存按 id+mtime 命名：文件内容变化后自然失效。 */
    coverFile(id, mtimeMs) {
      return join(coversDir, `${id}-${Math.round(mtimeMs)}.img`)
    },
    async readJson(file, fallback) {
      try {
        return JSON.parse(await readFile(file, 'utf8'))
      } catch {
        return fallback
      }
    },
    /** 原子写：先写临时文件再 rename，避免半截 JSON。 */
    async writeJson(file, value) {
      await ready
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
      await writeFile(tmp, JSON.stringify(value), 'utf8')
      await rename(tmp, file)
    },
  }
}