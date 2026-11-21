#!/usr/bin/env node
/**
 * Reproducible, code-native specimen sheet from the real life engine and
 * Creature renderer. This is an explicitly simulated morphology study, not
 * a screenshot of the product or evidence of real-world listening.
 *
 * node scripts/render-echo-specimens.mjs [output.svg]
 *
 * Uses existing React dependencies and Node built-ins only. No browser,
 * rasterization package, external assets, or user data are involved.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLife, applyLifeEvent, getMorphology } from '../bundle/shared/life-core.js'
import { createCreatureComponents } from '../src/client/echo/creature.js'

const repo = fileURLToPath(new URL('..', import.meta.url))
const output = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(repo, 'docs/assets/echo-specimens.svg')
if (process.argv.length > 3) throw new Error('Usage: node scripts/render-echo-specimens.mjs [output.svg]')

const bornAt = 1700000000000
const stepMs = 30000
const steps = 40
const features = { energy: 0.62, brightness: 0.58, rhythm: 0.72, texture: 0.44 }
const structures = [
  { key: 'fold', title: '折叠膜', english: 'FOLD', description: '连续柔膜，向外舒展' },
  { key: 'shell', title: '温润壳', english: 'SHELL', description: '低重心，柔软的支撑' },
  { key: 'ribbon', title: '回旋带', english: 'RIBBON', description: '开放弧线，保留张力' },
]
const seeds = Object.fromEntries(structures.map(({ key }) => [key, []]))

// SHA-256 gives reproducible independent seed material, distributed like the
// host's random seed bytes. Selection balances the three structural grammars;
// it never forces a life to switch structure or manually alters its genome.
for (let index = 0; index < 10000; index++) {
  const seed = createHash('sha256').update(`echo-specimens:v1:${index}`).digest('hex')
  const initial = createLife({ seed, now: bornAt, name: '形态样本' })
  const group = seeds[initial.genome.structure]
  if (group.length < 3) group.push(seed)
  if (structures.every(({ key }) => seeds[key].length === 3)) break
}
if (structures.some(({ key }) => seeds[key].length !== 3)) throw new Error('Could not find three independent specimens per structure')

const { Creature } = createCreatureComponents(React)
const specimens = []
for (let row = 0; row < 3; row++) {
  for (let column = 0; column < structures.length; column++) {
    const number = row * 3 + column + 1
    const structure = structures[column].key
    const seed = seeds[structure][row]
    let life = createLife({ seed, now: bornAt, name: `个体 ${String(number).padStart(2, '0')}` })
    for (let step = 0; step < steps; step++) {
      life = applyLifeEvent(life, {
        id: `specimen-simulation-${step + 1}`,
        type: 'listening',
        at: bornAt + (step + 1) * stepMs,
        sessionId: 'specimen-simulated-audio',
        track: { id: 'specimen-simulated-track', title: '同一段模拟声音输入', artist: '程序化形态研究' },
        listenedMs: stepMs,
        featureSource: 'audio',
        features,
      })
    }
    specimens.push({ number, row, column, seed, life, morphology: getMorphology(life) })
  }
}

const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character])
const text = (x, y, value, attributes = '') => `<text x="${x}" y="${y}" ${attributes}>${escape(value)}</text>`

function body(specimen) {
  // All actual SVG paths, gradients, filters, marks and title IDs remain intact.
  // One component factory serves all nine renders, preserving resource ID
  // uniqueness across this single SVG document.
  const rendered = renderToStaticMarkup(React.createElement(Creature, {
    life: specimen.life,
    morphology: specimen.morphology,
    compact: false,
    motionEnabled: false,
    label: `${specimen.life.name}，${structures[specimen.column].title}，同一段模拟输入后`,
  }))
  const svg = rendered.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>/)
  if (!svg) throw new Error(`Creature did not produce an SVG for specimen ${specimen.number}`)
  return `<svg${svg[1]} x="0" y="12" width="352" height="281.6" preserveAspectRatio="xMidYMid meet">${svg[2]}</svg>`
}

const width = 1200
const height = 1360
const margin = 50
const cardWidth = 352
const cardHeight = 312
const gap = 22
const cardsTop = 264
const cards = specimens.map(specimen => {
  const x = margin + specimen.column * (cardWidth + gap)
  const y = cardsTop + specimen.row * (cardHeight + gap)
  return `<g transform="translate(${x} ${y})" class="specimen-card" data-life-id="${escape(specimen.life.id)}">
    <rect width="${cardWidth}" height="${cardHeight}" rx="12" fill="#fafaf6" stroke="#dfe3d8"/>
    ${text(21, 31, `个体 ${String(specimen.number).padStart(2, '0')}`, 'font-size="11" fill="#697b69"')}
    ${text(cardWidth - 21, 31, specimen.life.id.slice(-8).toUpperCase(), 'class="mono" text-anchor="end" font-size="9" letter-spacing="1.1" fill="#8c9888"')}
    <g class="echo-creature" data-structure="${specimen.morphology.structure}" data-motion="off">${body(specimen)}</g>
    <line x1="21" x2="331" y1="272" y2="272" stroke="#e8ebe2"/>
    ${text(21, 294, '同一输入，各自成长', 'font-size="10" fill="#83907e"')}
    ${text(cardWidth - 21, 294, '20:00', 'class="mono" text-anchor="end" font-size="10" fill="#6c806b"')}
  </g>`
}).join('\n')

const columnHeadings = structures.map((structure, column) => {
  const x = margin + column * (cardWidth + gap)
  return `${text(x + 1, 219, structure.title, 'font-size="18" fill="#344d3d" font-weight="500"')}
    ${text(x + cardWidth - 1, 218, structure.english, 'class="mono" text-anchor="end" font-size="10" fill="#7f8e78" letter-spacing="1.6"')}
    ${text(x + 1, 244, structure.description, 'font-size="11" fill="#87947e"')}`
}).join('\n')

const manifest = {
  format: 'echo-procedural-specimen-sheet',
  version: 1,
  simulated: true,
  renderer: 'src/client/echo/creature.js',
  core: 'bundle/shared/life-core.js',
  bornAt,
  input: { featureSource: 'simulated-audio', features, stepMs, steps, durationMs: stepMs * steps },
  specimens: specimens.map(({ number, seed, life, morphology }) => ({ number, seed, id: life.id, morphology })),
}
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="sheet-title sheet-description">
  <title id="sheet-title">同一种音乐，各自生长</title>
  <desc id="sheet-description">三个身体结构，九个独立种子。全部由实际 Creature 程序化渲染器和生命核心，接受相同的二十分钟模拟声音特征后生成。这是静态形态样张，不是宿主界面截图。</desc>
  <metadata id="sheet-reproduction-data">${escape(JSON.stringify(manifest))}</metadata>
  <style>
    text { font-family: "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif; }
    .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    .echo-creature-shadow { opacity: .17; }
    .echo-creature-focus-ring { stroke: transparent; stroke-width: 1.25; }
    .echo-memory-halo { opacity: 0; }
    .echo-creature * { animation: none !important; transition: none !important; }
  </style>
  <rect width="${width}" height="${height}" fill="#f5f4ee"/>
  ${text(51, 51, 'ECHO', 'class="mono" font-size="15" letter-spacing="3" fill="#3a5643"')}
  ${text(124, 50, '/   MORPHOLOGY STUDY', 'class="mono" font-size="9" letter-spacing="1.3" fill="#8a977f"')}
  ${text(50, 116, '同一种音乐，各自生长', 'font-size="43" font-weight="500" letter-spacing="-1.1" fill="#293f32"')}
  ${text(52, 153, '三种身体结构 · 九个独立起点 · 同一段 20 分钟模拟声音输入', 'font-size="14" fill="#7b8b73"')}
  <line x1="50" x2="1150" y1="185" y2="185" stroke="#d7decf"/>
  ${columnHeadings}
  ${cards}
  <line x1="50" x2="1150" y1="1270" y2="1270" stroke="#d7decf"/>
  ${text(51, 1296, '相同输入：能量 0.62 / 明亮度 0.58 / 节奏 0.72 / 纹理 0.44', 'font-size="10" fill="#7b8b73"')}
  ${text(51, 1324, '程序化渲染样张 · 模拟音频输入 · 非宿主界面截图', 'font-size="11" fill="#536e54"')}
  ${text(1150, 1323, '9 LIVES / 3 STRUCTURES / 1 INPUT', 'class="mono" text-anchor="end" font-size="9" letter-spacing=".6" fill="#8a987e"')}
</svg>
`

await mkdir(dirname(output), { recursive: true })
await writeFile(output, svg, 'utf8')
console.log(`Rendered 9 actual ECHO specimens to ${output}`)
console.log('Input: identical 20-minute simulated audio features; this SVG is not a host UI screenshot.')
