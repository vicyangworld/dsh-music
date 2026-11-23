#!/usr/bin/env node
/**
 * 六期批5 · 冷装冒烟（对**打包产物**解包后的目录做，不碰当前 profile 的 link 安装）
 *
 * 用法：node tests/cold-install-smoke.mjs <解包后的包根>
 * 例如：node tests/cold-install-smoke.mjs /tmp/dshm-coldinstall/package
 *
 * 校验：
 *  ① 入口 index.js 可真实解析并导出 apply/inject（宿主图完整）
 *  ② host/**、client/index.js 的真实 import 图全部可解析（不依赖仓库其他文件）
 *  ③ 清单：name/version/private/engines.dsh/files 与八语 meta 完整
 *  ④ client 工厂 id == 包名（DSH 硬性要求，否则面板不注册）
 *  ⑤ docs/DETAIL.md 在包内，meta.detail 相对根可解析，引用图全部存在
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.argv[2]
if (!root) { console.error('用法：node tests/cold-install-smoke.mjs <包根>'); process.exit(2) }

let pass = 0, fail = 0
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`PASS ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
console.log(`包根：${root}\n包：${pkg.name}@${pkg.version}\n`)

// ---- ③ 清单 ----
check(pkg.name === '@vicyangorg/dsh-music', '包名 @vicyangorg/dsh-music（scoped）', pkg.name)
check(pkg.private === false, 'private=false（可发布）', String(pkg.private))
check(Boolean(pkg.engines?.dsh), 'engines.dsh 已声明', pkg.engines?.dsh)
check(Boolean(pkg.license), 'license 已声明', pkg.license)
check(Array.isArray(pkg.files) && pkg.files.length > 0, 'files 白名单存在', `${pkg.files?.length} 条`)
const srcVersion = JSON.parse(readFileSync(new URL('../bundle/package.json', import.meta.url), 'utf8')).version
check(pkg.version === srcVersion, `发布版本 ${srcVersion}（与源 bundle/package.json 一致）`, pkg.version)
check(/github\.com\/vicyangworld\/dsh-music/.test(pkg.repository?.url || ''), 'repository 指向 vicyangworld/dsh-music', pkg.repository?.url || '(缺失)')
check(/github\.com\/vicyangworld\/dsh-music/.test(pkg.homepage || ''), 'homepage 指向仓库', pkg.homepage || '(缺失)')
check(/github\.com\/vicyangworld\/dsh-music\/issues/.test(pkg.bugs?.url || ''), 'bugs 指向仓库 issues', pkg.bugs?.url || '(缺失)')

// ---- ① 入口 ----
const entryPath = join(root, 'index.js')
const entry = await import(pathToFileURL(entryPath).href).catch((e) => ({ __err: e }))
check(!entry.__err, '入口 index.js 可解析', entry.__err ? entry.__err.message.split('\n')[0] : '')
check(typeof entry.apply === 'function', '入口导出 apply', typeof entry.apply)
check(Array.isArray(entry.inject) && entry.inject.includes('webServer'), '入口 inject 含 webServer', JSON.stringify(entry.inject))

// ---- ② 真实 import 图 ----
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}
const hostFiles = walk(join(root, 'host'))
const bad = []
for (const f of hostFiles) {
  try { await import(pathToFileURL(f).href) } catch (e) { bad.push(`${f.slice(root.length + 1)}: ${e.message.split('\n')[0]}`) }
}
check(bad.length === 0 && hostFiles.length > 20, `host 全模块真实解析（${hostFiles.length} 个）`, bad.slice(0, 3).join('; '))
check(existsSync(join(root, 'client', 'index.js')), 'client/index.js 在包内')
check(existsSync(join(root, 'host', 'life.js')), 'host/life.js 在包内（ECHO 存档服务）')
check(existsSync(join(root, 'shared', 'life-core.js')), 'shared/life-core.js 在包内（ECHO 共享规则）')
const core = await import(pathToFileURL(join(root, 'shared', 'life-core.js')).href).catch((e) => ({ __err: e }))
check(!core.__err && ['createLife', 'applyLifeEvent', 'getMorphology', 'replayLife'].every(name => typeof core[name] === 'function'),
  '打包的 ECHO 共享规则可独立导入', core.__err ? core.__err.message.split('\n')[0] : '')

// ---- ④ 工厂 id ----
const clientSrc = readFileSync(join(root, 'client', 'index.js'), 'utf8')
// The built artifact may contain many unrelated id fields. Match only the
// ModuleLoader registration, accepting either quote style emitted by esbuild.
const idMatch = clientSrc.match(/window\.__ModuleLoader__\.load\(\{\s*id:\s*(['"])([^'"]+)\1\s*,/)
check(Boolean(idMatch) && idMatch[2] === pkg.name, 'client 工厂 id == 包名（DSH 注册要求）', idMatch ? `${idMatch[2]} vs ${pkg.name}` : '未找到 ModuleLoader 工厂 id')

// ---- ⑤ 八语 meta + DETAIL + 图片 ----
const localeDir = join(root, 'locale')
const locales = existsSync(localeDir) ? readdirSync(localeDir).filter((f) => f.endsWith('.json')) : []
check(locales.length >= 8, 'locale 语言数 ≥8', String(locales.length))
let detailPath = null
const metaBad = []
for (const f of locales) {
  const m = JSON.parse(readFileSync(join(localeDir, f), 'utf8')).meta || {}
  if (!m.title || !m.description || !m.detail) metaBad.push(`${f}(缺 ${['title', 'description', 'detail'].filter((k) => !m[k]).join('/')})`)
  if (m.detail) detailPath = m.detail
}
check(metaBad.length === 0, '八语 meta.title/description/detail 齐全', metaBad.join(', '))
check(Boolean(detailPath) && existsSync(join(root, detailPath)), 'meta.detail 在包内可解析', detailPath || '(缺失)')
if (detailPath && existsSync(join(root, detailPath))) {
  const md = readFileSync(join(root, detailPath), 'utf8')
  const refs = [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((r) => !/^https?:/i.test(r))
  const missing = refs.filter((r) => !existsSync(join(root, dirname(detailPath), normalize(r))))
  check(refs.length > 0 && missing.length === 0, `DETAIL 引用图全部在包内（${refs.length} 张）`, missing.join(', '))
}
check(existsSync(join(root, 'README.md')), 'README.md 在包内')

console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'}  pass=${pass} fail=${fail}`)
process.exit(fail === 0 ? 0 : 1)
