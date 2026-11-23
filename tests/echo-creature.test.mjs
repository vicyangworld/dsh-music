import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { createCreatureComponents } from '../src/client/echo/creature.js'
import { createLife, getMorphology } from '../bundle/shared/life-core.js'

const traits = ['elongation', 'spread', 'curvature', 'folds', 'texture', 'warmth', 'buoyancy']
const defaults = { seed: 0.37, phase: 0.4, accent: 0.55, ...Object.fromEntries(traits.map(key => [key, 0.5])) }
const mark = { id: 'shared-moment', position: 0.42, strength: 0.7 }

function render(props, Creature = createCreatureComponents(React).Creature) {
  const html = renderToStaticMarkup(React.createElement(Creature, { motionEnabled: false, ...props }))
  return { html, document: new JSDOM(html).window.document }
}

function bodyPaths(document) {
  return [...document.querySelectorAll('.echo-creature-surface path')].map(node => node.getAttribute('d'))
}

function absoluteControlPoints(path) {
  // The large surfaces use absolute M/L/Q/C. Relative q is used only for small
  // facial marks and is deliberately outside this control-hull check.
  if (/[mlqchvsta]/.test(path)) return []
  const numbers = path.match(/-?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)?.map(Number) || []
  return Array.from({ length: numbers.length / 2 }, (_, index) => numbers.slice(index * 2, index * 2 + 2))
}

function transformed(point, node, svg) {
  let [x, y] = point
  for (let current = node; current && current !== svg; current = current.parentElement) {
    const value = current.style?.transform || current.getAttribute('transform') || ''
    const operations = [...value.matchAll(/(matrix|translate|scale)\(([^)]+)\)/g)].reverse()
    for (const [, operation, values] of operations) {
      const n = values.split(/[ ,]+/).map(Number)
      if (operation === 'matrix') [x, y] = [n[0] * x + n[2] * y + n[4], n[1] * x + n[3] * y + n[5]]
      if (operation === 'translate') [x, y] = [x + n[0], y + (n[1] || 0)]
      if (operation === 'scale') [x, y] = [x * n[0], y * (n[1] ?? n[0])]
    }
  }
  return [x, y]
}

test('rendering preserves archived identity and geometry is stable across themes', () => {
  const life = createLife({ seed: 'material-refinement-identity', now: 1700000000000, name: '音灵' })
  const original = JSON.stringify(life)
  const morphology = getMorphology(life)
  const light = render({ life, framing: 'presence', tone: 'light' })
  const dark = render({ life, framing: 'presence', tone: 'dark' })
  const replay = render({ life: JSON.parse(original), framing: 'presence' })
  assert.deepEqual(bodyPaths(light.document), bodyPaths(dark.document))
  assert.deepEqual(bodyPaths(light.document), bodyPaths(replay.document))
  assert.equal(JSON.stringify(life), original)
  assert.deepEqual(getMorphology(life), morphology)
})

test('presence keeps a fixed viewport and memory marks follow every resting body', () => {
  for (const structure of ['fold', 'shell', 'ribbon']) {
    const morphology = { ...defaults, structure, marks: [mark] }
    const open = render({ morphology, framing: 'presence', onMemorySelect() {} })
    const rest = render({ morphology, framing: 'presence', compact: true, onMemorySelect() {} })
    assert.equal(open.document.querySelector('svg').getAttribute('viewBox'), rest.document.querySelector('svg').getAttribute('viewBox'))
    const initialMark = open.document.querySelector('.echo-memory-mark')
    const restingMark = rest.document.querySelector('.echo-memory-mark')
    assert.equal(restingMark.getAttribute('role'), 'button')
    assert.equal(restingMark.getAttribute('tabindex'), '0')
    assert.notDeepEqual(transformed([0, 0], restingMark, rest.document.querySelector('svg')),
      transformed([0, 0], initialMark, open.document.querySelector('svg')), structure)
    assert.equal(rest.document.querySelector('.echo-creature').dataset.motion, 'off')
    assert.equal(rest.document.querySelector('.echo-creature').dataset.framing, 'presence')
  }
})

test('surface resources resolve uniquely and extreme static poses stay inside the presence viewport', () => {
  const { Creature } = createCreatureComponents(React)
  const siblings = renderToStaticMarkup(React.createElement('div', null,
    ...['fold', 'shell', 'ribbon'].map(structure => React.createElement(Creature, { key: structure, morphology: { ...defaults, structure }, motionEnabled: false }))))
  const siblingDocument = new JSDOM(siblings).window.document
  const ids = [...siblingDocument.querySelectorAll('[id]')].map(node => node.id)
  assert.equal(new Set(ids).size, ids.length, 'SVG resources must not collide between lives')

  for (const structure of ['fold', 'shell', 'ribbon']) {
    for (const seed of [0, 0.37, 1]) {
      for (const profile of [0, 1, 'mixed']) {
        const morphology = { ...defaults, structure, seed, marks: [mark], ...Object.fromEntries(traits.map((key, index) => [key, profile === 'mixed' ? index % 2 : profile])) }
        for (const compact of [false, true]) {
          const { html, document } = render({ morphology, compact, framing: 'presence' })
          const context = `${structure}/${seed}/${profile}/${compact}`
          assert.doesNotMatch(html, /NaN|Infinity/, context)
          for (const [, id] of html.matchAll(/url\(#([^)]*)\)/g)) {
            assert.ok(document.getElementById(id), `Unresolved paint/clip resource ${id}: ${context}`)
          }
          const svg = document.querySelector('svg')
          const [left, top, width, height] = svg.getAttribute('viewBox').split(' ').map(Number)
          for (const node of document.querySelectorAll('.echo-creature-surface path')) {
            for (const control of absoluteControlPoints(node.getAttribute('d') || '')) {
              const [x, y] = transformed(control, node, svg)
              assert.ok(x >= left && x <= left + width && y >= top && y <= top + height,
                `${context}: control point ${x}, ${y} outside fixed viewport`)
            }
          }
        }
      }
    }
  }
})
