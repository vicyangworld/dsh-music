/** 歌手内容预填：把 notes/<slug>.json 策展笔记灌进 ~/.dsh/dsh-music/cache/artists/<slug>.json。
 * intro 若笔记未含则 live 抓维基 zh REST summary（免 key）。用法：node scripts/content/research-artist.mjs Beyond */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'

const UA = 'dsh-music/0.1 (content research script)'
const root = process.cwd()
const dataDir = join(homedir(), '.dsh', 'dsh-music')

function slugify(s) {
  const out = String(s ?? '').toLowerCase().normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '')
  return out || 'unknown'
}

async function atomicWrite(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(value), 'utf8')
  await rename(tmp, file)
}

async function wikiIntro(name) {
  try {
    const url = `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!res.ok) return null
    const d = await res.json()
    if (!d || d.type === 'disambiguation' || typeof d.extract !== 'string' || !d.extract.trim()) return null
    return {
      text: d.extract.trim(),
      source: '维基百科',
      url: d.content_urls?.desktop?.page ?? `https://zh.wikipedia.org/wiki/${encodeURIComponent(name)}`,
      date: new Date().toISOString().slice(0, 10),
    }
  } catch {
    return null
  }
}

const name = process.argv[2]
if (!name) {
  console.error('用法: node scripts/content/research-artist.mjs <歌手名>')
  process.exit(1)
}
const slug = slugify(name)
const notes = JSON.parse(await readFile(join(root, 'scripts/content/notes', `${slug}.json`), 'utf8'))
const intro = notes.intro ?? await wikiIntro(name)
if (!intro) {
  console.error(`未获取到 ${name} 的 intro（笔记与维基均无）`)
  process.exit(1)
}
const data = {
  name,
  intro,
  news: notes.news ?? [],
  trivia: notes.trivia ?? [],
  similarArtists: notes.similarArtists ?? [],
  similarSongs: notes.similarSongs ?? [],
}
const dir = join(dataDir, 'cache', 'artists')
await mkdir(dir, { recursive: true })
const file = join(dir, `${slug}.json`)
await atomicWrite(file, { version: 1, data, fetchedAt: Date.now() })
console.log(`written: ${file}`)
console.log(`intro: ${intro.source} / ${intro.date}; news=${data.news.length} trivia=${data.trivia.length} similarArtists=${data.similarArtists.length} similarSongs=${data.similarSongs.length}`)