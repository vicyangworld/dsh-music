/* 十三期：导入曲目后台音源扫描 —— 评分 / 查询顺序 / TTL / found 跳过 / 联网失败回队 / 与 likes.js 的写回 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickHit, cleanTitle, normText, sanitizeHit, createSourceScan } from '../bundle/host/source-scan.js'
import { createStorage } from '../bundle/host/storage.js'
import { createLikes } from '../bundle/host/likes.js'

let pass = 0
const test = async (name, fn) => { await fn(); pass++; console.log('PASS:', name) }
const tick = () => new Promise((r) => setTimeout(r, 5))

const v = (score) => ({ source: 'MusicBrainz', url: 'https://musicbrainz.org/recording/x', verifiedAt: 1, note: `search score=${score}` })

await test('评分：歌名完全一致优先；去括号/feat 后一致次之；歌手覆盖加分；歌名对不上直接排除', () => {
  const item = { artist: '周杰伦 / 费玉清', title: '千里之外' }
  const remote = [
    { kind: 'song', artist: '費玉清', title: '千里之外 (Live)', verification: v(80) },
    { kind: 'song', artist: '周杰伦, 費玉清', title: '千里之外', verification: v(90), id: 'r1' },
    { kind: 'song', artist: '刘芳', title: '千里之外', verification: v(70) },
    { kind: 'song', artist: '周杰伦', title: '千里之外二', verification: v(100) },
    { kind: 'artist', artist: '周杰伦', verification: v(100) },
    { kind: 'song', artist: '周杰伦', title: '千里之外' },
  ]
  assert.equal(pickHit(item, remote).id, 'r1')
  assert.equal(pickHit({ artist: '费玉清', title: '千里之外' }, [remote[0]]).title, '千里之外 (Live)')
  assert.equal(pickHit({ artist: 'x', title: '不存在' }, remote), null)
  assert.equal(cleanTitle('千里之外 (Live) [2020] feat. Someone'), '千里之外')
  assert.equal(normText('伍佰 & China Blue'), '伍佰chinablue')
  assert.equal(normText('費玉清'), normText('费玉清')); assert.equal(normText('陳潔麗'), '陈洁丽')
  // 精度优先：歌手一个都对不上（翻唱 / 同名歌）不要；长短悬殊的"包含"不算同名；歌手未知时只看歌名
  assert.equal(pickHit({ artist: '邓丽君', title: '我只在乎你' }, [{ kind: 'song', artist: '陳潔麗', title: '我只在乎你', verification: v(99) }]), null)
  assert.equal(pickHit({ artist: 'Max Daniel', title: '-Ramin Djawadi-《权力的游戏》冰与火之歌（重制版）' }, [{ kind: 'song', artist: '青蛙乐队', title: '权力', verification: v(99) }]), null)
  assert.ok(pickHit({ artist: '未知歌手', title: '因为爱情' }, [{ kind: 'song', artist: '王菲, 陈奕迅', title: '因为爱情', verification: v(50) }]))
  assert.ok(pickHit({ artist: 'The Score', title: 'The Fear' }, [{ kind: 'song', artist: 'The Score', title: 'The Fear (Acoustic)', verification: v(50) }]))
})

await test('hit 只保留入库需要的字段', () => {
  const h = sanitizeHit({ kind: 'song', id: 'r1', artist: 'a', title: 't', album: 'al', durationMs: 1000, verification: v(1), extra: 'x', source: 'musicbrainz' })
  assert.deepEqual(Object.keys(h).sort(), ['album', 'artist', 'durationMs', 'id', 'kind', 'source', 'title', 'verification'])
  assert.equal(sanitizeHit(null), null)
})

{
  const dir = await mkdtemp(join(tmpdir(), 'dshm-scan-'))
  const storage = createStorage({ dataDir: join(dir, 'data') })
  const libTrack = { id: 'a'.repeat(16), artist: '本地歌手', title: '已在曲库', album: 'x', audioUrl: '/a.mp3' }
  const library = {
    snapshot: () => ({ tracks: [libTrack] }),
    ensureScanned: async () => {},
  }
  const logger = { warn: () => {} }
  const likes = createLikes({ storage, library, logger })
  await likes.importItems('netease', [
    { platformId: 1, title: '已在曲库', artist: '本地歌手' },
    { platformId: 2, title: '痛哭的人', artist: '伍佰 & China Blue' },
    { platformId: 3, title: '查无此歌', artist: '无名氏' },
  ])
  const calls = []
  let failNext = false
  const hit = { kind: 'song', id: 'r9', artist: '伍佰 & China Blue', title: '痛哭的人', album: '爱你伍佰年', durationMs: 282145, verification: v(95), junk: 1 }
  const search = {
    search: async (q, type) => {
      calls.push({ q, type })
      if (failNext) { failNext = false; throw new Error('MusicBrainz 429') }
      return { local: [], remote: q.startsWith('伍佰') ? [hit] : [] }
    },
  }
  const scan = createSourceScan({ likes, search, logger })
  const drain = async () => { await tick(); while (scan.status().running || scan.status().pending) await tick() }
  await test('与真实 likes 协作：只扫还没入库且没结果的条目；found 写回 source；none 记 checkedAt', async () => {
    assert.deepEqual((await likes.missingKeys()).sort(), ['伍佰 & china blue::痛哭的人', '无名氏::查无此歌'])
    scan.scheduleMissing()
    await drain()
    const st = scan.status()
    assert.equal(st.done, 2); assert.equal(st.found, 1); assert.equal(st.error, null); assert.equal(st.running, false)
    assert.deepEqual(calls.map((c) => c.q), ['伍佰 & China Blue 痛哭的人', '无名氏 查无此歌', '查无此歌'])
    const items = (await likes.list()).items
    const found = items.find((it) => it.title === '痛哭的人')
    assert.equal(found.source.status, 'found'); assert.equal(found.source.hit.id, 'r9'); assert.equal('junk' in found.source.hit, false)
    assert.equal(found.source.hit.verification.source, 'MusicBrainz')
    const none = items.find((it) => it.title === '查无此歌')
    assert.equal(none.source.status, 'none'); assert.equal(none.source.hit, null)
    assert.equal(items.find((it) => it.title === '已在曲库').inLibrary, true)
  })
  await test('再排一次：found 跳过、none 在 7 天内跳过 → 零请求；force 则重扫 none', async () => {
    calls.length = 0
    scan.scheduleMissing()
    await drain()
    assert.deepEqual(calls, [])
    scan.scheduleMissing({ force: true })
    await drain()
    assert.deepEqual(calls.map((c) => c.q), ['无名氏 查无此歌', '查无此歌'])
  })
  await test('联网失败：本轮停摆、key 回到队首、status.error 有文案；下一次 schedule 继续', async () => {
    await likes.setSource('无名氏::查无此歌', null)
    failNext = true
    calls.length = 0
    scan.scheduleMissing({ force: true })
    await tick(); while (scan.status().running) await tick() // 失败后 key 回队（pending 1）但不再运行
    const st = scan.status()
    assert.equal(st.error, 'MusicBrainz 429'); assert.equal(st.pending, 1)
    scan.schedule()
    await drain()
    assert.ok(calls.some((c) => c.q === '无名氏 查无此歌'))
    assert.equal(scan.status().pending, 0)
    assert.equal((await likes.get('无名氏::查无此歌')).source.status, 'none')
  })
  await test('评分规则升级（SCAN_VERSION）后，旧的 found 结果会被自动重扫', async () => {
    const found = await likes.get('伍佰 & china blue::痛哭的人')
    await likes.setSource('伍佰 & china blue::痛哭的人', { ...found.source, v: 1 })
    calls.length = 0
    scan.scheduleMissing()
    await drain()
    assert.deepEqual(calls.map((c) => c.q), ['伍佰 & China Blue 痛哭的人'])
    assert.equal((await likes.get('伍佰 & china blue::痛哭的人')).source.v, 2)
  })
  await test('dispose 清空队列；扫描结束后 likes.list() 带 source，入库后 missingKeys 不再包含', async () => {
    scan.dispose()
    assert.equal(scan.status().pending, 0)
    assert.equal(await scan.scheduleMissing(), 0)
    await rm(dir, { recursive: true, force: true })
  })
}
console.log(`全部通过（音源后台扫描：${pass} 项）`)
