#!/usr/bin/env node
/**
 * 六期 D11/D2 · 分发打包自检
 *
 * 校验三件事（对 `bundle/` 这个包根执行 `npm pack --dry-run --json`，不产 tgz）：
 *  ① locale `meta.detail` 指向的文件确实在**包内**（相对包根解析）
 *  ② DETAIL.md 里引用的每张图都在包内、路径相对 DETAIL.md 可解析
 *  ③ 包内是否有 README（npm 无 README 时详情页/市场卡片会空）
 *
 * 背景：`files` 里的路径相对**包根**（bundle/），不是仓库根 —— 放在仓库 `docs/` 的文件
 * 不会被 npm 收进包（实测：`docs/DETAIL.md` 写在 files 里，但 bundle/ 下没有 docs/，零文件命中）。
 *
 * 用法：node tests/packaging-check.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const pkgRoot = join(repo, 'bundle')

let pass = 0, fail = 0
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`PASS ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

// ---- npm pack 清单（--dry-run 不产 tgz）----
let packed
try {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: pkgRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  packed = JSON.parse(out)
} catch (e) {
  console.log('FAIL npm pack --dry-run 执行失败 — ' + (e.stderr || e.message).toString().slice(0, 300))
  process.exit(1)
}
const info = Array.isArray(packed) ? packed[0] : packed
const files = (info.files || []).map((f) => f.path)
const set = new Set(files)
console.log(`包：${info.name}@${info.version} · ${files.length} 文件 · ${(info.size / 1024).toFixed(1)} kB\n`)

// ---- ⓪ 发布元数据（七期批3）----
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
check(info.name === '@vicyangorg/dsh-music', '包名 @vicyangorg/dsh-music（scoped）', info.name)
check(info.version === '0.3.0', '发布版本 0.3.0', info.version)
check(/github\.com\/vicyangworld\/dsh-music/.test(pkg.repository?.url || ''), 'repository 指向 vicyangworld/dsh-music', pkg.repository?.url || '(缺失)')
check(/github\.com\/vicyangworld\/dsh-music/.test(pkg.homepage || ''), 'homepage 指向仓库', pkg.homepage || '(缺失)')
check(/github\.com\/vicyangworld\/dsh-music\/issues/.test(pkg.bugs?.url || ''), 'bugs 指向仓库 issues', pkg.bugs?.url || '(缺失)')
const readmeSrc = readFileSync(join(pkgRoot, 'README.md'), 'utf8')
check(/plugin_manager/.test(readmeSrc) && /安装/.test(readmeSrc), 'README 含安装章节（plugin_manager 示例）')
check(/publishing\.md/.test(readmeSrc), 'README 含维护者发布入口（docs/publishing.md）')

// ---- ① meta.detail ----
const locales = files.filter((f) => f.startsWith('locale/') && f.endsWith('.json'))
check(locales.length > 0, '包内有 locale 资源', `${locales.length} 个`)
let detailPath = null
for (const rel of locales) {
  const abs = join(pkgRoot, rel)
  if (!existsSync(abs)) continue
  const meta = JSON.parse(readFileSync(abs, 'utf8')).meta || {}
  if (meta.detail) { detailPath = meta.detail; break }
}
check(Boolean(detailPath), 'locale meta.detail 已声明', detailPath || '(缺失)')
if (detailPath) {
  const inPack = set.has(detailPath.replace(/^\.\//, ''))
  check(inPack, 'meta.detail 指向的文件在**包内**', inPack ? detailPath : `${detailPath} 不在包内（包根=${pkgRoot}）`)
  const onDisk = existsSync(join(pkgRoot, detailPath))
  check(onDisk, 'meta.detail 文件在磁盘上可解析（相对包根）', onDisk ? '' : join(pkgRoot, detailPath) + ' 不存在')
}

// ---- ② DETAIL.md 里的图片引用 ----
const detailAbs = detailPath ? join(pkgRoot, detailPath) : null
if (detailAbs && existsSync(detailAbs)) {
  const md = readFileSync(detailAbs, 'utf8')
  const refs = [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1])
  check(refs.length > 0, 'DETAIL.md 含截图引用', `${refs.length} 张`)
  const detailDir = dirname(detailPath)
  const missing = []
  for (const ref of refs) {
    if (/^https?:/i.test(ref)) continue
    const relInPkg = normalize(join(detailDir, ref)).replace(/^\.\//, '')
    if (!set.has(relInPkg)) missing.push(`${ref} → 期望包内 ${relInPkg}`)
  }
  check(missing.length === 0, '每张引用图都在包内且路径可解析', missing.length ? missing.join('; ') : refs.join(', '))
} else {
  check(false, '无法读取 DETAIL.md，跳过图片校验', '')
}

// ---- ②b 仓库源与包内副本是否漂移（防两处各改各的）----
const repoDetail = join(repo, 'docs', 'DETAIL.md')
const pkgDetail = join(pkgRoot, 'docs', 'DETAIL.md')
if (existsSync(repoDetail) && existsSync(pkgDetail)) {
  const a = readFileSync(repoDetail, 'utf8').replace(/\r\n/g, '\n')
  const b = readFileSync(pkgDetail, 'utf8').replace(/\r\n/g, '\n')
  check(a === b, '仓库 docs/DETAIL.md 与包内 bundle/docs/DETAIL.md 内容一致', a === b ? '' : '内容漂移：以其中一份为准同步另一份')
} else if (!existsSync(pkgDetail)) {
  check(false, '包内副本 bundle/docs/DETAIL.md 存在', '缺失：仓库 docs/ 在包根之外，必须复制进 bundle/docs/')
}

// ---- ③ README ----
const readme = files.find((f) => /^readme(\.[a-z]+)?$/i.test(f))
check(Boolean(readme), '包内有 README（npm 页面/市场卡片用）', readme || '缺失：npm 会显示 “no README”，市场卡片无文案')

console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'}  pass=${pass} fail=${fail}`)
process.exit(fail === 0 ? 0 : 1)
