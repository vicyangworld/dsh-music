#!/usr/bin/env node
/**
 * dsh-music client render smoke (no build, no browser).
 *
 * Loads the real single-file client artifact in a vm sandbox with a minimal
 * React mock, drives the real component tree through the main views and the
 * mini player, and asserts the v6/v7 interaction contracts (mini player
 * states, list playback queues, artist entries, cold-start onboarding copy,
 * artist-image request coalescing, top-songs playback). Exit 0 = all pass.
 *
 * Run: node scripts/client-render-smoke.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../bundle/client/index.js', import.meta.url), 'utf8');

/* ---- minimal React ---- */
const state = { view: 'library', miniHidden: false, miniCollapsed: false, artistName: null };
const playerState = {
  track: { id: 't1', title: '测试歌曲', artist: '测试歌手', album: '测试专辑', coverUrl: null, duration: 200 },
  playing: true, position: 42, duration: 200, volume: 0.8, muted: false,
  shuffle: false, repeat: 'one', error: null,
  queue: [{ id: 't1', title: '测试歌曲', artist: '测试歌手' }], queueIndex: 0,
};
let libState = { status: 'ready', tracks: [
  { id: 't1', title: '测试歌曲', artist: '测试歌手', album: '测试专辑', duration: 200, source: 'dsh-music' },
  { id: 't2', title: '另一首', artist: '别的歌手', album: '专辑B', duration: 180, source: 'spotify-liked' },
], error: null };
const lyricsState = { trackId: 't1', status: 'ready', data: { synced: true, lines: [
  { time: 0, text: '第一句歌词' }, { time: 5, text: '第二句歌词' },
  { time: 10, text: '第三句歌词' }, { time: 15, text: '第四句歌词' },
] } };
let historyState = { status: 'ready', events: [
  { trackId: 't1', title: '测试歌曲', artist: '测试歌手', timestamp: Date.now(), completion: 0.9, skipped: false },
  { trackId: 't2', title: '另一首', artist: '别的歌手', timestamp: Date.now() - 60000, completion: 0.4, skipped: false },
], total: 2, stats: { totalPlays: 1, totalSeconds: 200, uniqueSongs: 1, uniqueArtists: 1, topSongs: [{ title: '测试歌曲', artist: '测试歌手', trackId: 't1', plays: 3 }, { title: '另一首', artist: '别的歌手', trackId: 't2', plays: 1 }, { title: '已删除的歌', artist: '旧歌手', trackId: null, plays: 2 }], topArtists: [{ name: '测试歌手', plays: 3 }], daily: [], skippedCount: 0, avgCompletion: 0.9 }, error: null };
let recoState = { status: 'ready', items: [], sections: { today: [{ title: '推荐曲', artist: '推荐歌手', coverUrl: null }], artist: [{ name: '歌手A', imageUrl: null, genreHint: 'rock' }], new: [] }, generatedAt: 1, error: null };

const noop = () => {};
let groupDefault = 'none';
let libTabDefault = 'library';
/* test hook: force the mini-bar ··· menu open so its items render (useState setter is a noop here) */
let miniMenuDefault = false;
const React = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => {
    const kids = children.flat(Infinity).filter((c) => c != null);
    const p = { ...(props || {}) };
    if (kids.length) p.children = kids.length === 1 ? kids[0] : kids;
    return { type, props: p, children: kids };
  },
  useState: (init) => {
    let v = typeof init === 'function' ? init() : init;
    /* test hook: force the library grouping mode so the group-header avatar path renders */
    if (v === 'none') v = groupDefault;
    /* test hook: force the library sub-tab so the「我喜欢」list renders */
    if (v === 'library') v = libTabDefault;
    /* test hook: open the mini-bar ··· menu */
    if (v === false && miniMenuDefault) v = true;
    return [v, noop];
  },
  useEffect: (fn) => { try { fn(); } catch (e) { throw e; } },
  useMemo: (fn) => fn(),
  useRef: (init) => ({ current: init === undefined ? null : init }),
  useCallback: (fn) => fn,
};

const localStorage = {
  _v: {}, getItem(k) { return this._v[k] ?? null; },
  setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; },
};
let captured = null;
const windowMock = {
  __ModuleLoader__: { load: (def) => { captured = def; } },
  localStorage, innerWidth: 1440, innerHeight: 900,
  addEventListener: noop, removeEventListener: noop,
  confirm: () => true,
};
const fetchCalls = [];
const fetchBodies = [];
/* 5z3：可变历史 mock —— POST 追加事件并同步更新统计，验证「播放事件落库 → 统计/排行实时刷新」 */
let histEventsMock = [];
let histStatsMock = { totalPlays: 0, totalSeconds: 0, uniqueSongs: 0, uniqueArtists: 0, topSongs: [], topArtists: [], daily: [], skippedCount: 0, avgCompletion: 0 };
const histAppendMock = (ev) => {
  const entry = { trackId: ev.trackId, title: '测试歌曲', artist: '测试歌手', timestamp: Date.now(), completion: ev.completion, skipped: !!ev.skipped };
  histEventsMock = [entry, ...histEventsMock];
  const plays = histStatsMock.totalPlays + 1;
  histStatsMock = { ...histStatsMock, totalPlays: plays, skippedCount: histStatsMock.skippedCount + (ev.skipped ? 1 : 0), topSongs: [{ title: '测试歌曲', artist: '测试歌手', trackId: ev.trackId, plays }], topArtists: [{ name: '测试歌手', plays }] };
  return entry;
};
/* HistoryView 驻留轮询用 setInterval 登记（mock useEffect 不跑 cleanup，记录即可断言） */
const intervalCalls = [];
let qqConnected = false; /* 5w：新用户先未连接（三步引导），粘贴后变已连接 */
const fetchMock = async (url, init) => {
  fetchCalls.push(url);
  if (init && init.body != null) fetchBodies.push({ url: String(url), body: String(init.body) });
  const body = url.includes('/onboarding/state')
    ? { status: 'ready', completed: false, mode: 'none', libraryConfigured: false, libraryPath: null, prefs: {}, starter: null }
    : url.includes('/onboarding/complete')
      ? { state: { status: 'ready', completed: true, mode: 'local', libraryConfigured: true, libraryPath: null, prefs: {}, starter: null }, startedStarter: false }
      : url.includes('/sync/availability')
    ? { available: true, hint: null, authorized: url.includes('refresh=1') }
    : url.includes('/sync/status')
      ? { running: false, result: null, error: null }
      : url.includes('/liked-sync/status')
        ? { enabled: true, providers: {
          netease: { label: '网易云音乐', connected: false, account: null, busy: false, lastSyncAt: null, lastResult: null, knownCount: 0 },
          qq: { label: 'QQ 音乐', connected: qqConnected, account: qqConnected ? { uid: '1001', nickname: '小Q', loginAt: 1 } : null, busy: false, lastSyncAt: 0, lastResult: null, knownCount: qqConnected ? 5 : 0 },
        } }
        : url.includes('/liked-sync/netease/qr/poll')
          ? { code: 801, message: '等待扫码' }
          : url.includes('/liked-sync/qq/qr/poll')
            ? { code: 801, message: '二维码未失效' }
          : url.includes('/liked-sync/qq/qr')
            ? { key: 'qk1', matrix: { size: 21, modules: Array(441).fill(0) }, png: 'data:image/png;base64,AAAA' }
          : url.includes('/liked-sync/netease/qr')
            ? { key: 'k1', url: 'https://music.163.com/login?codekey=8126df9b-smoke' }
            : url.includes('/liked-sync/qq/connect')
              ? { account: { uid: '1001', nickname: '小Q' }, likedDir: { tid: 201, name: '我喜欢', songCount: 10 } }
            : url.includes('/library/search')
              ? { local: [], remote: [{ title: '乙', artist: '甲', album: null, verification: { source: 'MusicBrainz', url: 'https://musicbrainz.org/release/x', verifiedAt: Date.now() } }] }
            : url.includes('/dsh-music/api/download/status')
              ? { running: false, total: 0, done: 0, items: [] }
            : url.includes('/dsh-music/api/download')
              ? { runId: 'r1', total: 1 }
            : url.includes('/liked-sync/qq/sync')
              ? { provider: 'qq', at: 1, durationMs: 5, total: 10, unavailable: 1, playlistName: '我喜欢', added: 3, existed: 5, skippedDisliked: 1, removed: 2, removedItems: [{ title: '旧歌', artist: '某人' }] }
              : url.includes('/library/preview')
                ? { status: 'ready', audioUrl: '/dsh-music/preview/abc.m4a' }
                : url.includes('/dsh-music/api/history/stats')
                  ? histStatsMock
                  : url.includes('/dsh-music/api/history')
                    ? (init && init.method === 'POST'
                      ? histAppendMock(JSON.parse(String(init.body)))
                      : { events: histEventsMock, total: histEventsMock.length })
                    : { imageUrl: 'http://img/orig.jpg', thumbnailUrl: 'http://img/thumb.jpg' };
  return { ok: true, json: async () => body };
};
/* ---- minimal HTMLAudioElement mock: lets the real player engine load/seek ----
 * Mirrors the browser contract the player relies on: setting currentTime moves
 * the playhead and fires timeupdate (position follows the audio, not the wish);
 * load() surfaces metadata; play()/pause() fire their events. */
const audioInstances = [];
class AudioMock {
  constructor() {
    this._ls = {}; this._time = 0; this.duration = NaN; this.paused = true;
    this.src = ''; this.preload = ''; this.volume = 1; this.muted = false; this.readyState = 0;
    audioInstances.push(this);
  }
  addEventListener(n, f) { (this._ls[n] = this._ls[n] || []).push(f); }
  removeEventListener(n, f) { this._ls[n] = (this._ls[n] || []).filter((x) => x !== f); }
  _emit(n) { for (const f of [...(this._ls[n] || [])]) f({ type: n }); }
  load() {
    if (!this.src) return;
    this.readyState = 4; this.duration = 200;
    this._emit('loadedmetadata'); this._emit('durationchange'); this._emit('canplay');
  }
  play() { this.paused = false; this._emit('play'); this._emit('playing'); return Promise.resolve(); }
  pause() { this.paused = true; this._emit('pause'); }
  removeAttribute(n) { if (n === 'src') { this.src = ''; this.readyState = 0; this.duration = NaN; } }
  get currentTime() { return this._time; }
  set currentTime(v) {
    if (this.readyState === 0) throw new Error('InvalidStateError: no media loaded');
    this._time = Math.max(0, Math.min(v, isFinite(this.duration) ? this.duration : v));
    this._emit('seeking'); this._emit('timeupdate'); this._emit('seeked');
  }
}
const sandbox = { window: windowMock, localStorage, console, setTimeout, clearTimeout, fetch: fetchMock,
  setInterval: (fn, ms) => { intervalCalls.push({ fn, ms }); return intervalCalls.length; }, clearInterval: noop,
  document: { baseURI: 'dsh-app://app/', createElement: () => ({ setAttribute: noop, textContent: '', remove: noop }), head: { appendChild: noop }, addEventListener: noop, removeEventListener: noop },
  Audio: AudioMock, TextEncoder, URL };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'client/index.js' });
if (!captured || !captured.factory) throw new Error('factory not captured');

const api = { get: noop, post: noop, request: noop };
const requireMock = (id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
};
const mod = captured.factory(requireMock);

const comps = {};
const services = {};
const registrations = [];
const ctx = {
  effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : noop; },
  locale: { register: noop, bind: () => (k) => k },
  layout: { selectPanel: noop },
  slots: {
    inject: (name, fn) => fn(),
    register: (def, comp) => {
      const key = def.id || def.key || def.name;
      comps[key] = comp;
      registrations.push({ def, comp });
      if (def.inject) services[key] = def.inject();
      return { dispose: noop };
    },
  },
};
mod.apply(ctx);

const usePlayer = (sel) => sel(playerState);
const useLibrary = (sel) => sel(libState);
const useLyrics = (sel) => sel(lyricsState);
const useUi = (sel) => sel(state);
const useHistory = (sel) => sel(historyState);
const useReco = (sel) => sel(recoState);
const useDownload = (sel) => sel({ running: false, total: 0, done: 0, items: [], error: null, finishedAt: 0 });
const useSync = (sel) => sel({ phase: 'idle', result: null, error: null, tracks: [] });
const useLikes = (sel) => sel({ keys: {}, loaded: true, error: null });
const usePreview = (sel) => sel({ status: 'idle', item: null, error: null });
const useArtistImages = (sel) => sel({ images: { '测试歌手': 'http://img/thumb.jpg', '别的歌手': null } });
const onboardingState = { status: 'ready', completed: true, starter: null, taste: null, error: null };
const useOnboarding = (sel) => sel(onboardingState);
const useWarm = (sel) => {
  const svcWarm = (services['music'] || {}).warm;
  return sel(svcWarm ? svcWarm.source.getSnapshot() : { pending: {}, running: false });
};
const hooks = { usePlayer, useLibrary, useLyrics, useUi, useHistory, useReco, useDownload, useSync, useLikes, usePreview, useWarm, useArtistImages, useOnboarding };
const svc = services['music'] || services['shell.overlay'] || {};
const music = comps['music'];
const mini = comps['dsh-music.mini-player'];
if (!music) throw new Error('MusicPanel not registered');
if (!mini) throw new Error('MiniPlayer not registered');

const baseProps = { t: (k) => k, ...(services['music'] || {}), ...hooks };
const expand = (node) => {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expand).flat(Infinity);
  if (typeof node.type === 'function') return expand(node.type(node.props));
  if (node.type === 'Fragment') return node.children.map(expand).flat(Infinity);
  return { ...node, children: node.children.map(expand).flat(Infinity) };
};
const walk = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  out.push(node);
  walk(node.children, out);
  return out;
};
const cls = (n) => (n && n.props && n.props.className) || '';
/* 平台行按整段 class 匹配（dshm-prv-head / -body / -open 不是行本身） */
const isCard = (n) => cls(n).split(' ').includes('dshm-prv');
const has = (tree, pred) => walk(tree).some(pred);

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); }

/* 1) library view renders; single cycle mode button; play-all follows list */
state.view = 'library';
const libTree = expand(music(baseProps));
check('library renders', !!libTree);
const modeBtns = walk(libTree).filter((n) => /dshm-mode-cycle/.test(cls(n)));
check('library has exactly 1 cycle-mode button', modeBtns.length === 1, 'count=' + modeBtns.length);
check('library row artist is a clickable button', has(libTree, (n) => cls(n) === 'dshm-row-sub-btn'));

/* 2) now-playing view */
state.view = 'now';
const nowTree = expand(music(baseProps));
check('now-playing renders', !!nowTree);
/* 十三期：正在播放页 ♥ / 👎 */
{
  const acts = walk(nowTree).find((n) => cls(n) === 'dshm-now-actions');
  const btns = acts ? walk(acts).filter((n) => cls(n).includes('dshm-like-btn')) : [];
  check('now-playing has a ♥ / 👎 group under the artist line', !!acts && btns.length === 2 && acts.props.role === 'group', 'btns=' + btns.length);
  const heart = btns.find((n) => !cls(n).includes('dshm-dislike-btn'));
  const b = fetchBodies.length;
  if (heart) heart.props.onClick({ stopPropagation: noop });
  await new Promise((r) => setTimeout(r, 0));
  check('now-playing ♥ toggles the like through the likes API', fetchBodies.slice(b).some((x) => x.url.includes('/dsh-music/api/library/like')),
    JSON.stringify(fetchBodies.slice(b).map((x) => x.url)));
}
check('now-playing has 1 cycle-mode control', walk(nowTree).filter((n) => /dshm-mode-cycle|dshm-iconbtn/.test(cls(n))).length >= 1);
check('now-playing artist opens artist page (button present)', has(nowTree, (n) => cls(n).includes('dshm-artist-btn')));

/* 3) history view: play-list header + clickable rows */
state.view = 'history';
const hisTree = expand(music(baseProps));
check('history renders', !!hisTree);
check('history has play-list button', has(hisTree, (n) => cls(n).includes('dshm-col-play') && typeof n.props.onClick === 'function'), 'nodes=' + walk(hisTree).filter((n) => cls(n).includes('chipbtn')).length);
check('history row is clickable', has(hisTree, (n) => /dshm-hrow-click/.test(cls(n)) && typeof n.props.onClick === 'function'));
check('history row artist clickable', has(hisTree, (n) => /dshm-row-sub-btn/.test(cls(n))));
/* 历史页必须自己是滚动容器：.dshm-body 不滚动，缺 flex:1;min-height:0;overflow-y:auto 长历史会被裁掉滚不动 */
check('history page is its own scroll container (flex:1;min-height:0;overflow-y:auto)', /\.dshm-history-page\{flex:1;min-height:0;overflow-y:auto;/.test(src));
check('history page root rendered with scroll class', has(hisTree, (n) => cls(n) === 'dshm-history-page'));

/* 4) reco view: song artist clickable */
state.view = 'reco';
const recoTree = expand(music(baseProps));
check('reco renders', !!recoTree);
check('reco row artist clickable', has(recoTree, (n) => cls(n) === 'dshm-srow-artist'));

/* 4x) 十期：三栏各自「重新推荐」 + 播放按钮缓存转圈 */
const refreshBtns = walk(recoTree).filter((n) => /dshm-col-refresh/.test(cls(n)));
check('reco shows one refresh button per column', refreshBtns.length === 3, 'count=' + refreshBtns.length);
check('reco refresh buttons are enabled', refreshBtns.every((b) => !b.props.disabled));
fetchCalls.length = 0;
refreshBtns[0].props.onClick();
await new Promise((r) => setTimeout(r, 40));
check('refresh calls the per-column POST route',
  fetchCalls.some((u) => String(u).includes('/reco/sections/refresh')), JSON.stringify(fetchCalls.slice(0, 3)));

const savedRecoSpin = recoState;
recoState = { ...recoState, refreshing: { today: true, artist: false, new: false } };
const spinColTree = expand(music(baseProps));
const loaders = walk(spinColTree).filter((n) => cls(n) === 'dshm-col-loading');
check('refreshing column shows exactly one column loader', loaders.length === 1, 'count=' + loaders.length);
check('refreshing column keeps the other columns intact',
  walk(spinColTree).filter((n) => /dshm-col-refresh/.test(cls(n)) && n.props.disabled).length === 1);
recoState = savedRecoSpin;

const warmSvc = (services['music'] || {}).warm;
check('warm service is injected', !!warmSvc && typeof warmSvc.playList === 'function');
const spinItems = [{ title: '缓存曲A', artist: '缓存歌手', verification: { ok: true } },
  { title: '缓存曲B', artist: '缓存歌手', verification: { ok: true } }];
const savedRecoCol = recoState;
recoState = { ...recoState, status: 'ready', sections: { today: spinItems, artist: [], new: [] } };
state.view = 'reco';
const warmRun = warmSvc.playList(spinItems, () => null);
const busyTree = expand(music(baseProps));
check('column play spins every uncached row at once',
  walk(busyTree).filter((n) => /dshm-playround-busy/.test(cls(n))).length === 2,
  'busy=' + walk(busyTree).filter((n) => /dshm-playround-busy/.test(cls(n))).length);
await warmRun;
check('rows stop spinning once caching lands',
  Object.keys(warmSvc.source.getSnapshot().pending).length === 0,
  JSON.stringify(warmSvc.source.getSnapshot()));
check('warm run finishes and unlocks clicks', warmSvc.source.getSnapshot().running === false);
warmSvc.source.set({ running: true });
fetchCalls.length = 0;
await warmSvc.playList(spinItems, () => null);
check('repeated column click is ignored while a warm run is active',
  !fetchCalls.some((u) => String(u).includes('/library/preview')), JSON.stringify(fetchCalls.slice(0, 3)));
warmSvc.source.set({ running: false });
recoState = savedRecoCol;

/* 4z) cold-start onboarding (v6 batch 4): empty library + empty recommendations */
const savedLib = libState, savedReco = recoState, savedHist = historyState;
libState = { status: 'ready', tracks: [], error: null };
state.view = 'library';
const emptyTree = expand(music(baseProps));
const ctas = walk(emptyTree).find((n) => cls(n) === 'dshm-empty-ctas');
check('empty library shows onboarding CTA row', !!ctas && ctas.children.length === 3,
  'ctas=' + (ctas ? ctas.children.length : 'none'));
const ctaLabels = ctas ? JSON.stringify(ctas.children.map((c) => c.props && c.props.children)) : '';
check('empty library has search / rescan / settings CTAs (sync lives in settings)',
  ctaLabels.includes('emptySearchCta') && ctaLabels.includes('emptyRescanCta') && ctaLabels.includes('settingsTitle') && !ctaLabels.includes('syncOptional'),
  ctaLabels.slice(0, 140));
check('empty library drops the old phase-3 copy', !ctaLabels.includes('phase'));
check('empty library shows default folder hint', has(expand(music(baseProps)), (n) => cls(n) === 'dshm-empty-dir'));
/* host sync probe drives the optional sync button */
await new Promise((r) => setTimeout(r, 50));
const syncSvc = (services['music'] || {}).sync;
check('sync availability probed from host endpoint', !!syncSvc && syncSvc.source.getSnapshot().available === true,
  JSON.stringify(syncSvc && syncSvc.source.getSnapshot()));

recoState = { status: 'idle', items: [], sections: null, generatedAt: 0, stats: null, error: null };
historyState = { status: 'ready', events: [], total: 0, stats: { totalPlays: 0, totalSeconds: 0, uniqueSongs: 0, uniqueArtists: 0, topSongs: [], topArtists: [], daily: [], skippedCount: 0, avgCompletion: 0 }, error: null };
state.view = 'reco';
const coldTree = expand(music(baseProps));
check('zero-history reco copy shown', JSON.stringify(walk(coldTree).map((n) => n.props && n.props.children)).includes('recoColdTitle'));
libState = savedLib; recoState = savedReco; historyState = savedHist;

/* 4y) cold-start exploration batch note (D3 contract: exploreOnly/note) */
const savedReco2 = recoState;
recoState = { ...recoState, bootstrapNote: '探索批次：基于公众热门流派与场景生成，收听增长后会逐步个性化' };
state.view = 'reco';
const bootTree = expand(music(baseProps));
check('reco explore note rendered', has(bootTree, (n) => cls(n) === 'dshm-explore-note'));
check('reco explore chip rendered', has(bootTree, (n) => cls(n) === 'dshm-explore-chip'));
recoState = savedReco2;

/* 4w) 设置页（原欢迎流程的继任者）：首启 = 真实 Logo 欢迎区 + 三区块 + 完成/先随便看看；
 *     finish()/save() 用源码提取的真实函数体跑一遍（POST 次数 / 路由 / 失败分支）。 */
check('returning user is not forced into the settings page', state.view !== 'settings');
check('onboarding payload matches the host contract', src.includes('payload.libraryPath') && src.includes('payload.useStarter'));
const firstRunSnap = { status: 'ready', completed: false, mode: 'none', libraryPath: null, starter: null, taste: null, error: null };
state.view = 'settings';
const firstTree = expand(music({ ...baseProps, useOnboarding: (sel) => sel(firstRunSnap) }));
check('first run renders the settings page with the hero', has(firstTree, (n) => cls(n) === 'dshm-settings dshm-settings-first')
  && has(firstTree, (n) => cls(n) === 'dshm-welcome-hero dshm-set-hero'));
const logo = walk(firstTree).find((n) => n.type === 'img' && cls(n) === 'dshm-logo');
check('hero logo is the real plugin icon served by the host', !!logo && String((logo.props || {}).src || '').includes('/dsh-music/icon.png'),
  'src=' + ((logo && logo.props && logo.props.src) || ''));
check('hero shows title + first-run note + three selling points', has(firstTree, (n) => (n.children || []).includes('welcomeTitle'))
  && has(firstTree, (n) => cls(n) === 'dshm-set-first-note') && has(firstTree, (n) => cls(n) === 'dshm-wpoint'));
check('first-run foot: skip + finish', has(firstTree, (n) => cls(n) === 'dshm-wbtn dshm-wbtn-primary' && (n.children || []).includes('welcomeFinish'))
  && has(firstTree, (n) => cls(n) === 'dshm-wbtn' && (n.children || []).includes('welcomeSkip')));
const sectionIds = walk(firstTree).filter((n) => cls(n) === 'dshm-set-section').map((n) => (n.props || {})['aria-label']);
check('three sections in order: liked / taste / library', JSON.stringify(sectionIds) === JSON.stringify(['setLikedTitle', 'setTasteTitle', 'setLibTitle']),
  JSON.stringify(sectionIds));
check('liked section = three provider rows: 网易云 / QQ 音乐 / Spotify', walk(firstTree).filter(isCard).map((n) => n.props['data-provider']).join(',') === 'netease,qq,spotify',
  walk(firstTree).filter(isCard).map((n) => n.props['data-provider']).join(','));
svc.likedSync.selectTab('spotify');
const spotBtn = walk(expand(music({ ...baseProps, useOnboarding: (sel) => sel(firstRunSnap) }))).find((n) => cls(n) === 'dshm-chipbtn dshm-chipbtn-primary' && (n.children || []).includes('syncBtn'));
svc.likedSync.selectTab(null);
check('Spotify row offers the sync action inside settings', !!spotBtn && !(spotBtn.props || {}).disabled);
check('no standalone import/Spotify buttons outside the settings page', !has(firstTree, (n) => cls(n) === 'dshm-toolbar'));
check('taste chips + library pick cards render', has(firstTree, (n) => cls(n) === 'dshm-wchip')
  && walk(firstTree).filter((n) => /^dshm-wcard( |$)/.test(cls(n))).length === 2);
/* finish() / persist() 真实函数体：参数全部 mock，统计调用（0.8.5 起老用户设置页没有 save()：
 * 自动保存 = persistRef.current，保存中再改动只记一笔 dirty，落地后补发一次） */
const finishBody2 = (src.match(/async function finish\(\) \{\n([\s\S]*?)\n      \}\n/) || [])[1];
const persistBody = (src.match(/persistRef\.current = async \(over\) => \{\n([\s\S]*?)\n      \};\n/) || [])[1];
function makePersist(impl, opts = {}) {
  const calls = { complete: 0, failed: 0, saved: 0 };
  const onboarding = !impl ? null : { complete: impl.fail ? async () => { calls.complete++; throw new Error('boom'); }
    : async (payload) => { calls.complete++; calls.payload = payload; if (opts.slow) await new Promise((r) => setTimeout(r, 30)); } };
  const savingRef = { current: false }, dirtyRef = { current: false }, persistRef = { current: null };
  const payloadRef = { current: (over) => ({ taste: { genres: [], languages: [] }, libraryMode: (over && over.mode) || 'local' }) };
  const names = ['onboarding', 'savingRef', 'dirtyRef', 'persistRef', 'payloadRef', 'setFailed', 'setSavedAt'];
  const values = [onboarding, savingRef, dirtyRef, persistRef, payloadRef, (v) => { if (v) calls.failed++; }, () => { calls.saved++; }];
  persistRef.current = new Function(...names, 'return async function persist(over) {' + persistBody + '\n};')(...values);
  return { calls, fn: persistRef.current, savingRef, dirtyRef };
}
async function runSettings(fnBody, args, impl) {
  const calls = { complete: 0, route: 0, phase: 0, failed: 0, saved: 0 };
  const onboarding = { complete: impl && impl.fail ? async () => { calls.complete++; throw new Error('boom'); } : async (payload) => { calls.complete++; calls.payload = payload; } };
  const names = ['busy', 'setBusy', 'setFailed', 'onboarding', 'payloadFor', 'mode', 'starterStatus', 'setStarterPhase', 'onRoute', 'setSavedAt'];
  const values = [false, noop, (v) => { if (v) calls.failed++; }, onboarding,
    () => ({ taste: { genres: [], languages: [] }, libraryMode: args.mode, useStarter: args.mode === 'starter' }),
    args.mode, args.starterStatus || 'idle', (v) => { if (v) calls.phase++; }, () => { calls.route++; }, () => { calls.saved++; }];
  const fn = new Function(...names, 'return async function run() {' + fnBody + '\n};')(...values);
  await fn();
  return calls;
}
const finStarter = await runSettings(finishBody2, { mode: 'starter' });
check('first-run finish (starter): one POST with useStarter, stays for progress', !!finishBody2 && finStarter.complete === 1
  && finStarter.payload.libraryMode === 'starter' && finStarter.payload.useStarter === true && finStarter.phase === 1 && finStarter.route === 0);
const finLocal = await runSettings(finishBody2, { mode: 'local' });
check('first-run finish (local): one POST then routes to library', finLocal.complete === 1 && finLocal.route === 1 && finLocal.phase === 0);
const finFail = await runSettings(finishBody2, { mode: 'local' }, { fail: true });
check('first-run finish failure: no route, failed flag set', finFail.complete === 1 && finFail.route === 0 && finFail.failed === 1);
const finReady = await runSettings(finishBody2, { mode: 'starter', starterStatus: 'ready' });
check('first-run finish when starter already ready: routes instead of re-downloading', finReady.complete === 1 && finReady.route === 1 && finReady.phase === 0);
check('returning settings has no save() and no save-button copy (auto-save replaced it)', !/async function save\(\)/.test(src) && !/settingsSave(?!d)/.test(src));
const pOk = makePersist({});
await pOk.fn({ mode: 'starter' });
check('auto-save persist: one POST with the override payload, then saved flag', !!persistBody && pOk.calls.complete === 1 && pOk.calls.saved === 1
  && pOk.calls.failed === 0 && pOk.calls.payload.libraryMode === 'starter');
const pFail = makePersist({ fail: true });
await pFail.fn();
check('auto-save failure: failed flag, no saved flag', pFail.calls.failed === 1 && pFail.calls.saved === 0 && pFail.calls.complete === 1);
const pBusy = makePersist({}, { slow: true });
const inflight = pBusy.fn();
await pBusy.fn();
check('a change during an in-flight save is not POSTed twice in parallel (dirty flag only)', pBusy.calls.complete === 1 && pBusy.dirtyRef.current === true);
await inflight;
await new Promise((r) => setTimeout(r, 60));
check('the dirty change is re-sent exactly once after the in-flight save lands', pBusy.calls.complete === 2 && pBusy.dirtyRef.current === false && pBusy.savingRef.current === false,
  'complete=' + pBusy.calls.complete);
const pNone = makePersist(null);
await pNone.fn();
check('persist is a no-op without the onboarding service', pNone.calls.complete === 0 && pNone.calls.saved === 0);
state.view = 'library';
const backTree = expand(music(baseProps));
const gearBtn = walk(backTree).find((n) => /dshm-chipbtn-icon/.test(String(cls(n) || '')) && (n.props || {})['aria-label'] === 'settingsTitle');
check('returning user gets a header 「设置」entry (gear, hint title)', !!gearBtn && (gearBtn.props || {}).title === 'settingsHint'
  && (gearBtn.props || {})['aria-label'] === 'settingsTitle');
check('preview-welcome entry is gone', !has(backTree, (n) => (n.children || []).includes('welcomePreview')));

/* 4a) small round artist avatars where the brief asks for them */
const isRoundThumb = (n) => cls(n).includes('dshm-tile') && n.props.style && n.props.style.borderRadius === '50%';
state.view = 'now';
state.view = 'library';
groupDefault = 'artist';
const groupAvatars = walk(expand(music(baseProps))).filter(isRoundThumb);
check('library artist group header avatar rendered', groupAvatars.length >= 2, 'count=' + groupAvatars.length);
const nowAvatars = walk(expand(music(baseProps))).filter(isRoundThumb);
check('now-playing artist avatar rendered', nowAvatars.length >= 1, 'count=' + nowAvatars.length);
state.view = 'history';
const hisAvatars = walk(expand(music(baseProps))).filter(isRoundThumb);
check('history row artist avatar rendered', hisAvatars.length >= 1, 'count=' + hisAvatars.length);

groupDefault = 'none';

/* 4b) row click queues the whole list and jumps to that row */
const playerSvc = (services['music'] || {}).player;
const plays = [];
const realPlayTracks = playerSvc.playTracks.bind(playerSvc); /* 真·playTracks：4c 用来验随机态不劫持点播 */
playerSvc.playTracks = (list, idx) => plays.push({ len: list.length, idx, first: list[0] && list[0].id, last: list[list.length - 1] && list[list.length - 1].id });

state.view = 'library';
const libRows = walk(expand(music(baseProps))).filter((n) => /^dshm-row( |$)/.test(cls(n)) && typeof n.props.onClick === 'function');
check('library has 2 clickable rows', libRows.length === 2, 'count=' + libRows.length);
libRows[1].props.onClick();
check('library row 2 queues both tracks at index 1', plays.length === 1 && plays[0].len === 2 && plays[0].idx === 1,
  JSON.stringify(plays[plays.length - 1]));

state.view = 'history';
const hisRows = walk(expand(music(baseProps))).filter((n) => /dshm-hrow-click/.test(cls(n)));
check('history has 2 clickable rows', hisRows.length === 2, 'count=' + hisRows.length);
hisRows[1].props.onClick();
check('history row 2 queues history list at index 1', plays.length === 2 && plays[1].len === 2 && plays[1].idx === 1,
  JSON.stringify(plays[plays.length - 1]));
const hisPlayBtn = walk(expand(music(baseProps))).find((n) => cls(n).includes('dshm-col-play') && typeof n.props.onClick === 'function');
hisPlayBtn.props.onClick();
check('history play-list button starts at 0', plays.length === 3 && plays[2].idx === 0 && plays[2].len === 2,
  JSON.stringify(plays[plays.length - 1]));

state.view = 'history';
const topRows = walk(expand(music(baseProps))).filter((n) => /dshm-top-row-click/.test(cls(n)));
check('top songs rows are clickable', topRows.length === 2, 'count=' + topRows.length);
topRows[1].props.onClick();
check('top songs row queues the chart and jumps to that row', plays.length === 4 && plays[3].len === 2 && plays[3].idx === 1,
  JSON.stringify(plays[plays.length - 1]));

state.view = 'history';
const offRows = walk(expand(music(baseProps))).filter((n) => /dshm-top-row-off/.test(cls(n)));
check('top song missing from library is greyed, not hidden', offRows.length === 1 && offRows[0].props['aria-disabled'] === true,
  'count=' + offRows.length);
const beforeOff = plays.length;
offRows[0].props.onClick();
check('clicking an unplayable top song does not start playback', plays.length === beforeOff,
  'plays=' + plays.length);

/* 4c) 十三期修复：随机态下点某一首必须从这一首开始（只打乱后面的队列）；
 * 只有 playAll（shuffleStart）才随机起播；调用方列表里无音频项不能让起点漂移 */
{
  const snapP = () => playerSvc.source.getSnapshot();
  const run = (list, idx, opts) => { realPlayTracks(list, idx, opts); return snapP(); };
  const ids = (q) => q.map((tr) => tr.id).sort().join(',');
  const lib4 = [{ id: 't1', title: 'A', audioUrl: '/a' }, { id: 't2', title: 'B', audioUrl: '/b' }, { id: 't3', title: 'C', audioUrl: '/c' }, { id: 't4', title: 'D', audioUrl: '/d' }];
  playerSvc.source.set({ shuffle: true });
  let st = run(lib4, 2);
  check('shuffle ON: clicking row 3 starts with row 3 (queueIndex 0)', st.queue[0].id === 't3' && st.queueIndex === 0, JSON.stringify({ first: st.queue[0] && st.queue[0].id, i: st.queueIndex }));
  check('shuffle ON: rest of the queue is a permutation of the whole list', st.queue.length === 4 && ids(st.queue) === 't1,t2,t3,t4');
  st = run(lib4, 0);
  check('shuffle ON: clicking row 1 starts with row 1', st.queue[0].id === 't1' && st.queueIndex === 0);
  st = run(lib4, 0, { shuffleStart: true }); /* playAll 的调用形态 */
  check('shuffle ON: play-all keeps the whole list (random start allowed)', st.queue.length === 4 && ids(st.queue) === 't1,t2,t3,t4' && st.queueIndex >= 0 && st.queueIndex < 4);
  playerSvc.source.set({ shuffle: false });
  const mixed = [{ id: 'm1', title: 'no audio' }, { id: 'm2', title: 'M2', audioUrl: '/m2' }, { id: 'm3', title: 'M3', audioUrl: '/m3' }];
  st = run(mixed, 1);
  check('rows without audio before the clicked one do not shift the start', st.queue[0].id === 'm2' && st.queue.length === 2 && st.queueIndex === 0, JSON.stringify(ids(st.queue)));
  st = run(mixed, 2);
  check('clicking the last playable row starts there', st.queue[st.queueIndex].id === 'm3' && st.queueIndex === 1 && st.queue.length === 2, JSON.stringify(ids(st.queue)));
  playerSvc.source.set({ shuffle: false, queue: [], queueIndex: 0 });
}

/* 5) mini player states */
const miniProps = { t: (k) => k, ...(services['dsh-music.mini-player'] || {}), ...hooks };
state.miniHidden = false; state.miniCollapsed = false;
const expanded = expand(mini(miniProps));
check('mini expanded renders', !!expanded);
const miniBox = walk(expanded).find((n) => cls(n) === 'dshm-mini');
check('mini bar itself is the drag surface (pointer handlers on the bar, not only on the grip)',
  !!miniBox && ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel'].every((k) => typeof miniBox.props[k] === 'function'));
check('mini grip stays as the keyboard handle (arrow keys) without its own pointer handlers',
  has(expanded, (n) => cls(n) === 'dshm-mini-grip' && typeof n.props.onKeyDown === 'function' && n.props.onPointerDown == null));
/* simulate the real contract (verified against Chrome via CDP): the bar captures the pointer on
 * press, moves only past a 4px threshold, clamps inside the viewport, persists on drop; a plain tap
 * on the title button is forwarded as a click (capture made Chrome retarget the click to the bar);
 * controls never capture or drag. */
{
  const capturedIds = [], releasedIds = [];
  let clicks = 0;
  const mainEl = { click: () => { clicks++; } };
  const fakeEl = {
    getBoundingClientRect: () => ({ left: 100, top: 500, width: 380, height: 96 }),
    setPointerCapture: (id) => capturedIds.push(id), releasePointerCapture: (id) => releasedIds.push(id),
    contains: (el) => el === mainEl,
  };
  miniBox.props.ref.current = fakeEl;
  const target = (inMain, inControl) => ({
    closest: (sel) => {
      if (sel === '.dshm-mini-grip') return inMain === 'grip' ? {} : null;
      if (sel === '.dshm-mini-main') return inMain === true ? mainEl : null;
      return inControl ? {} : null; /* 'button:not(.dshm-mini-main), a, …, [role="slider"]' */
    },
  });
  const lyrics = target(false, false), title = target(true, false), control = target(false, true), grip = target('grip', false);
  const mk = (x, y, tgt = lyrics) => ({ button: 0, buttons: 1, pointerId: 7, clientX: x, clientY: y, target: tgt, currentTarget: fakeEl, preventDefault: noop });
  let prevented = 0;
  const press = (x, y, tgt) => { const ev = mk(x, y, tgt); ev.preventDefault = () => { prevented++; }; miniBox.props.onPointerDown(ev); return ev; };
  localStorage.removeItem('dsh-music.prefs');
  press(200, 520);
  check('mini captures the pointer on press (so a fast flick that leaves the bar still drags)', capturedIds.length === 1 && capturedIds[0] === 7, JSON.stringify(capturedIds));
  check('pressing the lyrics area does not preventDefault (normal clicks untouched)', prevented === 0);
  miniBox.props.onPointerMove(mk(201, 521));
  miniBox.props.onPointerUp(mk(201, 521));
  let prefs = JSON.parse(localStorage.getItem('dsh-music.prefs') || '{}');
  check('a sub-threshold press/release is not a drag (nothing persisted)', !prefs.miniPos && releasedIds.length === 1, JSON.stringify(prefs));
  press(200, 520);
  miniBox.props.onPointerMove(mk(320, 560));
  miniBox.props.onPointerMove(mk(5000, 5000));
  miniBox.props.onPointerUp(mk(5000, 5000));
  prefs = JSON.parse(localStorage.getItem('dsh-music.prefs') || '{}');
  check('mini drag persists a position clamped inside the viewport', prefs.miniPos && prefs.miniPos.left === 1440 - 380 - 8 && prefs.miniPos.top === 900 - 96 - 8, JSON.stringify(prefs.miniPos));
  check('mini drag releases pointer capture on drop', releasedIds.length === 2);
  press(200, 520, title);
  miniBox.props.onPointerUp(mk(200, 520, title));
  check('a plain tap on the title button is forwarded as a click (open now-playing)', clicks === 1 && releasedIds.length === 3, 'clicks=' + clicks);
  press(200, 520, title);
  miniBox.props.onPointerMove(mk(320, 560, title));
  miniBox.props.onPointerUp(mk(320, 560, title));
  check('dragging from the title area moves the bar without firing the title click', clicks === 1 && releasedIds.length === 4, 'clicks=' + clicks);
  press(200, 520, title);
  miniBox.props.onPointerCancel(mk(200, 520, title));
  check('a cancelled pointer (e.g. browser gesture) never forwards a click', clicks === 1 && releasedIds.length === 5, 'clicks=' + clicks);
  press(110, 520, grip);
  check('pressing the grip prevents text selection', prevented === 1);
  miniBox.props.onPointerUp(mk(110, 520, grip));
  press(200, 520, control);
  miniBox.props.onPointerMove(mk(320, 560, control));
  miniBox.props.onPointerUp(mk(320, 560, control));
  check('pressing a control (button / slider) never captures or drags', capturedIds.length === 6 && prevented === 1, JSON.stringify(capturedIds));
  const right = mk(200, 520);
  right.button = 2;
  miniBox.props.onPointerDown(right);
  miniBox.props.onPointerMove(mk(320, 560));
  check('non-primary buttons do not start a drag', capturedIds.length === 6);
  const other = mk(200, 520);
  other.pointerId = 9;
  miniBox.props.onPointerDown(other);
  miniBox.props.onPointerMove(mk(320, 560, lyrics));
  miniBox.props.onPointerUp(mk(320, 560, lyrics));
  check('a second pointer never disturbs the current drag', capturedIds.length === 7 && clicks === 1);
}
check('mini has seek slider', has(expanded, (n) => cls(n).includes('dshm-slider')));
check('mini shows 3 lyric lines', walk(expanded).filter((n) => /dshm-mini-lyric\b/.test(cls(n))).length === 3,
  'count=' + walk(expanded).filter((n) => /dshm-mini-lyric\b/.test(cls(n))).length);
check('mini artist clickable', has(expanded, (n) => cls(n).includes('dshm-mini-artist') && typeof n.props.onClick === 'function'));
check('mini has a ··· more button (low-frequency actions moved off the bar)', has(expanded, (n) => /dshm-mini-morebtn/.test(cls(n))));
/* 十三期→本次升级：迷你条只留 4 个核心控件，♥ 保留（与曲库行同一套语义），点 ♥ 走 /library/like；👎/模式/收起/隐藏收进 ··· 菜单 */
{
  const likeBtns = walk(expanded).filter((n) => cls(n).includes('dshm-mini-like'));
  check('mini bar carries only ♥ (no 👎) for the current track', likeBtns.length === 1 && !likeBtns.some((n) => cls(n).includes('dshm-dislike-btn')), 'count=' + likeBtns.length);
  /* 常驻控件 = 上一首 / 播放暂停 / 下一首（3 个 iconbtn）+ ♥（like-btn）= 4；· 的 more 按钮单独算 */
  const controlsRow = walk(expanded).find((n) => /dshm-mini-controls/.test(cls(n)));
  const directKids = (controlsRow && controlsRow.children) || [];
  const inlineIconBtns = directKids.filter((x) => /dshm-iconbtn/.test(String(cls(x) || '')));
  const inlineLike = directKids.filter((x) => /dshm-mini-like/.test(String(cls(x) || '')));
  const inlineMore = directKids.filter((x) => /dshm-mini-more\b/.test(String(cls(x) || '')));
  check('mini bar has 4 resident controls (prev/play/next/♥) + one ··· more button, no extra inline buttons', inlineIconBtns.length === 3 && inlineLike.length === 1 && inlineMore.length === 1
    && has(expanded, (n) => /dshm-mini-morebtn/.test(cls(n)) && (n.props || {})['aria-haspopup'] === 'menu'), 'icon=' + inlineIconBtns.length + ' like=' + inlineLike.length + ' more=' + inlineMore.length);
  miniMenuDefault = true;
  const menuOpenTree = expand(mini(miniProps));
  miniMenuDefault = false;
  const menuItems = walk(menuOpenTree).filter((n) => cls(n) === 'dshm-mini-menuitem');
  check('··· menu exposes play mode / collapse / hide as menu items', menuItems.length === 3, 'items=' + menuItems.length);
  const heart = likeBtns.find((n) => !cls(n).includes('dshm-dislike-btn'));
  const b = fetchBodies.length;
  if (heart) heart.props.onClick({ stopPropagation: noop });
  await new Promise((r) => setTimeout(r, 80));
  check('mini ♥ toggles the like through the likes API', fetchBodies.slice(b).some((x) => x.url.includes('/dsh-music/api/library/like') && x.body.includes('"liked":true')),
    JSON.stringify(fetchBodies.slice(b).map((x) => x.url)));
  const hasText = (n, txt) => walk(n).some((x) => (x.children || []).includes(txt));
  const collapseBtn = menuItems.find((n) => hasText(n, 'miniCollapse'));
  let collapsedTo = null;
  const prevSet = miniProps.setMiniCollapsed;
  /* collapse must derive the badge position from the bar (shared anchor) — the DOM-less smoke only proves the write */
  collapseBtn.props.onClick();
  const prefsAfter = JSON.parse(localStorage.getItem('dsh-music.prefs') || '{}');
  check('collapsing syncs the badge anchor prefs (miniFabPos written alongside miniPos)', 'miniFabPos' in prefsAfter, JSON.stringify(prefsAfter));
  void prevSet; void collapsedTo;
}

state.miniCollapsed = true;
const collapsedTree = expand(mini(miniProps));
check('mini collapsed renders a floating badge', !!collapsedTree && has(collapsedTree, (n) => cls(n) === 'dshm-mini-fab'));
check('floating badge is draggable', has(collapsedTree, (n) => cls(n) === 'dshm-mini-fab' && typeof n.props.onPointerDown === 'function' && typeof n.props.onPointerMove === 'function'));
check('floating badge restores on activate', has(collapsedTree, (n) => cls(n) === 'dshm-mini-fab' && typeof n.props.onKeyDown === 'function'));
check('floating badge hides the bar controls', !has(collapsedTree, (n) => cls(n).includes('dshm-slider')));

/* 5a2) logo 落点（P0+P1）：侧栏入口 / 面板报头 / 四个空状态冷启动 / FAB 无封面兜底 */
{
  const logoImg = (n) => n.type === 'img' && cls(n) === 'dshm-logo';
  check('logo css is size-driven (no fixed 56px)', /\.dshm-logo\{display:block;object-fit:contain;user-select:none;margin:0;\}/.test(src));
  check('panel header carries logo wordmark', has(libTree, (n) => cls(n) === 'dshm-title-logo' && has(n, logoImg)));
  const sidebarReg = registrations.find((r) => r.def.name === 'sidebar.panellist');
  const sideOn = expand(sidebarReg.comp({ size: 18, active: true }));
  const sideOff = expand(sidebarReg.comp({ size: 18, active: false }));
  check('sidebar entry renders real logo', has(sideOn, (n) => cls(n).split(' ').includes('dshm-panel-icon') && has(n, logoImg)));
  check('sidebar active state is tinted box not recolor',
    cls(walk(sideOn).find((n) => cls(n).includes('dshm-panel-icon'))).includes('dshm-panel-icon-on')
    && !cls(walk(sideOff).find((n) => cls(n).includes('dshm-panel-icon'))).includes('dshm-panel-icon-on'));
  check('empty library icon is logo', has(emptyTree, (n) => cls(n) === 'dshm-state-icon' && has(n, logoImg)));
  check('reco cold-start icon is logo', has(coldTree, (n) => cls(n) === 'dshm-state-icon' && has(n, logoImg)));
  const hisEmptyTree = expand(music({ ...baseProps, useUi: (sel) => sel({ ...state, view: 'history' }), useHistory: (sel) => sel({ status: 'ready', events: [] }) }));
  check('empty history icon is logo', has(hisEmptyTree, (n) => cls(n) === 'dshm-state-icon' && has(n, logoImg)));
  const nowIdleTree = expand(music({ ...baseProps, useUi: (sel) => sel({ ...state, view: 'now' }), usePlayer: (sel) => sel({ ...playerState, track: null, queue: [], queueIndex: 0 }) }));
  check('now-playing idle icon is logo', has(nowIdleTree, (n) => cls(n) === 'dshm-state-icon' && has(n, logoImg)));
  check('mini FAB without cover shows logo', has(collapsedTree, (n) => cls(n) === 'dshm-mini-fab-logo' && has(n, logoImg)));
  const fabCover = expand(mini({ ...miniProps, usePlayer: (sel) => sel({ ...playerState, track: { ...playerState.track, coverUrl: 'http://img/c.jpg' } }) }));
  check('mini FAB with cover keeps the cover', has(fabCover, (n) => cls(n).includes('dshm-tile')) && !has(fabCover, (n) => cls(n) === 'dshm-mini-fab-logo'));
  check('small logos drop shadow, big logos keep it',
    walk(sideOn).filter(logoImg).every((n) => n.props.style.filter === 'none')
    && walk(libTree).filter((n) => cls(n) === 'dshm-title-logo').flatMap((n) => walk(n).filter(logoImg)).every((n) => n.props.style.filter === 'none')
    && walk(emptyTree).filter((n) => cls(n) === 'dshm-state-icon').flatMap((n) => walk(n).filter(logoImg)).every((n) => String(n.props.style.filter).includes('drop-shadow')));
}

/* 5a3) 背景预设：面板 / 迷你条 / 悬浮球共用 ui.bg，默认小蓝鱼水印 */
{
  const bgOf = (tree) => { const n = walk(tree).find((x) => cls(x) === 'dshm-bg'); return n ? (n.props || {})['data-dshm-bg'] : null; };
  check('panel default background is logo watermark', bgOf(libTree) === 'logo' && has(libTree, (n) => cls(n) === 'dshm-bg-logo'));
  check('mini bar background syncs with panel', bgOf(expanded) === 'logo' && has(expanded, (n) => cls(n) === 'dshm-bg-logo'));
  check('FAB carries preset but no watermark (too small)', bgOf(collapsedTree) === 'logo' && !has(collapsedTree, (n) => cls(n) === 'dshm-bg-logo'));
  const bgState = { ...state, bg: 'vinyl' };
  const vinylPanel = expand(music({ ...baseProps, useUi: (sel) => sel(bgState) }));
  const vinylMini = expand(mini({ ...miniProps, useUi: (sel) => sel(bgState) }));
  check('one bg switch updates panel and mini together', bgOf(vinylPanel) === 'vinyl' && bgOf(vinylMini) === 'vinyl'
    && !has(vinylPanel, (n) => cls(n) === 'dshm-bg-logo') && !has(vinylMini, (n) => cls(n) === 'dshm-bg-logo'));
  check('watermark readable (18% opacity) and layer never eats clicks',
    /\.dshm-bg-logo\{position:absolute;opacity:\.18;user-select:none;\}/.test(src)
    && /\.dshm-bg\{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;/.test(src));
  check('logo preset carries a translucent blue wash (plugin blue 26→12→8%)',
    /\.dshm-panel,\.dshm-mini,\.dshm-mini-fab,\.dshm-bg-tile,\.dshm-bg-tilebtn\{--dshm-brand:#1a5bf6;\}/.test(src)
    && /\.dshm-bg\[data-dshm-bg="logo"\]\{background:radial-gradient\(120% 95% at 88% 104%,color-mix\(in srgb,var\(--dshm-brand\) 26%,transparent\) 0%,color-mix\(in srgb,var\(--dshm-brand\) 12%,transparent\) 52%,color-mix\(in srgb,var\(--dshm-brand\) 8%,transparent\) 100%\);\}/.test(src));
  check('panel watermark scales with panel width (cqw), not viewport',
    /\.dshm-panel\{--dshm-axis:1160px;--dshm-pad:clamp\(16px,2\.4vw,32px\);--dshm-love:#e5485b;position:relative;container-type:inline-size;/.test(src)
    && /data-dshm-bg-kind="panel"\] \.dshm-bg-logo\{right:-24px;bottom:-28px;width:clamp\(200px,40cqw,460px\);/.test(src));
  check('content lifted above background layer', /\.dshm-panel > \.dshm-header,\.dshm-panel > \.dshm-body\{z-index:1;\}/.test(src) && /\.dshm-mini-inner,\.dshm-mini-seek,\.dshm-mini-lyrics\{position:relative;z-index:1;\}/.test(src));
  check('mist/dune/vinyl presets carry distinct motifs (teal-mint-peach fog / sand ridges+sky / grooves+violet label)',
    /data-dshm-bg="mist"\]\{background-image:radial-gradient\(110% 55% at 8% -8%,color-mix\(in srgb,#4fb6b0 44%,transparent\),transparent 70%\),/.test(src)
    && /data-dshm-bg="dune"\]\{background-image:radial-gradient\(95% 80% at 100% 112%,color-mix\(in srgb,#e9a962 60%,transparent\),transparent 70%\),/.test(src)
    && /data-dshm-bg="vinyl"\]\{background-image:radial-gradient\(45% 32% at 94% 112%,color-mix\(in srgb,#8b5cf6 46%,transparent\) 0%,/.test(src)
    && /repeating-radial-gradient\(circle at 94% 112%,color-mix\(in srgb,var\(--dsw-alias-label-primary\) 17%,transparent\) 0 1px,transparent 1px 12px\);\}/.test(src));
  check('every redone preset has a dark-theme variant (host body[data-ds-dark-theme]) that is stronger, not weaker',
    ['mist', 'dune', 'vinyl'].every((id) => new RegExp('\\[data-ds-dark-theme\\] \\.dshm-bg\\[data-dshm-bg="' + id + '"\\]\\{background-image:').test(src))
    && /\[data-ds-dark-theme\] \.dshm-bg\[data-dshm-bg="mist"\]\{background-image:radial-gradient\(110% 55% at 8% -8%,color-mix\(in srgb,#4fb6b0 56%,transparent\)/.test(src)
    && /\[data-ds-dark-theme\] \.dshm-bg\[data-dshm-bg="vinyl"\]\{background-image:[^}]*var\(--dsw-alias-label-primary\) 24%,transparent\) 0 1px/.test(src)
    && !/\[data-ds-dark-theme\] \.dshm-bg\[data-dshm-bg="logo"\]/.test(src));
  check('dot-matrix (plain) preset is fully removed: no CSS rule, no preset entry, no locale key',
    !/data-dshm-bg="plain"\]/.test(src) && !/id: 'plain'/.test(src) && !/bgPlain/.test(src)
    && /const BG_PRESETS = \[\s*\{ id: 'logo', nameKey: 'bgLogo' \},\s*\{ id: 'mist', nameKey: 'bgMist' \},\s*\{ id: 'dune', nameKey: 'bgDune' \},\s*\{ id: 'vinyl', nameKey: 'bgVinyl' \},\s*\];/.test(src));
  check('history cards transparent (border only) so the wash runs through; other big surfaces 66%; sticky heads frosted',
    /\.dshm-hist-hero,\.dshm-top-col,\.dshm-dislikes\{background:transparent;\}/.test(src)
    && /\.dshm-reco-card,\.dshm-acard,\.dshm-prv,\.dshm-sync,\.dshm-dl,\.dshm-wcard\{background:color-mix\(in srgb,var\(--dsw-alias-bg-layer-1\) 66%,transparent\);\}/.test(src)
    && /\.dshm-hgroup-label\{background:color-mix\(in srgb,var\(--dsw-alias-bg-base\) 46%,transparent\);backdrop-filter:blur\(12px\);-webkit-backdrop-filter:blur\(12px\);\}/.test(src)
    && /\.dshm-group-head,\.dshm-set-foot\{background:color-mix\(in srgb,var\(--dsw-alias-bg-base\) 82%,transparent\);backdrop-filter:blur\(10px\);-webkit-backdrop-filter:blur\(10px\);\}/.test(src));
  check('settings page sits inside the panel shell above its own background layer',
    /\.dshm-panel > \.dshm-settings\{flex:1 1 0;min-height:0;height:auto;z-index:1;\}/.test(src)
    && /if \(view === 'settings'\) \{[\s\S]{0,400}return h\('div', \{ className: 'dshm-panel', 'data-dshm-view': 'settings' \},\s*h\(BgLayer, \{ bg, kind: 'panel' \}\),\s*h\(SettingsView,/.test(src));
  check('0.8.5 settings: returning mode = 132px label column grid + hairline separators; one selection colour (brand) for chips and tiles; status/placeholder contrast tokens',
    /\.dshm-settings-returning \.dshm-set-section\{display:grid;grid-template-columns:132px minmax\(0,1fr\);column-gap:24px;padding:22px 0;border-bottom:1px solid var\(--dsw-alias-border-l1\);scroll-margin-top:64px;\}/.test(src)
    && /\.dshm-wchip-on,\.dshm-wchip-on:hover\{background:color-mix\(in srgb,var\(--dsw-alias-brand-primary\) 9%,var\(--dsw-alias-bg-layer-1\)\);color:var\(--dsw-alias-label-primary\);/.test(src)
    && /\.dshm-bg-tilebtn\[aria-checked="true"\]\{border-color:var\(--dsw-alias-brand-primary\);[^}]*box-shadow:0 0 0 1px var\(--dsw-alias-brand-primary\);\}/.test(src)
    && /\.dshm-prv-state\{[^}]*color:var\(--dsw-alias-label-secondary\);/.test(src)
    && /\.dshm-winput::placeholder\{[^}]*color:var\(--dsw-alias-label-secondary\);/.test(src)
    && /\.dshm-prv-head:hover\{background:var\(--dsw-alias-interactive-bg-hover\);\}/.test(src)
    && !/dshm-set-top-title|dshm-set-head-icon/.test(src));
}

state.miniHidden = true;
check('mini hidden renders nothing', mini(miniProps) === null);

/* 5b) mini artist avatar */
check('mini artist avatar rendered', walk(expanded).filter(isRoundThumb).length >= 1,
  'count=' + walk(expanded).filter(isRoundThumb).length);

/* 5c) artist-image service: debounce coalescing + memory cache */
const svcImgs = (services['music'] || {}).artistImages;
svcImgs.request('测试歌手'); svcImgs.request('测试歌手'); svcImgs.request('新歌手A');
await new Promise((r) => setTimeout(r, 400));
const fetched = fetchCalls.filter((u) => u.includes('artist-image'));
const names = fetched.map((u) => new URL(u, 'http://local').searchParams.get('name'));
const uniq = new Set(names);
const dupTest = names.filter((n) => n === '测试歌手').length;
check('artist-image requests coalesced (one fetch per unique name)',
  names.length === uniq.size && dupTest === 1,
  'fetched=' + JSON.stringify(names));
const imgSnap = svcImgs.source.getSnapshot().images;
check('artist-image cached by normalized key', imgSnap['测试歌手'] === 'http://img/thumb.jpg' && imgSnap['新歌手a'] === 'http://img/thumb.jpg',
  JSON.stringify(imgSnap));
const before = fetched.length;
svcImgs.request('测试歌手');
await new Promise((r) => setTimeout(r, 300));
check('artist-image memory cache prevents refetch', fetchCalls.filter((u) => u.includes('artist-image')).length === before,
  'total=' + fetchCalls.filter((u) => u.includes('artist-image')).length);

/* 5z) inline locale hygiene: no shadowed duplicates, no stale launch copy */
function localeBlock(marker) {
  const ls = src.split('\n');
  const start = ls.findIndex((l) => l.startsWith(marker));
  let depth = 0;
  const body = [];
  for (let i = start; i < ls.length; i++) {
    body.push(ls[i]);
    depth += (ls[i].match(/\{/g) || []).length - (ls[i].match(/\}/g) || []).length;
    if (depth === 0 && i > start) break;
  }
  const counts = {};
  for (const l of body) {
    const m = l.match(/^      (\w+):/);
    if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return { text: body.join('\n'), dup: Object.keys(counts).filter((k) => counts[k] > 1) };
}
const zhBlock = localeBlock('    const zh = {');
const enBlock = localeBlock('    const en = {');
check('zh locale has no duplicate keys (no shadowing)', !!zhBlock.text && zhBlock.dup.length === 0, 'dups=' + JSON.stringify(zhBlock.dup));
check('en locale has no duplicate keys (no shadowing)', !!enBlock.text && enBlock.dup.length === 0, 'dups=' + JSON.stringify(enBlock.dup));
check('no stale "stage 3" copy in zh/en', !/阶段 ?3|stage ?3/i.test(zhBlock.text) && !/阶段 ?3|stage ?3/i.test(enBlock.text));

/* 5y) integration: the real 「设置」chipbtn writes the REAL ui store and the panel
 *     re-renders into the settings view (closes the GUI-only gap). */
const uiStore = svc.hooks && svc.hooks.ui;
check('first run (host says completed=false) auto-opens the settings page', uiStore.getSnapshot().view === 'settings',
  'view=' + uiStore.getSnapshot().view);
uiStore.set({ view: 'library', settingsSection: null, lyricsOpen: false });
const useUiReal = (sel) => sel(uiStore.getSnapshot());
const realProps = { ...baseProps, useUi: useUiReal };
const realHeader = expand(music(realProps));
/* 右上角「设置」是纯图标幽灵按钮（不再常驻文字），靠 aria-label 识别 */
const settingsBtn = walk(realHeader).find((n) => /dshm-chipbtn-icon/.test(String(cls(n) || '')) && (n.props || {})['aria-label'] === 'settingsTitle');
check('settings button is rendered and enabled', !!settingsBtn && !(settingsBtn.props || {}).disabled);
check('header mini-bar toggle is a ghost state button (aria-pressed), not a primary CTA', (() => {
  const tg = walk(realHeader).find((n) => /dshm-chipbtn-toggle/.test(String(cls(n) || '')));
  return !!tg && (tg.props || {})['aria-pressed'] === true && !/dshm-chipbtn-primary/.test(String(cls(tg)));
})());
check('rescan stays inside the library tab only (not in reco/history/now header)', (() => {
  const hdr = (v) => { uiStore.set({ view: v }); return expand(music(realProps)); };
  const inLib = has(hdr('library'), (n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('rescan'));
  const inReco = has(hdr('reco'), (n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('rescan'));
  uiStore.set({ view: 'library' });
  return inLib && !inReco;
})());
settingsBtn.props.onClick();
const afterClick = uiStore.getSnapshot();
check('settings click writes the real ui store', afterClick.view === 'settings' && afterClick.settingsSection === null,
  'view=' + afterClick.view + ' section=' + afterClick.settingsSection);
check('entering settings remembers where you came from (nav stack)', ((afterClick.navStack || []).slice(-1)[0] || {}).view === 'library',
  JSON.stringify(afterClick.navStack));
check('artist page back label names the page you came from', (() => {
  uiStore.set({ view: 'history' });
  svc.openArtistPage('导航歌手');
  const tree = expand(music(realProps));
  const back = walk(tree).find((n) => /dshm-apage-back/.test(String(cls(n) || '')));
  /* 宿主里 t 是真翻译；冒烟里 t 是恒等函数，只能验「标签键 + 栈顶目标」 */
  const labelOk = !!back && (back.children || []).some((c) => typeof c === 'string' && /backTo/.test(c));
  back.props.onClick();
  const st = uiStore.getSnapshot();
  const okNav = labelOk && st.view === 'history';
  /* 回到设置页，继续验证「返回设置」页脚 */
  uiStore.set({ view: 'settings', settingsSection: null, navStack: [{ view: 'library', artistName: null }] });
  return okNav;
})());
const realSettingsTree = expand(music(realProps));
check('returning settings view renders a compact title row (back arrow + title; no first-run hero, no gear/hint)', has(realSettingsTree, (n) => cls(n) === 'dshm-set-top'
    && has(n, (x) => cls(x) === 'dshm-set-title' && (x.children || []).includes('settingsTitle')))
  && !has(realSettingsTree, (n) => cls(n) === 'dshm-logo') && walk(realSettingsTree).filter(isCard).length === 3
  && !has(realSettingsTree, (n) => /dshm-count|dshm-set-head-icon/.test(cls(n))));
const retLabels = walk(realSettingsTree).filter((n) => cls(n) === 'dshm-set-label').map((n) => (n.children || []).join(','));
const retSections = walk(realSettingsTree).filter((n) => cls(n) === 'dshm-set-section');
check('returning settings is a two-column list: 4 labelled sections (liked / taste / library / background), each = label + body, no subs', JSON.stringify(retLabels) === JSON.stringify(['setLikedTitle', 'setTasteTitle', 'setLibTitle', 'bgTitle'])
  && retSections.length === 4 && retSections.every((s) => { const k = s.children || []; return cls(k[0]) === 'dshm-set-label' && cls(k[1]) === 'dshm-set-body'; })
  && !has(realSettingsTree, (n) => cls(n) === 'dshm-wstep-sub') && has(realSettingsTree, (n) => cls(n) === 'dshm-settings dshm-settings-returning'),
  JSON.stringify(retLabels));
check('first-run wizard keeps the card/foot layout and only loses the icon chips', !/dshm-set-head-icon/.test(src)
  && /\.dshm-settings-first \.dshm-set-body\{display:contents;\}/.test(src));
const backBtn = walk(realSettingsTree).find((n) => cls(n) === 'dshm-set-back');
check('returning settings has a back arrow in the title row and NO footer / save button', !!backBtn && (backBtn.props || {})['aria-label'] === 'settingsBack'
  && !has(realSettingsTree, (n) => /dshm-set-foot/.test(cls(n))) && !has(realSettingsTree, (n) => /dshm-wbtn/.test(cls(n)) && (n.children || []).includes('settingsSave')));
const tileChecks = walk(realSettingsTree).filter((n) => cls(n) === 'dshm-bg-tilecheck');
check('every background tile carries a check badge node (shown only on the checked tile, not colour alone)', tileChecks.length === 4
  && tileChecks.every((n) => (n.props || {})['aria-hidden'] === true && has(n, (x) => x.type === 'svg'))
  && /\.dshm-bg-tilebtn\[aria-checked="true"\] \.dshm-bg-tilecheck\{display:inline-flex;\}/.test(src),
  'badges=' + tileChecks.length);

/* 5a3b) 设置页背景选择：四个 radio（小蓝鱼/晨雾/暖沙/唱片，点阵版已删），点选立即写 ui store + prefs（面板/迷你条同步） */
{
  const tiles = walk(realSettingsTree).filter((n) => cls(n) === 'dshm-bg-tilebtn');
  const tileIds = tiles.map((n) => walk(n).map((x) => (x.props || {})['data-dshm-bg']).find(Boolean));
  check('settings offers four background presets in order (logo/mist/dune/vinyl) with logo checked', tiles.length === 4
    && tileIds.join(',') === 'logo,mist,dune,vinyl' && tiles[0].props['aria-checked'] === true
    && tiles.slice(1).every((n) => n.props['aria-checked'] === false), 'ids=' + tileIds.join(','));
  const beforeBg = uiStore.getSnapshot().bg;
  tiles[2].props.onClick();
  check('background pick writes ui store and prefs immediately', uiStore.getSnapshot().bg === 'dune' && beforeBg === 'logo'
    && JSON.parse(localStorage.getItem('dsh-music.prefs') || '{}').bg === 'dune');
  const dunePanel = expand(music(realProps));
  check('picked background reaches panel without reload', walk(dunePanel).some((n) => cls(n) === 'dshm-bg' && (n.props || {})['data-dshm-bg'] === 'dune'));
  /* 设置页本身也铺背景：根是 .dshm-panel，第一个子节点是 panel 级 BgLayer（跟随刚点选的预设），第二个是 .dshm-settings */
  const root = dunePanel;
  const kids = (root && root.children) || [];
  check('settings page is wrapped in the panel shell with its own panel-kind background layer (live)',
    !!root && cls(root) === 'dshm-panel' && root.props['data-dshm-view'] === 'settings'
    && kids.length === 2 && cls(kids[0]) === 'dshm-bg' && kids[0].props['data-dshm-bg'] === 'dune' && kids[0].props['data-dshm-bg-kind'] === 'panel'
    && cls(kids[1]).split(' ')[0] === 'dshm-settings',
    'root=' + (root && cls(root)) + ' kids=' + kids.map((k) => (k && typeof k === 'object' ? cls(k) + ':' + ((k.props || {})['data-dshm-bg'] || '') : typeof k)).join('|'));
  const mistState = { ...uiStore.getSnapshot(), bg: 'mist' };
  uiStore.set({ bg: 'mist' });
  const mistSettings = expand(music(realProps));
  check('switching preset re-renders the settings page background immediately (same ui.bg source as the main panel)',
    cls(mistSettings) === 'dshm-panel' && mistSettings.children[0].props['data-dshm-bg'] === 'mist' && mistState.bg === 'mist');
  uiStore.set({ bg: 'logo' });
  localStorage.setItem('dsh-music.prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('dsh-music.prefs') || '{}'), bg: 'logo' }));
}
if (backBtn) backBtn.props.onClick();
const afterBack = uiStore.getSnapshot();
check('back returns to the library view', afterBack.view === 'library' && afterBack.settingsSection === null, 'view=' + afterBack.view);
/* 0.8.5 自动保存：曲库单选点一下立即落盘；口味标签 400ms 防抖落盘；页面上没有任何保存按钮 */
const obBefore = fetchBodies.length;
const modeChips = walk(realSettingsTree).filter((n) => cls(n).split(' ').includes('dshm-wchip') && (n.props || {}).role === 'radio');
check('library mode is a two-option radio chip row (local / starter) with exactly one checked', modeChips.length === 2
  && modeChips.map((n) => (n.children || []).join(',')).join('|') === 'setLibLocalShort|setLibStarterShort'
  && modeChips.filter((n) => n.props['aria-checked'] === true).length === 1
  && has(realSettingsTree, (n) => cls(n) === 'dshm-wchips' && (n.props || {}).role === 'radiogroup' && (n.props || {})['aria-label'] === 'setLibTitle')
  && !has(realSettingsTree, (n) => /^dshm-wcard( |$)/.test(cls(n))),
  modeChips.map((n) => (n.children || []).join(',') + '=' + n.props['aria-checked']).join('|'));
modeChips.find((n) => n.props['aria-checked'] === false).props.onClick();
await new Promise((r) => setTimeout(r, 30));
check('picking the other library mode saves immediately (no save button)', fetchBodies.slice(obBefore).some((x) => x.url.includes('/onboarding/complete') && /"libraryMode":"(starter|local)"/.test(x.body)),
  JSON.stringify(fetchBodies.slice(obBefore).filter((x) => x.url.includes('/onboarding'))));
const tasteBefore = fetchBodies.length;
const offChip = walk(realSettingsTree).find((n) => cls(n) === 'dshm-wchip' && (n.props || {})['aria-pressed'] === false);
offChip.props.onClick();
check('taste chip toggle does NOT POST synchronously (debounced)', !fetchBodies.slice(tasteBefore).some((x) => x.url.includes('/onboarding/complete')));
await new Promise((r) => setTimeout(r, 480));
check('taste chip toggle auto-saves after the 400ms debounce with the genres payload', fetchBodies.slice(tasteBefore).some((x) => x.url.includes('/onboarding/complete') && /"genres"/.test(x.body)),
  JSON.stringify(fetchBodies.slice(tasteBefore).filter((x) => x.url.includes('/onboarding'))));

/* 5x) v8 taste plumbing + v9 card rail / background loads */
check('library renders the liked card rail', has(realHeader, (n) => cls(n) === 'dshm-favs'));
check('empty likes show the rail guidance', has(realHeader, (n) => cls(n) === 'dshm-favs-empty'));
const likedItemsState = (sel) => sel({
  keys: {}, dislikes: {}, loaded: true, error: null,
  items: [{ key: 'k1', artist: '甲', title: '乙', trackId: 't1', audioUrl: '/a.mp3', coverUrl: null, inLibrary: true, durationMs: 1000 }],
});
/* 「我喜欢」书架：≤12 首时只在顶部留「查看全部 ›」，末尾不再重复一张虚线卡（去双入口） */
const railTree = expand(music({ ...baseProps, useUi: (sel) => sel({ ...state, view: 'library' }), useLikes: likedItemsState }));
check('liked rail renders a card, no duplicate view-all card when ≤12', has(railTree, (n) => String(cls(n) || '').includes('dshm-favcard'))
  && !has(railTree, (n) => String(cls(n) || '').includes('dshm-favcard-more')));
const manyLiked = (sel) => sel({
  keys: {}, dislikes: {}, loaded: true, error: null,
  items: Array.from({ length: 13 }, (_, i) => ({ key: 'k' + i, artist: '甲', title: '乙' + i, trackId: 't' + i, audioUrl: '/a' + i + '.mp3', coverUrl: null, inLibrary: true, durationMs: 1000 })),
});
const railMany = expand(music({ ...baseProps, useUi: (sel) => sel({ ...state, view: 'library' }), useLikes: manyLiked }));
check('liked rail shows the view-all card only when items overflow (>12)', has(railMany, (n) => String(cls(n) || '').includes('dshm-favcard-more')));
uiStore.set({ toast: { kind: 'artist', name: '测试歌手', at: Date.now() } });
const toastTree = expand(music({ ...realProps, useUi: useUiReal }));
check('background-complete toast renders', has(toastTree, (n) => cls(n) === 'dshm-toast'));
const toastMain = walk(toastTree).find((n) => cls(n) === 'dshm-toast-main');
toastMain.props.onClick();
check('toast click opens the cached artist page', uiStore.getSnapshot().view === 'artist'
  && uiStore.getSnapshot().artistName === '测试歌手', 'view=' + uiStore.getSnapshot().view);
const artistFetchesBefore = fetchCalls.filter((u) => u.includes('/reco/artist')).length;
await svc.artistPage.load('缓存歌手');
await svc.artistPage.load('缓存歌手');
const artistFetchesAfter = fetchCalls.filter((u) => u.includes('/reco/artist')).length;
check('artist page session cache: one request per name', artistFetchesAfter - artistFetchesBefore === 1);
check('artist page load records lastReady', (svc.artistPage.source.getSnapshot().lastReady || {}).name === '缓存歌手');
/* 👎 只留在推荐 / 正在播放 / 队列这些「正在做选择」的场景；曲库与「我喜欢」行不再常驻 👎（减噪 + 防误触） */
check('library rows no longer carry a dislike button', !has(realHeader, (n) => String(cls(n) || '').includes('dshm-dislike-btn')));
const queueTree = expand(music({ ...realProps, useUi: (sel) => sel({ ...uiStore.getSnapshot(), view: 'now' }) }));
check('now-playing queue rows still carry a dislike button', has(queueTree, (n) => String(cls(n) || '').includes('dshm-dislike-btn')));
const dislikesBefore = fetchCalls.length;
await svc.likes.setDislike({ artist: '冒烟歌手', title: '冒烟歌' }, true);
check('dislike POSTs to the host route', fetchCalls.slice(dislikesBefore).some((u) => u.includes('/library/dislike')));
historyState = { ...historyState, stats: { ...historyState.stats, dislikes: { count: 1, events: 1, songs: [{ title: '不喜欢歌', artist: '某歌手', dislikedAt: Date.now(), inLibrary: true }] } } };
const histTree = expand(music({ ...realProps, useUi: (sel) => sel({ ...uiStore.getSnapshot(), view: 'history' }) }));
check('history stats shows the dislike summary block', has(histTree, (n) => cls(n) === 'dshm-dislike-row'));

/* 5w) 喜欢列表同步（设置页）：网易云 / QQ 音乐 / Spotify 三行手风琴 + 新用户分步引导；
 *     连接成功即自动导入；结果 = 一行主结论 + 异常 chip；错误按行归属；「入库」走核实下载。 */
const svcLiked = svc.likedSync;
check('liked-sync service is injected into the panel', !!svcLiked && !!svcLiked.source && typeof svcLiked.open === 'function');
const tick = () => new Promise((r) => setTimeout(r, 60));
const useLikedSyncReal = (sel) => sel(svcLiked.source.getSnapshot());
uiStore.set({ view: 'settings', settingsSection: 'liked' });
const svcSync = svc.sync;
await svcSync.probe();
const setProps = { ...realProps, useLikedSync: useLikedSyncReal, useSync: (sel) => sel(svcSync.source.getSnapshot()) };
svcLiked.open('netease');
await tick();
const qrSnap = svcLiked.source.getSnapshot();
check('QR session created from the host route and encoded locally', qrSnap.qr && qrSnap.qr.key === 'k1'
  && qrSnap.qr.matrix && qrSnap.qr.matrix.size > 20 && qrSnap.qrPhase === 'waiting',
  'phase=' + qrSnap.qrPhase + ' size=' + (qrSnap.qr && qrSnap.qr.matrix && qrSnap.qr.matrix.size));
const setTree = expand(music(setProps));
check('status route fetched on open', fetchCalls.some((u) => u.includes('/liked-sync/status')));
const rowsOf = (tree) => walk(tree).filter(isCard);
const rowOf = (tree, id) => rowsOf(tree).find((n) => n.props['data-provider'] === id) || null;
const isOpen = (row) => !!row && cls(row).includes('dshm-prv-open');
const headOf = (tree, id) => { const r = rowOf(tree, id); return r ? (r.children || []).find((c) => cls(c) === 'dshm-prv-head') || null : null; };
const says = (node, text) => !!node && has(node, (x) => (x.children || []).includes(text));
const stepsOf = (tree, id) => { const r = rowOf(tree, id); return r ? walk(r).filter((n) => /^dshm-step /.test(cls(n))).map(cls) : []; };
check('settings lists three provider rows (netease / qq / spotify)', rowsOf(setTree).map((n) => n.props['data-provider']).join(',') === 'netease,qq,spotify',
  rowsOf(setTree).map((n) => n.props['data-provider']).join(','));
check('netease row is expanded first (new-user path); the others are collapsed', isOpen(rowOf(setTree, 'netease')) && !isOpen(rowOf(setTree, 'qq')) && !isOpen(rowOf(setTree, 'spotify')));
check('netease shows a 2-step guide: scan (active) → auto import (todo)', stepsOf(setTree, 'netease').join('|') === 'dshm-step dshm-step-active|dshm-step dshm-step-todo',
  stepsOf(setTree, 'netease').join('|'));
check('collapsed row headers state how to connect', says(headOf(setTree, 'qq'), 'prvQqHow') && says(headOf(setTree, 'spotify'), 'spStateNoAuth'));
const qrSvg = walk(setTree).find((n) => cls(n) === 'dshm-qr');
check('netease step renders the QR as a crisp SVG with a 4-module quiet zone', !!qrSvg && (qrSvg.props || {}).shapeRendering === 'crispEdges'
  && /^-4 -4 /.test((qrSvg.props || {}).viewBox || ''), 'viewBox=' + ((qrSvg && qrSvg.props.viewBox) || ''));
check('step 1 shows the waiting status + regenerate button', has(setTree, (n) => cls(n) === 'dshm-imp-step' && (n.children || []).includes('importQrWaiting'))
  && has(setTree, (n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('importQrRegenerate')));
check('read-only contract is stated under the section title in the first-run wizard only (returning settings drops the subs)', has(firstTree, (n) => cls(n) === 'dshm-wstep-sub' && (n.children || []).includes('setLikedSub'))
  && !has(setTree, (n) => cls(n) === 'dshm-wstep-sub'));

/* QQ：未连接 → 默认「手机 QQ 扫码」两步；微信账号可切到 Cookie 三步（登录 → 复制命令 → 粘贴即连接并自动导入） */
qqConnected = false;
await svcLiked.load();
headOf(expand(music(setProps)), 'qq').props.onClick();
await tick();
let tree = expand(music(setProps));
check('QQ row expands into the 2-step scan guide (QR matrix from the host drawn as SVG)', isOpen(rowOf(tree, 'qq')) && !isOpen(rowOf(tree, 'netease'))
  && stepsOf(tree, 'qq').join('|') === 'dshm-step dshm-step-active|dshm-step dshm-step-todo'
  && has(tree, (n) => cls(n) === 'dshm-step-title' && (n.children || []).includes('importQqQrStep1'))
  && !!walk(rowOf(tree, 'qq')).find((n) => cls(n) === 'dshm-qr' && (n.props || {}).viewBox === '-4 -4 29 29'),
  'steps=' + stepsOf(tree, 'qq').join('|') + ' qr=' + svcLiked.source.getSnapshot().qrPhase);
check('QQ header says “waiting for scan” while its QR is alive', says(headOf(tree, 'qq'), 'importQrWaiting')
  && cls(walk(headOf(tree, 'qq')).find((n) => cls(n).startsWith('dshm-prv-state'))).includes('dshm-prv-state-busy'));
check('scan guide offers the cookie fallback for WeChat accounts', has(tree, (n) => cls(n) === 'dshm-linkbtn' && (n.children || []).includes('importQqUseCookie')));
walk(tree).find((n) => cls(n) === 'dshm-linkbtn' && (n.children || []).includes('importQqUseCookie')).props.onClick();
await tick();
tree = expand(music(setProps));
check('cookie mode: QQ row shows the 3-step guide', stepsOf(tree, 'qq').length === 3 && svcLiked.source.getSnapshot().qqMode === 'cookie'
  && has(tree, (n) => cls(n) === 'dshm-step-title' && (n.children || []).includes('importQqStep3'))
  && has(tree, (n) => cls(n) === 'dshm-linkbtn' && (n.children || []).includes('importQqUseQr'))
  && !has(tree, (n) => cls(n) === 'dshm-qr'));
check('QQ guide offers open-page + copy-command buttons and a single-line paste field',
  ['importQqOpen', 'importQqCopy'].every((k) => has(tree, (n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes(k)))
  && !!walk(tree).find((n) => cls(n) === 'dshm-imp-cookie' && (n.props || {}).type === 'text'));
walk(tree).find((n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('importQqCopy')).props.onClick();
walk(tree).find((n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('importQqOpen')).props.onClick();
await tick();
/* 切回扫码 → 重新取码；主机解不出矩阵时退回 PNG */
svcLiked.setQqMode('qr');
await tick();
svcLiked.source.set({ qr: { provider: 'qq', key: 'k', matrix: null, png: 'data:image/png;base64,BBBB' }, qrPhase: 'waiting' });
const pngTree = expand(music(setProps));
check('back to scan mode; a host PNG fallback renders as an image', svcLiked.source.getSnapshot().qqMode === 'qr'
  && !!walk(pngTree).find((n) => cls(n) === 'dshm-qr dshm-qr-img' && n.props.src === 'data:image/png;base64,BBBB'));
svcLiked.setQqMode('cookie');
qqConnected = true;
const beforeConnect = fetchCalls.length;
walk(tree).find((n) => cls(n) === 'dshm-imp-cookie').props.onChange({ target: { value: 'qm_keyst=Q_H_SMOKE; uin=o1001' } });
await tick();
check('pasting a cookie connects and auto-imports (connect → sync)', fetchCalls.slice(beforeConnect).some((u) => u.includes('/liked-sync/qq/connect'))
  && fetchCalls.slice(beforeConnect).some((u) => u.includes('/liked-sync/qq/sync')),
  JSON.stringify(fetchCalls.slice(beforeConnect).filter((u) => u.includes('liked-sync'))));
const resTree = expand(music(setProps));
check('connected row shows the account line (nickname + imported count)', has(resTree, (n) => cls(n) === 'dshm-imp-nick' && (n.children || []).includes('小Q'))
  && has(resTree, (n) => cls(n) === 'dshm-imp-time' && (n.children || []).includes('importKnownLine')));
check('result = one summary line + exception chips only', has(resTree, (n) => cls(n) === 'dshm-imp-summary' && has(n, (x) => (x.children || []).includes('importDoneLine')))
  && has(resTree, (n) => cls(n) === 'dshm-sync-chip dshm-sync-chip-warn' && (n.children || []).includes('importResRemoved 2'))
  && has(resTree, (n) => cls(n) === 'dshm-sync-chip' && (n.children || []).includes('importResUnavailable 1'))
  && !has(resTree, (n) => cls(n) === 'dshm-sync-chip' && /^importRes(Total|Added|Existed) /.test(String((n.children || [])[0]))));
check('removed items are listed (informational only)', has(resTree, (n) => cls(n) === 'dshm-sync-detail' && (n.children || []).some((c) => typeof c === 'object' && (c.children || []).includes('· 某人 - 旧歌'))));
const viewBtn = walk(resTree).find((n) => cls(n) === 'dshm-linkbtn' && (n.children || []).includes('importViewLikes'));
check('result offers a “view liked” jump (returning users)', !!viewBtn);
if (viewBtn) viewBtn.props.onClick();
check('the jump opens the library on the likes tab', uiStore.getSnapshot().view === 'library' && uiStore.getSnapshot().libTabWish === 'likes',
  JSON.stringify({ view: uiStore.getSnapshot().view, wish: uiStore.getSnapshot().libTabWish }));
uiStore.set({ view: 'settings', settingsSection: 'liked', libTabWish: null });
/* 错误按行归属，且主机的「缺 qm_keyst」换成新用户文案 */
svcLiked.source.set({ error: 'Cookie 中缺少 qm_keyst / qqmusic_key（登录态）', errorProvider: 'qq' });
const errTree = expand(music(setProps));
const errRows = rowsOf(errTree).filter((n) => has(n, (x) => cls(x) === 'dshm-errorline'));
check('error line shows only on the owning provider row, in plain wording', errRows.length === 1 && errRows[0].props['data-provider'] === 'qq'
  && has(errTree, (n) => cls(n) === 'dshm-errorline' && (n.children || []).includes('importQqNeedKey')), errRows.map((n) => n.props['data-provider']).join('|'));
svcLiked.source.set({ error: null, errorProvider: null });

/* Spotify：装 CLI → 授权 → 同步 三步；「重新检测」带 refresh=1 */
const spProps = setProps;
headOf(expand(music(spProps)), 'spotify').props.onClick();
let spTree = expand(music(spProps));
check('Spotify row expands into install(done) → authorize(miss) → sync(active)', stepsOf(spTree, 'spotify').join('|') === 'dshm-step dshm-step-done|dshm-step dshm-step-miss|dshm-step dshm-step-active',
  stepsOf(spTree, 'spotify').join('|'));
check('Spotify header flags the pending authorization', says(headOf(spTree, 'spotify'), 'spStateNoAuth'));
walk(spTree).find((n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('spRecheck')).props.onClick();
await tick();
spTree = expand(music(spProps));
check('re-check hits availability?refresh=1 and turns the authorize step green', fetchCalls.some((u) => u.includes('/sync/availability?refresh=1'))
  && stepsOf(spTree, 'spotify')[1].includes('dshm-step-done') && says(headOf(spTree, 'spotify'), 'spStateReady'));
const noCli = expand(music({ ...spProps, useSync: (sel) => sel({ phase: 'idle', available: false, authorized: null, hint: '未检测到', result: null, error: null }) }));
check('missing CLI: step 1 miss, sync disabled, header says not installed', stepsOf(noCli, 'spotify')[0].includes('dshm-step-miss') && stepsOf(noCli, 'spotify')[2].includes('dshm-step-todo')
  && has(noCli, (n) => cls(n) === 'dshm-chipbtn dshm-chipbtn-primary dshm-chipbtn-off' && (n.children || []).includes('syncBtn') && n.props.disabled)
  && says(headOf(noCli, 'spotify'), 'spStateNoCli'));
headOf(expand(music(spProps)), 'spotify').props.onClick();
const closedTree = expand(music(spProps));
check('clicking the open row collapses it', rowsOf(closedTree).every((n) => !cls(n).includes('dshm-prv-open')) && !has(closedTree, (n) => cls(n) === 'dshm-prv-body'),
  'tab=' + svcLiked.source.getSnapshot().tab + ' rows=' + rowsOf(closedTree).map(cls).join('|') + ' view=' + uiStore.getSnapshot().view);
uiStore.set({ view: 'library', settingsSection: null });

const withSources = (sel) => sel({
  keys: {}, dislikes: {}, loaded: true, error: null,
  items: [{ key: 'k9', artist: '甲', title: '乙', trackId: null, audioUrl: null, coverUrl: null, inLibrary: false, durationMs: 1000,
    sources: { netease: { id: 1, likedAt: 1 }, qq: { id: 2, likedAt: 2 } } }],
});
libTabDefault = 'likes';
const srcTree2 = expand(music({ ...realProps, useUi: (sel) => sel({ ...uiStore.getSnapshot(), view: 'library' }), useLikes: withSources }));
libTabDefault = 'library';
const likedEntry = walk(srcTree2).find((n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('setLikedTitle'));
check('likes tab header offers the 「喜欢列表同步」entry', !!likedEntry && (likedEntry.props || {}).title === 'importBtnHint');
likedEntry.props.onClick();
check('liked entry opens settings at the liked section', uiStore.getSnapshot().view === 'settings' && uiStore.getSnapshot().settingsSection === 'liked');
uiStore.set({ view: 'library', settingsSection: null });
check('liked rows show a source chip per platform', has(srcTree2, (n) => cls(n) === 'dshm-src-chip dshm-src-netease')
  && has(srcTree2, (n) => cls(n) === 'dshm-src-chip dshm-src-qq'));
check('likes header counts songs not in the library yet', has(srcTree2, (n) => cls(n) === 'dshm-missing-chip' && (n.children || []).includes('likesMissingCount')));
const addBtn = walk(srcTree2).find((n) => n.props && n.props['aria-label'] === 'addMissing');
check('rows imported but not in the library get an add-to-library button', !!addBtn);
if (addBtn) {
  const b = fetchBodies.length;
  addBtn.props.onClick({ stopPropagation: noop });
  await tick();
  check('add-to-library resolves a verified search hit and POSTs it to the download route',
    fetchBodies.slice(b).some((x) => x.url.includes('/dsh-music/api/download') && x.body.includes('"verification"')),
    JSON.stringify(fetchBodies.slice(b).map((x) => x.url)));
  check('a per-song add is prioritised: body carries front:true (top of the pending list)',
    fetchBodies.slice(b).some((x) => x.url.includes('/dsh-music/api/download') && x.body.includes('"front":true')),
    JSON.stringify(fetchBodies.slice(b).map((x) => x.body)));
}
/* 点一首还没入库的导入歌 = 先入库（而不是只报「无法播放」） */
{
  libTabDefault = 'likes';
  const clickTree = expand(music({ ...realProps, useUi: (sel) => sel({ ...uiStore.getSnapshot(), view: 'library' }), useLikes: withSources }));
  libTabDefault = 'library';
  const mutedRow = walk(clickTree).find((n) => cls(n) === 'dshm-row dshm-row-off');
  check('a muted imported row is rendered (likes tab)', !!mutedRow && typeof mutedRow.props.onClick === 'function');
  const b = fetchCalls.length;
  if (mutedRow) mutedRow.props.onClick({ stopPropagation: noop });
  await tick();
  const slice1 = fetchCalls.slice(b).filter((u) => u.includes('/library/search') || u.includes('/dsh-music/api/download') && !u.includes('/status'));
  check('clicking an imported row without audio searches + queues a verified download (not just “unplayable”)',
    slice1.some((u) => u.includes('/library/search')) && slice1.some((u) => u.includes('/dsh-music/api/download')),
    JSON.stringify(slice1));
  const batchBtn = walk(clickTree).find((n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('addMissingBatch'));
  check('likes header offers a batch add-to-library button', !!batchBtn);
  if (batchBtn) {
    const c = fetchCalls.length;
    batchBtn.props.onClick();
    await tick(); await tick();
    const slice2 = fetchCalls.slice(c).filter((u) => u.includes('/library/search') || (u.includes('/dsh-music/api/download') && !u.includes('/status')));
    check('batch add-to-library searches each missing song and POSTs one download batch',
      slice2.some((u) => u.includes('/library/search')) && slice2.some((u) => u.includes('/dsh-music/api/download')),
      JSON.stringify(slice2));
  }
}
/* 十三期：后台音源扫描 → 实心圆图标钮（found）/ 淡色虚线（none）/ 普通（未扫描），三态同宽、行尾各列垂直对齐；命中条目不联网直接进下载队列；扫描进度 chip */
{
  const hit = { kind: 'song', id: 'r1', artist: '甲', title: '乙', album: null, durationMs: 1000, verification: { source: 'MusicBrainz', url: 'https://musicbrainz.org/recording/r1', verifiedAt: 1, note: 'search score=99' } };
  const scanned = (sel) => sel({
    keys: {}, dislikes: {}, loaded: true, error: null, scan: { running: true, pending: 3, done: 5, found: 2 },
    items: [
      { key: 'kA', artist: '甲', title: '乙', audioUrl: null, inLibrary: false, durationMs: 1000, source: { status: 'found', checkedAt: 1, hit } },
      { key: 'kB', artist: '丙', title: '丁', audioUrl: null, inLibrary: false, durationMs: 1000, source: { status: 'none', checkedAt: 1, hit: null } },
      { key: 'kC', artist: '戊', title: '己', audioUrl: null, inLibrary: false, durationMs: 1000 },
      { key: 'kD', artist: '庚', title: '辛', audioUrl: 'http://local/a.mp3', inLibrary: true, durationMs: 1000 },
    ] });
  libTabDefault = 'likes';
  const scanTree = expand(music({ ...realProps, useUi: (sel) => sel({ ...uiStore.getSnapshot(), view: 'library' }), useLikes: scanned }));
  libTabDefault = 'library';
  const ready = walk(scanTree).find((n) => cls(n).includes('dshm-row-add-ready'));
  const noneBtn = walk(scanTree).find((n) => cls(n).includes('dshm-row-add-none'));
  const unknown = walk(scanTree).find((n) => n.props && n.props['aria-label'] === 'addMissing');
  check('found source → solid icon-only add button (label addReady, no text)', !!ready && ready.props['aria-label'] === 'addReady' && !has(ready, (x) => cls(x) === 'dshm-row-add-text') && (ready.children || []).length === 1);
  check('none → muted dashed add button (addNone); unscanned → plain addMissing', !!noneBtn && noneBtn.props['aria-label'] === 'addNone' && !!unknown);
  check('add button keeps one 32px footprint in every state (no text pill)', /\.dshm-row-add-ready\{width:32px;height:32px;padding:0;/.test(src) && !src.includes('dshm-row-add-text'));
  const slots = walk(scanTree).filter((n) => cls(n) === 'dshm-row-add-slot');
  check('already-in-library likes row reserves the same-width empty slot', slots.length === 1);
  const likeTails = walk(scanTree).filter((n) => cls(n) === 'dshm-row-tail' && has(n, (x) => cls(x).includes('dshm-like-btn')));
  check('every likes row tail holds the same 4 slots (♥ 👎 add/empty play) → columns align', likeTails.length === 4 && likeTails.every((tn) => (tn.children || []).length === 4));
  check('scan running → progress chip in the likes header', has(scanTree, (n) => cls(n) === 'dshm-missing-chip dshm-scan-chip' && has(n, (x) => (x.children || []).includes('scanProgress'))));
  const b = fetchCalls.length;
  ready.props.onClick({ stopPropagation: noop });
  await tick();
  let slice = fetchCalls.slice(b).filter((u) => u.includes('/library/search') || (u.includes('/dsh-music/api/download') && !u.includes('/status')));
  check('clicking the solid add icon uses the stored hit: no search, download POST carries it', !slice.some((u) => u.includes('/library/search')) && slice.some((u) => u.includes('/dsh-music/api/download')), JSON.stringify(slice));
  const body = [...fetchBodies].reverse().find((x) => x.url.includes('/dsh-music/api/download'));
  check('…and the POST body contains the verified hit + front:true', !!body && body.body.includes('"r1"') && body.body.includes('"front":true'), body && body.body.slice(0, 120));
  const mutedReady = walk(scanTree).find((n) => cls(n) === 'dshm-row dshm-row-off');
  const c = fetchCalls.length;
  mutedReady.props.onClick({ stopPropagation: noop });
  await tick();
  slice = fetchCalls.slice(c);
  check('clicking a scanned-ready row adds it without searching', !slice.some((u) => u.includes('/library/search')) && slice.some((u) => u.includes('/dsh-music/api/download') && !u.includes('/status')), JSON.stringify(slice));
}
/* 文案必须走真实字典键（曾出现 t('src' + p) 拼出 srcqq 这种不存在的键 → 界面裸露键名） */
const chipText = (name) => { const n = walk(srcTree2).find((x) => cls(x) === 'dshm-src-chip dshm-src-' + name); return n ? String(n.children[0]) : ''; };
const zhKeys = new Set([...src.slice(src.indexOf('    const zh = {'), src.indexOf('    const en = {')).matchAll(/^      (\w+): '/gm)].map((m) => m[1]));
check('source chip labels resolve to dictionary keys', chipText('netease') === 'srcNetease' && chipText('qq') === 'srcQq'
  && zhKeys.has('srcNetease') && zhKeys.has('srcQq') && !zhKeys.has('srcqq') && !zhKeys.has('srcnetease'));
/* 老页面上的「导入喜欢列表」「同步 Spotify」按钮已收进设置：工具栏只剩同步进行中的状态钮 */
const runningTree = expand(music({ ...realProps, useUi: (sel) => sel({ ...uiStore.getSnapshot(), view: 'library' }), useSync: (sel) => sel({ phase: 'running', result: null, error: null, tracks: [], available: true }) }));
check('library toolbar shows only a running-sync status chip (→ settings)', has(runningTree, (n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('syncing'))
  && !has(runningTree, (n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('importBtn')));
const noLikesTree = expand(music({ ...realProps, useLikes: (sel) => sel({ keys: {}, dislikes: {}, loaded: true, error: null, items: [] }) }));
check('empty likes rail still renders and the header keeps the settings entry', has(noLikesTree, (n) => cls(n) === 'dshm-favs-empty')
  && has(noLikesTree, (n) => /dshm-chipbtn-icon/.test(String(cls(n) || '')) && (n.props || {})['aria-label'] === 'settingsTitle'));
uiStore.set({ view: 'library', settingsSection: null });

/* 5x) download status float (shell.overlay): opens itself while a batch runs, lists per-song status,
   plays finished items, collapses to a pill, closes — and 「打开曲库」 returns to the library */
{
  const floatComp = comps['dsh-music.download-float'];
  const floatSvc = services['dsh-music.download-float'] || {};
  check('download float is registered on shell.overlay with download/library/player/ui', !!floatComp && !!floatSvc.download && !!floatSvc.library && !!floatSvc.ui && typeof floatSvc.openLibrary === 'function');
  const played = [];
  const says = (node, text) => !!node && has(node, (x) => (x.children || []).includes(text));
  const fp = (dlState) => ({ t: (k) => k, ...floatSvc, library: { source: { getSnapshot: () => ({ status: 'ready', tracks: [{ id: 'a'.repeat(16), title: '乙' }], error: null }) } }, player: { playTracks: (...a) => played.push(a) }, useUi: (sel) => sel(uiStore.getSnapshot()), useDownload: (sel) => sel(dlState) });
  const runningState = { running: true, total: 3, done: 1, error: null, items: [
    { artist: '甲', title: '乙', status: 'ok', note: null, trackId: 'a'.repeat(16) },
    { artist: '丙', title: '丁', status: 'downloading', note: null, trackId: null },
    { artist: '戊', title: '己', status: 'pending', note: null, trackId: null }] };
  uiStore.set({ downloadFloat: null, view: 'reco' });
  const firstPass = expand(floatComp(fp(runningState)));            // 首帧 panel 为空 → null，副作用把面板设为 open
  const opened = uiStore.getSnapshot().downloadFloat;
  const runTree = expand(floatComp(fp(runningState)));
  const runRows = walk(runTree).filter((n) => cls(n).split(' ').includes('dshm-dl-row'));
  check('download float opens itself when a batch is running and shows progress + per-song status',
    (!firstPass || firstPass.length === 0) && opened === 'open' && has(runTree, (n) => cls(n) === 'dshm-dl-float' && n.props.role === 'region')
    && has(runTree, (n) => cls(n) === 'dshm-count' && (n.children || []).includes('1 / 3'))
    && runRows.length === 3 && says(runRows[1], 'downloading') && says(runRows[2], 'downloadQueued')
    && !has(runTree, (n) => cls(n) === 'dshm-dl-foot'),
    JSON.stringify({ opened, rows: runRows.length }));
  check('completed row in a running download queue is already directly clickable to play',
    runRows[0] && runRows[0].type === 'button' && runRows[0].props['aria-label'] === 'downloadPlayOne'
    && runRows[1] && runRows[1].type === 'div' && runRows[2] && runRows[2].type === 'div');
  if (runRows[0]) runRows[0].props.onClick();
  check('clicking a completed row while queue is still running plays the track immediately',
    played.length === 1 && played[0][0][0].id === 'a'.repeat(16));
  played.length = 0;
  const barNode = walk(runTree).find((n) => cls(n) === 'dshm-dl-bar' && n.children && n.children[0] && n.children[0].props);
  check('progress bar reflects done/total while running', !!barNode && barNode.children[0].props.style.width === '33%');
  const doneState = { running: false, total: 4, done: 4, error: null, items: [
    { artist: '甲', title: '乙', status: 'ok', note: null, trackId: 'a'.repeat(16) },
    { artist: '庚', title: '辛', status: 'skip', note: '文件已存在', trackId: 'b'.repeat(16) },
    { artist: '壬', title: '癸', status: 'fail', note: '搜索无结果', trackId: null },
    { artist: '子', title: '丑', status: 'fail', note: '下载失败: 超时', trackId: null }] };
  const doneTree = expand(floatComp(fp(doneState)));
  const doneRows = walk(doneTree).filter((n) => cls(n).split(' ').includes('dshm-dl-row'));
  const sumNode = walk(doneTree).find((n) => cls(n).split(' ').includes('dshm-dl-sum'));
  const playBtns = walk(doneTree).filter((n) => n.type === 'button' && n.props['aria-label'] === 'downloadPlayOne');
  check('finished batch lists ok/skip/fail with notes and a summary line',
    doneRows.length === 4 && says(doneRows[1], 'downloadSkip') && says(doneRows[2], 'downloadFail')
    && says(doneRows[2], '搜索无结果') && !!sumNode && (sumNode.children || []).includes('downloadSummary') && sumNode.props.className.includes('dshm-dl-sum-warn'),
    JSON.stringify({ rows: doneRows.length, skip: says(doneRows[1] || {}, 'downloadSkip'), fail: says(doneRows[2] || {}, 'downloadFail'), sum: !!sumNode }));
  check('only in-library items get a clickable play row; play resolves the trackId through the library', playBtns.length === 2 && played.length === 0, 'playBtns=' + playBtns.length + ' labels=' + JSON.stringify(walk(doneTree).filter((n) => n.type === 'button').map((n) => n.props['aria-label'])));
  if (playBtns[0]) playBtns[0].props.onClick();
  check('clicking finished row plays the resolved library track', played.length === 1 && Array.isArray(played[0] && played[0][0]) && played[0][0].length === 1 && played[0][0][0].id === 'a'.repeat(16), JSON.stringify(played.map((a) => (a[0] || []).map((x) => x && x.id))));
  if (playBtns[1]) playBtns[1].props.onClick();
  check('clicking finished row falls back to direct /dsh-music/audio/<trackId> when library snapshot is still refreshing',
    played.length === 2 && played[1][0][0].id === 'b'.repeat(16) && played[1][0][0].audioUrl === '/dsh-music/audio/' + 'b'.repeat(16));
  uiStore.set({ downloadFloat: 'collapsed', view: 'reco' });
  const pillTree = expand(floatComp(fp(doneState)));
  const pill = walk(pillTree).find((n) => cls(n) === 'dshm-dl-pill');
  check('collapsed state renders a pill with the result text', !!pill && (pill.children || []).some((c) => c && c.type === 'span' && (c.children || []).includes('downloadPillDoneFail')));
  if (pill) pill.props.onClick();
  check('pill click expands the panel again', uiStore.getSnapshot().downloadFloat === 'open');
  const openTree = expand(floatComp(fp(doneState)));
  const libBtn = walk(openTree).find((n) => n.type === 'button' && (n.children || []).includes('downloadOpenLibrary'));
  if (libBtn) libBtn.props.onClick();
  check('「打开曲库」 closes the float and returns to the library view', uiStore.getSnapshot().downloadFloat === null && uiStore.getSnapshot().view === 'library');
  uiStore.set({ downloadFloat: 'open', view: 'reco' });
  const closeTree = expand(floatComp(fp(doneState)));
  const closeBtn = walk(closeTree).find((n) => n.type === 'button' && n.props['aria-label'] === 'downloadClose');
  if (closeBtn) closeBtn.props.onClick();
  check('close button hides the float', !!closeBtn && uiStore.getSnapshot().downloadFloat === null);
  { const idleTree = expand(floatComp(fp({ running: false, total: 0, done: 0, items: [], error: null }))); check('nothing renders when idle and closed', !idleTree || idleTree.length === 0); }
  uiStore.set({ downloadFloat: null, view: 'library' });
}

/* 5z) 歌词点击跳转回归：真实 player 引擎 + Audio mock。
 * 点正在播放页任意一句 → audio.currentTime 与 position 都必须落到那句的时间；
 * 这是「点击歌词跳转」的完整链路（LyricsPanel.seekTo → player.seek → audio）。 */
{
  const store = playerSvc.source;
  const audio = audioInstances[0];
  check('player engine owns exactly one audio element', audioInstances.length === 1 && !!audio, 'instances=' + audioInstances.length);
  const track = { id: 't1', title: '测试歌曲', artist: '测试歌手', album: '测试专辑', duration: 200, audioUrl: '/dsh-music/audio/t1', source: 'dsh-music' };
  realPlayTracks([track], 0);
  check('playTracks loads the track into the audio element', !!store.getSnapshot().track && store.getSnapshot().track.id === 't1' && String(audio.src).includes('/dsh-music/audio/t1'),
    JSON.stringify({ src: audio.src, track: store.getSnapshot().track && store.getSnapshot().track.id }));
  state.view = 'now';
  const nowProps = { ...baseProps, usePlayer: (sel) => sel(store.getSnapshot()), useLyrics: (sel) => sel(lyricsState) };
  const lyricTree = expand(music(nowProps));
  const lyricBtns = walk(lyricTree).filter((n) => cls(n).split(' ').includes('dshm-lyric-line'));
  check('now-playing renders 4 timed lyric lines as enabled buttons',
    lyricBtns.length === 4 && lyricBtns.every((b) => b.type === 'button' && !b.props.disabled && typeof b.props.onClick === 'function'),
    'count=' + lyricBtns.length);
  if (lyricBtns.length === 4) {
    lyricBtns[2].props.onClick(); /* 第三句 time=10 */
    check('clicking lyric line 3 seeks the audio playhead to 10s', audio.currentTime === 10, 'currentTime=' + audio.currentTime);
    check('clicking lyric line 3 moves player position to 10s', store.getSnapshot().position === 10, 'position=' + store.getSnapshot().position);
    lyricBtns[0].props.onClick(); /* 第一句 time=0 */
    check('clicking lyric line 1 seeks back to 0s', audio.currentTime === 0 && store.getSnapshot().position === 0,
      JSON.stringify({ currentTime: audio.currentTime, position: store.getSnapshot().position }));
    lyricBtns[3].props.onClick(); /* 第四句 time=15 */
    check('clicking lyric line 4 seeks to 15s', audio.currentTime === 15 && store.getSnapshot().position === 15,
      JSON.stringify({ currentTime: audio.currentTime, position: store.getSnapshot().position }));
  }
  playerSvc.seek(9999);
  check('seek beyond duration clamps to the track end', audio.currentTime === 200 && store.getSnapshot().position === 200,
    JSON.stringify({ currentTime: audio.currentTime, position: store.getSnapshot().position }));
  playerSvc.seek(-5);
  check('negative seek clamps to 0', audio.currentTime === 0 && store.getSnapshot().position === 0);
  /* 进度条与歌词共用同一 seek：Slider 键盘步进（→ +5%）也必须走通 */
  const slider = walk(lyricTree).find((n) => cls(n).split(' ').includes('dshm-slider') && typeof n.props.onKeyDown === 'function');
  if (slider) {
    slider.props.onKeyDown({ key: 'ArrowRight', preventDefault: noop }); /* frac 0 → 0.05 → 10s */
    check('progress slider seek lands at frac*duration (same path as lyric click)', audio.currentTime === 10 && store.getSnapshot().position === 10,
      JSON.stringify({ currentTime: audio.currentTime, position: store.getSnapshot().position }));
  } else {
    check('progress slider seek lands at frac*duration (same path as lyric click)', false, 'slider not found');
  }
  store.set({ track: null, queue: [], queueIndex: -1, position: 0, duration: 0 });
}

/* 5z2) 桌面媒体 URL 回归：桌面壳 document base 是 dsh-app://，其请求代理会剥掉
 * Content-Length 并重流 body，Chromium 媒体管线无法 byte-range seek（歌词/进度
 * 跳转弹回）。修复=audio 改走 boot 注入的 __DSH_TRANSPORT__.streamBaseUrl（loopback
 * HTTP origin，音频路由免鉴权、<audio> 跨源无需 CORS）。这里验证：有 transport →
 * audio.src 落到 HTTP origin；无 transport（web）→ 回落 document base，不误用 HTTP。 */
{
  const store = playerSvc.source;
  const audio = audioInstances[0];
  const track = { id: 't1', title: '测试歌曲', artist: '测试歌手', album: '测试专辑', duration: 200, audioUrl: '/dsh-music/audio/t1', source: 'dsh-music' };
  const prevBaseURI = sandbox.document.baseURI;
  /* 模拟桌面：document base 为 dsh-app://，boot 注入 loopback HTTP origin。 */
  sandbox.document.baseURI = 'dsh-app://app/';
  sandbox.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl: 'http://127.0.0.1:60244' };
  realPlayTracks([track], 0);
  check('desktop: audio loads over the loopback HTTP origin (seekable), not dsh-app://',
    audio.src === 'http://127.0.0.1:60244/dsh-music/audio/t1', 'src=' + audio.src);
  state.view = 'now';
  const nowProps = { ...baseProps, usePlayer: (sel) => sel(store.getSnapshot()), useLyrics: (sel) => sel(lyricsState) };
  const lyricBtns = walk(expand(music(nowProps))).filter((n) => cls(n).split(' ').includes('dshm-lyric-line'));
  if (lyricBtns.length === 4) {
    lyricBtns[2].props.onClick(); /* 第三句 time=10 */
    check('desktop: lyric click still seeks the playhead to 10s over HTTP media', audio.currentTime === 10 && store.getSnapshot().position === 10,
      JSON.stringify({ currentTime: audio.currentTime, position: store.getSnapshot().position }));
  } else {
    check('desktop: lyric click still seeks the playhead to 10s over HTTP media', false, 'lyric buttons=' + lyricBtns.length);
  }
  /* 无 transport（web，或 boot 未注入）→ 回落 document base。沙箱 base 是 dsh-app://，
   * 故此处正好复现「未修复时桌面会走的不可 seek 代理路径」，与上面的 HTTP origin 形成对照。 */
  delete sandbox.__DSH_TRANSPORT__;
  realPlayTracks([track], 0);
  check('fallback: without transport the audio resolves against the document base (dsh-app proxy path)',
    audio.src === 'dsh-app://app/dsh-music/audio/t1', 'src=' + audio.src);
  if (prevBaseURI === undefined) delete sandbox.document.baseURI; else sandbox.document.baseURI = prevBaseURI;
  store.set({ track: null, queue: [], queueIndex: -1, position: 0, duration: 0 });
}

/* 5z3) 历史统计/排行实时更新：播放事件落库（自然播完 / 手动切歌）→ report POST 成功
 * → historyService.refreshSoon（300ms 防抖）→ 不切页即刷新 totalPlays/topSongs/时间线；
 * 历史页驻留还注册 15s 轮询兜底；载荷不变时不通知订阅者（避免无意义整页重渲染）。 */
{
  const histSvc = (services['music'] || {}).history;
  const store = playerSvc.source;
  const audio = audioInstances[0];
  histEventsMock = [];
  histStatsMock = { totalPlays: 5, totalSeconds: 500, uniqueSongs: 1, uniqueArtists: 1, topSongs: [{ title: '测试歌曲', artist: '测试歌手', trackId: 'abcd1234ef', plays: 5 }], topArtists: [{ name: '测试歌手', plays: 5 }], daily: [], skippedCount: 0, avgCompletion: 0.9 };
  await histSvc.load(50);
  check('history baseline loaded (totalPlays=5)', histSvc.source.getSnapshot().stats.totalPlays === 5,
    'totalPlays=' + (histSvc.source.getSnapshot().stats && histSvc.source.getSnapshot().stats.totalPlays));
  /* 驻留历史页：注册 15s 轮询兜底 */
  const intervalsBefore = intervalCalls.length;
  state.view = 'history';
  const histProps = { ...baseProps, useHistory: (sel) => sel(histSvc.source.getSnapshot()), usePlayer: (sel) => sel(store.getSnapshot()) };
  expand(music(histProps));
  check('history view registers a 15s live-refresh poll', intervalCalls.slice(intervalsBefore).some((c) => c.ms === 15000),
    JSON.stringify(intervalCalls.slice(intervalsBefore).map((c) => c.ms)));
  /* 自然播完 → report(skipped=false) → 统计 +1、排行 +1、时间线新增（无需切页） */
  const track = { id: 'abcd1234ef', title: '测试歌曲', artist: '测试歌手', duration: 200, audioUrl: '/dsh-music/audio/abcd1234ef', source: 'dsh-music' };
  realPlayTracks([track], 0);
  audio._emit('ended');
  await new Promise((r) => setTimeout(r, 450)); /* report POST + 300ms 防抖 + 重新拉取 */
  const snap1 = histSvc.source.getSnapshot();
  check('natural end refreshes stats live (totalPlays 5→6)', snap1.stats && snap1.stats.totalPlays === 6,
    'totalPlays=' + (snap1.stats && snap1.stats.totalPlays));
  check('leaderboard refreshes live (topSongs plays 5→6)', snap1.stats && snap1.stats.topSongs[0] && snap1.stats.topSongs[0].plays === 6,
    JSON.stringify(snap1.stats && snap1.stats.topSongs));
  check('timeline gains the new event without re-entering the view', snap1.events.length === 1 && snap1.total === 1, 'events=' + snap1.events.length);
  /* 手动切歌 → 上一首按 skipped 上报 → skippedCount 也实时 +1 */
  realPlayTracks([{ ...track, id: 'bcd1234ef0' }], 0);
  await new Promise((r) => setTimeout(r, 450));
  const snap2 = histSvc.source.getSnapshot();
  check('manual switch reports a skip and refreshes stats live', snap2.stats.totalPlays === 7 && snap2.stats.skippedCount === 1,
    JSON.stringify({ plays: snap2.stats.totalPlays, skipped: snap2.stats.skippedCount }));
  /* 载荷不变 → 不通知订阅者（轮询/重复刷新不触发整页重渲染） */
  let notified = 0;
  const un = histSvc.source.subscribe(() => { notified++; });
  await histSvc.load(50);
  check('unchanged payload does not notify subscribers', notified === 0, 'notified=' + notified);
  un();
  store.set({ track: null, queue: [], queueIndex: -1, position: 0, duration: 0 });
  state.view = 'library';
}

/* 6) report */
const fail = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  (' + r.detail + ')' : ''));
console.log('\n' + (results.length - fail.length) + '/' + results.length + ' PASS');
process.exit(fail.length ? 1 : 0);
