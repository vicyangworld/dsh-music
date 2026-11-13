/** 外部二进制探测（D1 分发修复）：config 覆盖 → PATH 自动查找 → 中文引导错误。
 * 发行环境（别人的机器）用 PATH 找 yt-dlp/ffmpeg/ffprobe；缺失时给可操作的安装提示，
 * 绝不把 raw ENOENT 丢给前端。tags.js 的 runTool 同语义（bare-name 回退）。 */
import { spawn } from 'node:child_process'

const HINTS = {
  'yt-dlp': 'macOS: brew install yt-dlp ffmpeg；Linux: sudo apt install yt-dlp ffmpeg',
  ffmpeg: 'macOS: brew install ffmpeg；Linux: sudo apt install ffmpeg',
  ffprobe: 'macOS: brew install ffmpeg；Linux: sudo apt install ffmpeg',
}

/** 带超时与输出收集的工具执行器；ENOENT 统一转中文引导错误。 */
export function createToolRunner({ config = {}, logger } = {}) {
  const overrides = {
    'yt-dlp': config.ytdlpPath,
    ffmpeg: config.ffmpegPath,
    ffprobe: config.ffprobePath,
  }
  const warn = (msg) => logger?.warn?.(msg)
  const active = new Set()

  function guideError(name) {
    const e = new Error(`未找到 ${name}，请先安装后重试（${HINTS[name] ?? name}）`)
    e.code = 'BINARY_MISSING'
    return e
  }

  function spawnOnce(file, args, { timeout = 90000, encoding = 'utf8' } = {}) {
    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (err) {
        reject(err)
        return
      }
      active.add(child)
      const out = []
      const errOut = []
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) { settled = true; child.kill('SIGKILL'); reject(new Error(`timeout ${timeout}ms`)) }
      }, timeout)
      child.stdout.on('data', (c) => out.push(c))
      child.stderr.on('data', (c) => errOut.push(c))
      child.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        active.delete(child)
        reject(err)
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        active.delete(child)
        const stdout = encoding === 'buffer' ? Buffer.concat(out) : Buffer.concat(out).toString('utf8')
        if (code === 0) resolve(stdout)
        else reject(new Error(`exit ${code}: ${Buffer.concat(errOut).toString('utf8').slice(0, 200)}`))
      })
    })
  }

  return {
    /** 运行一个工具：config 覆盖优先；覆盖路径不存在时回退 PATH 同名；都找不到抛中文引导。 */
    async run(name, args, opts) {
      const override = overrides[name]
      if (override) {
        try {
          return await spawnOnce(override, args, opts)
        } catch (err) {
          if (err.code !== 'ENOENT') throw err
          warn(`dsh-music: 配置的 ${name} 路径不存在（${override}），回退 PATH 查找`)
        }
      }
      try {
        return await spawnOnce(name, args, opts)
      } catch (err) {
        if (err.code === 'ENOENT') throw guideError(name)
        if (err.code === 'EACCES') {
          const e = new Error(`无法执行 ${name}（无执行权限），请检查文件权限或重新安装`)
          e.code = 'BINARY_NOT_EXECUTABLE'
          throw e
        }
        throw err
      }
    },
    killAll() {
      for (const child of active) child.kill('SIGKILL')
      active.clear()
    },
  }
}