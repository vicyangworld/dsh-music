/** 九期点4 host 持久缓存证明测试：连续两次 get 同一歌手，第二次 0 网络调用（fetch 计数器）。
 * 覆盖：①回写生效 ②TTL 内零重复拉取 ③过期刷新保留调研字段 ④无数据不缓存成功态。
 * 运行：node scripts/content/test-persistent-cache.mjs（用临时 dataDir，不碰真实缓存） */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMetadataCache } from '../../bundle/host/metadata/cache.js'
import { createArtistContent } from '../../bundle/host/metadata/artist.js'

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}

const dir = await mkdtemp(join(tmpdir(), 'dshm-cache-test-'))
const cache = createMetadataCache(dir)

// fetch 计数器：artist.js 的维基兜底走全局 fetch
let fetchCalls = 0
const realFetch = globalThis.fetch
globalThis.fetch = async (...args) => {
  fetchCalls++
  const url = String(args[0] ?? '')
  if (url.includes('zh.wikipedia.org')) {
    return new Response(JSON.stringify({
      type: 'standard',
      extract: `${url.includes('Nightwish') ? 'Nightwish 是一支芬兰交响金属乐队。' : '测试歌手简介。'}`,
      content_urls: { desktop: { page: 'https://zh.wikipedia.org/wiki/Test' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response('', { status: 404 })
}

try {
  const artist = createArtistContent({ cache, logger: undefined })

  console.log('[1] 首次 get（live 兜底 + 回写）')
  const a1 = await artist.get('Nightwish')
  check('intro 命中', a1.intro?.text?.includes('Nightwish') === true)
  check('首次 cached=false', a1.cached === false)
  check('发生 1 次网络调用', fetchCalls === 1, `calls=${fetchCalls}`)

  console.log('[2] 二次 get（持久缓存，零网络）')
  const before = fetchCalls
  const a2 = await artist.get('Nightwish')
  check('cached=true', a2.cached === true)
  check('零重复网络调用', fetchCalls === before, `delta=${fetchCalls - before}`)

  console.log('[3] 新建 content 实例（模拟重启/跨会话）后仍零网络')
  const artist2 = createArtistContent({ cache, logger: undefined })
  const before2 = fetchCalls
  const a3 = await artist2.get('Nightwish')
  check('重启后 cached=true', a3.cached === true)
  check('重启后零网络调用', fetchCalls === before2, `delta=${fetchCalls - before2}`)

  console.log('[4] TTL 过期刷新：保留既有调研字段（模拟预填 news/trivia）')
  const file = cache.artistFile('nightwish')
  const stored = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'))
  stored.fetchedAt = Date.now() - 31 * 24 * 3600 * 1000 // 31 天前
  stored.data.news = [{ text: '旧调研动态', source: '测试', url: 'https://x', date: '2026-01-01' }]
  stored.data.trivia = [{ text: '旧逸闻', source: '测试', url: 'https://x', date: '2026-01-01', kind: 'fact' }]
  await (await import('node:fs/promises')).writeFile(file, JSON.stringify(stored), 'utf8')
  const before3 = fetchCalls
  const a4 = await artist2.get('Nightwish')
  check('过期后重新拉取（1 次）', fetchCalls - before3 === 1, `delta=${fetchCalls - before3}`)
  check('news 被保留', a4.news.length === 1 && a4.news[0].text === '旧调研动态')
  check('trivia 被保留', a4.trivia.length === 1)
  check('intro 已刷新', a4.cached === false)

  console.log('[5] 维基失败：不缓存成功态，可重试')
  globalThis.fetch = async () => new Response('', { status: 500 })
  const artist3 = createArtistContent({ cache, logger: undefined })
  const b1 = await artist3.get('失败歌手xyz')
  check('失败返回降级 message', b1.message === '暂无该歌手内容')
  const b2 = await artist3.get('失败歌手xyz')
  check('失败不缓存（仍 message 而非 cached=true）', b2.cached === false && b2.message === '暂无该歌手内容')
} finally {
  globalThis.fetch = realFetch
  await rm(dir, { recursive: true, force: true })
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)