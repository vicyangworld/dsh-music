#!/usr/bin/env node
/** Same identity and simulated history, before/after actual Creature rendering.
 * The alpha.1 SVG is a preserved code-generated baseline, not a product capture.
 * node scripts/render-echo-material-study.mjs [output.svg]
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createLife, applyLifeEvent, getMorphology } from '../bundle/shared/life-core.js';
import { createCreatureComponents } from '../src/client/echo/creature.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(root, 'docs/assets/echo-material-study.svg');
if (process.argv.length > 3) throw new Error('Usage: node scripts/render-echo-material-study.mjs [output.svg]');
const source = await readFile(resolve(root, 'docs/assets/echo-specimens-alpha1.svg'), 'utf8');
const baseline = new JSDOM(source, { contentType: 'image/svg+xml' });
const document = baseline.window.document;
const manifest = JSON.parse(document.querySelector('#sheet-reproduction-data').textContent);
const samples = manifest.specimens.slice(0, 3);
const names = ['折叠膜', '温润壳', '回旋带'];
const cards = [...document.querySelectorAll('.specimen-card')];
const { Creature } = createCreatureComponents(React);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const text = (x, y, value, attrs = '') => `<text x="${x}" y="${y}" ${attrs}>${escape(value)}</text>`;

const lives = samples.map(sample => {
  let life = createLife({ seed: sample.seed, now: manifest.bornAt, name: `个体 ${String(sample.number).padStart(2, '0')}` });
  for (let step = 0; step < manifest.input.steps; step++) {
    life = applyLifeEvent(life, {
      id: `specimen-simulation-${step + 1}`, type: 'listening',
      at: manifest.bornAt + (step + 1) * manifest.input.stepMs,
      sessionId: 'specimen-simulated-audio',
      track: { id: 'specimen-simulated-track', title: '同一段模拟声音输入', artist: '程序化形态研究' },
      listenedMs: manifest.input.stepMs, featureSource: 'audio', features: manifest.input.features,
    });
  }
  assert.equal(life.id, sample.id, 'the comparison must preserve the individual');
  assert.deepEqual(getMorphology(life), sample.morphology, 'the comparison must preserve the growth result');
  return life;
});

function framed(markup, x, y, width, height, prefix, tone = 'light') {
  const svg = markup.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>/);
  if (!svg) throw new Error('Missing rendered SVG');
  // Baseline resources are already unique, but remain separately namespaced
  // from the current renderer in this combined document.
  const inner = prefix ? svg[2].replace(/echo-being-/g, prefix + '-echo-being-') : svg[2];
  return `<svg class="${prefix ? 'study-before' : `study-current is-${tone}`}" x="${x}" y="${y}" width="${width}" height="${height}" viewBox="64 55 472 382" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

function current(index, x, y, width, height, tone = 'light') {
  const markup = renderToStaticMarkup(React.createElement(Creature, {
    life: lives[index], morphology: samples[index].morphology,
    active: false, compact: false, motionEnabled: false, tone,
    label: `${names[index]}，固定的同一生命`,
  }));
  return framed(markup, x, y, width, height, null, tone);
}

const parts = samples.map((sample, index) => {
  const x = 62 + index * 400;
  const old = cards[index].querySelector('.echo-creature svg').outerHTML;
  return `${text(x + 6, 150, names[index], 'font-size="18" font-weight="500" fill="#344738"')}
    ${text(x + 352, 149, sample.id.slice(-8).toUpperCase(), 'font-size="10" class="mono" text-anchor="end" fill="#73816d"')}
    ${text(x + 6, 190, '此前 · alpha.1', 'font-size="12" fill="#75816f"')}
    ${framed(old, x, 202, 354, 286, `before-${index}`)}
    ${text(x + 6, 536, '当前 · alpha.2', 'font-size="12" fill="#405c42"')}
    ${current(index, x, 548, 354, 286)}
    ${current(index, x + 100, 906, 154, 125, 'dark')}
    ${text(x + 177, 1055, names[index], 'font-size="11" text-anchor="middle" fill="#c7d0bd"')}`;
});

const metadata = { format: 'echo-material-study', simulated: true, baseline: '0.8.0-alpha.1', current: '0.8.0-alpha.2', input: manifest.input, samples };
const result = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1170" viewBox="0 0 1280 1170" role="img" aria-labelledby="study-title study-description">
  <title id="study-title">同一生命，细化材质与光照</title>
  <desc id="study-description">固定三只生命的基因和二十分钟模拟经历，对比alpha.1和alpha.2实际渲染器的结果。下方为当前版本在暗背景上的缩小样张。这不是宿主截图或真实声音测试。</desc>
  <metadata>${escape(JSON.stringify(metadata))}</metadata>
  <style>
    text{font-family:"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif}
    .mono{font-family:"SFMono-Regular",Consolas,monospace;letter-spacing:1px}
    .study-before .echo-creature-shadow{opacity:.17}
    .study-current .echo-creature-shadow{opacity:.21}
    .study-current .echo-creature-contact{opacity:.2352}
    .study-current.is-dark .echo-creature-shadow{opacity:.31}
    .study-current.is-dark .echo-creature-contact{opacity:.3472}
    .echo-creature-focus-ring{stroke:transparent}
    .echo-memory-halo{opacity:0}
    *{animation:none!important;transition:none!important}
  </style>
  <rect width="1280" height="1170" fill="#f5f4ee"/>
  ${text(68, 58, '同一生命，细化材质与光照', 'font-size="34" font-weight="500" fill="#2c4132"')}
  ${text(70, 95, '相同基因、相同经历，只改变绘制 · 实际程序化输出', 'font-size="13" fill="#6c7d66"')}
  <path d="M 68 117 H 1212 M 68 507 H 1212" fill="none" stroke="#d9dfd2"/>
  <rect x="54" y="872" width="1172" height="207" rx="14" fill="#20271f"/>
  ${text(74, 901, '暗背景 · 当前版', 'font-size="11" fill="#c7d0bd"')}
  ${parts.join('\n')}
  ${text(70, 1120, '初生身份、结构与成长参数一致；曲面细节、材质和光照统一细化。', 'font-size="12" fill="#506549"')}
  ${text(70, 1144, '模拟经历的静态样张 · 非真实界面截图 · 不代表动画或声音验收', 'font-size="10" fill="#7c8975"')}
</svg>`;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, result);
baseline.window.close();
console.log(`Wrote ${output}; checked the same 3 identities and growth results.`);
