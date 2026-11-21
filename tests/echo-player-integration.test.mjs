/**
 * Executes the authored plugin and actual service/Host API boundary in a VM.
 * Audio, HTTP and MediaSession are test doubles; no music is fetched or played.
 * esbuild writes only to memory, leaving the committed bundle untouched.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { webcrypto } from 'node:crypto'
import { build } from 'esbuild'
import React from 'react'
import { createLife, getMorphology } from '../bundle/shared/life-core.js'

const repo = fileURLToPath(new URL('..', import.meta.url))
const entry = resolve(repo, 'src/client/index.js')
const source = await readFile(entry, 'utf8')
// Expose just the legacy fallback caller for its metadata regression. The
// services themselves are obtained through real Harness slot registration.
const instrumented = source.replace('return { inject, apply };', 'return { inject, apply, testPlaySong: playSong };')
assert.notEqual(instrumented, source, 'test instrumentation finds the plugin return')
const compiled = await build({
  stdin: { contents: instrumented, sourcefile: entry, resolveDir: dirname(entry), loader: 'js' },
  bundle: true, write: false, format: 'iife', target: ['chrome110', 'safari16'],
  loader: { '.css': 'text' }, logLevel: 'silent',
})
const code = compiled.outputFiles[0].text
const a = { id: 'a000000000000001', artist: '测试歌手', title: '第一首', audioUrl: '/audio/a', duration: 180 }
const b = { id: 'a000000000000002', artist: '测试歌手', title: '第二首', audioUrl: '/audio/b', duration: 200 }
const recommendation = {
  artist: '试听歌手', title: '尚未入库', album: '示例专辑', durationMs: 182000,
  source: 'verified-recommendation', sourceUrl: 'https://example.invalid/source',
  verification: { source: 'fixture', url: 'https://example.invalid/verified', checkedAt: 1700000000000 },
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const plain = value => JSON.parse(JSON.stringify(value))

async function harness(t) {
  const requests = [], media = [], handlers = new Map(), cleanup = [], slots = new Map()
  const liked = new Map(), disliked = new Map(), storage = new Map()
  let definition, deferredLikes = null, deferredLyrics = null, nextRequestFailure = null
  const life = createLife({ seed: 'player-integration-fixture', now: 1700000000000, name: '试验音灵' })
  const key = item => `${String(item.artist || '').toLowerCase().trim()}::${String(item.title || '').toLowerCase().trim()}`
  class FakeAudio extends EventTarget {
    constructor() {
      super()
      Object.assign(this, { src: '', paused: true, ended: false, currentTime: 0, duration: 180,
        readyState: 4, volume: 1, muted: false, playbackRate: 1, seeking: false,
        plays: 0, pauses: 0, loads: 0 })
      media.push(this)
    }
    load() { this.loads++; this.paused = true; this.ended = false; this.currentTime = 0; this.dispatchEvent(new Event('loadedmetadata')); this.dispatchEvent(new Event('canplay')) }
    play() { this.plays++; this.paused = false; this.ended = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve() }
    pause() { this.pauses++; this.paused = true; this.dispatchEvent(new Event('pause')) }
    removeAttribute(name) { if (name === 'src') this.src = '' }
    end() { this.paused = true; this.ended = true; this.dispatchEvent(new Event('ended')) }
  }
  const fetcher = async (url, options = {}) => {
    const parsed = new URL(url, 'http://example.invalid'), path = parsed.pathname
    const input = options.body ? JSON.parse(options.body) : null
    requests.push({ path, search: parsed.search, input, method: options.method || 'GET' })
    const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => plain(value) })
    if (nextRequestFailure?.path === path) {
      const failure = nextRequestFailure; nextRequestFailure = null
      return response({ error: failure.message }, 503)
    }
    if (path === '/dsh-music/api/life') return response({ life, morphology: getMorphology(life) })
    if (path === '/dsh-music/api/library') return response({ tracks: [a, b] })
    if (path === '/dsh-music/api/library/likes') {
      const snapshot = response({ items: [...liked.values()] })
      if (deferredLikes) { const deferred = deferredLikes; deferredLikes = null; return deferred(snapshot) }
      return snapshot
    }
    if (path === '/dsh-music/api/library/dislikes') return response({ items: [...disliked.values()] })
    if (path === '/dsh-music/api/library/like' || path === '/dsh-music/api/library/dislike') {
      let item = input
      if (input.trackId !== undefined) {
        item = [a, b].find(track => track.id === input.trackId)
        if (!item) return response({ error: '无效的曲目 id' }, 404)
      }
      const itemKey = key(item), local = [a, b].find(track => key(track) === itemKey)
      const base = { key: itemKey, artist: item.artist, title: item.title, trackId: local?.id || null, inLibrary: !!local }
      if (path.endsWith('/like')) {
        if (input.liked) { disliked.delete(itemKey); liked.set(itemKey, { ...base, liked: true }) }
        else liked.delete(itemKey)
        return response({ ...base, liked: !!input.liked, disliked: false,
          downloading: !!input.liked && !local && !!input.verification,
          ...(!local && input.liked && !input.verification ? { message: '已喜欢，但尚未入库' } : {}) })
      }
      const clearedLike = input.disliked && liked.has(itemKey)
      if (input.disliked) { liked.delete(itemKey); disliked.set(itemKey, base) }
      else disliked.delete(itemKey)
      return response({ ...base, disliked: !!input.disliked, clearedLike: !!clearedLike, liked: liked.has(itemKey) })
    }
    if (path === '/dsh-music/api/lyrics') {
      const snapshot = response({ source: 'fixture', synced: true, lines: [{ time: 0, text: '本地曲目歌词' }] })
      if (deferredLyrics) { const deferred = deferredLyrics; deferredLyrics = null; return deferred(snapshot) }
      return snapshot
    }
    if (path === '/dsh-music/api/library/preview') return response({ status: 'ready', audioUrl: '/dsh-music/preview/fixture.m4a' })
    if (path === '/dsh-music/api/playback/next') return response({ trackId: b.id, reason: 'next' })
    if (path === '/dsh-music/api/onboarding/state') return response({ completed: true })
    if (path.endsWith('/sync/availability')) return response({ available: false })
    if (path.endsWith('/sync/status') || path.endsWith('/download/status')) return response({ running: false, items: [], total: 0, done: 0 })
    return response({})
  }
  const eventTarget = new EventTarget()
  const document = { baseURI: 'http://example.invalid/', hidden: false,
    createElement: () => ({ setAttribute() {}, remove() {}, style: { setProperty() {} } }),
    head: { appendChild() {} }, body: {}, addEventListener() {}, removeEventListener() {} }
  const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) }
  const window = { document, localStorage, innerWidth: 1440, innerHeight: 900,
    __ModuleLoader__: { load: value => { definition = value } },
    addEventListener: eventTarget.addEventListener.bind(eventTarget), removeEventListener: eventTarget.removeEventListener.bind(eventTarget) }
  const sandbox = { window, document, localStorage, navigator: { mediaSession: {
    setActionHandler: (name, fn) => handlers.set(name, fn), metadata: null,
  } }, MediaMetadata: class { constructor(value) { Object.assign(this, value) } },
  Audio: FakeAudio, fetch: fetcher, URL, Blob, TextEncoder, TextDecoder, AbortController,
  structuredClone, crypto: webcrypto, performance, console, setTimeout, clearTimeout, setInterval, clearInterval,
  addEventListener: window.addEventListener, removeEventListener: window.removeEventListener }
  sandbox.globalThis = sandbox
  vm.runInNewContext(code, sandbox, { filename: 'echo-player-integration-bundle.js' })
  const module = definition.factory(id => {
    if (id === 'react') return React
    if (id === 'react-dom') return { createPortal: value => value }
    throw new Error(`Unexpected module ${id}`)
  })
  module.apply({
    locale: { register() {}, bind: () => key => key }, layout: { selectPanel() {} },
    effect: fn => { const result = fn(); if (typeof result === 'function') cleanup.push(result) },
    slots: { inject: (_name, fn) => fn(), register: (definition, component) => {
      const value = definition.inject?.(); slots.set(definition.id || definition.key || definition.name, { value, component }); return () => {}
    } },
  })
  t.after(() => { for (const dispose of cleanup.reverse()) dispose() })
  await settle()
  const main = slots.get('music').value, mini = slots.get('dsh-music.mini-player').value
  await main.lifeService.load(); await main.likes.load()
  return { main, mini, module, requests, media, handlers,
    failNext(path, message = '保存失败') { nextRequestFailure = { path, message } },
    holdNextLikes() { let release; const promise = new Promise(resolve => { release = resolve }); deferredLikes = snapshot => promise.then(() => snapshot); return release },
    holdNextLyrics() { let release; const promise = new Promise(resolve => { release = resolve }); deferredLyrics = snapshot => promise.then(() => snapshot); return release },
  }
}

test('companion receives shared player, likes source and direct library navigation', async t => {
  const h = await harness(t)
  assert.equal(h.media.length, 1)
  assert.equal(h.mini.player, h.main.player)
  assert.equal(h.mini.likes, h.main.likes)
  assert.equal(h.mini.hooks.likes, h.main.likes.source)
  h.mini.openLibrary()
  assert.equal(h.mini.hooks.ui.getSnapshot().view, 'library')
})

test('verified preview metadata survives warm and legacy play paths, likes use metadata not synthetic IDs', async t => {
  const h = await harness(t)
  await h.main.warm.playOne(recommendation)
  const preview = h.main.player.source.getSnapshot().track
  assert.match(preview.id, /^preview:/)
  assert.deepEqual(plain(preview.verification), recommendation.verification)
  assert.equal(preview.source, recommendation.source)
  assert.equal(preview.durationMs, recommendation.durationMs)
  const result = await h.mini.likes.toggle(preview, true)
  assert.equal(result.downloading, true)
  const request = h.requests.findLast(row => row.path.endsWith('/library/like')).input
  assert.equal(request.trackId, undefined)
  assert.equal(request.artist, recommendation.artist)
  assert.deepEqual(request.verification, recommendation.verification)
  await h.mini.likes.setDislike(preview, true)
  const dislike = h.requests.findLast(row => row.path.endsWith('/library/dislike')).input
  assert.equal(dislike.trackId, undefined)
  assert.equal(dislike.title, recommendation.title)
  assert.equal(h.mini.likes.isDisliked(preview), true)
  assert.equal(h.mini.likes.isLiked(preview), false)

  let fallback
  h.module.testPlaySong(recommendation, { playTracks: tracks => { fallback = tracks[0] } }, [],
    { start: (_item, ready) => ready({ audioUrl: '/preview/fallback' }) }, () => {}, key => key)
  assert.deepEqual(plain(fallback.verification), recommendation.verification)
  assert.equal(fallback.source, recommendation.source)
})

test('library likes use library IDs, failed writes preserve state, refresh cannot undo a newer preference', async t => {
  const h = await harness(t)
  const release = h.holdNextLikes()
  await h.main.likes.toggle(a, true)
  assert.deepEqual(h.requests.findLast(row => row.path.endsWith('/library/like')).input, { trackId: a.id, liked: true })
  await h.main.likes.setDislike(a, true)
  await settle(); release(); await settle()
  assert.equal(h.main.likes.isLiked(a), false)
  assert.equal(h.main.likes.isDisliked(a), true)
  h.failNext('/dsh-music/api/library/like')
  assert.equal((await h.main.likes.toggle(a, true)).error, '保存失败')
  assert.equal(h.main.likes.isDisliked(a), true)
  assert.equal(h.main.likes.isLiked(a), false)
  await h.main.likes.setDislike(a, false)
  await h.main.likes.toggle(a, true)
  assert.equal(h.main.likes.isLiked(a), true)
  assert.equal(h.main.likes.isDisliked(a), false)
})

test('preview lyrics fall back locally and late library lyrics do not replace that state', async t => {
  const h = await harness(t)
  const release = h.holdNextLyrics()
  const libraryLoad = h.main.lyrics.load(a.id)
  await h.mini.lyrics.load('preview:试听歌手::尚未入库')
  release(); await libraryLoad
  const snapshot = h.mini.lyrics.source.getSnapshot()
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.data.source, 'none')
  assert.match(snapshot.data.message, /试听/)
  assert.equal(h.requests.filter(row => row.path.endsWith('/lyrics')).length, 1)
  await h.mini.lyrics.load(b.id)
  assert.equal(h.mini.lyrics.source.getSnapshot().data.synced, true)
})

test('MediaSession play and pause are idempotent and keep one audio instance', async t => {
  const h = await harness(t)
  h.main.player.playTracks([a], 0)
  const audio = h.media[0], plays = audio.plays
  h.handlers.get('play')(); h.handlers.get('play')()
  assert.equal(audio.plays, plays)
  assert.equal(audio.paused, false)
  assert.equal(h.main.player.source.getSnapshot().playing, true)
  h.handlers.get('pause')(); h.handlers.get('pause')()
  assert.equal(audio.paused, true)
  const pauses = audio.pauses
  h.handlers.get('play')(); h.handlers.get('play')()
  assert.equal(audio.plays, plays + 1)
  assert.equal(audio.pauses, pauses)
  assert.equal(h.media.length, 1)
})

test('mixed queue preserves preview order and every Host playback payload excludes synthetic IDs', async t => {
  const h = await harness(t), player = h.main.player
  const preview = { id: 'preview:试听歌手::尚未入库', title: '试听', artist: '歌手', audioUrl: '/preview/mixed' }
  player.playTracks([a, preview, b], 0, { ordered: true })
  h.media[0].end(); await settle()
  assert.equal(player.source.getSnapshot().track.id, preview.id)
  h.media[0].end(); await settle()
  assert.equal(player.source.getSnapshot().track.id, b.id)
  assert.equal(h.requests.filter(row => row.path.endsWith('/playback/next')).length, 0)
  player.appendTrack({ ...preview, id: 'preview:another' })
  player.jumpTo(1)
  for (const request of h.requests.filter(row => row.path.endsWith('/api/playback'))) {
    assert.ok(request.input.trackId === null || /^[a-f0-9]{16}$/.test(request.input.trackId))
    assert.ok(request.input.queue.every(id => /^[a-f0-9]{16}$/.test(id)))
  }
  player.playTracks([a, b], 0, { ordered: true })
  h.media[0].end(); await settle()
  assert.equal(h.requests.filter(row => row.path.endsWith('/playback/next')).length, 1)
  assert.equal(player.source.getSnapshot().track.id, b.id)
})
