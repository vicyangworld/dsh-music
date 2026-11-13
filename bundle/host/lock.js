/** 下载管线共享锁：与 spotify-sync 使用同一把锁（~/.config/spotify-sync/sync.lock），
 * 保证推荐下载与 Spotify 同步永不并发（红线 1）。锁语义与 sync.py 完全一致：
 * 锁龄 <1h 视为有管线在跑，撞锁即退出等待，不绕锁；>1h 视为陈旧锁可接管。
 * 注意：本模块只操作 sync.lock 这一个文件，绝不读取/移动/删除同目录的 refresh_token。 */
import { open, stat, unlink, writeFile, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_LOCK_PATH = join(homedir(), '.config', 'spotify-sync', 'sync.lock')
const MAX_AGE_MS = 3600 * 1000

export function createPipelineLock(lockPath = DEFAULT_LOCK_PATH) {
  let held = false

  async function lockAge() {
    try {
      const st = await stat(lockPath)
      return Date.now() - st.mtimeMs
    } catch {
      return null // 锁不存在
    }
  }

  return {
    path: lockPath,
    isHeld: () => held,
    /** 尝试取锁。true=取到；false=撞锁（上一轮还在跑，调用方应等待/报忙）。 */
    async acquire() {
      if (held) return false
      const age = await lockAge()
      if (age !== null && age < MAX_AGE_MS) return false
      try {
        const fh = await open(lockPath, 'wx') // 原子创建，避免与 CLI 竞争
        try {
          await fh.writeFile(String(process.pid))
          await fh.chmod(0o600)
        } finally {
          await fh.close()
        }
        held = true
        return true
      } catch (err) {
        if (err.code !== 'EEXIST') throw err
        // 竞争失败：锁刚被创建。若确已陈旧（>1h）按 sync.py 语义接管，否则报忙。
        const age2 = await lockAge()
        if (age2 === null || age2 < MAX_AGE_MS) return false
        await writeFile(lockPath, String(process.pid))
        await chmod(lockPath, 0o600)
        held = true
        return true
      }
    },
    /** 只释放自己持有的锁。 */
    async release() {
      if (!held) return
      held = false
      try {
        await unlink(lockPath)
      } catch {
        /* 锁已被清理 */
      }
    },
  }
}