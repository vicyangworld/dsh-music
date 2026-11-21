/** ffprobe/ffmpeg 封装：内嵌标签、时长、封面探测与提取。对音频文件只读。
 * 二进制经 binaries.js（config 覆盖 → PATH 自动探测 → 中文引导），零本机硬编码路径。 */
import { createToolRunner } from './binaries.js'

export function createTagReader(config = {}) {
  const tools = createToolRunner({ config })

  return {
    /** 读取标签/时长/封面流信息；失败抛出，由调用方决定回退。 */
    async probe(filePath) {
      const stdout = await tools.run('ffprobe', [
        '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath,
      ])
      const data = JSON.parse(stdout)
      const format = data.format ?? {}
      const tags = {}
      for (const [key, value] of Object.entries(format.tags ?? {})) tags[key.toLowerCase()] = String(value)
      const coverStream = (data.streams ?? []).find(
        (s) => s.codec_type === 'video' && s.disposition?.attached_pic === 1,
      )
      const duration = Number.parseFloat(format.duration)
      return {
        title: tags.title || null,
        artist: tags.artist || null,
        album: tags.album || null,
        genre: tags.genre || null,
        language: tags.language || null,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        hasCover: coverStream !== undefined,
        coverCodec: coverStream?.codec_name ?? null,
      }
    },
    /** 提取内嵌封面字节（原流拷贝，不重编码）；无封面或失败返回 null。 */
    async extractCover(filePath) {
      try {
        const buf = await tools.run('ffmpeg', [
          '-v', 'error', '-i', filePath, '-an', '-c:v', 'copy', '-f', 'image2', 'pipe:1',
        ], { encoding: 'buffer' })
        return Buffer.isBuffer(buf) && buf.length > 0 ? buf : null
      } catch {
        return null
      }
    },
    /** 插件卸载时终止仍在跑的子进程。 */
    killAll() {
      tools.killAll()
    },
  }
}