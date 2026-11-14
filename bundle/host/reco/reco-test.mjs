/** reco 离线单测（无网络）：node bundle/host/reco/reco-test.mjs
 * 覆盖：7+3 装配、3 轴严格匹配与放宽兜底、探索轴轮换、避开高频歌手、曲库去重、
 *       自动补位（未核实绝不输出）、防重复推荐、多样性度量、browse 解析与失败不缓存。
 * .mjs 不在 package.json files（host 双星 *.js）内，不会被打进 bundle。 */
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planExploreSlots, assembleBatch, normKey, topArtists, exploreCandidateOk } from './quota.js'
import { detectLanguage, languageDistribution, historyGenreDistribution, computeDiversity } from './diversity.js'
import { createReco } from './index.js'
import { createDiscover, biasKeys, normalizeTaste } from './discover.js'
import { interpretStyle, styleQueryPlan, fallbackPlan, FALLBACK_GENRES } from './style.js'

let pass = 0, fail = 0
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name) } }
const fakeImages = {
  async coverUrl() { return 'https://img.test/c.jpg' },
  async artistImage() { return { thumbnail: 'https://img.test/t.jpg', original: 'https://img.test/o.jpg' } },
  async artistImages(names) {
    const m = new Map()
    for (const n of names ?? []) m.set(n, { thumbnail: 'https://img.test/t.jpg', original: 'https://img.test/o.jpg' })
    return m
  },
}


// ---------- A. 探索轴轮换 ----------
{
  let s = {}
  const seen = new Set()
  let structureOk = true
  for (let i = 0; i < 4; i++) {
    const p = planExploreSlots(s)
    const axes = p.slots.map((x) => x.axis)
    if (axes.length !== 6) structureOk = false
    if (axes.filter((a) => a === 'wildcard').length !== 2) structureOk = false
    if (new Set(axes.filter((a) => a !== 'wildcard')).size !== 4) structureOk = false
    if (p.slots.some((x) => x.axis === 'wildcard' && x.label !== '意外之喜')) structureOk = false
    for (const x of p.slots) if (x.axis !== 'wildcard') seen.add(x.axis)
    s = { nextAxis: p.nextAxis }
  }
  t('A1 每批 6 探索位 = 4 轴 + 2 意外之喜', structureOk)
  t('A2 四批轮转覆盖全部 4 轴', seen.size === 4 && ['genre','language','era','scene'].every((a) => seen.has(a)))
  t('A3 轮转周期 2 批回到起点', s.nextAxis === 0)
  t('A4 批内 4 轴不重复', new Set(planExploreSlots({ nextAxis: 0 }).slots.filter((x) => x.axis !== 'wildcard').map((x) => x.axis)).size === 4)
}

// ---------- B. 历史特征加权 ----------
{
  const events = [
    { artist: 'Beyond', title: 'A', completion: 1, skipped: false },
    { artist: 'Beyond', title: 'B', completion: 0.5, skipped: false },
    { artist: 'Beyond', title: 'C', completion: 1, skipped: true },
    { artist: 'Jay', title: 'D', completion: 1, skipped: false },
  ]
  const top = topArtists(events)
  t('B1 完整播放权重高于跳过', top[0].artist === 'Beyond' && top[0].score > top[1].score)
  t('B2 跳过计低权重', top.find((x) => x.artist === 'Beyond').score === 2.2) // 1.3+0.8+0.1
}

// ---------- C. 70/30 装配 ----------
{
  const slots = planExploreSlots({ nextAxis: 0 }).slots // genre/language/era/scene + wildcard×2
  const mkSim = (i) => ({ category: 'similar', artist: `AR${i}`, title: `T${i}`, reason: 'r' })
  const mkExp = (axis, i, hint) => ({ category: 'explore', axis, artist: `${axis}AR${i}`, title: `${axis}T${i}`, reason: 'r', ...hint })
  const mkAll = (n) => Array.from({ length: n }, (_, i) => mkSim(i))
  const base = {
    libraryKeys: new Set([normKey('LIB', 'LIBT')]),
    topArtistSet: new Set(['Beyond']),
    profileValues: new Set(['rock', '华语']),
  }
  // C1 严格轴匹配：六探索位各取同轴候选
  const c1 = [...mkAll(16),
    mkExp('genre', 0, { genreHint: 'jazz' }), mkExp('genre', 1, { genreHint: 'jazz' }),
    mkExp('language', 0, { languageHint: '日语' }), mkExp('language', 1, { languageHint: '韩语' }),
    mkExp('era', 0, { eraHint: '60s' }), mkExp('era', 1, { eraHint: '70s' }),
    mkExp('scene', 0, { sceneHint: '深夜' }), mkExp('scene', 1, { sceneHint: '雨天' }),
    mkExp('wildcard', 0, { sceneHint: '意外之喜' }), mkExp('wildcard', 1, { sceneHint: '意外之喜' })]
  const b1 = assembleBatch(c1, { ...base, exploreSlots: slots })
  t('C1a 默认 7+6=13', b1.length === 13 && b1.filter((x) => x.category === 'similar').length === 7 && b1.filter((x) => x.category === 'explore').length === 6)
  t('C1b 六探索位轴严格匹配', JSON.stringify(b1.filter((x) => x.category === 'explore').map((x) => x.axis)) === '["genre","language","era","scene","wildcard","wildcard"]')
  t('C1c 各轴首候选命中', b1.find((x) => x.axis === 'genre').artist === 'genreAR0' && b1.find((x) => x.axis === 'language').artist === 'languageAR0' && b1.find((x) => x.axis === 'era').artist === 'eraAR0' && b1.find((x) => x.axis === 'scene').artist === 'sceneAR0')
  // C1d 三期 20 首批次：similarCount=14
  const b1b = assembleBatch(c1.map((c) => ({ ...c })), { ...base, exploreSlots: slots, similarCount: 14 })
  t('C1d 20 首批次装配 14+6', b1b.length === 20 && b1b.filter((x) => x.category === 'similar').length === 14 && b1b.filter((x) => x.category === 'explore').length === 6)
  // C2 轴缺失 → 放宽兜底（候选耗尽即止）
  const c2 = [...mkAll(16), mkExp('genre', 0, { genreHint: 'jazz' }), mkExp('genre', 1, { genreHint: 'blues' }), mkExp('genre', 2, { genreHint: 'soul' })]
  const b2 = assembleBatch(c2, { ...base, exploreSlots: slots })
  t('C2 轴缺失时放宽兜底', b2.filter((x) => x.category === 'explore').length === 3)
  // C3 去重/避高频/画像避重
  const c3 = [...mkAll(16),
    { category: 'similar', artist: 'LIB', title: 'LIBT', reason: 'r' },
    mkExp('genre', 9, { genreHint: 'jazz', artist: 'Beyond' }),
    mkExp('genre', 8, { genreHint: 'rock' }),
    mkExp('genre', 0, { genreHint: 'jazz' }), mkExp('language', 0, { languageHint: '日语' }),
    mkExp('era', 0, { eraHint: '60s' }), mkExp('scene', 0, { sceneHint: '深夜' }),
    mkExp('wildcard', 0, { sceneHint: '意外之喜' }), mkExp('wildcard', 1, { sceneHint: '意外之喜' })]
  const b3 = assembleBatch(c3, { ...base, exploreSlots: slots })
  t('C3a 曲库已有歌不进推荐', !b3.some((x) => x.artist === 'LIB'))
  t('C3b 探索避开高频歌手', !b3.some((x) => x.category === 'explore' && x.artist === 'Beyond'))
  t('C3c 与画像相同的轴值被拒', !b3.some((x) => x.artist === 'genreAR8'))
  t('C3d exploreCandidateOk 边界', exploreCandidateOk({ artist: 'X', title: 'Y', genreHint: 'jazz' }, { topArtistSet: new Set(), profileValues: new Set(['rock']) }) && !exploreCandidateOk({ artist: 'X', title: 'Y', genreHint: 'rock' }, { topArtistSet: new Set(), profileValues: new Set(['rock']) }))
}

// ---------- D. 多样性度量 ----------
{
  t('D1 语言判定', detectLanguage('Beyond 光輝歲月') === '华语' && detectLanguage('宇多田ヒカル First Love') === '日语' && detectLanguage('IU 밤편지') === '韩语' && detectLanguage('Adele Hello') === '欧美')
  t('D2 语言分布', JSON.stringify(languageDistribution([{ artist: 'Beyond', title: '光輝歲月' }, { artist: 'Adele', title: 'B' }])) === '{"华语":1,"欧美":1}')
  const tags = new Map([['Beyond', ['rock', 'cantopop']], ['周杰倫', ['mandopop', 'pop']]])
  const gd = historyGenreDistribution([{ artist: 'Beyond', completion: 1, skipped: false }, { artist: '周杰倫', completion: 0.5, skipped: false }], tags)
  t('D3 流派按播放权重', gd.rock === 1.3 && gd.mandopop === 0.8)
  const v = { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/x', verifiedAt: 1 }
  const batches = [{
    generatedAt: 1, engine: 'traditional-musicbrainz',
    profile: { genres: ['rock', 'cantopop', 'mandopop', 'pop'], languages: ['华语', '欧美'], eras: [] },
    explorePlan: [{ axis: 'genre' }, { axis: 'language' }, { axis: 'wildcard' }],
    items: [
      ...Array.from({ length: 7 }, (_, i) => ({ category: 'similar', artist: 'Beyond', title: `X${i}`, verification: v })),
      { category: 'explore', axis: 'genre', artist: 'Miles Davis', title: 'So What', genreHint: 'jazz', verification: v },
      { category: 'explore', axis: 'language', artist: 'Édith Piaf', title: 'La Vie en rose', languageHint: '法语', verification: v },
      { category: 'explore', axis: 'wildcard', artist: 'Khruangbin', title: 'Time', sceneHint: '意外之喜', verification: v },
    ],
  }]
  const m = computeDiversity({
    events: [{ artist: 'Beyond', title: '光輝歲月', completion: 1, skipped: false }, { artist: '周杰倫', title: '晴天', completion: 0.5, skipped: false }],
    tracks: [{ artist: 'Beyond', title: 'A' }, { artist: 'Adele', title: 'Hello' }],
    batches,
    artistTags: new Map([...tags, ['Miles Davis', ['jazz', 'cool jazz']], ['Khruangbin', ['funk']]]),
  })
  const pb = m.perBatch[0]
  t('D4 新增流派=jazz', JSON.stringify(pb.newGenres) === '["jazz"]')
  t('D5 新增语言=法语', JSON.stringify(pb.newLanguages) === '["法语"]')
  t('D6 MB标签口径含意外之喜位 funk', pb.tagNewGenres.includes('funk') && pb.tagNewGenres.includes('cool jazz'))
  t('D7 相近位歌手重合度 7/7', pb.similarArtistOverlap.count === 7 && pb.similarArtistOverlap.of === 7)
  t('D8 配额/轴/核实/避高频全过', m.overall.quotaOk && m.overall.axesPerBatchOk && m.overall.verifiedOk && m.overall.avoidsTopOk)
  t('D9 跨批新增覆盖汇总', m.overall.newGenres.includes('jazz') && m.overall.newLanguages.includes('法语'))
  // D10 批次画像基线：推荐歌曲下载回流曲库后，新增覆盖仍按生成时画像度量
  const m2 = computeDiversity({
    events: [], tracks: [{ artist: 'Miles Davis', title: 'So What' }], batches,
    artistTags: new Map([['Miles Davis', ['jazz']]]),
  })
  t('D10 回流曲库不稀释新增覆盖（批次画像基线）', m2.perBatch[0].newGenres.includes('jazz'))
}

// ---------- E. generate() 全流程（假 discover/verifier，离线） ----------
{
  const tmp = await mkdtemp(join(tmpdir(), 'reco-unit-'))
  const allSimilar = Array.from({ length: 40 }, (_, i) => ({ category: 'similar', artist: `S${i}`, title: `T${i}`, reason: 'r' }))
  const failKeys = new Set([normKey('S0', 'T0'), normKey('genreA0', 'genreT0')]) // 这两首「核实失败」
  let verifyCalls = 0
  const fakeVerifier = {
    async verify({ artist, title }) {
      verifyCalls++
      if (failKeys.has(normKey(artist, title))) return null
      return { verification: { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/test', verifiedAt: Date.now() }, matched: {} }
    },
  }
  const hintField = { genre: 'genreHint', language: 'languageHint', era: 'eraHint', scene: 'sceneHint', wildcard: 'sceneHint' }
  const fakeDiscover = {
    async buildSimilarCandidates({ extraKeys }) {
      const ex = extraKeys ?? new Set()
      return allSimilar.filter((c) => !ex.has(normKey(c.artist, c.title))).map((c) => ({ ...c }))
    },
    async buildExploreCandidates({ slots, cursors }) {
      const cands = []
      for (const s of slots) {
        for (let i = 0; i < 4; i++) {
          cands.push({ category: 'explore', axis: s.axis, artist: `${s.axis}A${i}`, title: `${s.axis}T${i}`, reason: 'r', durationMs: 200000, [hintField[s.axis]]: s.axis === 'wildcard' ? '意外之喜' : `${s.axis}val` })
        }
      }
      return { candidates: cands, cursors: { ...cursors } }
    },
    async findArtist(name) { return { mbid: 'x', name, tags: ['rock'] } },
  }
  const history = { read: async () => ({ events: [{ artist: 'Beyond', title: 'X', completion: 1, skipped: false }, { artist: 'Beyond', title: 'Y', completion: 0.8, skipped: false }, { artist: 'Nightwish', title: 'Z', completion: 0.9, skipped: false }], total: 3 }) }
  const library = { snapshot: () => ({ tracks: [{ artist: 'LIB', title: 'LIBT' }], scannedAt: 1 }) }
  const reco = createReco({ history, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: fakeVerifier, discover: fakeDiscover, images: fakeImages })

  const b1 = await reco.generate()
  t('E1a 首批 14+6=20', b1.items.length === 20 && b1.stats.similar === 14 && b1.stats.explore === 6)
  t('E1b 核实失败的首首选被替补（S0 不在输出）', !b1.items.some((i) => i.artist === 'S0' && i.title === 'T0'))
  t('E1c 探索失败位被同类替补且轴覆盖 5 种', new Set(b1.items.filter((i) => i.category === 'explore').map((i) => i.axis)).size === 5)
  t('E1d 输出全部带核实记录', b1.items.every((i) => i.verification?.source === 'musicbrainz' && Number.isFinite(i.verification.verifiedAt)))
  t('E1e 确实发生了核实调用', verifyCalls >= 20)
  const st1 = JSON.parse(await readFile(join(tmp, 'reco-state.json'), 'utf8'))
  t('E1f 状态含防重复名单(20)且轮换推进', st1.recentRecommended.length === 20 && st1.nextAxis === 2)

  const b2 = await reco.generate()
  const k1 = new Set(b1.items.map((i) => normKey(i.artist, i.title)))
  const overlap = b2.items.filter((i) => k1.has(normKey(i.artist, i.title)))
  t('E2a 第二批仍 14+6=20', b2.items.length === 20 && b2.stats.similar === 14 && b2.stats.explore === 6)
  t('E2b 防重复：两批零重叠', overlap.length === 0)
  t('E2c 轮换推进：第二批轴与第一批不同', JSON.stringify(b2.explorePlan.map((p) => p.axis)) !== JSON.stringify(b1.explorePlan.map((p) => p.axis)))
  const archived = JSON.parse(await readFile(join(tmp, 'reco-history.json'), 'utf8'))
  t('E2d 批次留档 2 条', archived.length === 2)
  const st2 = JSON.parse(await readFile(join(tmp, 'reco-state.json'), 'utf8'))
  t('E2e 防重复名单滚动上限 40', st2.recentRecommended.length === 40)
  await rm(tmp, { recursive: true, force: true })
}

// ---------- G. sections 三栏目（假 discover/verifier，离线） ----------
{
  const { registerRecoRoutes } = await import('./index.js')
  const tmp = await mkdtemp(join(tmpdir(), 'reco-sections-'))
  const allSimilar = Array.from({ length: 40 }, (_, i) => ({ category: 'similar', artist: `S${i}`, title: `T${i}`, reason: 'r' }))
  const failKeys = new Set([normKey('S0', 'T0'), normKey('L0', 'LT0')])
  const fakeVerifier = {
    async verify({ artist, title }) {
      if (failKeys.has(normKey(artist, title))) return null
      return { verification: { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/test', verifiedAt: Date.now() }, matched: {} }
    },
  }
  const hintField = { genre: 'genreHint', language: 'languageHint', era: 'eraHint', scene: 'sceneHint', wildcard: 'sceneHint' }
  const fakeDiscover = {
    async buildSimilarCandidates({ extraKeys }) {
      const ex = extraKeys ?? new Set()
      return allSimilar.filter((c) => !ex.has(normKey(c.artist, c.title))).map((c) => ({ ...c }))
    },
    async buildExploreCandidates({ slots, cursors }) {
      const cands = []
      for (const s of slots) {
        for (let i = 0; i < 4; i++) {
          cands.push({ category: 'explore', axis: s.axis, artist: `${s.axis}A${i}`, title: `${s.axis}T${i}`, reason: 'r', durationMs: 200000, [hintField[s.axis]]: s.axis === 'wildcard' ? '意外之喜' : `${s.axis}val` })
        }
      }
      return { candidates: cands, cursors: { ...cursors } }
    },
    async findArtist(name) { return { mbid: 'x', name, tags: ['rock'] } },
    async buildArtistList({ cursor = 0, limit = 20 }) {
      const artists = Array.from({ length: limit }, (_, i) => ({
        id: `mb${i}`, name: `ar${i}`, genreHint: 'rock', similar: [`sib${i}a`, `sib${i}b`],
        reason: '相似歌手：与您常听的 Beyond 风格相近',
        verification: { source: 'musicbrainz', url: `https://musicbrainz.org/artist/mb${i}`, verifiedAt: Date.now() },
      }))
      return { artists, cursor: cursor + 1 }
    },
    async buildNewCandidates({ extraKeys }) {
      const ex = extraKeys ?? new Set()
      const local = Array.from({ length: 10 }, (_, i) => ({ category: 'new', artist: `L${i}`, title: `LT${i}`, local: true, trackId: `id${i}`, reason: '新歌推荐：近期加入曲库' }))
      const mb = Array.from({ length: 14 }, (_, i) => ({ category: 'new', artist: `N${i}`, title: `NT${i}`, album: '新专辑', durationMs: 200000, reason: '新歌推荐：近期新发行' }))
      return [...local, ...mb].filter((c) => !ex.has(normKey(c.artist, c.title)))
    },
  }
  const history = { read: async () => ({ events: [{ artist: 'Beyond', title: 'X', completion: 1, skipped: false }, { artist: 'Beyond', title: 'Y', completion: 0.8, skipped: false }, { artist: 'Nightwish', title: 'Z', completion: 0.9, skipped: false }], total: 3 }) }
  const library = {
    snapshot: () => ({ tracks: [{ id: 'lib1', artist: 'LIB', title: 'LIBT' }], scannedAt: 1 }),
    getRecord: (id) => (id === 'lib1' ? { meta: { mtimeMs: Date.now(), duration: 200 } } : undefined),
  }
  const reco = createReco({ history, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: fakeVerifier, discover: fakeDiscover, images: fakeImages })

  // 预置一条「同日但只有 10 首」的旧批次：必须判定为不足 20 并重生成（三期回归）
  const staleItems = Array.from({ length: 10 }, (_, i) => ({
    artist: `OLD${i}`, title: `OLDT${i}`, category: i < 7 ? 'similar' : 'explore', axis: null, reason: '旧批次',
    verification: { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/old', verifiedAt: Date.now() },
  }))
  await writeFile(join(tmp, 'reco-history.json'), JSON.stringify([{ generatedAt: Date.now(), engine: 'traditional-musicbrainz', items: staleItems }]))

  const s1 = await reco.sections()
  t('G1b 同日旧 10 首批次不复用，重生成 20 首', s1.todayFromCache === false && !s1.today.some((i) => i.artist === 'OLD0'))
  t('G1 today 为 14+6=20', s1.today.length === 20 && s1.today.filter((i) => i.category === 'similar').length === 14 && s1.today.filter((i) => i.category === 'explore').length === 6)
  t('G2 artist 20 位歌手对象（id/name/核实齐全）', s1.artist.length === 20 && s1.artist.every((a) => a.id && a.name && a.verification?.source === 'musicbrainz' && /^https?:/.test(a.verification.url)))
  t('G3 new 20 首且全部 category=new', s1.new.length === 20 && s1.new.every((i) => i.category === 'new'))
  t('G4 today/new 全部带核实', [...s1.today, ...s1.new].every((i) => i.verification?.source === 'musicbrainz' && Number.isFinite(i.verification.verifiedAt)))
  t('G4b today/new 全部带封面 coverUrl', [...s1.today, ...s1.new].every((i) => typeof i.coverUrl === 'string' && /^https?:|^\/dsh-music\//.test(i.coverUrl)))
  t('G4c artist 对象带真实图 imageUrl', s1.artist.every((a) => a.imageUrl === 'https://img.test/t.jpg'))
  t('G5 核实失败的 new 候补被替换（L0 不在输出）', !s1.new.some((i) => i.artist === 'L0'))
  t('G6 today/new 无重复歌曲', new Set([...s1.today, ...s1.new].map((i) => normKey(i.artist, i.title))).size === s1.today.length + s1.new.length)
  const s2 = await reco.sections()
  t('G7 当日二次调用复用 today 批次', s2.todayFromCache === true && s2.todayGeneratedAt === s1.todayGeneratedAt)
  t('G8 二次调用 artist/new 仍满额', s2.artist.length === 20 && s2.new.length === 20)

  // 路由级：GET 200 / POST 405
  const routes = {}
  const webServer = { register: (r) => { routes[r.path] = r; return () => {} } }
  registerRecoRoutes(webServer, { reco, logger: { warn: () => {} } })
  const call = (method, path) => new Promise((resolve) => {
    const res = { code: null, writeHead(code) { this.code = code }, end(body) { resolve({ code: this.code, body: JSON.parse(body) }) } }
    routes[path].handler({ method, url: path }, res)
  })
  const r1 = await call('GET', '/dsh-music/api/reco/sections')
  t('G9 sections 路由 200 且含三栏', r1.code === 200 && r1.body.today.length === 20 && r1.body.artist.length === 20 && r1.body.new.length === 20 && r1.body.todayFromCache === true)
  const r2 = await call('POST', '/dsh-music/api/reco/sections')
  t('G10 POST 返回 405', r2.code === 405)
  t('G11 /api/reco 兼容未破坏', typeof routes['/dsh-music/api/reco']?.handler === 'function' && typeof routes['/dsh-music/api/reco/status']?.handler === 'function' && typeof routes['/dsh-music/api/reco/style']?.handler === 'function' && typeof routes['/dsh-music/api/reco/artist']?.handler === 'function')
  await rm(tmp, { recursive: true, force: true })
}

// ---------- K. 旧缓存批次封面回填（today 复用 + coverUrl 缺失） ----------
{
  const tmp = await mkdtemp(join(tmpdir(), 'reco-backfill-'))
  const stale = Array.from({ length: 20 }, (_, i) => ({
    artist: `B${i}`, title: `BT${i}`, category: i < 14 ? 'similar' : 'explore', axis: i < 14 ? null : 'genre',
    reason: 'v3 旧批次', trackId: i === 0 ? 'lib1' : undefined,
    verification: { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/old', verifiedAt: Date.now() },
  }))
  await writeFile(join(tmp, 'reco-history.json'), JSON.stringify([{ generatedAt: Date.now(), engine: 'traditional-musicbrainz', items: stale }]))
  const fakeDiscover2 = {
    async findArtist() { return null },
    async buildArtistList({ limit = 20 }) { return { artists: [], cursor: 1 } },
    async buildNewCandidates() { return [] },
  }
  const library = {
    snapshot: () => ({ tracks: [{ id: 'lib1', artist: 'B0', title: 'BT0' }], scannedAt: 1 }),
    getRecord: (id) => (id === 'lib1' ? { meta: { hasCover: true } } : undefined),
    ensureScanned: async () => {},
  }
  const history = { read: async () => ({ events: [], total: 0 }) }
  const reco = createReco({ history, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: { async verify() { return null } }, discover: fakeDiscover2, images: fakeImages })
  const s = await reco.sections()
  t('K1 同日 20 首批次复用（todayFromCache=true）', s.todayFromCache === true && s.today.length === 20)
  t('K2 缺 coverUrl 的 item 全部回填', s.today.every((i) => typeof i.coverUrl === 'string' && i.coverUrl.length > 0))
  t('K3 本地曲用曲库封面路由', s.today[0].coverUrl === '/dsh-music/cover/lib1')
  const saved = JSON.parse(await readFile(join(tmp, 'reco-history.json'), 'utf8'))
  t('K4 回填结果写回批次（下次读取即带图）', saved[saved.length - 1].items.every((i) => i.coverUrl))
  await rm(tmp, { recursive: true, force: true })
}

// ---------- I. 歌手页（离线：拾词缓存资料 + 伪造 browse/verify） ----------
{
  const { registerRecoRoutes } = await import('./index.js')
  const { mkdir, writeFile } = await import('node:fs/promises')
  const tmp = await mkdtemp(join(tmpdir(), 'reco-artist-'))
  await mkdir(join(tmp, 'cache', 'artists'), { recursive: true })
  await writeFile(join(tmp, 'cache', 'artists', 'beyond.json'), JSON.stringify({
    version: 1,
    data: {
      name: 'Beyond',
      intro: { text: '香港搖滾樂團', source: '维基百科', url: 'https://zh.wikipedia.org/wiki/Beyond', date: '2026-11-12' },
      news: [{ text: '精选辑发行', source: '维基百科', url: 'https://zh.wikipedia.org/wiki/Beyond', date: '2025-09', kind: 'fact' }],
      trivia: [], similarArtists: [], similarSongs: [],
    },
  }))
  const fakeDiscover = {
    async findArtist(name) { return name === 'Beyond' ? { mbid: 'mb-beyond', name: 'Beyond', tags: ['rock'] } : null },
    async browseRecordings() {
      return [
        { artist: 'Beyond', title: '光輝歲月', durationMs: 302835 },
        { artist: 'Beyond', title: '海闊天空', durationMs: 326000 },
        { artist: 'Beyond', title: '光輝歲月 (Live)', durationMs: 300000 },
      ]
    },
  }
  const fakeVerifier = {
    async verify() {
      return { verification: { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/x', verifiedAt: Date.now() }, matched: { album: '認真的' } }
    },
  }
  const library = { snapshot: () => ({ tracks: [{ id: 't-1', artist: 'Beyond', title: '光輝歲月' }], scannedAt: 1 }), ensureScanned: async () => {} }
  const history = { read: async () => ({ events: [], total: 0 }) }
  const reco = createReco({ history, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: fakeVerifier, discover: fakeDiscover, images: fakeImages })
  const p = await reco.artistPage('Beyond')
  t('I1 资料复用拾词缓存', p.profile?.intro?.text === '香港搖滾樂團' && p.profile.news.length === 1 && p.mbid === 'mb-beyond')
  t('I2 歌曲带核实 + 曲库标注 trackId', p.songs.length === 2 && p.songs.every((x) => x.verification?.source === 'musicbrainz') && p.songs[0].inLibrary === true && p.songs[0].trackId === 't-1')
  t('I3 版本复本去重（Live 版不重复占位）', p.songs.length === 2 && !p.songs.some((x) => x.title.includes('Live')))
  t('I3b 歌手页头图 + profile.imageUrl', p.imageUrl === 'https://img.test/o.jpg' && p.thumbnailUrl === 'https://img.test/t.jpg' && p.profile?.imageUrl === 'https://img.test/o.jpg')
  t('I3c 歌手页歌曲带封面', p.songs.every((x) => x.coverUrl === 'https://img.test/c.jpg'))
  t('I6 空 name 抛 BAD_REQUEST', await reco.artistPage('').then(() => false).catch((e) => e.code === 'BAD_REQUEST'))
  t('I7 查无歌手抛 NOT_FOUND', await reco.artistPage('不存在的人xyz').then(() => false).catch((e) => e.code === 'NOT_FOUND'))
  // 路由：200 / 400 / 404 / 405
  const routes = {}
  registerRecoRoutes({ register: (r) => { routes[r.path] = r; return () => {} } }, { reco, logger: { warn: () => {} } })
  const call = (method, url) => new Promise((resolve) => {
    const res = { code: null, writeHead(code) { this.code = code }, end(body) { resolve({ code: this.code, body: JSON.parse(body) }) } }
    routes['/dsh-music/api/reco/artist'].handler({ method, url }, res)
  })
  const r1 = await call('GET', '/dsh-music/api/reco/artist?name=Beyond')
  t('I8 路由 200 含 profile+songs', r1.code === 200 && r1.body.profile?.intro?.text === '香港搖滾樂團' && r1.body.songs.length === 2)
  const r2 = await call('GET', '/dsh-music/api/reco/artist?name=')
  t('I9 空 name 400', r2.code === 400)
  const r3 = await call('GET', '/dsh-music/api/reco/artist?name=nobody')
  t('I10 查无歌手 404', r3.code === 404)
  const r4 = await call('POST', '/dsh-music/api/reco/artist?name=Beyond')
  t('I11 POST 405', r4.code === 405)
  await rm(tmp, { recursive: true, force: true })
}

{
  // ---------- F2. discover browse 解析（fetch 桩，离线） ----------
  const tmp = await mkdtemp(join(tmpdir(), 'reco-disc-'))
  const origFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url) => {
    calls++
    if (String(url).includes('artist=mbid-ok')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          recordings: [
            { title: 'T1', video: false, length: 200000, 'artist-credit': [{ name: 'A1' }] },
            { title: 'V1', video: true, length: 1000 },
            { title: 'T2', video: false, length: null },
          ],
        }),
      }
    }
    throw new Error('network down')
  }
  try {
    const d = createDiscover({ storage: { dataDir: tmp }, logger: { warn: () => {} } })
    const recs = await d.browseRecordings('mbid-ok', 'Fallback')
    t('F1 artist-credit 解析 + 视频过滤 + 兜底歌手', recs.length === 2 && recs[0].artist === 'A1' && recs[0].durationMs === 200000 && recs[1].artist === 'Fallback')
    const callsAfterFirst = calls
    await d.browseRecordings('mbid-ok', 'Fallback')
    t('F2 二次命中缓存不再请求', calls === callsAfterFirst)
    const bad = await d.browseRecordings('mbid-bad', 'X')
    t('F3 请求失败返回空数组', Array.isArray(bad) && bad.length === 0)
    let cachedBad = true
    try { await readFile(join(tmp, 'cache', 'reco', 'recordings-mbid-bad.json'), 'utf8') } catch { cachedBad = false }
    t('F4 失败不写缓存（下次可重试）', !cachedBad)
  } finally {
    globalThis.fetch = origFetch
    await rm(tmp, { recursive: true, force: true })
  }
}

// ---------- H. 风格搜索（批3）：纯函数 + 离线端到端 + 路由 ----------
{
  // H1 中文组合
  const h1 = interpretStyle('深夜爵士')
  t('H1a 命中 jazz+night', h1.byKind.genre[0] === 'jazz' && h1.byKind.scene[0] === 'night')
  t('H1b AND 计划首位', styleQueryPlan(h1.byKind)[0].query === 'tag:"jazz" AND tag:"night"')
  // H2 英文词边界 + 粤语
  const h2 = interpretStyle('cantonese oldies')
  t('H2 英文命中', h2.byKind.language[0] === 'cantonese' && h2.byKind.era[0] === 'oldies')
  t('H2b rock 不误命中 roc', interpretStyle('baroque').byKind.genre.length === 0)
  // H3 数字年代 + 中文年代短语
  const h3 = interpretStyle('80s 合成器')
  t('H3a 80s 命中', h3.byKind.era[0] === '80s')
  t('H3b 八十年代命中', interpretStyle('八十年代粤语经典').byKind.era[0] === '80s')
  // H4 无命中 → 回退热门流派
  const h4 = interpretStyle('随便来点好听的')
  t('H4a 无命中', h4.terms.length === 0)
  t('H4b 回退计划含 4 热门流派', fallbackPlan().length === FALLBACK_GENRES.length && fallbackPlan()[0].query === 'tag:"rock"')
  // H5 场景+年代组合降级链
  const h5 = styleQueryPlan(interpretStyle('学习 90s').byKind)
  t('H5 降级链含组合与单项', h5[0].query === 'tag:"study" AND tag:"90s"' && h5.some((p) => p.query === 'tag:"study"'))

  // H6 端到端（假 discover/verifier）：正常链 + fallback 链 + 核实失败跳过 + 曲库排除 + limit 8
  {
    const tmp = await mkdtemp(join(tmpdir(), 'reco-style-'))
    const fakeVerifier = {
      async verify({ artist, title }) {
        if (title === 'BAD') return null
        return { verification: { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/x', verifiedAt: Date.now() }, matched: {} }
      },
    }
    let lastQuery = null
    let firstQuery = null
    const fakeDiscover = {
      async findArtist() { return null },
      async searchRecordings(query) {
        lastQuery = query
        if (firstQuery === null) firstQuery = query
        if (query.includes('night')) return Array.from({ length: 10 }, (_, i) => ({ artist: `BA${i}`, title: 'BAD' }))
        if (query.includes('EMPTYQ')) return []
        return Array.from({ length: 12 }, (_, i) => ({ artist: `SA${i}`, title: `ST${i}`, durationMs: 200000 }))
      },
    }
    const history = { read: async () => ({ events: [], total: 0 }) }
    const library = { snapshot: () => ({ tracks: [{ id: 'l1', artist: 'SA1', title: 'ST1' }], scannedAt: 1 }), getRecord: () => undefined }
    const reco = createReco({ history, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: fakeVerifier, discover: fakeDiscover })

    const r1 = await reco.styleSearch('深夜爵士')
    t('H6a 首个查询用 AND 组合', firstQuery === 'tag:"jazz" AND tag:"night"')
    t('H6b 上限 8 首且 category=style 全核实', r1.items.length === 8 && r1.items.every((i) => i.category === 'style' && i.verification?.source === 'musicbrainz'))
    t('H6c 曲库已有歌被排除', !r1.items.some((i) => i.artist === 'SA1' && i.title === 'ST1'))
    t('H6d interpretedTags', r1.interpretedTags.includes('jazz') && r1.interpretedTags.includes('night'))
    t('H6e 非 fallback', r1.fallback === false && !r1.message)
    // 映射命中但检索结果全部核实失败 → 空列表 + message（不硬凑、不冒充 fallback）
    const r2 = await reco.styleSearch('深夜')
    t('H6f 核实失败不硬凑', r2.items.length === 0 && r2.fallback === false && typeof r2.message === 'string')
    // 完全无法映射 → fallback 热门流派
    const r3 = await reco.styleSearch('随便来点')
    t('H6g fallback=true + message 明示 + 热门流派结果', r3.fallback === true && r3.message.includes('热门流派') && r3.items.length === 8)
    // 空 q
    const r4 = await reco.styleSearch('')
    t('H6h 空输入友好提示不发请求', r4.items.length === 0 && r4.message.includes('风格描述') && r4.fallback === false)

    // 路由
    const { registerRecoRoutes } = await import('./index.js')
    const routes = {}
    registerRecoRoutes({ register: (r) => { routes[r.path] = r; return () => {} } }, { reco, logger: { warn: () => {} } })
    const call = (method, url) => new Promise((resolve) => {
      const res = { writeHead(code) { this.code = code }, end(body) { resolve({ code: this.code, body: JSON.parse(body) }) } }
      routes['/dsh-music/api/reco/style'].handler({ method, url }, res)
    })
    const g = await call('GET', '/dsh-music/api/reco/style?q=%E6%B7%B1%E5%A4%9C%E7%88%B5%E5%A3%AB')
    t('H6i 路由 GET 200 结构完整', g.code === 200 && g.body.q === '深夜爵士' && g.body.items.length === 8 && Array.isArray(g.body.interpretedTags))
    const p = await call('POST', '/dsh-music/api/reco/style?q=x')
    t('H6j POST 405', p.code === 405)
    await rm(tmp, { recursive: true, force: true })
  }
}

// ---------- J. 图片供给（fetch 桩：维基 action API 批量 + iTunes 封面） ----------
{
  const { createImages } = await import('./images.js')
  const tmp = await mkdtemp(join(tmpdir(), 'reco-img-'))
  const origFetch = globalThis.fetch
  const counts = { wiki: 0, itunes: 0, fail: 0, banner: 0 }
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('commons.wikimedia.org/wiki/Special:FilePath')) {
      counts.banner++
      return { ok: true, status: 200, headers: { get: () => 'image/jpeg' } }
    }
    if (u.includes('upload.wikimedia.org')) {
      counts.banner++
      return { ok: false, status: 400, headers: { get: () => 'text/html' } }
    }
    if (u.includes('w/api.php')) {
      if (u.includes('fail-artist')) { counts.fail++; throw new Error('network down') }
      counts.wiki++
      if (u.includes('noimage')) {
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ query: { pages: { '1': { title: 'noimage' } } } }) }
      }
      if (u.includes('%E7%BB%B4%E5%9F%BA%E6%AD%8C%E6%89%8B')) { // 维基歌手
        return {
          ok: true, status: 200, headers: { get: () => 'application/json' },
          json: async () => ({ query: { pages: { '2': {
            title: '维基歌手',
            thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/F.jpg/330px-F.jpg' },
            original: { source: 'https://upload.wikimedia.org/wikipedia/commons/0/0a/F.jpg' },
          } } } }),
        }
      }
      return {
        ok: true, status: 200, headers: { get: () => 'application/json' },
        json: async () => ({ query: { pages: { '1': {
          title: '伍佰',
          thumbnail: { source: 'https://upload.example/thumb.jpg?utm_source=zh.wikipedia.org&utm_campaign=api' },
          original: { source: 'https://upload.example/orig.jpg?utm_source=zh.wikipedia.org&utm_content=original' },
        } } } }),
      }
    }
    if (u.includes('itunes.apple.com/search')) {
      counts.itunes++
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ results: [{ artworkUrl100: 'https://mz.example/image/100x100bb.jpg' }] }) }
    }
    throw new Error('unexpected url ' + u)
  }
  try {
    const images = createImages({ storage: { dataDir: tmp }, logger: { warn: () => {} } })
    const a1 = await images.artistImage('伍佰')
    t('J1 维基 action API 歌手图解析+utm 清洗', a1?.thumbnail === 'https://upload.example/thumb.jpg' && a1?.original === 'https://upload.example/orig.jpg')
    const before = counts.wiki
    await images.artistImage('伍佰')
    t('J2 歌手图缓存命中不再请求', counts.wiki === before)
    const batch = await images.artistImages(['伍佰', '伍佰 & China Blue'])
    t('J3 批量取图（含 langlinks 兜底，缺失为 null）', batch.get('伍佰')?.thumbnail === 'https://upload.example/thumb.jpg' && batch.get('伍佰 & China Blue') === null && counts.wiki >= before + 1)
    const c1 = await images.coverUrl({ artist: 'Beyond', title: '光輝歲月' })
    t('J4 iTunes 封面取 500x500', c1 === 'https://mz.example/image/500x500bb.jpg')
    const before2 = counts.itunes
    await images.coverUrl({ artist: 'Beyond', title: '光輝歲月' })
    t('J5 封面 URL 缓存命中', counts.itunes === before2)
    t('J8 横幅派生纯函数（commons 原图/缩略图→Special:FilePath width=1200；en 本地文件/非维基→null）',
      images.deriveBannerUrl('https://upload.wikimedia.org/wikipedia/commons/0/0a/F.jpg') === 'https://commons.wikimedia.org/wiki/Special:FilePath/F.jpg?width=1200'
      && images.deriveBannerUrl('https://upload.wikimedia.org/wikipedia/en/b/b0/Beyond.jpg/330px-Beyond.jpg') === null
      && images.deriveBannerUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/F.jpg/330px-F.jpg') === 'https://commons.wikimedia.org/wiki/Special:FilePath/F.jpg?width=1200'
      && images.deriveBannerUrl('https://mz.example/image/100x100bb.jpg') === null)
    const wikiImg = await images.artistImage('维基歌手')
    t('J9 维基横幅派生+探测可达', wikiImg?.banner === 'https://commons.wikimedia.org/wiki/Special:FilePath/F.jpg?width=1200' && counts.banner >= 1)
    const nonWiki = await images.artistImage('伍佰')
    t('J10 非维基源横幅回落缩略图', nonWiki?.banner === 'https://upload.example/thumb.jpg')
    const beforeB = counts.banner
    const av = await images.artistAvatar('维基歌手')
    t('J11 轻量头像返回 thumbnail/original 且不探测横幅', av?.thumbnail === 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/F.jpg/330px-F.jpg' && av?.original === 'https://upload.wikimedia.org/wikipedia/commons/0/0a/F.jpg' && counts.banner === beforeB)
    const bad = await images.artistImage('fail-artist')
    t('J6 网络失败返回 null 且不缓存（每次 2 次重试，下次再试）', bad === null && (await images.artistImage('fail-artist')) === null && counts.fail === 4)
    const noimg = await images.artistImage('noimage')
    const beforeW = counts.wiki
    await images.artistImage('noimage')
    t('J7 确定性无图负缓存（3 天内不再请求）', noimg === null && counts.wiki === beforeW)
  } finally {
    globalThis.fetch = origFetch
    await rm(tmp, { recursive: true, force: true })
  }
}

// ---------- L. 轻量歌手头像 API（六期批2 路由级） ----------
{
  const { registerRecoRoutes } = await import('./index.js')
  const { createReco } = await import('./index.js')
  const tmp = await mkdtemp(join(tmpdir(), 'reco-avatar-'))
  const fakeImages = {
    async artistAvatar(name) {
      if (name === '伍佰') return { thumbnail: 'https://img.test/thumb.jpg', original: 'https://img.test/orig.jpg' }
      return null
    },
    async artistImage() { return null },
    async artistImages() { return new Map() },
    async coverUrl() { return null },
  }
  const reco = createReco({
    history: { read: async () => ({ events: [], total: 0 }) },
    library: { snapshot: () => ({ tracks: [], scannedAt: 1 }), getRecord: () => undefined },
    storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: { async verify() { return null } },
    discover: { async findArtist() { return null }, async buildArtistList() { return { artists: [], cursor: 0 } }, async buildNewCandidates() { return [] } },
    images: fakeImages,
  })
  const a = await reco.artistAvatar('伍佰')
  t('L1 命中返回 imageUrl/thumbnailUrl', a.imageUrl === 'https://img.test/orig.jpg' && a.thumbnailUrl === 'https://img.test/thumb.jpg')
  const n = await reco.artistAvatar('无图歌手')
  t('L2 无图歌手返回双 null（不报错）', n.imageUrl === null && n.thumbnailUrl === null)
  t('L3 空 name 抛 BAD_REQUEST', await reco.artistAvatar('').then(() => false).catch((e) => e.code === 'BAD_REQUEST'))
  const routes = {}
  registerRecoRoutes({ register: (r) => { routes[r.path] = r; return () => {} } }, { reco, logger: { warn: () => {} } })
  const call = (method, url) => new Promise((resolve) => {
    const res = { code: null, writeHead(code) { this.code = code }, end(body) { resolve({ code: this.code, body: JSON.parse(body) }) } }
    routes['/dsh-music/api/reco/artist-image'].handler({ method, url }, res)
  })
  const r1 = await call('GET', '/dsh-music/api/reco/artist-image?name=' + encodeURIComponent('伍佰'))
  t('L4 路由 200 结构完整', r1.code === 200 && r1.body.imageUrl === 'https://img.test/orig.jpg' && r1.body.thumbnailUrl === 'https://img.test/thumb.jpg')
  const r2 = await call('GET', '/dsh-music/api/reco/artist-image?name=')
  t('L5 空 name 400', r2.code === 400)
  const r3 = await call('POST', '/dsh-music/api/reco/artist-image?name=x')
  t('L6 POST 405', r3.code === 405)
  const r4 = await call('GET', '/dsh-music/api/reco/artist-image?name=' + encodeURIComponent('无图歌手'))
  t('L7 未知歌手 200 双 null', r4.code === 200 && r4.body.imageUrl === null && r4.body.thumbnailUrl === null)
  await rm(tmp, { recursive: true, force: true })
}

// ---------- M. D3 冷启动探索批次（零/薄历史放宽下限 ≥6） ----------
{
  const hintField = { genre: 'genreHint', language: 'languageHint', era: 'eraHint', scene: 'sceneHint', wildcard: 'sceneHint' }
  const mkExploreFake = () => ({
    async findArtist() { return null },
    async buildSimilarCandidates() { return [] },
    async buildExploreCandidates({ slots, cursors }) {
      const cands = []
      for (const s of slots) {
        for (let i = 0; i < 4; i++) {
          cands.push({ category: 'explore', axis: s.axis, artist: `${s.axis}A${i}`, title: `${s.axis}T${i}`, reason: 'r', durationMs: 200000, [hintField[s.axis]]: s.axis === 'wildcard' ? '意外之喜' : `${s.axis}val` })
        }
      }
      return { candidates: cands, cursors: { ...cursors } }
    },
    async buildArtistList() { return { artists: [], cursor: 0 } },
    async buildNewCandidates() { return [] },
  })
  const failKeys = new Set([normKey('genreA0', 'genreT0'), normKey('languageA0', 'languageT0')])
  let verifyCalls = 0
  const mkVerifier = () => ({
    async verify({ artist, title }) {
      verifyCalls++
      if (failKeys.has(normKey(artist, title))) return null
      return { verification: { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/m', verifiedAt: Date.now() }, matched: {} }
    },
  })
  const library = { snapshot: () => ({ tracks: [], scannedAt: 1 }), getRecord: () => undefined, ensureScanned: async () => {} }

  // M1 零历史：探索批次 6 首、明示 bootstrap、核实不绕过
  {
    const tmp = await mkdtemp(join(tmpdir(), 'reco-boot-'))
    const reco = createReco({ history: { read: async () => ({ events: [], total: 0 }) }, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: mkVerifier(), discover: mkExploreFake(), images: fakeImages })
    const b = await reco.generate()
    t('M1a 零历史出探索批次（6 首）', b.bootstrap === true && b.items.length === 6 && b.items.every((i) => i.category === 'explore') && b.stats.similar === 0)
    t('M1b 批次明示探索说明', typeof b.note === 'string' && b.note.includes('探索批次'))
    t('M1c 逐首仍核实（不绕过）', verifyCalls >= 6 && b.items.every((i) => i.verification?.source === 'musicbrainz' && Number.isFinite(i.verification.verifiedAt)))
    const s1 = await reco.sections()
    t('M1d sections 明示 exploreOnly', s1.exploreOnly === true && s1.today.length === 6)
    const s2 = await reco.sections()
    t('M1e 探索批次同日复用（不重复生成）', s2.todayFromCache === true && s2.exploreOnly === true && s2.today.length === 6)
    await rm(tmp, { recursive: true, force: true })
  }

  // M2 薄历史（1 条）：仍走探索批次
  {
    const tmp = await mkdtemp(join(tmpdir(), 'reco-boot-thin-'))
    const reco = createReco({ history: { read: async () => ({ events: [{ artist: 'X', title: 'Y', completion: 1, skipped: false }], total: 1 }) }, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: mkVerifier(), discover: mkExploreFake(), images: fakeImages })
    const b = await reco.generate()
    t('M2 薄历史仍出探索批次', b.bootstrap === true && b.items.length === 6)
    await rm(tmp, { recursive: true, force: true })
  }

  // M3 历史充足（≥3 条）：走原 14+6 下限，bootstrap=false
  {
    const tmp = await mkdtemp(join(tmpdir(), 'reco-boot-normal-'))
    const allSimilar = Array.from({ length: 40 }, (_, i) => ({ category: 'similar', artist: `S${i}`, title: `T${i}`, reason: 'r' }))
    const fakeDiscover = {
      ...mkExploreFake(),
      async buildSimilarCandidates() { return allSimilar.map((c) => ({ ...c })) },
    }
    const events = Array.from({ length: 3 }, (_, i) => ({ artist: 'Beyond', title: `B${i}`, completion: 1, skipped: false }))
    const reco = createReco({ history: { read: async () => ({ events, total: 3 }) }, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: mkVerifier(), discover: fakeDiscover, images: fakeImages })
    const b = await reco.generate()
    t('M3 历史充足走原 14+6 下限且 bootstrap=false', b.bootstrap === false && b.items.length === 20 && b.stats.similar === 14 && b.stats.explore === 6)
    await rm(tmp, { recursive: true, force: true })
  }
}

// ---------- N. v7 批2 taste 软偏置（客户端首启偏好；无 taste 行为不变） ----------
{
  const { registerRecoRoutes } = await import('./index.js')
  const base = ['jazz', 'classical', 'electronic']
  t('N1 空 taste 键顺序原样', JSON.stringify(biasKeys(base, [])) === JSON.stringify(base))
  t('N2 taste 命中键前置、其余保序', JSON.stringify(biasKeys(base, ['electronic'])) === JSON.stringify(['electronic', 'jazz', 'classical']))
  t('N3 taste 未知键仍原样', JSON.stringify(biasKeys(base, ['k-pop', 'trip-hop'])) === JSON.stringify(base))
  const nt = normalizeTaste({ genres: [' Electronic ', 'JAZZ', ''], languages: ['japanese', '韩语'] })
  t('N4 taste 归一化（小写/去空白/英文语言别名）', JSON.stringify(nt.genres) === JSON.stringify(['electronic', 'jazz']) && JSON.stringify(nt.languages) === JSON.stringify(['日语', '韩语']))
  t('N5 非数组 taste 不炸', JSON.stringify(normalizeTaste({ genres: 'jazz', languages: null })) === JSON.stringify({ genres: [], languages: [] }))
  const { LANGUAGE_POOLS } = await import('./pools.js')
  t('N5b 语言池含 中文/英语/粤语 且各 ≥3 首', ['中文', '英语', '粤语'].every((k) => (LANGUAGE_POOLS[k] ?? []).length >= 3))
  const ntAlias = normalizeTaste({ languages: ['chinese', 'mandarin', 'english', 'cantonese', '华语'] })
  t('N5c 语言英文别名/华语映射到池键', JSON.stringify(ntAlias.languages) === JSON.stringify(['中文', '中文', '英语', '粤语', '中文']))
  t('N5d biasKeys 中文命中前置', JSON.stringify(biasKeys(['法语', '中文', '日语'], ['中文'])) === JSON.stringify(['中文', '法语', '日语']))

  const hintFieldN = { genre: 'genreHint', language: 'languageHint', era: 'eraHint', scene: 'sceneHint', wildcard: 'sceneHint' }
  const mkTasteFake = () => {
    const seen = { taste: 'untouched' }
    return {
      seen,
      async findArtist() { return null },
      async buildSimilarCandidates() { return [] },
      async buildExploreCandidates({ slots, cursors, taste }) {
        seen.taste = taste
        const g = taste?.genres?.[0] ?? 'jazz'
        const l = taste?.languages?.[0] ?? '法语'
        const cands = []
        for (const s of slots) {
          const hint = s.axis === 'genre' ? g : s.axis === 'language' ? l : s.axis === 'wildcard' ? '意外之喜' : `${s.axis}val`
          for (let i = 0; i < 4; i++) {
            cands.push({ category: 'explore', axis: s.axis, artist: `${s.axis}N${i}`, title: `${s.axis}NT${i}`, reason: 'r', [hintFieldN[s.axis]]: hint })
          }
        }
        return { candidates: cands, cursors: { ...cursors } }
      },
      async buildArtistList() { return { artists: [], cursor: 0 } },
      async buildNewCandidates() { return [] },
    }
  }
  const mkVerifierN = () => ({ async verify() { return { verification: { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/n', verifiedAt: Date.now() }, matched: {} } } })
  const fakeImagesN = { async coverUrl() { return 'https://img.test/c.jpg' }, async artistImage() { return { thumbnail: null, original: null } }, async artistImages() { return new Map() } }
  const library = { snapshot: () => ({ tracks: [], scannedAt: 1 }), getRecord: () => undefined, ensureScanned: async () => {} }

  // N6 generate({taste})：透传发现层，并反映到探索轴提示（零历史探索批）
  {
    const tmp = await mkdtemp(join(tmpdir(), 'reco-taste-'))
    const d = mkTasteFake()
    const reco = createReco({ history: { read: async () => ({ events: [], total: 0 }) }, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: mkVerifierN(), discover: d, images: fakeImagesN })
    const b = await reco.generate({ taste: { genres: ['electronic'], languages: ['日语'] } })
    const g = b.items.find((i) => i.axis === 'genre')
    const l = b.items.find((i) => i.axis === 'language')
    t('N6a generate 透传 taste 给探索发现', JSON.stringify(d.seen.taste) === JSON.stringify({ genres: ['electronic'], languages: ['日语'] }))
    t('N6b 探索流派位命中 taste（软偏置）', g?.genreHint === 'electronic')
    t('N6c 探索语言位命中 taste（软偏置）', l?.languageHint === '日语')
    t('N6d taste 不改变配额/核实（仍 6 首全核实）', b.items.length === 6 && b.items.every((i) => i.verification?.source === 'musicbrainz'))
    await rm(tmp, { recursive: true, force: true })
  }

  // N7 无 taste：发现层收到 undefined，提示回池默认值（行为与现状一致）
  {
    const tmp = await mkdtemp(join(tmpdir(), 'reco-taste-none-'))
    const d = mkTasteFake()
    const reco = createReco({ history: { read: async () => ({ events: [], total: 0 }) }, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: mkVerifierN(), discover: d, images: fakeImagesN })
    const b = await reco.generate()
    const g = b.items.find((i) => i.axis === 'genre')
    const l = b.items.find((i) => i.axis === 'language')
    t('N7a 无 taste 发现层收到 undefined', d.seen.taste === undefined)
    t('N7b 无 taste 提示回池默认（jazz/法语）', g?.genreHint === 'jazz' && l?.languageHint === '法语')
    await rm(tmp, { recursive: true, force: true })
  }

  // N8 路由 query：genres=/languages=（逗号分隔）解析并透传给 sections
  {
    const mkReco = async (tag) => {
      const tmp = await mkdtemp(join(tmpdir(), `reco-taste-route-${tag}-`))
      const reco = createReco({ history: { read: async () => ({ events: [], total: 0 }) }, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: mkVerifierN(), discover: mkTasteFake(), images: fakeImagesN })
      return { reco, tmp }
    }
    const { reco, tmp } = await mkReco('taste')
    const routes = {}
    registerRecoRoutes({ register: (r) => { routes[r.path] = r; return () => {} } }, { reco, logger: { warn: () => {} } })
    const call = (url) => new Promise((resolve) => {
      const res = { code: null, writeHead(code) { this.code = code }, end(body) { resolve({ code: this.code, body: JSON.parse(body) }) } }
      routes['/dsh-music/api/reco/sections'].handler({ method: 'GET', url }, res)
    })
    const r1 = await call('/dsh-music/api/reco/sections?genres=electronic&languages=' + encodeURIComponent('日语'))
    t('N8 路由解析 genres/languages 并透传', r1.code === 200 && r1.body.today.some((i) => i.genreHint === 'electronic') && r1.body.today.some((i) => i.languageHint === '日语'))
    await rm(tmp, { recursive: true, force: true })

    // N9 另一实例无 query：行为不变（默认池值），且同日批次可复用
    const { reco: reco2, tmp: tmp2 } = await mkReco('plain')
    const routes2 = {}
    registerRecoRoutes({ register: (r) => { routes2[r.path] = r; return () => {} } }, { reco: reco2, logger: { warn: () => {} } })
    const call2 = (url) => new Promise((resolve) => {
      const res = { code: null, writeHead(code) { this.code = code }, end(body) { resolve({ code: this.code, body: JSON.parse(body) }) } }
      routes2['/dsh-music/api/reco/sections'].handler({ method: 'GET', url }, res)
    })
    const r2 = await call2('/dsh-music/api/reco/sections')
    t('N9 路由无参数时行为不变（默认 jazz/法语）', r2.code === 200 && r2.body.today.some((i) => i.genreHint === 'jazz') && r2.body.today.some((i) => i.languageHint === '法语'))
    await rm(tmp2, { recursive: true, force: true })
  }
}

// ---------- P. 八期：新歌语义 / 流派池补全 / 避开不喜欢（离线） ----------
{
  const { GENRE_POOLS } = await import('./pools.js')
  const { NEW_RELEASE_DAYS, newReleaseReason } = await import('./discover.js')
  const CLIENT_GENRES = ['pop', 'rock', 'electronic', 'hip hop', 'jazz', 'classical', 'folk', 'blues', 'soul', 'funk', 'reggae', 'metal', 'punk', 'country', 'ambient']
  t('P1 欢迎页 15 流派全部有池键且 ≥3 首', CLIENT_GENRES.every((g) => Array.isArray(GENRE_POOLS[g]) && GENRE_POOLS[g].length >= 3))
  t('P2 池内条目 artist/title 齐全', Object.values(GENRE_POOLS).flat().every((s) => typeof s.artist === 'string' && s.artist && typeof s.title === 'string' && s.title))
  t('P3 hip hop 保留空格键（与 MB tag / style.js 口径一致）', Boolean(GENRE_POOLS['hip hop']) && GENRE_POOLS.hiphop === undefined)
  t('P4 新歌窗口收紧到 180 天', NEW_RELEASE_DAYS === 180)
  t('P5 新歌理由年份来自真实发行日期', newReleaseReason('A', '2026-03-01', 'X') === '新歌推荐：A 2026 年发行专辑《X》')
  t('P6 无发行日期时回退「近期发行」', newReleaseReason('A', '', '').includes('近期发行'))
  t('P7 taste 命中 hip hop 时软偏置到首位', biasKeys(['jazz', 'hip hop', 'rock'], ['hip hop'])[0] === 'hip hop')
}

{
  // ④ generate：不喜欢的歌排除 + 同歌手其余曲目软降权 + 不写入防重复名单
  const tmp = await mkdtemp(join(tmpdir(), 'reco-dislike-'))
  await writeFile(join(tmp, 'likes.json'), JSON.stringify({
    v: 2, items: {},
    dislikes: {
      'S0::T0': { key: 'S0::T0', artist: 'S0', title: 'T0', dislikedAt: 1 },
      'S2::T2': { key: 'S2::T2', artist: 'S2', title: 'T2', dislikedAt: 1 },
    },
  }))
  const similar = Array.from({ length: 40 }, (_, i) => ({ category: 'similar', artist: `S${i}`, title: `T${i}`, reason: 'r' }))
  const hintField = { genre: 'genreHint', language: 'languageHint', era: 'eraHint', scene: 'sceneHint', wildcard: 'sceneHint' }
  const fakeDiscover = {
    async buildSimilarCandidates() { return similar.map((c) => ({ ...c })) },
    async buildExploreCandidates({ slots }) {
      const cands = []
      for (const s of slots) {
        for (let i = 0; i < 4; i++) {
          cands.push({ category: 'explore', axis: s.axis, artist: `${s.axis}A${i}`, title: `${s.axis}T${i}`, reason: 'r', durationMs: 200000, [hintField[s.axis]]: s.axis === 'wildcard' ? '意外之喜' : `${s.axis}val` })
        }
      }
      return { candidates: cands, cursors: {} }
    },
    async findArtist(name) { return { mbid: 'x', name, tags: ['rock'] } },
  }
  const history = { read: async () => ({ events: [{ artist: 'Beyond', title: 'X', completion: 1 }, { artist: 'Beyond', title: 'Y', completion: 1 }, { artist: 'Nightwish', title: 'Z', completion: 1 }], total: 3 }) }
  const library = { snapshot: () => ({ tracks: [], scannedAt: 1 }), ensureScanned: async () => {} }
  const verifier = { async verify() { return { verification: { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/x', verifiedAt: Date.now() }, matched: {} } } }
  const reco = createReco({ history, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier, discover: fakeDiscover, images: fakeImages })
  const b = await reco.generate()
  t('P8 不喜欢的歌不进批次', b.items.length > 0 && !b.items.some((i) => normKey(i.artist, i.title) === normKey('S0', 'T0')))
  t('P9 不喜欢歌手的其余曲目软降权（候选充足时不被选中）', !b.items.some((i) => i.artist === 'S2'))
  const st = JSON.parse(await readFile(join(tmp, 'reco-state.json'), 'utf8'))
  t('P10 不喜欢的歌不进防重复名单', !st.recentRecommended.includes(normKey('S0', 'T0')))
  await rm(tmp, { recursive: true, force: true })
}

{
  // ①/④ sections：new 走「真新歌」入参（tasteGenres + dislikes），且不喜欢的歌被兜底过滤
  const tmp = await mkdtemp(join(tmpdir(), 'reco-newsec-'))
  await writeFile(join(tmp, 'likes.json'), JSON.stringify({ v: 2, items: {}, dislikes: { 'BAD::BADT': { key: 'BAD::BADT', artist: 'BAD', title: 'BADT', dislikedAt: 1 } } }))
  let captured = null
  const fakeDiscover = {
    async buildSimilarCandidates() {
      return Array.from({ length: 40 }, (_, i) => ({ category: 'similar', artist: `S${i}`, title: `T${i}`, reason: 'r' }))
    },
    async buildExploreCandidates({ slots }) {
      const cands = []
      const hintField = { genre: 'genreHint', language: 'languageHint', era: 'eraHint', scene: 'sceneHint', wildcard: 'sceneHint' }
      for (const s of slots) {
        for (let i = 0; i < 4; i++) {
          cands.push({ category: 'explore', axis: s.axis, artist: `${s.axis}A${i}`, title: `${s.axis}T${i}`, reason: 'r', durationMs: 200000, [hintField[s.axis]]: s.axis === 'wildcard' ? '意外之喜' : `${s.axis}val` })
        }
      }
      return { candidates: cands, cursors: {} }
    },
    async findArtist(name) { return { mbid: 'x', name, tags: ['rock'] } },
    async buildArtistList({ cursor = 0, limit = 20 }) {
      const artists = Array.from({ length: limit }, (_, i) => ({
        id: `mb${i}`, name: `ar${i}`, genreHint: 'rock', similar: [`sib${i}a`],
        reason: '相似歌手：与您常听的 Beyond 风格相近',
        verification: { source: 'musicbrainz', url: `https://musicbrainz.org/artist/mb${i}`, verifiedAt: Date.now() },
      }))
      return { artists, cursor: cursor + 1 }
    },
    async buildNewCandidates(args) {
      captured = args
      const cands = Array.from({ length: 24 }, (_, i) => ({ category: 'new', artist: `N${i}`, title: `NT${i}`, album: '新专辑', durationMs: 200000, releaseDate: '2026-05-01', reason: '新歌推荐：近期发行' }))
      cands.splice(5, 0, { category: 'new', artist: 'BAD', title: 'BADT', reason: '新歌推荐：不应出现' })
      return cands
    },
  }
  const history = { read: async () => ({ events: [{ artist: 'Beyond', title: 'X', completion: 1 }, { artist: 'Beyond', title: 'Y', completion: 1 }, { artist: 'Nightwish', title: 'Z', completion: 1 }], total: 3 }) }
  const library = { snapshot: () => ({ tracks: [{ id: 'lib1', artist: 'LIB', title: 'LIBT' }], scannedAt: 1 }), getRecord: () => undefined, ensureScanned: async () => {} }
  const verifier = { async verify() { return { verification: { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/x', verifiedAt: Date.now() }, matched: {} } } }
  const reco = createReco({ history, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier, discover: fakeDiscover, images: fakeImages })
  const s = await reco.sections({ taste: { genres: ['rock'] } })
  t('P11 new 入参带 tasteGenres（taste 优先）', Array.isArray(captured?.tasteGenres) && captured.tasteGenres.includes('rock'))
  t('P12 new 入参带不喜欢键，且兜底过滤后不出现', captured?.dislikedKeys?.has(normKey('BAD', 'BADT')) && !s.new.some((i) => normKey(i.artist, i.title) === normKey('BAD', 'BADT')))
  t('P13 new 不再含「新加入曲库」类本地条目', !s.new.some((i) => String(i.reason).includes('新加入曲库')))
  await rm(tmp, { recursive: true, force: true })
}

{
  // ④ 歌手页：不喜欢的歌不出现在歌手页歌曲列表
  const { mkdir, writeFile } = await import('node:fs/promises')
  const tmp = await mkdtemp(join(tmpdir(), 'reco-dislike-artist-'))
  await mkdir(join(tmp, 'cache', 'artists'), { recursive: true })
  await writeFile(join(tmp, 'cache', 'artists', 'beyond.json'), JSON.stringify({ version: 1, data: { name: 'Beyond', intro: { text: '香港搖滾樂團', source: '维基百科', url: 'https://zh.wikipedia.org/wiki/Beyond', date: '2026-11-12' }, news: [], trivia: [], similarArtists: [], similarSongs: [] } }))
  await writeFile(join(tmp, 'likes.json'), JSON.stringify({ v: 2, items: {}, dislikes: { 'Beyond::D1': { key: 'Beyond::D1', artist: 'Beyond', title: 'D1', dislikedAt: 1 } } }))
  const fakeDiscover = {
    async findArtist(name) { return name === 'Beyond' ? { mbid: 'mb-beyond', name: 'Beyond', tags: ['rock'] } : null },
    async browseRecordings() { return [{ artist: 'Beyond', title: 'D1', durationMs: 300000 }, { artist: 'Beyond', title: 'D2', durationMs: 300000 }] },
  }
  const verifier = { async verify() { return { verification: { source: 'musicbrainz', url: 'https://musicbrainz.org/recording/x', verifiedAt: Date.now() }, matched: {} } } }
  const library = { snapshot: () => ({ tracks: [], scannedAt: 1 }), ensureScanned: async () => {} }
  const reco = createReco({ history: { read: async () => ({ events: [], total: 0 }) }, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier, discover: fakeDiscover, images: fakeImages })
  const p = await reco.artistPage('Beyond')
  t('P14 歌手页不显示不喜欢的歌', p.songs.length === 1 && p.songs[0].title === 'D2')
  await rm(tmp, { recursive: true, force: true })
}

// ---------- Q. 九期点4：歌手页维基兜底回写 + 核实未命中负缓存 ----------
{
  const { createVerifier } = await import('./verify.js')
  const tmp = await mkdtemp(join(tmpdir(), 'reco-neg-'))
  const origFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ recordings: [] }) }
  }
  const verifier = createVerifier({ storage: { dataDir: tmp }, logger: { warn: () => {} } })
  const a = await verifier.verify({ artist: 'NegA', title: 'NegT' })
  const b = await verifier.verify({ artist: 'NegA', title: 'NegT' })
  t('Q1 核实未命中写入负缓存，二次调用零网络', a === null && b === null && calls === 1)
  const files = (await readdir(join(tmp, 'cache', 'verifications'))).filter((f) => f.endsWith('.json'))
  const rec = JSON.parse(await readFile(join(tmp, 'cache', 'verifications', files[0]), 'utf8'))
  rec.missedAt = Date.now() - 4 * 24 * 3600 * 1000
  await writeFile(join(tmp, 'cache', 'verifications', files[0]), JSON.stringify(rec))
  const c = await verifier.verify({ artist: 'NegA', title: 'NegT' })
  t('Q2 负缓存 3 天过期后重新核实', c === null && calls === 2)
  globalThis.fetch = async () => { calls++; throw new Error('network down') }
  const d1 = await verifier.verify({ artist: 'NetFail', title: 'X' })
  const d2 = await verifier.verify({ artist: 'NetFail', title: 'X' })
  t('Q3 网络失败不写负缓存（每次可重试）', d1 === null && d2 === null && calls === 4)
  globalThis.fetch = origFetch
  await rm(tmp, { recursive: true, force: true })
}

{
  // artistPage：无预填缓存时 live 维基成功 → 落 cache/artists/<slug>.json（与 metadata 同格式，共享）
  const tmp = await mkdtemp(join(tmpdir(), 'reco-wikicache-'))
  const origFetch = globalThis.fetch
  let wikiCalls = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('w/api.php')) {
      wikiCalls++
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ query: { pages: { '1': { extract: '维基简介文本' } } } }) }
    }
    return { ok: false, status: 404, headers: { get: () => 'text/html' } }
  }
  const fakeDiscover = {
    async findArtist(name) { return name === 'Wikitest' ? { mbid: 'mb-w', name, tags: ['rock'] } : null },
    async browseRecordings() { return [] },
  }
  const library = { snapshot: () => ({ tracks: [], scannedAt: 1 }), ensureScanned: async () => {} }
  const reco = createReco({ history: { read: async () => ({ events: [], total: 0 }) }, library, storage: { dataDir: tmp }, logger: { warn: () => {} }, verifier: { async verify() { return null } }, discover: fakeDiscover, images: fakeImages })
  const p = await reco.artistPage('Wikitest')
  const saved = JSON.parse(await readFile(join(tmp, 'cache', 'artists', 'wikitest.json'), 'utf8'))
  t('Q4 维基兜底成功回写共享缓存', p.profile?.intro?.text === '维基简介文本' && saved?.version === 1 && saved?.data?.name === 'Wikitest' && saved?.data?.intro?.text === '维基简介文本' && Number.isFinite(saved?.fetchedAt))
  const before = wikiCalls
  const p2 = await reco.artistPage('Wikitest')
  t('Q5 回写后再次打开不再请求维基（跨会话共享）', wikiCalls === before && p2.profile?.intro?.text === '维基简介文本')
  globalThis.fetch = origFetch
  await rm(tmp, { recursive: true, force: true })
}

console.log(`\nreco-test: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
