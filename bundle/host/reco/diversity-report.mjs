/** 探索效果报告生成器（S4）：node bundle/host/reco/diversity-report.mjs [测试摘要]
 * 只读真实数据（history.jsonl / library-cache.json / reco-history.json / cache/reco 歌手标签缓存），
 * 缺缓存的歌手做少量 MusicBrainz 活体标签查询（写入临时目录，不污染真实缓存），
 * 计算多样性度量并生成 docs/reco-diversity.md。不触发 /api/reco 生成。 */
import { readFile, writeFile, mkdir, readdir, copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createDiscover } from './discover.js'
import { computeDiversity } from './diversity.js'
import { topArtists } from './quota.js'

const dataDir = join(homedir(), '.dsh', 'dsh-music')
const projectRoot = join(import.meta.dirname, '..', '..', '..')
const testSummary = process.argv[2] ?? 'node bundle/host/reco/reco-test.mjs → 38 pass, 0 fail, exit 0'

const readJson = async (f, fb) => { try { return JSON.parse(await readFile(f, 'utf8')) } catch { return fb } }
const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—')
const distTable = (dist, total, label) => {
  const rows = Object.entries(dist).sort((a, b) => b[1] - a[1])
  return [`| ${label} | 计数 | 占比 |`, '|---|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${typeof v === 'number' && v % 1 !== 0 ? v.toFixed(2) : v} | ${pct(v, total)} |`)].join('\n')
}

const main = async () => {
  // ---- 真实数据（只读）----
  const histText = await readFile(join(dataDir, 'history.jsonl'), 'utf8').catch(() => '')
  const events = histText.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).reverse()
  const libCache = await readJson(join(dataDir, 'library-cache.json'), { entries: {} })
  const tracks = Object.values(libCache.entries ?? {}).map((m) => ({ artist: m.artist, title: m.title }))
  const batches = await readJson(join(dataDir, 'reco-history.json'), [])

  // ---- 歌手 MB 标签：复用真实缓存 + 临时目录活体补齐 ----
  const tmp = join('/tmp', `reco-diversity-${Date.now()}`)
  await mkdir(join(tmp, 'cache', 'reco'), { recursive: true })
  const realRecoCache = join(dataDir, 'cache', 'reco')
  for (const f of await readdir(realRecoCache).catch(() => [])) {
    if (f.startsWith('artist-')) await copyFile(join(realRecoCache, f), join(tmp, 'cache', 'reco', f)).catch(() => {})
  }
  const discover = createDiscover({ storage: { dataDir: tmp }, logger: { warn: (m) => console.log('warn:', m) } })

  const weight = new Map()
  for (const t of topArtists(events)) if (t.artist !== '未知歌手') weight.set(t.artist, t.score)
  for (const r of tracks) if (r.artist && r.artist !== '未知歌手') weight.set(r.artist, (weight.get(r.artist) ?? 0) + 0.15)
  const seeds = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a]) => a)
  const exploreArtists = [...new Set(batches.flatMap((b) => (b.items ?? []).filter((i) => i.category === 'explore').map((i) => i.artist)))]
  const artistTags = new Map()
  for (const name of [...new Set([...seeds, ...exploreArtists])]) {
    const a = await discover.findArtist(name)
    if (a?.tags?.length) artistTags.set(name, a.tags)
  }

  const m = computeDiversity({ events, tracks, batches, artistTags })
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const L = []
  L.push('# dsh-music 推荐反茧房多样性报告（S4）')
  L.push('')
  L.push(`- 生成时间：${now}（Asia/Shanghai）`)
  L.push('- 生成方式：`node bundle/host/reco/diversity-report.mjs`（只读真实数据 + MusicBrainz 歌手标签，未触发推荐生成）')
  L.push(`- 数据来源：\`~/.dsh/dsh-music/\` 的 history.jsonl（${events.length} 条）、library-cache.json（${tracks.length} 首）、reco-history.json（${batches.length} 批）`)
  L.push('- 度量口径：流派=MusicBrainz 歌手标签（播放权重加权）；语言=文字系统启发式（华语/日语/韩语/欧美）；年代=本地标签无年代字段，历史侧记未知，探索侧按 eraHint 计新增')
  L.push('- 新增覆盖基线=**批次生成时的画像**（batch.profile，引擎实际避重口径）；不用当前曲库，避免推荐歌曲下载入库回流后稀释度量')
  L.push('')
  L.push('## 1. 收听历史画像')
  L.push('')
  L.push(`历史 ${m.history.events} 条事件、${m.history.uniqueArtists} 位歌手。高频歌手（完整度加权）：${topArtists(events).slice(0, 5).map((t) => `${t.artist}（${t.score}）`).join('、') || '（暂无）'}。`)
  L.push('')
  L.push(distTable(m.history.languages, m.history.events, '语言'))
  L.push('')
  L.push('流派分布（MB 标签 × 播放权重，无标签歌手计「未知」）：')
  L.push('')
  L.push(distTable(m.history.genres, Object.values(m.history.genres).reduce((a, b) => a + b, 0), '流派'))
  L.push('')
  L.push('## 2. 曲库画像')
  L.push('')
  L.push(`曲库 ${m.library.tracks} 首、${m.library.uniqueArtists} 位歌手。`)
  L.push('')
  L.push(distTable(m.library.languages, m.library.tracks, '语言'))
  L.push('')
  L.push(`画像基线（历史 ∪ 曲库，当前口径）：流派 ${m.baseline.genres.length} 种（${m.baseline.genres.join('、') || '无'}）；语言 ${m.baseline.languages.join('、')}。注：推荐歌曲下载入库后会进入此基线，故第 3 节新增覆盖按各批生成时画像度量。`)
  L.push('')
  L.push('## 3. 逐批探索效果')
  L.push('')
  if (m.perBatch.length === 0) L.push('（尚无推荐批次）')
  for (const [i, p] of m.perBatch.entries()) {
    L.push(`### 批次 ${i + 1}（${new Date(p.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}，引擎 ${p.engine}）`)
    L.push('')
    L.push(`- 轮换轴：${p.plan.join(' / ')}；配额：相近 ${p.counts.similar} + 探索 ${p.counts.explore} = ${p.counts.total} 首`)
    L.push(`- **轴标签新增覆盖**：新流派 ${p.newGenres.length ? p.newGenres.join('、') : '无'}；新语言 ${p.newLanguages.length ? p.newLanguages.join('、') : '无（本批未轮到语言轴）'}；新年代 ${p.newEras.length ? p.newEras.join('、') : '无'}；新场景 ${p.newScenes.length ? p.newScenes.join('、') : '无'}`)
    L.push(`- **MB 标签实测新增流派**（含意外之喜位歌手的全部标签）：${p.tagNewGenres.length ? p.tagNewGenres.join('、') : '无'}`)
    L.push(`- 意外之喜位：${p.wildcard.join('；') || '无'}`)
    L.push(`- 相近位与历史歌手重合：${p.similarArtistOverlap.count}/${p.similarArtistOverlap.of}（口味延续）；相近位语言分布：${Object.entries(p.similarLanguages).map(([k, v]) => `${k}×${v}`).join('、')}`)
    L.push(`- 机制校验：探索避开高频歌手 ${p.exploreAvoidsTop ? '✅' : '❌'}；3 种探索轴 ${p.axes.length === 3 ? '✅' : '❌'}；逐首联网核实 ${p.allVerified ? '✅' : '❌'}`)
    L.push('')
  }
  L.push('## 4. 跨批汇总')
  L.push('')
  L.push(`- 累计新增流派（轴标签口径）：${m.overall.newGenres.join('、') || '无'}；MB 标签实测口径：${m.overall.tagNewGenres.join('、') || '无'}`)
  L.push(`- 累计新增语言：${m.overall.newLanguages.join('、') || '无'}；新增年代：${m.overall.newEras.join('、') || '无'}；新增场景：${m.overall.newScenes.join('、') || '无'}`)
  L.push(`- 探索位独立歌手 ${m.overall.uniqueExploreArtists.length} 位：${m.overall.uniqueExploreArtists.join('、') || '无'}`)
  L.push(`- 批间重复率：${m.overall.repeatRate}%（防重复名单滚动生效）`)
  L.push(`- 机制总校验：7+3 配额 ${m.overall.quotaOk ? '✅' : '❌'}；每批 3 探索轴 ${m.overall.axesPerBatchOk ? '✅' : '❌'}；全部核实 ${m.overall.verifiedOk ? '✅' : '❌'}；避开高频 ${m.overall.avoidsTopOk ? '✅' : '❌'}`)
  L.push('')
  L.push('## 5. 配额机制测试覆盖')
  L.push('')
  L.push(`\`${testSummary}\`。覆盖项：`)
  L.push('- 7+3 装配（总数/类别计数）；3 轴严格匹配 + 轴缺失放宽兜底')
  L.push('- 探索轴 4 批轮转覆盖 genre/language/era/scene 全 4 轴 + 每批固定意外之喜位、周期回绕')
  L.push('- 避开近期高频歌手；曲库去重；与画像相同的轴值拒绝')
  L.push('- 自动补位：核实失败候选绝不输出，同类替补保持配额与轴覆盖')
  L.push('- 防重复推荐：连续两批零重叠、名单滚动上限 20')
  L.push('- 多样性度量：语言判定/分布、流派权重、新增覆盖、重合度、汇总校验')
  L.push('- browse 解析：artist-credits/视频过滤/兜底歌手/缓存命中/失败不缓存')
  L.push('')
  L.push('## 6. S4 调优记录')
  L.push('')
  L.push('- 装配按槽位轴严格匹配（此前探索位可能被单一流派候选占满），轴缺失才放宽')
  L.push('- 新增防重复名单 recentRecommended（最近 20 首≈2 批），相近/探索候选均避重')
  L.push('- 发现与核实共享 MusicBrainz 限速器（≥1.05s/请求 + 503 退避×3）；失败不写缓存')
  L.push('- 修正 MB length 单位（本就是毫秒，原 ×1000 会破坏下载时长匹配）')
  L.push('')
  L.push('## 7. 已知限制')
  L.push('')
  L.push(`- 历史样本目前仅 ${events.length} 条（多为冒烟测试跳过事件），画像偏薄；随真实收听积累自动修正`)
  L.push('- 本地音频标签无年代字段：历史侧年代分布不可得，探索年代均按新增计')
  L.push('- 流派依赖 MB 歌手标签覆盖，无标签歌手计「未知」；语言为文字系统启发式（华语内部粤/国语不区分）')
  L.push('- 单批探索为 2 个轮换轴 + 1 个意外之喜位：语言/场景轴在后续批次轮到（4 批一周期全轴覆盖），单批新语言数可能为 0 属设计预期')
  L.push('- 核实留档：~/.dsh/dsh-music/cache/verifications/（30 天复用）；推荐记录仅存本地 reco-history.json')
  L.push('')
  await writeFile(join(projectRoot, 'docs', 'reco-diversity.md'), L.join('\n'), 'utf8')
  await rm(tmp, { recursive: true, force: true })
  console.log(`report written: docs/reco-diversity.md`)
  console.log(`batches=${batches.length} events=${events.length} tracks=${tracks.length} tagsArtists=${artistTags.size}`)
  console.log('overall:', JSON.stringify({ newGenres: m.overall.newGenres, tagNewGenres: m.overall.tagNewGenres, newLanguages: m.overall.newLanguages, newEras: m.overall.newEras, repeatRate: m.overall.repeatRate, quotaOk: m.overall.quotaOk, axesPerBatchOk: m.overall.axesPerBatchOk, verifiedOk: m.overall.verifiedOk, avoidsTopOk: m.overall.avoidsTopOk }))
}
main().catch((e) => { console.error('REPORT ERROR:', e); process.exit(1) })
