/** 插件激活图导入冒烟：node scripts/import-smoke.mjs
 * node --check 只查语法、不解析 import 说明符；已发生过 `./binaries.js` 写错目录导致
 * 插件未激活的事故。本脚本动态 import 真实入口 bundle/index.js（Node 会解析整张
 * import 图），并逐一 import host 下所有非测试模块，确认真实解析全部通过。 */
const failures = []
const ok = []
async function tryImport(label, url) {
  try {
    const mod = await import(url)
    ok.push(label)
    return mod
  } catch (err) {
    failures.push(`${label}: ${err.message.split('\n')[0]}`)
    return null
  }
}

const entryUrl = new URL('../bundle/index.js', import.meta.url)
const entry = await tryImport('bundle/index.js（插件入口）', entryUrl)
if (entry) {
  if (typeof entry.apply !== 'function') failures.push('bundle/index.js 未导出 apply 函数')
  if (!Array.isArray(entry.inject) || !entry.inject.includes('webServer')) failures.push('bundle/index.js 的 inject 未包含 webServer')
}

// host 根与子目录模块（排除测试/脚本类 .mjs：reco-test、diversity-report 等）
const modules = [
  'main.js', 'storage.js', 'library.js', 'playback.js', 'routes.js', 'history.js',
  'download.js', 'sync.js', 'manage.js', 'search.js', 'likes.js', 'preview.js',
  'media-core.js', 'binaries.js', 'lock.js', 'tags.js', 't2s.js', 'icon.js',
  'metadata/index.js', 'metadata/cache.js', 'metadata/lrc.js', 'metadata/lrclib.js',
  'metadata/lyrics.js', 'metadata/artist.js', 'metadata/embedded.js',
  'reco/index.js', 'reco/mb.js', 'reco/verify.js', 'reco/quota.js', 'reco/discover.js',
  'reco/images.js', 'reco/style.js', 'reco/pools.js', 'reco/diversity.js',
]
for (const rel of modules) {
  const url = new URL(`../bundle/host/${rel}`, import.meta.url)
  try {
    const fs = await import('node:fs/promises')
    await fs.access(url)
  } catch {
    continue // 该模块不存在（不同版本裁剪）不算失败
  }
  await tryImport(`host/${rel}`, url)
}

if (failures.length > 0) {
  console.error('导入冒烟失败：')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(`导入冒烟通过：${ok.length} 个模块真实解析成功（含插件入口激活图）`)
process.exit(0)