import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createLife, getMorphology } from '../bundle/shared/life-core.js'
import { createEchoUI } from '../src/client/echo/ui.js'

function source(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    set: patch => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()) },
  }
}
async function harness(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://echo.test/', pretendToBeVisual: true })
  const saved = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const songs = [
    { id: 'song-1', title: '夜航', artist: '林河', album: '深蓝', duration: 210, audioUrl: '/audio/1' },
    { id: 'song-2', title: '清晨', artist: '林河', album: '微光', duration: 160, audioUrl: '/audio/2' },
    { id: 'song-3', title: '路过', artist: '远山', album: '白昼', duration: 190, audioUrl: '/audio/3' },
    { id: 'song-4', title: '无声', artist: '远山', album: '白昼', duration: 120, audioUrl: '' },
  ]
  const play = source({ track: songs[0], playing: true, loading: false, position: 20, duration: 210, volume: .5, muted: false, queue: songs.slice(0, 3), queueIndex: 0, repeat: 'off', shuffle: false, error: null })
  const collection = source({ status: 'ready', tracks: songs, error: null })
  const lyricSource = source({ status: 'idle', trackId: null, data: null, error: null })
  const taste = source({ loaded: true, keys: { 'song-3': true }, dislikes: {} })
  const initial = createLife({ seed: 'habitat-persistent-identity', now: 1700000000000, name: '小岚' })
  const morphology = getMorphology(initial)
  const memory = { id: 'a-real-memory', at: initial.createdAt + 100, title: '一起听过的夜航', note: '测试档案中的真实记忆', track: songs[0] }
  const historyMorphology = { ...morphology, structure: morphology.structure === 'fold' ? 'shell' : 'fold' }
  const life = { ...initial, memories: [memory], timeline: [{ at: initial.createdAt, reason: '初次相遇', morphology: historyMorphology }, { at: initial.createdAt + 100, reason: '留下记忆', morphology }] }
  const lifeSource = source({ life, morphology: { ...morphology, marks: [{ id: memory.id, position: .4, strength: .6 }] }, status: 'ready' })
  const calls = { play: [], seek: [], next: 0, dispatch: [], lyric: [], preference: [], utility: [], mini: [] }
  const player = {
    source: play,
    playTracks: (items, index, options) => { calls.play.push({ items, index, options }); play.set({ track: items[index], queue: items, queueIndex: index, position: 0, playing: true }) },
    toggle: () => play.set({ playing: !play.getSnapshot().playing }),
    pause: () => play.set({ playing: false }),
    next: () => { calls.next++; player.jumpTo((play.getSnapshot().queueIndex + 1) % play.getSnapshot().queue.length) },
    prev: () => play.set({ position: 0 }),
    jumpTo: index => play.set({ track: play.getSnapshot().queue[index], queueIndex: index, position: 0 }),
    seek: value => { calls.seek.push(value); play.set({ position: value }) },
    setVolume: value => play.set({ volume: value, muted: false }),
    toggleMute: () => play.set({ muted: !play.getSnapshot().muted }),
    cycleMode: () => play.set({ shuffle: !play.getSnapshot().shuffle }),
  }
  const lifeService = {
    source: lifeSource, load: async () => {}, retry: async () => {},
    dispatch: async (type, payload) => { calls.dispatch.push({ type, payload }); if (type === 'rename') lifeSource.set({ life: { ...lifeSource.getSnapshot().life, name: payload.name } }) },
    exportArchive: async () => lifeSource.getSnapshot().life,
  }
  const library = { source: collection, load: async () => {} }
  const lyrics = { source: lyricSource, load: async id => { calls.lyric.push(id); lyricSource.set({ trackId: id, status: 'loading', data: null }) } }
  const likes = {
    source: taste,
    isLiked: item => !!taste.getSnapshot().keys[item.id], isDisliked: item => !!taste.getSnapshot().dislikes[item.id],
    toggle: async (item, target) => {
      calls.preference.push({ kind: 'like', item, target })
      const keys = { ...taste.getSnapshot().keys }, dislikes = { ...taste.getSnapshot().dislikes }
      keys[item.id] = target; if (target) dislikes[item.id] = false
      taste.set({ keys, dislikes }); return {}
    },
    setDislike: async (item, target) => {
      calls.preference.push({ kind: 'dislike', item, target })
      const keys = { ...taste.getSnapshot().keys }, dislikes = { ...taste.getSnapshot().dislikes }
      dislikes[item.id] = target; if (target) keys[item.id] = false
      taste.set({ keys, dislikes }); return {}
    },
  }
  const useStore = store => selector => React.useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()), () => selector(store.getSnapshot()))
  const { EchoHabitat } = createEchoUI(React)
  const nav = { route: null, command: null }
  function App() {
    const [route, setRoute] = React.useState('home'), [command, setCommand] = React.useState(0)
    nav.route = setRoute; nav.command = () => setCommand(value => value + 1)
    return React.createElement(EchoHabitat, {
      lifeService, player, library, lyrics, likes,
      usePlayer: useStore(play), useLibrary: useStore(collection), useLyrics: useStore(lyricSource), useLikes: useStore(taste),
      requestedView: route, commandRequest: command, openView: setRoute,
      openArtistPage: () => setRoute('artist'), setMiniHidden: value => calls.mini.push(value),
      renderUtility: utility => { calls.utility.push(utility); return React.createElement('div', { 'data-utility': utility }, `真实工具 ${utility}`, React.createElement('button', null, '工具操作')) },
    })
  }
  const root = createRoot(dom.window.document.querySelector('#root'))
  await act(async () => root.render(React.createElement(App)))
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }
  })
  const q = selector => dom.window.document.querySelector(selector)
  const button = (label, within = dom.window.document) => [...within.querySelectorAll('button,[role="button"]')].find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label)
  const click = async node => { assert.ok(node, 'click target exists'); assert.equal(!!node.disabled, false); await act(async () => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))) }
  const input = async (node, value) => {
    assert.ok(node, 'input exists')
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); node.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  }
  const route = async value => act(async () => nav.route(value))
  return { dom, q, button, click, input, route, nav, songs, calls, play, player, lifeSource, morphology, historyMorphology, collection, lyricSource, likes, taste }
}

test('one real Creature survives searching, listening, memory and utility routes', async t => {
  const app = await harness(t)
  const body = app.q('.eh-being .echo-creature'), svg = body.querySelector('svg'), sourceId = svg.querySelector('title').id
  assert.equal(app.q('.echo-living-space').dataset.scene, 'encounter')
  for (const route of ['library', 'reco', 'now', 'echo-memory', 'history', 'home']) {
    await app.route(route)
    assert.equal(app.q('.eh-being .echo-creature'), body, `${route} keeps the same body DOM`)
    assert.equal(body.querySelector('svg'), svg)
    assert.equal(body.querySelector('title').id, sourceId, 'the Creature resource identity stays stable')
  }
  assert.equal(app.calls.play.length, 0)
  assert.equal(app.calls.seek.length, 0)
  assert.equal(app.calls.dispatch.length, 0)
  assert.equal(app.play.getSnapshot().track, app.songs[0])
  assert.equal(app.q('.dshm-tabs'), null)
  assert.equal(app.q('.echo-habitat'), null)
})

test('search changes no audio, and selection plays the actual filtered queue then returns to the body', async t => {
  const app = await harness(t)
  const before = app.play.getSnapshot()
  await app.click(app.button('找音乐'))
  await app.input(app.q('input[type="search"]'), '林河')
  assert.equal(app.q('.eh-song-list').children.length, 2)
  assert.equal(app.play.getSnapshot(), before, 'opening and typing search do not touch playback state')
  assert.equal(app.calls.play.length, 0)
  await app.click(app.button('播放 清晨 · 林河'))
  assert.equal(app.calls.play.length, 1)
  assert.deepEqual(app.calls.play[0], { items: app.songs.slice(0, 2), index: 1, options: { shuffle: false, ordered: true } })
  assert.equal(app.play.getSnapshot().track, app.songs[1])
  assert.equal(app.q('.echo-living-space').dataset.scene, 'encounter')
  await app.route('library')
  await app.input(app.q('input[type="search"]'), '远山')
  assert.equal(app.button('无声 · 音频暂不可用').disabled, true)
  await app.click(app.button('播放 路过 · 远山'))
  assert.equal(app.calls.play.at(-1).items.length, 1, 'unplayable records cannot shift the selected index')
  assert.equal(app.play.getSnapshot().track, app.songs[2])
})

test('memory timeline reviews the same body without writing the archive or changing music', async t => {
  const app = await harness(t)
  const archive = JSON.stringify(app.lifeSource.getSnapshot()), playback = app.play.getSnapshot(), body = app.q('.eh-being .echo-creature')
  await app.click(app.button('共同记忆'))
  await app.input(app.q('input[aria-label="回看成长时间线"]'), '0')
  assert.equal(app.q('.eh-being .echo-creature'), body)
  assert.equal(body.dataset.structure, app.historyMorphology.structure)
  assert.equal(body.dataset.motion, 'off')
  assert.equal(JSON.stringify(app.lifeSource.getSnapshot()), archive)
  assert.equal(app.calls.dispatch.length, 0)
  await app.click(app.q('.eh-memory-list button'))
  assert.match(app.q('.echo-dialog').textContent, /测试档案中的真实记忆/)
  await app.click(app.button('关闭'))
  assert.equal(app.play.getSnapshot(), playback)
  await app.click(app.button('回到生命空间'))
  assert.equal(app.q('.eh-being .echo-creature'), body)
  assert.equal(body.dataset.structure, app.morphology.structure)
  assert.equal(body.dataset.motion, 'on')
  assert.equal(JSON.stringify(app.lifeSource.getSnapshot()), archive)
})

test('explicit tools return to the same space; command requests focus real search', async t => {
  const app = await harness(t)
  const body = app.q('.eh-being .echo-creature')
  await app.click(app.button('打开空间工具'))
  await app.click(app.button('管理曲库'))
  assert.equal(app.q('.eh-utility').getAttribute('aria-modal'), 'true')
  assert.ok(app.q('[data-utility="library-manage"]'))
  assert.equal(app.q('.eh-being .echo-creature'), body)
  await app.click(app.button('回到生命空间'))
  assert.equal(app.q('.eh-utility'), null)
  assert.equal(app.q('.eh-being .echo-creature'), body)
  await act(async () => { app.nav.command(); await new Promise(resolve => setTimeout(resolve, 10)) })
  await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  assert.equal(app.q('.echo-living-space').dataset.scene, 'search')
  assert.equal(app.dom.window.document.activeElement, app.q('input[type="search"]'))
  assert.equal(app.calls.play.length, 0)
})

test('discovery offers at most three real playable local tracks and excludes rejected tracks', async t => {
  const app = await harness(t)
  await act(async () => app.likes.setDislike(app.songs[1], true))
  await app.route('reco')
  const buttons = [...app.q('.eh-song-list-discover').querySelectorAll('button')]
  assert.equal(buttons.length, 2)
  assert.match(buttons[0].textContent, /路过.*你喜欢的歌/)
  assert.ok(buttons.every(node => !node.textContent.includes('清晨') && !node.textContent.includes('无声')))
  await app.click(buttons[0])
  assert.equal(app.play.getSnapshot().track, app.songs[2])
  assert.equal(app.q('.echo-living-space').dataset.scene, 'encounter')
})

test('progress commits on release and pending lyrics never reuse another track', async t => {
  const app = await harness(t)
  await app.click(app.button('打开音乐操作'))
  const seek = app.q('input[aria-label="播放进度"]')
  await app.input(seek, '71')
  assert.deepEqual(app.calls.seek, [])
  await act(async () => seek.dispatchEvent(new app.dom.window.MouseEvent('pointerup', { bubbles: true })))
  assert.deepEqual(app.calls.seek, [71])
  await app.input(app.q('input[aria-label="音量"]'), '.31')
  assert.equal(app.play.getSnapshot().volume, .31)
  assert.equal(app.calls.play.length, 0)
  assert.equal(app.calls.lyric.length, 0)
  await app.click(app.button('显示歌词'))
  assert.deepEqual(app.calls.lyric, ['song-1'])
  await act(async () => app.lyricSource.set({ trackId: 'song-1', status: 'ready', data: { synced: true, lines: [{ time: 0, text: '第一首的真实歌词' }] } }))
  assert.match(app.q('.eh-lyrics-detail').textContent, /第一首的真实歌词/)
  await act(async () => app.player.next())
  await act(async () => app.lyricSource.set({ trackId: 'song-1', status: 'ready', data: { synced: true, lines: [{ time: 0, text: '迟来的旧歌词' }] } }))
  assert.doesNotMatch(app.q('.eh-lyrics-detail').textContent, /旧歌词|第一首/)
  assert.match(app.q('.eh-lyrics-detail').textContent, /正在寻找/)
  await act(async () => app.lyricSource.set({ trackId: 'song-2', status: 'ready', data: { synced: false, plain: '没有时间标记的文本', lines: [] } }))
  assert.match(app.q('.eh-lyrics-detail').textContent, /纯文本歌词 · 没有时间标记/)
  const body = app.q('.eh-being .echo-creature')
  await act(async () => app.play.set({ loading: true }))
  assert.equal(body.dataset.active, 'false')
})

test('naming and touch use the existing life service, while preference undo leaves the new song alone', async t => {
  const app = await harness(t)
  const body = app.q('.eh-being .echo-creature')
  await app.click(app.button('给生命命名'))
  await app.input(app.q('.echo-dialog input'), '阿澜')
  await act(async () => app.q('.echo-dialog form').dispatchEvent(new app.dom.window.Event('submit', { bubbles: true, cancelable: true })))
  assert.deepEqual(app.calls.dispatch[0], { type: 'rename', payload: { name: '阿澜' } })
  assert.equal(app.q('.eh-being .echo-creature'), body)
  await app.click(app.q('.eh-being .echo-creature-touch-target'))
  assert.equal(app.calls.dispatch[1].type, 'interaction')
  assert.equal(app.q('.echo-living-space').dataset.scene, 'encounter')
  app.songs[0].verification = { only: 'test fixture' }
  await app.click(app.button('打开音乐操作'))
  await app.click(app.button('喜欢'))
  await app.click(app.button('不喜欢并跳过'))
  assert.equal(app.play.getSnapshot().track, app.songs[1])
  assert.equal(app.likes.isDisliked(app.songs[0]), true)
  await app.click(app.button('撤销对《夜航》的不喜欢'))
  assert.equal(app.likes.isLiked(app.songs[0]), true)
  assert.equal(app.calls.preference.at(-1).item.verification, undefined)
  assert.equal(app.play.getSnapshot().track, app.songs[1])
})
