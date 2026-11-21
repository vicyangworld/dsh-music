import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createLife, getMorphology } from '../bundle/shared/life-core.js'
import { createEchoUI } from '../src/client/echo/ui.js'
import { companionPlacement } from '../src/client/echo/mini.js'

function source(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    set: patch => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()) },
  }
}
const key = item => String(item?.id || `${item?.artist}::${item?.title}`)
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function harness(t, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://echo.test/', pretendToBeVisual: true })
  const saved = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const songs = [1, 2, 3].map(n => ({ id: `ec0000000000000${n}`, title: `歌曲${n}`, artist: `音乐人${n}`, duration: 180 }))
  const queue = options.single ? [songs[0], songs[0]] : songs
  const play = source({ track: songs[0], playing: true, loading: false, position: 38, duration: 180, volume: .65, muted: false, queue, queueIndex: 0, shuffle: false, repeat: 'all', error: null })
  const ui = source({ miniHidden: false, dockVisible: false, miniCollapsed: false })
  const calls = { next: 0, pause: 0, jump: [], seek: [], dispatch: [], lyrics: [], likes: [] }
  const player = {
    source: play,
    toggle: () => play.set({ playing: !play.getSnapshot().playing }),
    play: () => play.set({ playing: true }),
    pause: () => { calls.pause++; play.set({ playing: false }) },
    next: () => { calls.next++; player.jumpTo((play.getSnapshot().queueIndex + 1) % queue.length) },
    prev: () => { if (play.getSnapshot().position > 3) play.set({ position: 0 }); else player.jumpTo((play.getSnapshot().queueIndex + queue.length - 1) % queue.length) },
    jumpTo: index => { calls.jump.push(index); play.set({ track: queue[index], queueIndex: index, position: 0, playing: true }) },
    seek: value => { calls.seek.push(value); play.set({ position: value }) },
    setVolume: value => play.set({ volume: value, muted: false }),
    toggleMute: () => play.set({ muted: !play.getSnapshot().muted }),
    cycleMode: () => play.set({ shuffle: !play.getSnapshot().shuffle }),
  }
  let life = createLife({ seed: 'mini-lifecycle-test', now: 1700000000000, name: '小岚' })
  life = { ...life, memories: [{ id: 'memory-fixture', title: '一起听过的下午', note: '这是一条测试中的已保存记忆。', at: 1700000000001, track: songs[0] }] }
  const lifeSource = source({ life, morphology: { ...getMorphology(life), marks: [{ id: 'memory-fixture', position: .4, strength: .5 }] }, status: 'ready' })
  const lifeService = { source: lifeSource, load: async () => {}, retry: async () => {}, dispatch: async (type, payload) => { calls.dispatch.push({ type, payload }) } }
  const taste = source({ keys: {}, dislikes: {} })
  let gate = null, failLike = false
  const likes = {
    source: taste,
    isLiked: item => !!taste.getSnapshot().keys[key(item)],
    isDisliked: item => !!taste.getSnapshot().dislikes[key(item)],
    toggle: async (item, target) => {
      calls.likes.push({ kind: 'like', item, target })
      if (failLike) return { error: '写入失败' }
      const keys = { ...taste.getSnapshot().keys }, dislikes = { ...taste.getSnapshot().dislikes }
      if (target) { keys[key(item)] = true; delete dislikes[key(item)] } else delete keys[key(item)]
      taste.set({ keys, dislikes }); return { liked: target, inLibrary: true }
    },
    setDislike: async (item, target) => {
      calls.likes.push({ kind: 'dislike', item, target })
      if (gate && target) { const wait = gate; gate = null; await wait.promise }
      const keys = { ...taste.getSnapshot().keys }, dislikes = { ...taste.getSnapshot().dislikes }
      if (target) { dislikes[key(item)] = true; delete keys[key(item)] } else delete dislikes[key(item)]
      taste.set({ keys, dislikes }); return { disliked: target }
    },
  }
  const lyricSource = source({ status: 'idle', trackId: null, data: null })
  const lyrics = { source: lyricSource, load: async trackId => {
    calls.lyrics.push(trackId)
    if (options.holdLyrics) return
    lyricSource.set({ trackId, status: 'ready', data: { synced: true, lines: [{ time: 0, text: `第一句 ${trackId}` }, { time: 60, text: `第二句 ${trackId}` }] } })
  } }
  const useStore = store => selector => React.useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()), () => selector(store.getSnapshot()))
  const { EchoMini } = createEchoUI(React)
  const root = createRoot(dom.window.document.querySelector('#root'))
  const navigation = []
  const props = { lifeService, player, lyrics, likes, usePlayer: useStore(play), useUi: useStore(ui), openHome: () => navigation.push('home'), openLibrary: () => navigation.push('library'), openNow: () => navigation.push('now'), setMiniHidden: value => ui.set({ miniHidden: value }), setMiniCollapsed: value => ui.set({ miniCollapsed: value }) }
  await act(async () => root.render(React.createElement(EchoMini, props)))
  t.after(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }
  })
  const q = selector => dom.window.document.querySelector(selector)
  const button = (label, within = dom.window.document) => [...within.querySelectorAll('button,[role="button"]')].find(node => node.getAttribute('aria-label') === label || node.textContent.trim() === label)
  const click = async node => { assert.ok(node, 'click target exists'); assert.equal(!!node.disabled, false, 'click target is enabled'); await act(async () => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))) }
  const input = async (node, value) => { await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); node.dispatchEvent(new dom.window.Event('change', { bubbles: true })) }) }
  return { dom, root, props, q, button, click, input, songs, calls, player, play, ui, likes, taste, lyricSource, navigation,
    deferDislike: () => { gate = deferred(); return gate }, failLike: () => { failLike = true } }
}

test('body, attention and stored memory stay independent of music controls', async t => {
  const app = await harness(t)
  assert.equal(app.q('.echo-mini-tools'), null)
  assert.equal(app.calls.lyrics.length, 0, 'lyrics are opt in')
  const body = app.q('.echo-creature-touch-target')
  await act(async () => { body.dispatchEvent(new app.dom.window.FocusEvent('focusin', { bubbles: true })); body.dispatchEvent(new app.dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 100 })) })
  assert.equal(app.q('.echo-mini-tools'), null)
  await app.click(body)
  assert.equal(app.calls.dispatch.length, 1)
  assert.equal(app.calls.dispatch[0].type, 'interaction')
  assert.equal(app.q('.echo-mini-tools'), null)
  assert.equal(app.play.getSnapshot().playing, true)
  assert.deepEqual(app.navigation, [])
  await app.click(app.button('回看最近共同记忆'))
  assert.match(app.q('.echo-mini-paper').textContent, /一起听过的下午/)
  assert.equal(app.q('.echo-mini-tools'), null)
  assert.equal(app.calls.jump.length, 0)
})

test('explicit music entry, keyboard close and hiding preserve the shared player', async t => {
  const app = await harness(t)
  await app.click(app.button('音乐操作'))
  assert.ok(app.q('.echo-mini-tools'))
  await app.click(app.button('暂停', app.q('.echo-mini-tools')))
  assert.equal(app.play.getSnapshot().playing, false)
  await app.click(app.button('播放', app.q('.echo-mini-foot')))
  assert.equal(app.play.getSnapshot().playing, true)
  await app.click(app.button('更多播放操作'))
  await app.click(app.button('队列 · 3'))
  assert.equal(app.q('.echo-mini-queue').children.length, 3)
  await act(async () => app.q('.echo-mini-tools').dispatchEvent(new app.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(app.q('.echo-mini-queue'), null)
  await app.click(app.button('隐藏伴生窗'))
  assert.equal(app.q('.echo-mini'), null)
  assert.equal(app.play.getSnapshot().playing, true)
  await act(async () => app.ui.set({ miniHidden: false }))
  assert.equal(app.q('.echo-mini-tools'), null, 'restoring the companion returns to the life-first view')
  await app.click(app.button('音乐操作'))
  await app.click(app.button('收起音乐操作'))
  assert.equal(app.dom.window.document.activeElement, app.button('音乐操作'))
})

test('dislike skips a song once, and undo restores its earlier like without replay', async t => {
  const app = await harness(t)
  app.songs[0].verification = { source: 'test-only-preview-verification' }
  await app.click(app.button('音乐操作'))
  await app.click(app.button('喜欢这首歌'))
  assert.equal(app.likes.isLiked(app.songs[0]), true)
  assert.ok(app.calls.likes[0].item.verification, 'the deliberate like preserves verification')
  await app.click(app.button('不喜欢这首歌并跳过'))
  assert.equal(app.likes.isLiked(app.songs[0]), false)
  assert.equal(app.likes.isDisliked(app.songs[0]), true)
  assert.equal(app.play.getSnapshot().track.id, app.songs[1].id)
  await app.click(app.button('撤销对《歌曲1》的不喜欢'))
  assert.equal(app.likes.isLiked(app.songs[0]), true)
  assert.equal(app.likes.isDisliked(app.songs[0]), false)
  assert.equal(app.play.getSnapshot().track.id, app.songs[1].id)
  assert.deepEqual(app.calls.jump, [1])
  assert.equal(app.calls.likes.at(-1).item.verification, undefined, 'undo only restores preference and cannot initiate a new download')
  await act(async () => app.player.jumpTo(0))
  await app.click(app.button('不喜欢这首歌并跳过'))
  await act(async () => app.likes.setDislike(app.songs[0], false))
  const writes = app.calls.likes.length
  await app.click(app.button('撤销对《歌曲1》的不喜欢'))
  assert.equal(app.calls.likes.length, writes, 'stale undo cannot overwrite a newer preference from another view')
  assert.equal(app.likes.isLiked(app.songs[0]), false)
  assert.equal(app.likes.isDisliked(app.songs[0]), false)
  assert.match(app.q('.echo-mini-feedback').textContent, /偏好已更新/)
})

test('progress commits on release, while volume and queue use the shared player', async t => {
  const app = await harness(t)
  await app.click(app.button('音乐操作'))
  await app.click(app.button('更多播放操作'))
  const seek = app.q('input[aria-label="伴生播放进度"]')
  await app.input(seek, '95')
  assert.deepEqual(app.calls.seek, [], 'drag previews a target without repeated seeks')
  await act(async () => seek.dispatchEvent(new app.dom.window.MouseEvent('pointerup', { bubbles: true })))
  assert.deepEqual(app.calls.seek, [95])
  await app.input(app.q('input[aria-label="伴生音量"]'), '.32')
  assert.equal(app.play.getSnapshot().volume, .32)
  await app.click(app.button('队列 · 3'))
  await app.click(app.q('.echo-mini-queue li:nth-child(3) button'))
  assert.equal(app.play.getSnapshot().track.id, app.songs[2].id)
})

test('an asynchronous dislike never skips a newer user-selected track', async t => {
  const app = await harness(t)
  await app.click(app.button('音乐操作'))
  const gate = app.deferDislike()
  await app.click(app.button('不喜欢这首歌并跳过'))
  assert.equal(app.button('不喜欢这首歌并跳过').disabled, true)
  await app.click(app.button('下一首', app.q('.echo-mini-foot')))
  await act(async () => gate.resolve())
  assert.equal(app.likes.isDisliked(app.songs[0]), true)
  assert.equal(app.play.getSnapshot().track.id, app.songs[1].id)
  assert.deepEqual(app.calls.jump, [1])
  assert.match(app.q('.echo-mini-feedback').textContent, /没有打断你后来选择/)
})

test('dislike pauses a queue containing only duplicates of the same song', async t => {
  const app = await harness(t, { single: true })
  await app.click(app.button('音乐操作'))
  await app.click(app.button('不喜欢这首歌并跳过'))
  assert.equal(app.play.getSnapshot().playing, false)
  assert.equal(app.calls.pause, 1)
  assert.deepEqual(app.calls.jump, [])
  assert.match(app.q('.echo-mini-feedback').textContent, /没有其他可播放的歌/)
})

test('failed preference writes are not presented as a successful like', async t => {
  const app = await harness(t)
  app.failLike()
  await app.click(app.button('音乐操作'))
  await app.click(app.button('喜欢这首歌'))
  assert.equal(app.likes.isLiked(app.songs[0]), false)
  assert.match(app.q('.echo-mini-feedback[role="alert"]').textContent, /偏好未能保存：写入失败/)
})

test('lyrics are opt in, persisted, and never borrow the previous track response', async t => {
  const app = await harness(t, { holdLyrics: true })
  await app.click(app.button('音乐操作'))
  await app.click(app.button('显示伴随歌词'))
  assert.equal(app.q('.echo-mini-tools'), null)
  assert.equal(app.dom.window.localStorage.getItem('dsh-music.echo.mini-lyrics'), 'true')
  assert.deepEqual(app.calls.lyrics, [app.songs[0].id])
  await act(async () => app.lyricSource.set({ trackId: app.songs[0].id, status: 'ready', data: { synced: true, lines: [{ time: 0, text: '上一首的歌词' }] } }))
  assert.match(app.q('.echo-mini-paper').textContent, /上一首的歌词/)
  await app.click(app.button('下一首', app.q('.echo-mini-foot')))
  assert.doesNotMatch(app.q('.echo-mini-paper').textContent, /上一首的歌词/)
  await act(async () => app.lyricSource.set({ trackId: app.songs[1].id, status: 'ready', data: { synced: true, lines: [{ time: 0, text: '现在这一首' }] } }))
  assert.match(app.q('.echo-mini-paper').textContent, /现在这一首/)
  await app.click(app.button('收起纸条'))
  assert.equal(app.dom.window.localStorage.getItem('dsh-music.echo.mini-lyrics'), 'false')
})

test('companion controls remain clamped to small and large viewports', () => {
  for (const viewport of [{ width: 320, height: 480 }, { width: 768, height: 600 }, { width: 1920, height: 1080 }]) {
    for (const left of [0, viewport.width / 2, viewport.width - 300]) {
      const anchor = { left, top: viewport.height - 320, right: left + 300, bottom: viewport.height - 20, width: 300, height: 300 }
      const result = companionPlacement(anchor, { width: 286, height: 650 }, viewport)
      assert.ok(result.left >= 12 && result.left + result.width <= viewport.width - 12)
      assert.ok(result.top >= 12 && result.top + Math.min(650, result.maxHeight) <= viewport.height - 12)
    }
  }
})
