/** 第三方平台账号凭据（仅本地）：~/.dsh/dsh-music/accounts.json，权限 0600。
 * 对外只暴露脱敏摘要（uid / 昵称 / 登录时间）；cookie 永不离开 host，也绝不进日志。
 * 写入走“临时文件(0600) + rename”，与 storage.writeJson 同一套原子策略，但额外收紧权限。 */
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanText } from './providers/common.js'

export const PROVIDER_KEYS = ['netease', 'qq']

export function createAccounts({ storage, logger } = {}) {
  const file = () => join(storage.dataDir, 'accounts.json')
  const warn = (msg) => logger?.warn?.(msg)
  let cache = null
  let chain = Promise.resolve()

  function pick(value) {
    if (!value || typeof value !== 'object' || typeof value.cookie !== 'string' || !value.cookie.trim()) return null
    return {
      uid: cleanText(value.uid, 64) || null,
      nickname: cleanText(value.nickname, 64),
      cookie: value.cookie.trim(),
      loginAt: Number(value.loginAt) || Date.now(),
    }
  }

  async function load() {
    if (cache) return cache
    const saved = await storage.readJson(file(), null)
    cache = { v: 1, netease: pick(saved && saved.netease), qq: pick(saved && saved.qq) }
    return cache
  }

  function persist() {
    const data = cache
    const target = file()
    const write = chain.then(async () => {
      await storage.ready
      await mkdir(storage.dataDir, { recursive: true })
      const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
      await writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
      await rename(tmp, target)
      // 显式收紧（rename 继承临时文件权限，这里兜底 umask 以外的意外）
      await chmod(target, 0o600).catch(() => {})
    })
    chain = write.catch((err) => warn(`dsh-music: 写入 accounts.json 失败: ${err && err.message}`))
    return write
  }

  return {
    file,
    /** 含 cookie，只给 host 内部用 */
    async get(provider) {
      const data = await load()
      return data[provider] || null
    },
    async set(provider, value) {
      const data = await load()
      // 刷新登录态时可透传原 loginAt，保持“首次登录时间”不变
      data[provider] = pick({ ...value, loginAt: Number(value.loginAt) || Date.now() })
      await persist()
      return data[provider]
    },
    async clear(provider) {
      const data = await load()
      const had = !!data[provider]
      if (had) {
        delete data[provider]
        await persist()
      }
      return had
    },
    /** 脱敏摘要：绝不含 cookie */
    async summary() {
      const data = await load()
      const out = {}
      for (const key of PROVIDER_KEYS) {
        const account = data[key]
        out[key] = account ? { uid: account.uid, nickname: account.nickname, loginAt: account.loginAt } : null
      }
      return out
    },
  }
}
