#!/usr/bin/env node
/**
 * S4 D1/D2 定点复测（可复跑）
 *
 * D1：推荐卡片类别 chip 显示中文/英文标签，而不是原始键 `recoSimilar`。
 *     - zh/en 字典都含 recoSimilar / recoExplore
 *     - RecoCard 用 t('recoSimilar') / t('recoExplore') 渲染
 *     - 全文件 t('...') 引用键在两个字典里都齐全（防止同类缺键再犯）
 * D2：推荐页挂载时自动 load() 已有批次。
 *     - createRecoService 暴露 load()，load() 读 api.recoStatus()
 *     - RecoView 挂载 useEffect 调 reco.load()
 *     - 活体端点 /dsh-music/api/reco/status 返回批次（含 similar 与 explore）
 *
 * 用法：node tests/s4-d1d2-retest.mjs [BASE_URL]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', 'bundle', 'client', 'index.js');
const BASE = process.argv[2] || 'http://127.0.0.1:63218';
const src = readFileSync(CLIENT, 'utf8');

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`PASS ${label}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`); }
};

/** 从源码里按大括号配平截取对象字面量，再求值得到字典。 */
function sliceLiteral(startMarker) {
  const at = src.indexOf(startMarker);
  if (at < 0) throw new Error(`未找到 ${startMarker}`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`${startMarker} 对象未闭合`);
}

const zh = eval('(' + sliceLiteral('const zh = {') + ')');
const en = eval('(' + sliceLiteral('const en = {') + ')');

/* ---------------- D1 ---------------- */
check(zh.recoSimilar === '相近', 'D1 zh.recoSimilar = 相近', JSON.stringify(zh.recoSimilar));
check(en.recoSimilar === 'Similar', 'D1 en.recoSimilar = Similar', JSON.stringify(en.recoSimilar));
check(zh.recoExplore === '强制探索', 'D1 zh.recoExplore = 强制探索', JSON.stringify(zh.recoExplore));
check(en.recoExplore === 'Forced exploration', 'D1 en.recoExplore = Forced exploration', JSON.stringify(en.recoExplore));

const chipLine = src.split('\n').find((l) => l.includes("t('recoExplore')") && l.includes("t('recoSimilar')"));
check(!!chipLine, 'D1 RecoCard chip 用 t() 渲染类别标签', chipLine ? chipLine.trim() : '未找到');

// 全量缺键扫描：只认独立调用 t('key')，避开 createElement('style') 这类误报
const used = new Set();
for (const m of src.matchAll(/(?:^|[^A-Za-z0-9_$.])t\('([^']+)'\)/g)) used.add(m[1]);
const missZh = [...used].filter((k) => !(k in zh));
const missEn = [...used].filter((k) => !(k in en));
check(missZh.length === 0, 'D1 t() 引用键在 zh 字典齐全', `used=${used.size} missing=${missZh.join(',') || '无'}`);
check(missEn.length === 0, 'D1 t() 引用键在 en 字典齐全', `missing=${missEn.join(',') || '无'}`);

/* ---------------- D2 ---------------- */
const svc = src.slice(src.indexOf('function createRecoService'), src.indexOf('function createDownloadService'));
check(/async function load\(\)/.test(svc), 'D2 createRecoService 定义 load()');
check(/api\.recoStatus\(\)/.test(svc), 'D2 load() 读取 /dsh-music/api/reco/status');
check(/return \{ source: store, generate, load \}/.test(svc), 'D2 load() 已从 createRecoService 暴露');
const mount = src.split('\n').find((l) => l.includes('reco.load()'));
check(!!mount && /useEffect\(\(\) => \{ reco\.load\(\); \}, \[\]\)/.test(mount), 'D2 RecoView 挂载时调用 load()', mount ? mount.trim() : '未找到');

const recoView = src.slice(src.indexOf('function RecoView'), src.indexOf('function RecoView') + 4000);
check(/s\.items\.length/.test(recoView) || /\.map\(/.test(recoView), 'D2 有批次时渲染卡片分支存在');

/* ---------------- 活体端点 ---------------- */
let status = null;
try {
  const r = await fetch(`${BASE}/dsh-music/api/reco/status`);
  status = r.ok ? await r.json() : null;
  check(r.ok, 'D2 GET api/reco/status 200', `HTTP ${r.status}`);
} catch (e) {
  check(false, 'D2 GET api/reco/status 200', String(e.message));
}
const items = (status && status.items) || [];
check(items.length > 0, 'D2 端点返回已有批次', `items=${items.length}`);
const similar = items.filter((i) => i.category === 'similar').length;
const explore = items.filter((i) => i.category === 'explore').length;
check(similar > 0 && explore > 0, 'D2 批次同时含 similar/explore', `similar=${similar} explore=${explore}`);

// 模拟 chip 文案解析（zh）
const label = (it) => (it.category === 'explore' ? zh.recoExplore : zh.recoSimilar);
check(items.every((i) => label(i) === '相近' || label(i) === '强制探索'), 'D1 本批每张卡片的 chip 文案均为中文标签',
  items.slice(0, 3).map((i) => `${i.category}→${label(i)}`).join(' / '));
const rawKey = items.some((i) => label(i) === 'recoSimilar' || label(i) === 'recoExplore');
check(!rawKey, 'D1 不再输出原始键文本');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
