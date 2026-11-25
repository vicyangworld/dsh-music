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
                : { imageUrl: 'http://img/orig.jpg', thumbnailUrl: 'http://img/thumb.jpg' };
  return { ok: true, json: async () => body };
};
const sandbox = { window: windowMock, localStorage, console, setTimeout, clearTimeout, fetch: fetchMock,
  document: { createElement: () => ({ setAttribute: noop, textContent: '', remove: noop }), head: { appendChild: noop }, addEventListener: noop, removeEventListener: noop },
  TextEncoder };
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
const ctx = {
  effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : noop; },
  locale: { register: noop, bind: () => (k) => k },
  layout: { selectPanel: noop },
  slots: {
    inject: (name, fn) => fn(),
    register: (def, comp) => {
      const key = def.id || def.key || def.name;
      comps[key] = comp;
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
check('now-playing has 1 cycle-mode control', walk(nowTree).filter((n) => /dshm-mode-cycle|dshm-iconbtn/.test(cls(n))).length >= 1);
check('now-playing artist opens artist page (button present)', has(nowTree, (n) => cls(n).includes('dshm-artist-btn')));

/* 3) history view: play-list header + clickable rows */
state.view = 'history';
const hisTree = expand(music(baseProps));
check('history renders', !!hisTree);
check('history has play-list button', has(hisTree, (n) => cls(n).includes('dshm-col-play') && typeof n.props.onClick === 'function'), 'nodes=' + walk(hisTree).filter((n) => cls(n).includes('chipbtn')).length);
check('history row is clickable', has(hisTree, (n) => /dshm-hrow-click/.test(cls(n)) && typeof n.props.onClick === 'function'));
check('history row artist clickable', has(hisTree, (n) => /dshm-row-sub-btn/.test(cls(n))));

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
/* finish() / save() 真实函数体：参数全部 mock，统计调用 */
const finishBody2 = (src.match(/async function finish\(\) \{\n([\s\S]*?)\n      \}\n/) || [])[1];
const saveBody = (src.match(/async function save\(\) \{\n([\s\S]*?)\n      \}\n/) || [])[1];
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
const saveOk = await runSettings(saveBody, { mode: 'starter' });
check('returning save: one POST then saved flag', !!saveBody && saveOk.complete === 1 && saveOk.saved === 1 && saveOk.failed === 0 && saveOk.route === 0);
const saveFail = await runSettings(saveBody, { mode: 'local' }, { fail: true });
check('returning save failure: failed flag, no saved flag', saveFail.failed === 1 && saveFail.saved === 0);
state.view = 'library';
const backTree = expand(music(baseProps));
const gearBtn = walk(backTree).find((n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('settingsTitle'));
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
playerSvc.playTracks = (list, idx) => plays.push({ len: list.length, idx, first: list[0] && list[0].id, last: list[list.length - 1] && list[list.length - 1].id });

state.view = 'library';
const libRows = walk(expand(music(baseProps))).filter((n) => /^dshm-row( |$)/.test(cls(n)) && n.props.role === 'button');
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
check('mini has collapse button', has(expanded, (n) => (n.props && n.props.title) === 'miniCollapse'));

state.miniCollapsed = true;
const collapsedTree = expand(mini(miniProps));
check('mini collapsed renders a floating badge', !!collapsedTree && has(collapsedTree, (n) => cls(n) === 'dshm-mini-fab'));
check('floating badge is draggable', has(collapsedTree, (n) => cls(n) === 'dshm-mini-fab' && typeof n.props.onPointerDown === 'function' && typeof n.props.onPointerMove === 'function'));
check('floating badge restores on activate', has(collapsedTree, (n) => cls(n) === 'dshm-mini-fab' && typeof n.props.onKeyDown === 'function'));
check('floating badge hides the bar controls', !has(collapsedTree, (n) => cls(n).includes('dshm-slider')));

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
const settingsBtn = walk(realHeader).find((n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('settingsTitle'));
check('settings button is rendered and enabled', !!settingsBtn && !(settingsBtn.props || {}).disabled);
settingsBtn.props.onClick();
const afterClick = uiStore.getSnapshot();
check('settings click writes the real ui store', afterClick.view === 'settings' && afterClick.settingsSection === null,
  'view=' + afterClick.view + ' section=' + afterClick.settingsSection);
const realSettingsTree = expand(music(realProps));
check('returning settings view renders the title row (no first-run hero) + three cards', has(realSettingsTree, (n) => cls(n) === 'dshm-set-top' && has(n, (x) => (x.children || []).includes('settingsTitle')))
  && !has(realSettingsTree, (n) => cls(n) === 'dshm-logo') && walk(realSettingsTree).filter(isCard).length === 3);
const backBtn = walk(realSettingsTree).find((n) => cls(n) === 'dshm-wbtn' && (n.children || []).includes('settingsBack'));
check('returning foot has back + save', !!backBtn && has(realSettingsTree, (n) => cls(n) === 'dshm-wbtn dshm-wbtn-primary' && (n.children || []).includes('settingsSave')));
backBtn.props.onClick();
const afterBack = uiStore.getSnapshot();
check('back returns to the library view', afterBack.view === 'library' && afterBack.settingsSection === null, 'view=' + afterBack.view);
const saveBtn = walk(realSettingsTree).find((n) => cls(n) === 'dshm-wbtn dshm-wbtn-primary' && (n.children || []).includes('settingsSave'));
saveBtn.props.onClick();
await new Promise((r) => setTimeout(r, 50));
check('save POSTs the taste payload to onboarding/complete', fetchBodies.some((x) => x.url.includes('/onboarding/complete') && /"genres"/.test(x.body)),
  JSON.stringify(fetchBodies.filter((x) => x.url.includes('/onboarding'))));

/* 5x) v8 taste plumbing + v9 card rail / background loads */
check('library renders the liked card rail', has(realHeader, (n) => cls(n) === 'dshm-favs'));
check('empty likes show the rail guidance', has(realHeader, (n) => cls(n) === 'dshm-favs-empty'));
const likedItemsState = (sel) => sel({
  keys: {}, dislikes: {}, loaded: true, error: null,
  items: [{ key: 'k1', artist: '甲', title: '乙', trackId: 't1', audioUrl: '/a.mp3', coverUrl: null, inLibrary: true, durationMs: 1000 }],
});
const railTree = expand(music({ ...baseProps, useUi: (sel) => sel({ ...state, view: 'library' }), useLikes: likedItemsState }));
check('liked rail renders a card + view-all card', has(railTree, (n) => String(cls(n) || '').includes('dshm-favcard'))
  && has(railTree, (n) => String(cls(n) || '').includes('dshm-favcard-more')));
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
check('rows carry a dislike button', has(realHeader, (n) => String(cls(n) || '').includes('dshm-dislike-btn')));
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
check('read-only contract is stated under the section title', has(setTree, (n) => cls(n) === 'dshm-wstep-sub' && (n.children || []).includes('setLikedSub')));

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
  && has(noLikesTree, (n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('settingsTitle')));
uiStore.set({ view: 'library', settingsSection: null });

/* 6) report */
const fail = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  (' + r.detail + ')' : ''));
console.log('\n' + (results.length - fail.length) + '/' + results.length + ' PASS');
process.exit(fail.length ? 1 : 0);
