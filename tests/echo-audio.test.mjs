import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackDelta, summarizeSpectrum, createPlaybackObserver } from '../src/client/echo/audio.js';

const frame = (patch = {}) => ({ clock: 1000, position: 1, playing: true, seeking: false, muted: false, volume: 1, readyState: 4, rate: 1, trackId: 'aabbccddeeff0011', ...patch });
const nextFrame = (patch = {}) => frame({ clock: 1250, position: 1.25, ...patch });

function harness(t, options = {}) {
  let clock = 0;
  let poll = null;
  let cleared = 0;
  t.mock.method(globalThis, 'setInterval', fn => { poll = fn; return 7; });
  t.mock.method(globalThis, 'clearInterval', () => { cleared++; });
  t.mock.method(Date, 'now', () => 1800000000000 + clock);
  const handlers = new Map();
  const audio = {
    currentTime: 0, paused: false, ended: false, muted: false, volume: 1, readyState: 4, seeking: false, playbackRate: 1,
    addEventListener(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
    removeEventListener(name, fn) { handlers.get(name)?.delete(fn); },
    emit(name) { for (const fn of [...(handlers.get(name) || [])]) fn(); },
  };
  const events = [], statuses = [], contexts = [];
  class Context {
    constructor() {
      this.state = options.suspended ? 'suspended' : 'running';
      this.destination = { kind: 'destination' };
      this.source = { connections: [], connect: target => {
        if (options.failBranch && target.kind === 'analyser') throw new Error('analysis connection failed');
        this.source.connections.push(target);
      }, disconnect() {} };
      this.node = {
        kind: 'analyser', frequencyBinCount: 16, fftSize: 32,
        connect: target => { this.node.destination = target; }, disconnect() {},
        getByteFrequencyData: values => { if (options.failRead) throw new Error('read failed'); values.fill(80); values[12] = 200; },
        getByteTimeDomainData: values => { for (let i = 0; i < values.length; i++) values[i] = i % 2 ? 150 : 106; },
      };
      this.captures = 0;
      contexts.push(this);
    }
    async resume() {
      if (options.resume) await options.resume();
      this.state = 'running';
    }
    createAnalyser() { return this.node; }
    createMediaElementSource() { this.captures++; return this.source; }
    async close() { this.state = 'closed'; }
  }
  const previous = globalThis.AudioContext;
  const previousWebkit = globalThis.webkitAudioContext;
  globalThis.AudioContext = options.noContext ? undefined : Context;
  globalThis.webkitAudioContext = undefined;
  t.after(() => { globalThis.AudioContext = previous; globalThis.webkitAudioContext = previousWebkit; });
  const observer = createPlaybackObserver({ audio, now: () => clock,
    submit: options.submit || (event => { events.push(event); return Promise.resolve(); }),
    onStatus: (...args) => statuses.push(args),
  });
  const setTrack = (id = 'aabbccddeeff0011') => observer.setTrack({ id, title: 'Local recording', artist: 'An artist' });
  const tick = (ms = 250, mediaMs = ms * audio.playbackRate) => { clock += ms; audio.currentTime += mediaMs / 1000; poll(); };
  const start = () => { audio.paused = false; audio.ended = false; audio.emit('playing'); };
  const pause = () => { audio.paused = true; audio.emit('pause'); };
  t.after(() => observer.dispose());
  return { observer, audio, events, statuses, contexts, setTrack, tick, start, pause, handlers, cleared: () => cleared };
}

test('playbackDelta counts real audible wall time at 0.5x, 1x and 2x', () => {
  for (const rate of [0.5, 1, 2]) {
    assert.equal(playbackDelta(frame({ rate }), nextFrame({ rate, position: 1 + 0.25 * rate })), 250);
  }
});

test('playbackDelta rejects both sides of pause/mute/seek transitions and invalid clocks', () => {
  for (const patch of [{ playing: false }, { muted: true }, { volume: 0 }, { readyState: 1 }, { seeking: true }]) {
    assert.equal(playbackDelta(frame(patch), nextFrame()), 0);
    assert.equal(playbackDelta(frame(), nextFrame(patch)), 0);
  }
  for (const patch of [{ clock: NaN }, { position: NaN }, { rate: Infinity }, { clock: 5000, position: 5 }, { position: 45 }, { position: 0 }, { trackId: 'other' }]) {
    assert.equal(playbackDelta(frame(), nextFrame(patch)), 0);
  }
  assert.equal(playbackDelta(frame({ rate: 0.5 }), nextFrame({ rate: 2 })), 0);
});

test('spectrum features are finite; silence is not maximum texture; high bins are brighter', () => {
  const silence = summarizeSpectrum(new Uint8Array(16), new Uint8Array(32).fill(128));
  assert.deepEqual(silence, { energy: 0, brightness: 0, rhythm: 0, texture: 0 });
  const low = new Uint8Array(16); low[1] = 220;
  const high = new Uint8Array(16); high[13] = 220;
  const wave = Uint8Array.from({ length: 32 }, (_, i) => i % 2 ? 150 : 106);
  const a = summarizeSpectrum(low, wave), b = summarizeSpectrum(high, wave, low);
  assert.ok(b.brightness > a.brightness);
  assert.ok(b.rhythm > 0);
  for (const value of Object.values(b)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
});

test('observer counts resumed audio once, flushes on pause and gives loop/track sessions separate IDs', async t => {
  const h = harness(t, { noContext: true });
  h.setTrack(); h.start();
  for (let i = 0; i < 4; i++) h.tick();
  h.pause();
  await Promise.resolve();
  assert.equal(h.events.reduce((sum, e) => sum + e.listenedMs, 0), 1000);
  assert.ok(h.events.every(e => e.featureSource === 'none' && !e.features));
  const oldSession = h.events[0].sessionId;
  h.setTrack(); h.audio.currentTime = 0; h.start();
  for (let i = 0; i < 4; i++) h.tick();
  h.observer.flush();
  assert.notEqual(h.events.at(-1).sessionId, oldSession);
  h.setTrack('1122334455667788'); h.audio.currentTime = 0; h.start();
  for (let i = 0; i < 4; i++) h.tick();
  h.observer.flush();
  assert.equal(h.events.at(-1).track.id, '1122334455667788');
  assert.equal(new Set(h.events.map(e => e.id)).size, h.events.length);
});

test('observer omits seeking, muted, suspended and long-background intervals', async t => {
  const h = harness(t);
  h.setTrack(); await h.observer.activate(); h.start();
  for (let i = 0; i < 4; i++) h.tick();
  h.audio.seeking = true; h.audio.emit('seeking'); h.tick(250, 20000);
  h.audio.seeking = false; h.audio.emit('seeked');
  h.audio.muted = true; h.audio.emit('volumechange'); h.tick(1000, 1000);
  h.audio.muted = false; h.audio.emit('volumechange');
  h.tick(5000, 5000);
  h.contexts[0].state = 'suspended'; h.tick(1000, 1000);
  h.contexts[0].state = 'running'; h.tick(250, 250);
  h.observer.flush();
  assert.equal(h.events.reduce((sum, e) => sum + e.listenedMs, 0), 1000);
});

test('partial audio-feature coverage creates separate observed and time-only events', async t => {
  const h = harness(t);
  h.setTrack(); h.start();
  for (let i = 0; i < 4; i++) h.tick();
  await h.observer.activate();
  for (let i = 0; i < 4; i++) h.tick();
  h.observer.flush();
  const observed = h.events.filter(e => e.featureSource === 'audio');
  const timeOnly = h.events.filter(e => e.featureSource === 'none');
  assert.equal(observed.reduce((sum, e) => sum + e.listenedMs, 0), 1000);
  assert.equal(timeOnly.reduce((sum, e) => sum + e.listenedMs, 0), 1000);
  for (const e of observed) for (const value of Object.values(e.features)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
});

test('analyser failure cannot throw through a timer or remove the direct playback connection', async t => {
  const h = harness(t, { failRead: true });
  h.setTrack(); await h.observer.activate(); h.start();
  assert.doesNotThrow(() => { for (let i = 0; i < 4; i++) h.tick(); });
  h.observer.flush();
  const context = h.contexts[0];
  assert.ok(context.source.connections.includes(context.destination));
  assert.equal(h.events[0].featureSource, 'none');
});

test('a failed analysis branch retains a connected playback destination', async t => {
  const h = harness(t, { failBranch: true });
  h.setTrack();
  assert.equal(await h.observer.activate(), false);
  assert.ok(h.contexts[0].source.connections.includes(h.contexts[0].destination));
});

test('synchronous outbox rejection does not break playback callbacks', async t => {
  const h = harness(t, { noContext: true, submit: () => { throw new Error('disk full'); } });
  h.setTrack(); h.start();
  for (let i = 0; i < 4; i++) h.tick();
  assert.doesNotThrow(() => h.pause());
  await Promise.resolve();
});

test('asynchronous outbox rejection is handled and the observer remains usable', async t => {
  let attempts = 0;
  const h = harness(t, { noContext: true, submit: () => { attempts++; return Promise.reject(new Error('offline')); } });
  h.setTrack(); h.start();
  for (let i = 0; i < 4; i++) h.tick();
  h.observer.flush();
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 4; i++) h.tick();
  h.pause();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);
});

test('native loop wraps flush the old session and retain only observed post-wrap time', async t => {
  const h = harness(t, { noContext: true });
  h.audio.loop = true;
  h.setTrack(); h.start();
  for (let i = 0; i < 4; i++) h.tick();
  h.tick(250, -900);
  for (let i = 0; i < 4; i++) h.tick();
  h.observer.flush();
  assert.equal(h.events.reduce((sum, e) => sum + e.listenedMs, 0), 2000);
  assert.equal(new Set(h.events.map(e => e.sessionId)).size, 2);
});

test('thirty seconds auto-flushes and unsupported preview IDs never become life listening', async t => {
  const h = harness(t, { noContext: true });
  h.setTrack(); h.start();
  for (let i = 0; i < 120; i++) h.tick();
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].listenedMs, 30000);
  h.setTrack('preview:unverified'); h.start();
  for (let i = 0; i < 120; i++) h.tick();
  h.observer.flush();
  assert.equal(h.events.length, 1);
});

test('dispose during pending activation never captures the audio element afterward', async t => {
  let resume;
  const waiting = new Promise(resolve => { resume = resolve; });
  const h = harness(t, { suspended: true, resume: () => waiting });
  h.setTrack();
  const activation = h.observer.activate();
  h.observer.dispose();
  resume();
  assert.equal(await activation, false);
  assert.equal(h.contexts[0].captures, 0);
  assert.equal(h.contexts[0].state, 'closed');
  assert.equal([...h.handlers.values()].reduce((sum, handlers) => sum + handlers.size, 0), 0);
  assert.equal(h.cleared(), 1);
});
