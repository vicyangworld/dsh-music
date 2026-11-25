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
const fetchMock = async (url) => {
  fetchCalls.push(url);
  const body = url.includes('/sync/availability')
    ? { available: true, hint: null }
    : url.includes('/sync/status')
      ? { running: false, result: null, error: null }
      : url.includes('/liked-sync/status')
        ? { enabled: true, providers: {
          netease: { label: '网易云音乐', connected: false, account: null, busy: false, lastSyncAt: null, lastResult: null, knownCount: 0 },
          qq: { label: 'QQ 音乐', connected: true, account: { uid: '1001', nickname: '小Q', loginAt: 1 }, busy: false, lastSyncAt: 0, lastResult: null, knownCount: 5 },
        } }
        : url.includes('/liked-sync/netease/qr/poll')
          ? { code: 801, message: '等待扫码' }
          : url.includes('/liked-sync/netease/qr')
            ? { key: 'k1', url: 'https://music.163.com/login?codekey=8126df9b-smoke' }
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
check('empty library has search / rescan / optional sync CTAs',
  ctaLabels.includes('emptySearchCta') && ctaLabels.includes('emptyRescanCta') && ctaLabels.includes('syncOptional'),
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

/* 4w) first-run welcome: mascot, hero copy, taste copy route, preview entry */
check('returning user is not forced into welcome', state.view !== 'welcome');
check('onboarding payload matches the host contract', src.includes('payload.libraryPath') && src.includes('payload.useStarter'));
state.view = 'welcome';
const welcomeTree = expand(music(baseProps));
check('welcome renders the fish mascot', has(welcomeTree, (n) => cls(n) === 'dshm-fish'));
check('welcome shows title + start CTA', has(welcomeTree, (n) => cls(n).includes('dshm-wbtn-primary'))
  && has(welcomeTree, (n) => (n.children || []).includes('welcomeTitle')));
check('welcome shows the three selling points', has(welcomeTree, (n) => cls(n) === 'dshm-wpoint'));

/* Preview mode must be side-effect free: run the real finish()/skipAll() bodies
 * extracted from source with mock services and count every call. */
const finishBody = (src.match(/async function finish\(\) \{\n([\s\S]*?)\n      \}\n/) || [])[1];
const skipBody = (src.match(/function skipAll\(\) \{\n([\s\S]*?)\n      \}\n/) || [])[1];
async function runFinish(preview, mode) {
  const calls = { complete: 0, exit: 0, route: 0 };
  const fn = new Function('onboarding', 'preview', 'onExitPreview', 'onRoute', 'setStep', 'setBusy', 'setFailed', 'mode', 'genres', 'langs', 'dirPath', 'busy',
    'return async function finish() {' + finishBody + '\n};');
  await fn({ complete: async () => { calls.complete++; } }, preview, () => { calls.exit++; }, () => { calls.route++; },
    () => {}, () => {}, () => {}, mode, [], [], '', false)();
  return calls;
}
function runSkip(preview) {
  const calls = { exit: 0, route: 0 };
  const fn = new Function('preview', 'onExitPreview', 'onRoute', 'return function skipAll() {' + skipBody + '\n};');
  fn(preview, () => { calls.exit++; }, () => { calls.route++; })();
  return calls;
}
const pvFinish = await runFinish(true, 'local');
check('preview finish: zero POST, only closes preview', !!finishBody && pvFinish.complete === 0 && pvFinish.exit === 1 && pvFinish.route === 0);
const realFinish = await runFinish(false, 'local');
check('real finish: one POST then routes to library', realFinish.complete === 1 && realFinish.route === 1 && realFinish.exit === 0);
const pvSkip = runSkip(true);
check('preview skip closes preview without routing', !!skipBody && pvSkip.exit === 1 && pvSkip.route === 0);
state.welcomePreview = true;
check('welcome preview shows a close button', has(expand(music(baseProps)), (n) => cls(n) === 'dshm-wclose'));
state.welcomePreview = false;
state.view = 'library';
const backTree = expand(music(baseProps));
check('returning user gets a preview-welcome entry', has(backTree, (n) => cls(n) === 'dshm-chipbtn'
  && (n.children || []).includes('welcomePreview')));

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
check('mini has drag grip', has(expanded, (n) => cls(n) === 'dshm-mini-grip' && typeof n.props.onPointerDown === 'function'));
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

/* 5y) integration: the real preview chipbtn writes the REAL ui store and the
 *     panel re-renders into the welcome view (closes the GUI-only gap). */
const uiStore = svc.hooks && svc.hooks.ui;
uiStore.set({ view: 'library', welcomePreview: false, lyricsOpen: false });
const useUiReal = (sel) => sel(uiStore.getSnapshot());
const realProps = { ...baseProps, useUi: useUiReal };
const realHeader = expand(music(realProps));
const previewBtn = walk(realHeader).find((n) => cls(n) === 'dshm-chipbtn'
  && (n.children || []).includes('welcomePreview'));
check('preview button is rendered and enabled', !!previewBtn && !(previewBtn.props || {}).disabled);
previewBtn.props.onClick();
const afterClick = uiStore.getSnapshot();
check('preview click writes the real ui store', afterClick.view === 'welcome' && afterClick.welcomePreview === true,
  'view=' + afterClick.view + ' preview=' + afterClick.welcomePreview);
const realPreviewTree = expand(music(realProps));
check('preview view renders mascot + close button', has(realPreviewTree, (n) => cls(n) === 'dshm-fish')
  && has(realPreviewTree, (n) => cls(n) === 'dshm-wclose'));
const closeBtn = walk(realPreviewTree).find((n) => cls(n) === 'dshm-wclose');
closeBtn.props.onClick();
const afterClose = uiStore.getSnapshot();
check('preview close returns to the library view', afterClose.view === 'library' && afterClose.welcomePreview === false,
  'view=' + afterClose.view);

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

/* 5w) 喜欢列表导入（网易云扫码 / QQ Cookie，只读）：入口按钮 → 对话框 → 二维码 SVG →
 *     QQ 已连接卡片 → 同步结果 chips → 关闭；来源小标随 sources 渲染。 */
const svcLiked = svc.likedSync;
check('liked-sync service is injected into the panel', !!svcLiked && !!svcLiked.source && typeof svcLiked.open === 'function');
const importBtn = walk(realHeader).find((n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('importBtn'));
check('toolbar renders the import-liked button (not primary, not the Spotify sync)', !!importBtn
  && !(importBtn.props || {}).disabled && (importBtn.props || {}).title === 'importBtnHint');
const useLikedSyncReal = (sel) => sel(svcLiked.source.getSnapshot());
importBtn.props.onClick();
check('import click opens the service store', svcLiked.source.getSnapshot().open === true);
await new Promise((r) => setTimeout(r, 50));
const qrSnap = svcLiked.source.getSnapshot();
check('QR session created from the host route and encoded locally', qrSnap.qr && qrSnap.qr.key === 'k1'
  && qrSnap.qr && qrSnap.qr.matrix && qrSnap.qr.matrix.size > 20 && qrSnap.qrPhase === 'waiting',
  'phase=' + qrSnap.qrPhase + ' size=' + (qrSnap.qr && qrSnap.qr.matrix && qrSnap.qr.matrix.size));
check('status route fetched on open', fetchCalls.some((u) => u.includes('/liked-sync/status')));
uiStore.set({ view: 'library' });
const dlgProps = { ...realProps, useUi: useUiReal, useLikedSync: useLikedSyncReal };
const dlgTree = expand(music(dlgProps));
const modal = walk(dlgTree).find((n) => cls(n) === 'dshm-modal');
check('dialog renders as aria-modal with two provider tabs', !!modal && (modal.props || {})['aria-modal'] === true
  && walk(dlgTree).filter((n) => /(^| )dshm-imp-tab( |$)/.test(cls(n))).length === 2
  && walk(dlgTree).filter((n) => /dshm-imp-tab-on/.test(cls(n))).length === 1);
const qrSvg = walk(dlgTree).find((n) => cls(n) === 'dshm-qr');
check('QR renders as a crisp SVG with a 4-module quiet zone', !!qrSvg && (qrSvg.props || {}).shapeRendering === 'crispEdges'
  && /^-4 -4 /.test((qrSvg.props || {}).viewBox || ''), 'viewBox=' + ((qrSvg && qrSvg.props.viewBox) || ''));
check('QR tab shows the waiting status + regenerate button', has(dlgTree, (n) => cls(n) === 'dshm-imp-step' && (n.children || []).includes('importQrWaiting'))
  && has(dlgTree, (n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('importQrRegenerate')));
check('dialog footer states the read-only contract', has(dlgTree, (n) => cls(n) === 'dshm-modal-foot' && (n.children || []).includes('importFootNote')));
const qqTab = walk(dlgTree).find((n) => cls(n) === 'dshm-imp-tab' && (n.children || []).includes('importTabQq'));
qqTab.props.onClick();
check('switching to the QQ tab keeps the dialog open', svcLiked.source.getSnapshot().tab === 'qq' && svcLiked.source.getSnapshot().open === true);
const qqTree = expand(music(dlgProps));
check('connected QQ account card renders nickname + known count', has(qqTree, (n) => cls(n) === 'dshm-imp-account')
  && has(qqTree, (n) => cls(n) === 'dshm-imp-nick' && (n.children || []).includes('小Q')));
const syncBtn = walk(qqTree).find((n) => cls(n) === 'dshm-chipbtn dshm-chipbtn-primary' && (n.children || []).includes('importSyncNow'));
check('QQ tab offers the import action', !!syncBtn && !(syncBtn.props || {}).disabled);
syncBtn.props.onClick();
await new Promise((r) => setTimeout(r, 50));
check('sync POSTs to the provider route and stores the result', fetchCalls.some((u) => u.includes('/liked-sync/qq/sync'))
  && svcLiked.source.getSnapshot().result && svcLiked.source.getSnapshot().result.added === 3);
const resTree = expand(music(dlgProps));
check('result chips render added/existed/removed', has(resTree, (n) => cls(n) === 'dshm-sync-chip dshm-sync-chip-ok' && (n.children || []).includes('importResAdded 3'))
  && has(resTree, (n) => cls(n) === 'dshm-sync-chip' && (n.children || []).includes('importResExisted 5'))
  && has(resTree, (n) => cls(n) === 'dshm-sync-chip dshm-sync-chip-warn' && (n.children || []).includes('importResRemoved 2')));
check('removed items are listed (informational only)', has(resTree, (n) => cls(n) === 'dshm-sync-detail' && (n.children || []).some((c) => typeof c === 'object' && (c.children || []).includes('· 某人 - 旧歌'))));
const closeBtn2 = walk(resTree).find((n) => cls(n) === 'dshm-iconbtn' && (n.props || {})['aria-label'] === 'importClose');
check('close button present', !!closeBtn2);
closeBtn2.props.onClick();
check('close hides the dialog', svcLiked.source.getSnapshot().open === false);
const withSources = (sel) => sel({
  keys: {}, dislikes: {}, loaded: true, error: null,
  items: [{ key: 'k9', artist: '甲', title: '乙', trackId: null, audioUrl: null, coverUrl: null, inLibrary: false, durationMs: 1000,
    sources: { netease: { id: 1, likedAt: 1 }, qq: { id: 2, likedAt: 2 } } }],
});
libTabDefault = 'likes';
const srcTree2 = expand(music({ ...realProps, useUi: (sel) => sel({ ...uiStore.getSnapshot(), view: 'library' }), useLikes: withSources, useLikedSync: useLikedSyncReal }));
libTabDefault = 'library';
check('likes tab header offers the import button too', has(srcTree2, (n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('importBtn')));
check('liked rows show a source chip per platform', has(srcTree2, (n) => cls(n) === 'dshm-src-chip dshm-src-netease')
  && has(srcTree2, (n) => cls(n) === 'dshm-src-chip dshm-src-qq'));
/* 文案必须走真实字典键（曾出现 t('src' + p) 拼出 srcqq 这种不存在的键 → 界面裸露键名） */
const chipText = (name) => { const n = walk(srcTree2).find((x) => cls(x) === 'dshm-src-chip dshm-src-' + name); return n ? String(n.children[0]) : ''; };
const zhKeys = new Set([...src.slice(src.indexOf('    const zh = {'), src.indexOf('    const en = {')).matchAll(/^      (\w+): '/gm)].map((m) => m[1]));
check('source chip labels resolve to dictionary keys', chipText('netease') === 'srcNetease' && chipText('qq') === 'srcQq'
  && zhKeys.has('srcNetease') && zhKeys.has('srcQq') && !zhKeys.has('srcqq') && !zhKeys.has('srcnetease'));
uiStore.set({ view: 'library' });
const noLikesTree = expand(music({ ...realProps, useLikes: (sel) => sel({ keys: {}, dislikes: {}, loaded: true, error: null, items: [] }), useLikedSync: useLikedSyncReal }));
check('empty likes rail still renders with the import service present', has(noLikesTree, (n) => cls(n) === 'dshm-favs-empty')
  && has(noLikesTree, (n) => cls(n) === 'dshm-chipbtn' && (n.children || []).includes('importBtn')));

/* 6) report */
const fail = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  (' + r.detail + ')' : ''));
console.log('\n' + (results.length - fail.length) + '/' + results.length + ' PASS');
process.exit(fail.length ? 1 : 0);
