/** 内嵌歌词探测：ffprobe 读 format_tags 中含 lyric 的标签（MP3 USLT / M4A ©lyr / FLAC LYRICS）。
 * 对音频只读；失败/无词返回 null。内嵌多为纯文本，若含 LRC 时间标签则按同步解析。
 * 二进制经 binaries.js（config 覆盖 → PATH 自动探测 → 中文引导），零本机硬编码路径。 */
import { createToolRunner } from '../binaries.js'

export function createEmbeddedLyrics(config = {}) {
  const tools = createToolRunner({ config })

  return {
    /** @returns {{text:string}|null} */
    async extract(filePath) {
      try {
        const stdout = await tools.run('ffprobe', [
          '-v', 'quiet', '-print_format', 'json', '-show_entries', 'format_tags', filePath,
        ])
        const tags = JSON.parse(stdout)?.format?.tags ?? {}
        for (const [key, value] of Object.entries(tags)) {
          if (/lyric/i.test(key) && typeof value === 'string' && value.trim() !== '') {
            return { text: value }
          }
        }
        return null
      } catch {
        return null
      }
    },
  }
}