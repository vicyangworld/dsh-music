#!/usr/bin/env node
/**
 * 六期批3 · 冷启动审计（新用户视角，完全隔离，不碰用户数据）
 *
 * 做法：全部用**临时 storage.dataDir + 三个空音乐目录**实例化 Host 模块，
 * 模拟「刚装插件、没有本地音乐、没有历史、没有 Spotify」的新机器。
 * 只读用户真实目录做「未被改动」的前后比对。
 *
 * 使用：node tests/cold-start-audit.mjs
 */
import { mkdtemp, rm, mkdir, readdir, stat } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../bundle/host/storage.js'
import { createLibrary } from '../bundle/host/library.js'
import { createHistory } from '../bundle/host/history.js'
import { createSearch } from '../bundle/host/search.js'
import { createLikes } from '../bundle/host/likes.js'
import { createDownload } from '../bundle/host/download.js'
import { createReco } from '../bundle/host/reco/index.js'

const logger = { warn: (m) => logger.log.push(String(m)), log: [] }

async function snap(dir) {
  try {
    const names = await readdir(dir)
    const out = []
    for (const n of names.sort()) {
      const st = await stat(join(dir, n)).catch(() => null)
      if (st) out.push(`${n}|${st.size}|${Math.round(st.mtimeMs)}`)
    }
    return out.join('\n')
  } catch { return 'MISSING' }
}

const results = []
const say = (ok, label, detail = '') => { results.push({ ok, label, detail }); console.log(`${ok ? 'INFO' : 'WARN'} ${label}${detail ? ' — ' + detail : ''}`) }

async function main() {
  // 用户真实数据指纹（前后比对，证明没被改动）
  const userDataDir = join(homedir(), '.dsh', 'dsh-music')
  const userMusicDir = join(homedir(), 'Music', 'dsh-music')
  const beforeData = await snap(userDataDir)
  const beforeMusic = await snap(userMusicDir)

  // ---- 隔离环境 ----
  const root = await mkdtemp(join(tmpdir(), 'dshm-cold-'))
  const dataDir = join(root, 'data')
  const musicA = join(root, 'music-a')
  const musicB = join(root, 'music-b')
  const musicC = join(root, 'music-c')
  for (const d of [dataDir, musicA, musicB, musicC]) await mkdir(d, { recursive: true })
  console.log(`隔离根目录：${root}\n`)

  const storage = createStorage({ dataDir })
  const config = {
    dataDir,
    directories: [
      { path: musicA, source: 'spotify-liked' },
      { path: musicB, source: 'dsh-music' },
      { path: musicC, source: 'apple-music' },
    ],
  }
  const library = createLibrary({ storage, config, logger })
  const history = createHistory({ storage, library, logger })
  const download = createDownload({ storage, library, config, logger })
  const search = createSearch({ library, storage, logger })
  const likes = createLikes({ storage, library, download, logger })
  const reco = createReco({ history, library, storage, config, logger })

  // ---- ① 零曲库 ----
  await library.ensureScanned()
  const scan = library.snapshot()
  say((scan?.tracks ?? []).length === 0, '零曲库：扫描完成且 0 首', `scannedAt=${Boolean(scan?.scannedAt)} tracks=${(scan?.tracks ?? []).length}`)

  // ---- ② 零历史 ----
  const h = await history.read({ limit: 50 })
  say((h.events ?? []).length === 0, '零历史：history 读取返回空', `events=${(h.events ?? []).length}`)
  const stats = await history.stats?.().catch?.(() => null) ?? null
  void stats

  // ---- ③ 零历史 + 零曲库下点「生成推荐」：六期 D3 后应为「探索批次」（≥6 首、明示、逐首核实）----
  const t0 = Date.now()
  try {
    const batch = await reco.generate()
    const items = batch.items ?? []
    const verified = items.filter((i) => i.verification?.url).length
    say(items.length >= 6 && batch.bootstrap === true && Boolean(batch.note),
      '冷启动推荐：零历史出「探索批次」（≥6 首 + bootstrap + 中文说明）',
      `items=${items.length} bootstrap=${batch.bootstrap} note="${batch.note ?? ''}"（${Date.now() - t0}ms）`)
    say(verified === items.length && items.length > 0,
      '探索批次逐首仍带联网核实时（不绕过红线）', `verified ${verified}/${items.length}`)
    say(items.every((i) => i.category === 'explore'),
      '探索批次只含探索位（相近位为 0）', `categories=${[...new Set(items.map((i) => i.category))].join(',')}`)
  } catch (err) {
    say(false, '冷启动推荐：仍失败（D3 未生效或候选不足）', `${err.message}（${Date.now() - t0}ms）`)
  }
  // sections 走同一冷启动路径，并应带 exploreOnly/note 契约
  try {
    const s = await reco.sections()
    const today = s.today ?? []
    say(today.length >= 6 && s.exploreOnly === true && Boolean(s.note),
      '冷启动三栏：今日栏为探索批 + exploreOnly/note 契约就位',
      `today=${today.length} artist=${(s.artist ?? []).length} new=${(s.new ?? []).length} exploreOnly=${s.exploreOnly} note="${s.note ?? ''}"`)
  } catch (err) {
    say(false, '冷启动三栏', err.message)
  }

  // ---- ④ 零曲库下搜索联网补全是否可用（真实 MB 网络）----
  const t1 = Date.now()
  let searchOutcome
  try {
    const r = await search.search('王菲', 'song')
    searchOutcome = `local=${(r.local ?? []).length} remote=${(r.remote ?? []).length} remoteError=${r.remoteError ?? null}`
    say((r.local ?? []).length === 0 && (r.remote ?? []).length > 0,
      '零曲库搜索：本地 0、联网有结果（新用户唯一可发现的内容入口）', `${searchOutcome}（${Date.now() - t1}ms）`)
    const remote = (r.remote ?? [])[0]
    say(Boolean(remote?.verification), '联网结果自带核实记录（可直接试听/喜欢）', remote ? `source=${remote.verification?.source}` : '无结果')
  } catch (err) {
    searchOutcome = `异常：${err.message}`
    say(false, '零曲库搜索', searchOutcome)
  }

  // ---- ⑤ 喜欢流（无核实记录 → 只标记不下载）----
  const likeRes = await likes.set({ artist: '冷启动测试', title: '测试曲', liked: true }).catch((e) => ({ error: e.message }))
  say(likeRes?.downloading === false && /核实/.test(likeRes?.message ?? ''),
    '喜欢流（无核实）：只标记、不触发下载，返回中文原因', likeRes?.message ?? JSON.stringify(likeRes))
  const likeList = await likes.list()
  say(likeList.total === 1 && likeList.items[0].inLibrary === false,
    '喜欢列表可用（新用户无本地文件时 inLibrary=false）', `total=${likeList.total}`)

  // ---- ⑥ 外部二进制定位：D1 修复后应「零本机绝对路径」（断言方向：期望 = 0）----
  // 说明：① 媒体/标签链（media-core、binaries、tags、metadata/embedded）必须零本机绝对路径；
  //       ② host/sync.js 的 SCRIPT_PATH 仍指向本机技能目录 —— 那是可选功能 D6，单独报告不判失败。
  const { readFile } = await import('node:fs/promises')
  const rootDir = join(import.meta.dirname, '..', 'bundle', 'host')
  const read = (rel) => readFile(join(rootDir, rel), 'utf8').catch(() => '')
  const HARD = /'(\/(?:Users|opt|usr\/local)\/[^']+)'/g
  const coreFiles = ['media-core.js', 'binaries.js', 'tags.js', 'metadata/embedded.js']
  const found = []
  for (const rel of coreFiles) {
    const text = await read(rel)
    const hits = text.match(HARD) ?? []
    for (const h of hits) found.push(`${rel} → ${h}`)
  }
  say(found.length === 0, 'D1 修复校验：媒体/标签链零本机绝对路径（期望 0 命中）',
    found.length ? found.join('; ') : `扫描 ${coreFiles.join(', ')} 全部干净`)

  // 可选功能 D6：Spotify 同步脚本路径仍是本机专属，单独如实记录（不判失败）
  const syncSrc = await read('sync.js')
  const syncHits = syncSrc.match(HARD) ?? []
  say(syncHits.length === 0, '可选依赖 D6：sync.js 已参数化（Spotify 同步可选，不阻塞冷启动听歌）',
    syncHits.length ? syncHits.join(', ') : '无本机硬编码路径')

  // ---- ⑦ 用户真实数据零改动 ----
  // 注意：本机同时运行着已安装的插件，它可能正常改写自己的缓存/状态（library-cache、reco-state 等）。
  // 因此这里区分两类：① 用户生成数据（历史/喜欢/下载记录）必须零改动；② 插件缓存允许被活体改写，仅报告清单。
  const afterData = await snap(userDataDir)
  const afterMusic = await snap(userMusicDir)
  const parse = (blob) => new Map(blob === 'MISSING' ? [] : blob.split('\n').map((l) => {
    const [name, size, mtime] = l.split('|')
    return [name, `${size}|${mtime}`]
  }))
  const b = parse(beforeData); const a = parse(afterData)
  const changed = [...new Set([...b.keys(), ...a.keys()])].filter((k) => b.get(k) !== a.get(k))
  const USER_STATE = ['history.jsonl', 'likes.json', 'downloads.json']
  const userTouched = changed.filter((n) => USER_STATE.includes(n))
  say(userTouched.length === 0, '用户生成数据（历史/喜欢/下载记录）零改动', userTouched.length ? userTouched.join(', ') : `已核对 ${USER_STATE.join('、')}`)
  if (changed.length) {
    console.log(`INFO 插件缓存/状态被活体插件正常改写（不属本次审计写入）：${changed.join(', ')}`)
  } else {
    console.log('INFO 插件缓存/状态本次也未被改写')
  }
  say(beforeMusic === afterMusic, '用户 ~/Music/dsh-music 未被改动', '')

  await rm(root, { recursive: true, force: true })
  console.log('\n隔离目录已清理：' + root)
  console.log(`\n小结：${results.filter((r) => r.ok).length} 项符合预期 / ${results.filter((r) => !r.ok).length} 项异常`)
  process.exit(0)
}

main().catch((e) => { console.error('审计脚本异常：', e); process.exit(1) })
