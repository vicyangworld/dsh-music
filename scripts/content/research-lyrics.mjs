/** 歌词联网补齐预填：LRCLIB 常规未命中时的人工/调研结果写入 web 兜底缓存。
 * 用法: node scripts/content/research-lyrics.mjs <artist> <title> <lrc或纯文本文件路径> */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { parseLrc, plainToLines } from '../../bundle/host/metadata/lrc.js'

function slugify(s) {
  const out = String(s ?? '').toLowerCase().normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '')
  return out || 'unknown'
}

const [artist, title, file] = process.argv.slice(2)
if (!artist || !title || !file) {
  console.error('用法: node scripts/content/research-lyrics.mjs <artist> <title> <文本文件>')
  process.exit(1)
}
const text = await readFile(file, 'utf8')
const synced = /\[\d{1,3}:\d{2}/.test(text)
const lines = synced ? parseLrc(text) : plainToLines(text)
if (lines.length === 0) {
  console.error('文本解析结果为空')
  process.exit(1)
}
const slug = slugify(`${artist}-${title}`)
const dir = join(homedir(), '.dsh', 'dsh-music', 'cache', 'lyrics', 'web')
await mkdir(dir, { recursive: true })
const out = join(dir, `${slug}.json`)
const tmp = `${out}.tmp-${process.pid}`
await writeFile(tmp, JSON.stringify({ version: 1, data: { synced, lines, plain: text }, fetchedAt: Date.now() }), 'utf8')
await rename(tmp, out)
console.log(`written: ${out} (synced=${synced}, lines=${lines.length})`)