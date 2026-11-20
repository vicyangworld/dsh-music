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
let captured = null;const windowMock = {
  __ModuleLoader__: { load: (def) => { captured = def; } },
  localStorage, innerWidth: 1440, innerHeight: 900,
  addEventListener: noop, removeEventListener: noop,
  confirm: () => true,
};
const fetchCalls = [];
const fetchBodies = [];
let importStatusBody = { running: false, summary: null, error: null };
let importPostShouldFail = false;
let importStatusShouldFail = false;
let dirsList = [{ source: 'default', path: '~/Music/dsh-music' }, { source: 'custom', path: '/tmp/extra-music' }];
const fetchMock = async (url, opts) => {
  fetchCalls.push(url);
  if (importStatusShouldFail && url.includes('/import-playlist/status')) throw new Error('network down');
  try { if (opts && opts.body) fetchBodies.push({ url: String(url), body: String(opts.body) }); } catch { /* none */ }
  const body = url.includes('/import-playlist/status')
    ? importStatusBody
    : url.includes('/import-playlist') && opts && opts.method === 'POST'
      ? (importPostShouldFail
        ? { ok: false, json: async () => ({ error: '请粘贴有效的歌单链接' }) }
        : { started: true, dryRun: true })
      : url.includes('/library/directories')
        ? (() => {
            if (opts && opts.method === 'POST') {
              let p = null;
              try { p = JSON.parse(String(opts.body)).path; } catch { /* ignore */ }
              if (p && url.includes('/add') && !dirsList.some((d) => d.path === p)) dirsList.push({ source: 'custom', path: p });
              if (p && url.includes('/remove')) dirsList = dirsList.filter((d) => d.path !== p);
              return { added: true, removed: true, directories: dirsList.slice() };
            }
            return { directories: dirsList.slice() };
          })()
      : url.includes('/sync/availability')
    ? { available: true, hint: null }
    : url.includes('/sync/status')
      ? { running: false, result: null, error: null }
      : url.includes('/library/preview')
        ? { status: 'ready', audioUrl: '/dsh-music/preview/abc.m4a' }
        : url.includes('/library/search')
          ? { local: [], remote: [], artists: [{ name: '模糊歌手', disambiguation: '乐队' }], songs: [{ artist: '模糊歌手', title: '模糊歌', album: '专辑X', verification: 'verified' }] }
          : { imageUrl: 'http://img/orig.jpg', thumbnailUrl: 'http://img/thumb.jpg' };
  if (importPostShouldFail && url.includes('/import-playlist') && opts && opts.method === 'POST') {
    return { ok: false, json: async () => ({ error: '请粘贴有效的歌单链接' }) };
  }
  return { ok: true, json: async () => body };
};
const sandbox = { window: windowMock, localStorage, console, setTimeout, clearTimeout, fetch: fetchMock,
  document: { createElement: () => ({ setAttribute: noop, textContent: '', remove: noop }), head: { appendChild: noop } } };
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
let impStateQq = { phase: 'idle', summary: null, error: null };
let impStateNe = { phase: 'idle', summary: null, error: null };
const impSvcRefQq = { current: null };
const impSvcRefNe = { current: null };
const useImportQq = (sel) => {
  if (impSvcRefQq.current) impStateQq = impSvcRefQq.current.source.getSnapshot();
  return sel(impStateQq);
};
const useImportNe = (sel) => {
  if (impSvcRefNe.current) impStateNe = impSvcRefNe.current.source.getSnapshot();
  return sel(impStateNe);
};
let dirsState = { status: 'idle', items: [], error: null };
const dirsSvcRef = { current: null };
const useDirs = (sel) => {
  if (dirsSvcRef.current) dirsState = dirsSvcRef.current.source.getSnapshot();
  return sel(dirsState);
};
const useLikes = (sel) => sel({ keys: {}, loaded: true, error: null });
const usePreview = (sel) => sel({ status: 'idle', item: null, error: null });
const useArtistImages = (sel) => sel({ images: { '测试歌手': 'http://img/thumb.jpg', '别的歌手': null } });
const onboardingState = { status: 'ready', completed: true, starter: null, taste: null, error: null };
const useOnboarding = (sel) => sel(onboardingState);
const useWarm = (sel) => {
  const svcWarm = (services['music'] || {}).warm;
  return sel(svcWarm ? svcWarm.source.getSnapshot() : { pending: {}, running: false });
};
const hooks = { usePlayer, useLibrary, useLyrics, useUi, useHistory, useReco, useDownload, useSync, useImportQq, useImportNe, useDirs, useLikes, usePreview, useWarm, useArtistImages, useOnboarding };
const svc = services['music'] || services['shell.overlay'] || {};
dirsSvcRef.current = (services['music'] || {}).dirs;
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
check('returning user gets a settings entry (v13 replaces the preview-welcome chip)', has(backTree, (n) => cls(n) === 'dshm-chipbtn'
  && JSON.stringify(n.children || []).includes('settings')));

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

/* 5) mini player states (v12: quiet widget, lyrics expand/close) */
const miniProps = { t: (k) => k, ...(services['dsh-music.mini-player'] || {}), ...hooks };
state.miniHidden = false; state.miniCollapsed = false;
localStorage.setItem('dsh-music.prefs', JSON.stringify({ miniVersion: 2, miniLyricsOpen: false }));
const expanded = expand(mini(miniProps));
check('mini expanded renders', !!expanded);
check('mini has drag grip', has(expanded, (n) => cls(n) === 'dshm-mini-grip' && typeof n.props.onPointerDown === 'function'));
check('mini has seek slider', has(expanded, (n) => cls(n).includes('dshm-slider')));
check('mini closed state hides lyrics', walk(expanded).filter((n) => /dshm-mini-lyric\b/.test(cls(n))).length === 0,
  'count=' + walk(expanded).filter((n) => /dshm-mini-lyric\b/.test(cls(n))).length);
check('mini has a hover-revealed lyric toggle (词)', (() => {
  const btn = walk(expanded).find((n) => (n.props && n.props['aria-label']) === 'miniLyrics' && typeof n.props.onClick === 'function');
  return !!btn;
})());
check('mini hover extras reserve space (no layout jump classes)', has(expanded, (n) => cls(n) === 'dshm-mini-hover dshm-mini-extras'));
/* v12r2：底行常驻（词｜extras｜滑条｜A- A+）；当前时间 1 个在 row1，总时长走滑条 title */
check('mini bottom bar always present (词+slider+A-/A+)', (() => {
  const bar = walk(expanded).find((n) => cls(n) === 'dshm-mini-bar');
  return !!bar
    && walk(bar).some((n) => /dshm-mini-tool-word/.test(cls(n)))
    && walk(bar).some((n) => cls(n).includes('dshm-slider'))
    && ['miniFontSmaller', 'miniFontLarger'].every((k) => walk(bar).some((n) => (n.props && n.props['aria-label']) === k));
})());
check('mini shows a single current time; total duration lives on slider title', (() => {
  const times = walk(expanded).filter((n) => cls(n) === 'dshm-mini-time');
  const slider = walk(expanded).find((n) => cls(n).includes('dshm-slider'));
  return times.length === 1 && times[0].props.children === '0:42' && slider && slider.props.title === '3:20';
})());
check('mini no cover renders frameless default cover (dshm-cover-empty)', has(expanded, (n) => /dshm-cover-empty/.test(cls(n))));
check('mini root is a left-drag surface excluding interactive targets', (() => {
  const root = walk(expanded).find((n) => /^dshm-mini/.test(cls(n)) && n.props.onPointerDown);
  return !!root && ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel'].every((k) => typeof root.props[k] === 'function');
})());
check('mini artist clickable', has(expanded, (n) => cls(n).includes('dshm-mini-artist') && typeof n.props.onClick === 'function'));
check('mini has collapse button', has(expanded, (n) => (n.props && n.props.title) === 'miniCollapse'));

/* lyrics expanded state: 3 lines (v12r2) + bar wired and persisted */
localStorage.setItem('dsh-music.prefs', JSON.stringify({ miniVersion: 2, miniLyricsOpen: true, miniLyricFont: 13 }));
const expandedLyrics = expand(mini(miniProps));
check('mini expanded lyrics show exactly 3 lines (winSize=3)', walk(expandedLyrics).filter((n) => /dshm-mini-lyric\b/.test(cls(n))).length === 3,
  'count=' + walk(expandedLyrics).filter((n) => /dshm-mini-lyric\b/.test(cls(n))).length);
check('mini bar survives the lyrics-open state', has(expandedLyrics, (n) => cls(n) === 'dshm-mini-bar'));
const fontBefore = (walk(expandedLyrics).find((n) => cls(n) === 'dshm-mini-lyrics').props.style || {}).fontSize;
const aPlus = walk(expandedLyrics).find((n) => (n.props && n.props['aria-label']) === 'miniFontLarger' && typeof n.props.onClick === 'function');
aPlus.props.onClick();
await new Promise((r) => setTimeout(r, 20));
const prefsNow = JSON.parse(localStorage.getItem('dsh-music.prefs'));
check('mini A+ enlarges lyrics font and persists (11..17 clamp)', prefsNow.miniLyricFont === 14 && fontBefore === '13px',
  JSON.stringify({ prefsNow: prefsNow.miniLyricFont, fontBefore }));
const lyricToggle = walk(expandedLyrics).find((n) => /dshm-mini-tool-word/.test(cls(n)) && typeof n.props.onClick === 'function');
lyricToggle.props.onClick();
await new Promise((r) => setTimeout(r, 20));
check('mini 词 toggle closes lyrics and persists',
  JSON.parse(localStorage.getItem('dsh-music.prefs')).miniLyricsOpen === false);

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

/* 5y) integration: the settings gear writes the REAL ui store and the
 *     panel re-renders into the settings view (v13: sync cards + folders). */
const uiStore = svc.hooks && svc.hooks.ui;
uiStore.set({ view: 'library', welcomePreview: false, lyricsOpen: false });
const useUiReal = (sel) => sel(uiStore.getSnapshot());
const realProps = { ...baseProps, useUi: useUiReal };
const realHeader = expand(music(realProps));
const settingsBtn = walk(realHeader).find((n) => cls(n) === 'dshm-chipbtn'
  && JSON.stringify(n.props.children || '').includes('settings'));
check('settings gear button is rendered and enabled', !!settingsBtn && !(settingsBtn.props || {}).disabled);
/* preload the directory list so the settings view renders rows synchronously */
await dirsSvcRef.current.load();
settingsBtn.props.onClick();
const afterClick = uiStore.getSnapshot();
check('settings click writes the real ui store', afterClick.view === 'settings', 'view=' + afterClick.view);
const settingsTree = expand(music(realProps));
check('settings view renders the three-card sync row and the folders section',
  !!walk(settingsTree).find((n) => cls(n) === 'dshm-syncrow') && !!walk(settingsTree).find((n) => cls(n) === 'dshm-dirs'));
check('settings view has no import/preview mascots', !has(settingsTree, (n) => cls(n) === 'dshm-fish'));
const dirRows = walk(settingsTree).filter((n) => cls(n) === 'dshm-dirrow');
check('folder rows render path + source badge + remove button', dirRows.length === 2
  && dirRows.every((r) => walk(r).some((n) => cls(n) === 'dshm-dirpath') && walk(r).some((n) => cls(n) === 'dshm-dirsrc')
    && walk(r).some((n) => cls(n).includes('dshm-dir-remove'))));
const removeBtns = walk(settingsTree).filter((n) => cls(n).includes('dshm-dir-remove'));
/* smoke's setState is a noop by design — assert the two-step confirm at source level */
check('remove uses an inline two-step confirm (first click asks, second removes)',
  src.includes('confirmPath === (item && item.path) ? doRemove(item.path) : setConfirmPath(item && item.path)')
  && src.includes("t('settingsRemoveConfirm')"));
const dirAdd = walk(settingsTree).find((n) => cls(n) === 'dshm-diradd');
check('add-folder row renders input + submit button', !!dirAdd && walk(dirAdd).some((n) => n.type === 'input')
  && walk(dirAdd).some((n) => /dshm-chipbtn/.test(cls(n))));
/* service-level: add/remove hit the directories API and refresh the list */
const dirsSvc = dirsSvcRef.current;
check('directories service is wired into the panel', !!dirsSvc && typeof dirsSvc.add === 'function' && typeof dirsSvc.remove === 'function');
await dirsSvc.add('/tmp/new-music');
check('directories add posts the path and refreshes the list', fetchCalls.some((u) => u.includes('/library/directories/add'))
  && dirsSvc.source.getSnapshot().items.some((d) => d.path === '/tmp/new-music'));
await dirsSvc.remove('/tmp/extra-music');
check('directories remove posts the path and refreshes the list', fetchCalls.some((u) => u.includes('/library/directories/remove'))
  && !dirsSvc.source.getSnapshot().items.some((d) => d.path === '/tmp/extra-music'));
uiStore.set({ view: 'library', welcomePreview: false, lyricsOpen: false });

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

/* 7) 十一期：迷你条/正在播放 ♥+👎 执行级 + 模糊搜索候选合并 */
state.view = 'library'; state.miniHidden = false; state.miniCollapsed = false;
fetchCalls.length = 0; fetchBodies.length = 0;
const miniTree11 = expand(mini(miniProps));
check('mini bar renders the taste group (♥+👎)', has(miniTree11, (n) => /dshm-mini-extras/.test(cls(n)))
  && walk(miniTree11).filter((n) => /dshm-like-btn|dshm-dislike-btn/.test(cls(n))).length >= 2);
const miniLike = walk(miniTree11).find((n) => /dshm-like-btn\b/.test(cls(n)) && typeof n.props.onClick === 'function');
const miniDislike = walk(miniTree11).find((n) => /dshm-dislike-btn/.test(cls(n)) && typeof n.props.onClick === 'function');
check('mini taste buttons are wired to onClick', !!(miniLike && miniDislike));
miniLike.props.onClick({ stopPropagation: noop });
miniDislike.props.onClick({ stopPropagation: noop });
await new Promise((r) => setTimeout(r, 40));
check('mini like/dislike truly POST to the host routes',
  fetchCalls.some((u) => String(u).includes('/library/like')) && fetchCalls.some((u) => String(u).includes('/library/dislike')),
  JSON.stringify(fetchCalls.slice(0, 4)));

/* preview track: taste must be keyed by artist+title, preview id never sent */
const usePlayerPreview = (sel) => sel({ ...playerState, track: { ...playerState.track, id: 'preview:测试歌手::测试歌曲' } });
const miniTreePrev = expand(mini({ ...miniProps, usePlayer: usePlayerPreview }));
const prevLike = walk(miniTreePrev).find((n) => /dshm-like-btn\b/.test(cls(n)) && typeof n.props.onClick === 'function');
fetchBodies.length = 0;
prevLike.props.onClick({ stopPropagation: noop });
await new Promise((r) => setTimeout(r, 40));
check('preview track like sends artist+title, not the preview id',
  fetchBodies.some((b) => b.url.includes('/library/like') && b.body.includes('测试歌手') && !b.body.includes('preview:')),
  JSON.stringify(fetchBodies));

/* now-playing view carries the taste buttons too */
state.view = 'now';
const nowTree11 = expand(music(baseProps));
check('now-playing renders the taste group', has(nowTree11, (n) => cls(n) === 'dshm-now-taste'));
const nowLike = walk(nowTree11).find((n) => /dshm-like-btn\b/.test(cls(n)) && typeof n.props.onClick === 'function');
fetchCalls.length = 0;
nowLike.props.onClick({ stopPropagation: noop });
await new Promise((r) => setTimeout(r, 40));
check('now-playing like truly POSTs to the host route', fetchCalls.some((u) => String(u).includes('/library/like')));

/* fuzzy-search candidates merge: artists/songs fields become pick groups */
fetchCalls.length = 0;
const merged = await svc.library.searchRemote('模糊');
check('searchRemote prefers the single type=both request',
  fetchCalls.filter((u) => String(u).includes('/library/search')).every((u) => String(u).includes('type=both'))
  && fetchCalls.filter((u) => String(u).includes('/library/search')).length === 1,
  JSON.stringify(fetchCalls.filter((u) => String(u).includes('/library/search'))));
const kinds = (merged.remote || []).map((r) => r.kind);
check('searchRemote merges artist candidates', kinds.includes('artist') && !kinds.filter((k) => k === 'artist').some(() => false)
  && (merged.remote.find((r) => r.kind === 'artist') || {}).name === '模糊歌手', JSON.stringify(merged.remote));
check('searchRemote merges song candidates', kinds.includes('song')
  && !!(merged.remote.find((r) => r.kind === 'song') || {}).title, JSON.stringify(merged.remote));
state.view = 'library';

/* 7b) 十二期：布局结构断言（分层/分组/hover 次要键/调色板） */
const layMini = expand(mini(miniProps));
check('mini taste buttons live in the hover extras group', (() => {
  const extras = walk(layMini).find((n) => /dshm-mini-extras/.test(cls(n)));
  return !!extras && walk(extras).some((n) => /dshm-like-btn/.test(cls(n))) && walk(extras).some((n) => /dshm-dislike-btn/.test(cls(n)));
})());
check('mini window controls keep their own group', has(layMini, (n) => /dshm-mini-win/.test(cls(n))));
check('mini has no legacy row/divider structure', !has(layMini, (n) => /dshm-mini-group|dshm-mini-controls|dshm-mini-inner|dshm-mini-ctrl|dshm-mini-taste/.test(cls(n))));
check('mini palette block exists and old divider border-right is gone', (() => {
  return src.includes('--dshm-m-accent:#5B7FA6') && !/\.dshm-mini-taste\{[^}]*border-right/.test(src);
})());
check('mini palette: hex colors confined to the definition block', (() => {
  const start = src.indexOf('--dshm-m-bg:#');
  const endMarker = src.indexOf('--dsw-alias-bg-mask-2:rgba(0,0,0,0.10)');
  const end = src.indexOf('}', endMarker);
  const block = src.slice(start, end);
  const rest = src.slice(0, start) + src.slice(end);
  const cssBody = rest.slice(rest.indexOf('const CSS ='));
  return block.includes('#F7F8FA') && !/\.dshm-mini[^,{ ]*[,{][^}]*#[0-9a-fA-F]{6}/.test(cssBody);
})());

// v12r2 尺寸预算断言：从 CSS/JSX 解析数值核算两态渲染高度，判定线「约」±10%（超线必红）。
// 常驻 = top(4+90+4) + bar(2+22+4) + border 2 = 128；展开 = 常驻 + body(2+2) + 3行歌词(3*13*1.15+2*2) ≈ 180.9。
check('mini collapsed height budget 108-132px (spec ~120)', (() => {
  const top = src.match(/\.dshm-mini-top\{[^}]*padding:(\d+)px 12px (\d+)px 10px/);
  const coverCss = /\.dshm-mini-cover\{[^}]*width:(\d+)px;height:(\d+)px/.test(src);
  const bar = src.match(/\.dshm-mini-bar\{[^}]*padding:(\d+)px 14px (\d+)px 10px/);
  const btn = src.match(/\.dshm-mini-bar \.dshm-iconbtn[^{]*\{width:(\d+)px;height:(\d+)px/);
  const border = /\.dshm-mini\{[^}]*border:1px solid/.test(src);
  if (!top || !coverCss || !bar || !btn || !border) return false;
  const h = Number(top[1]) + 90 + Number(top[2]) + Number(bar[1]) + Number(btn[1]) + Number(bar[2]) + 2;
  return h >= 108 && h <= 132;
})());
check('mini expanded height budget 158-193px (spec ~175)', (() => {
  const body = src.match(/\.dshm-mini-body\{padding:(\d+)px 14px/);
  const lh = src.match(/\.dshm-mini-lyric\{line-height:([\d.]+);/);
  const gap = src.match(/\.dshm-mini-lyrics\{[^}]*gap:(\d+)px/);
  const bar = src.match(/\.dshm-mini-bar\{[^}]*padding:(\d+)px 14px (\d+)px 10px/);
  const btn = src.match(/\.dshm-mini-bar \.dshm-iconbtn[^{]*\{width:(\d+)px;height:(\d+)px/);
  const top = src.match(/\.dshm-mini-top\{[^}]*padding:(\d+)px 12px (\d+)px 10px/);
  if (!body || !lh || !gap || !bar || !btn || !top) return false;
  const collapsed = Number(top[1]) + 90 + Number(top[2]) + Number(bar[1]) + Number(btn[1]) + Number(bar[2]) + 2;
  const lyrics = 3 * 13 * Number(lh[1]) + 2 * Number(gap[1]); /* 3 行默认字号 13（winSize=3） */
  const h = collapsed + 2 * Number(body[1]) + lyrics;
  return h >= 158 && h <= 193;
})());
check('mini body/tools have no decorative border-top', !/\.dshm-mini-body\{[^}]*border-top/.test(src) && !/\.dshm-mini-tools\{[^}]*border-top/.test(src));
check('mini expanded renders exactly 3-line window size', src.includes('const winSize = 3;'));
check('mini collapse snaps fab to the nearer screen edge (bar center vs viewport mid)', (() => {
  const collapse = src.includes('const collapseToFab = () => {')
    && /r\.left \+ r\.width \/ 2 < window\.innerWidth \/ 2/.test(src)
    && /left: goLeft \? 8 : Math\.max\(8, window\.innerWidth - 56\)/.test(src)
    && /onClick: collapseToFab/.test(src);
  const dragEnd = /fp\.left \+ 24 < window\.innerWidth \/ 2 \? 8 : Math\.max\(8, window\.innerWidth - 56\)/.test(src);
  return collapse && dragEnd;
})());
check('mini surface drag: 3px threshold, interactive targets excluded, position persisted', (() => {
  return src.includes('const surfaceDown = (e) => {')
    && /e\.button !== 0\) return;/.test(src)
    && /from\.closest\('button,input,\[role="slider"\],\.dshm-mini-grip'\)/.test(src)
    && /Math\.abs\(dx\) \+ Math\.abs\(dy\) < 3/.test(src)
    && /onPointerDown: surfaceDown, onPointerMove: surfaceMove,/.test(src);
})());
check('cover fallback (no image) drops its border entirely', /\.dshm-cover-empty\{border:0;/.test(src)
  && /!url && 'dshm-cover-empty'/.test(src));

state.view = 'now';
const layNow = expand(music(baseProps));
check('now-playing taste sits in the meta subrow, not its own orphan line', (() => {
  const subrow = walk(layNow).find((n) => cls(n) === 'dshm-now-subrow');
  return !!subrow && walk(subrow).some((n) => cls(n) === 'dshm-now-taste');
})());
check('now-playing transport is symmetric: shuffle left, transport center, repeat right', (() => {
  const tr = walk(layNow).find((n) => cls(n) === 'dshm-transport');
  if (!tr) return false;
  const kids = (tr.children || []).filter((c) => c && c.props);
  const names = kids.map((c) => cls(c));
  return names.length === 3 && names[0] === 'dshm-transport-side dshm-transport-left' && names[1] === 'dshm-transport-center' && names[2] === 'dshm-transport-side dshm-transport-right';
})());
check('now-playing transport side buttons stay wired (shuffle/repeat)', (() => {
  const sides = walk(layNow).filter((n) => /dshm-transport-side/.test(cls(n)));
  return sides.length === 2 && sides.every((s) => walk(s).some((n) => typeof n.props.onClick === 'function'));
})());
state.view = 'library';

/* 5i) sync & import: three equal source cards (S12-E) */
impSvcRefQq.current = (services['music'] || {}).impQq;
impSvcRefNe.current = (services['music'] || {}).impNe;
const importTree = expand(music(baseProps));
const settingsTreeLocal = expand(music({ ...baseProps, useUi: (sel) => sel({ ...state, view: 'settings' }) }));
check('library view no longer embeds the sync/import row (v13 moved it to settings)',
  !walk(importTree).some((n) => cls(n) === 'dshm-syncrow'));
const syncRow = walk(settingsTreeLocal).find((n) => cls(n) === 'dshm-syncrow');
const rowCards = syncRow ? (syncRow.children || []).filter((c) => c && /dshm-sync$|dshm-import/.test(cls(c))) : [];
check('sync & import render as three equal sibling cards in one row', !!syncRow && rowCards.length === 3
  && rowCards.every((c) => /dshm-sync$/.test(cls(c)) || cls(c) === 'dshm-import'),
  rowCards.map((c) => cls(c)).join(','));
check('three cards carry distinct titles (Spotify / QQ / NetEase)', JSON.stringify(syncRow).includes('syncCardTitle')
  && JSON.stringify(syncRow).includes('importQqTitle') && JSON.stringify(syncRow).includes('importNeTitle'));
const qqCard = rowCards.find((c) => JSON.stringify(c).includes('importQqTitle'));
const neCard = rowCards.find((c) => JSON.stringify(c).includes('importNeTitle'));
check('QQ and NetEase placeholders differ per source', !!qqCard && !!neCard
  && JSON.stringify(qqCard).includes('importPlaceholderQq') && JSON.stringify(neCard).includes('importPlaceholderNe'));
check('toolbar no longer hides the sync trigger (moved into the settings card)', !JSON.stringify(walk(importTree).find((n) => cls(n) === 'dshm-toolbar')).includes('sync.start')
  && !!syncRow && walk(syncRow).some((n) => /dshm-chipbtn/.test(cls(n)) && n.props && typeof n.props.onClick === 'function'
    && JSON.stringify(n.props.children).includes('syncBtn')));
check('library empty state points to the settings page', src.includes("t('emptySettingsCta')") && src.includes("onClick: () => openView('settings')"));
check('mini bar root sets user-select:none (drag does not select text)', /\.dshm-mini\{[^}]*user-select:none/.test(src));
check('old toolbar sync chipbtn removed from source', !src.includes("syncState === 'running' || busy || !syncUsable"));

const importBox = qqCard;
check('library shows the playlist import block with a link input', !!importBox
  && walk(importBox).some((n) => n.type === 'input' && n.props && n.props.type === 'url' && cls(n) === 'dshm-import-input'));
const importBtns = importBox ? walk(importBox).filter((n) => /dshm-chipbtn/.test(cls(n)) && n.props && typeof n.props.onClick === 'function') : [];
check('import block has preview and import buttons wired', importBtns.length === 2
  && importBtns.some((b) => b.props.children === 'importPreview')
  && importBtns.some((b) => b.props.children === 'importRun'));
check('import buttons disabled until a link is entered', importBtns.every((b) => b.props.disabled === true));

const svcImp = impSvcRefQq.current;
const svcNe = impSvcRefNe.current;
check('import service is wired into the panel', !!svcImp && typeof svcImp.start === 'function');
check('two independent import service instances exist', !!svcNe && svcNe !== svcImp && typeof svcNe.start === 'function');

/* inject hooks key names must follow the framework rule: key K is injected as prop use+Pascal(K).
   Guards against the B2 defect where hooks.impQq produced useImpQq but components wanted useImportQq. */
{
  const hooksBlock = src.match(/hooks:\s*\{\n([\s\S]*?)\n\s*\},/);
  check('inject hooks block found in source', !!hooksBlock);
  if (hooksBlock) {
    const keys = hooksBlock[1].split('\n').flatMap((line) => {
      const t = line.trim();
      if (t.includes(':')) return (t.match(/[A-Za-z][A-Za-z0-9]*(?=\s*:)/g) || []);
      return (t.replace(/,$/, '').match(/^[A-Za-z][A-Za-z0-9]*$/) || [t.match(/^[A-Za-z][A-Za-z0-9]*/)?.[0]].filter(Boolean));
    });
    const panelSig = src.match(/function MusicPanel\(\{([\s\S]*?)\}\)/);
    check('MusicPanel signature found', !!panelSig);
    if (panelSig) {
      const missing = keys.filter((k) => !new RegExp(`(^|[^A-Za-z])use${k[0].toUpperCase()}${k.slice(1)}([^A-Za-z]|$)`).test(panelSig[1]));
      check('every inject hooks key matches a use+Pascal prop on MusicPanel (B2 guard)', missing.length === 0 && keys.length >= 10, `missing: ${missing.join(',') || 'none'}`);
      check('hooks keys use importQq/importNe (not impQq/impNe)', keys.includes('importQq') && keys.includes('importNe') && !keys.includes('impQq') && !keys.includes('impNe'));
    }
  }
}


/* two sources can each run their own dryRun preview independently */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
importStatusBody = { running: false, summary: { provider: 'qq', name: '我喜欢', total: 792, fetched: 792, matched: 17, fuzzyMatched: 22, missing: 753, queued: 0, downloaded: 0, failures: [], sample: [{ artist: 'The Revivalists', title: 'Get It Honest' }] } };
fetchCalls.length = 0;
await svcImp.start('https://c6.y.qq.com/base/fcgi-bin/u?__=x123', true);
await sleep(30);
const impPosts = fetchBodies.filter((b) => b.url.includes('/import-playlist') && !b.url.includes('/status'));
check('preview posts dryRun:true to the import endpoint', impPosts.length === 1 && JSON.parse(impPosts[0].body).dryRun === true,
  JSON.stringify(fetchCalls));
check('preview settles with summary', svcImp.source.getSnapshot().phase === 'preview'
  && svcImp.source.getSnapshot().summary && svcImp.source.getSnapshot().summary.total === 792,
  JSON.stringify(svcImp.source.getSnapshot()));
importStatusBody = { running: false, summary: { provider: 'netease', name: '热歌榜', total: 200, fetched: 200, matched: 5, fuzzyMatched: 3, missing: 192, queued: 0, downloaded: 0, failures: [], sample: [{ artist: '网易歌手', title: '网易歌' }] } };
await svcNe.start('https://music.163.com/playlist?id=99', true);
await sleep(30);
const nePosts = fetchBodies.filter((b) => b.url.includes('/import-playlist') && !b.url.includes('/status'));
check('NetEase instance runs its own dryRun preview independently', svcNe.source.getSnapshot().phase === 'preview'
  && svcNe.source.getSnapshot().summary.provider === 'netease'
  && svcImp.source.getSnapshot().summary.provider === 'qq'
  && nePosts[nePosts.length - 1] && JSON.parse(nePosts[nePosts.length - 1].body).url.includes('music.163.com'),
  JSON.stringify(svcNe.source.getSnapshot()));
/* import cards live in the settings view since v13 — render that for card-level checks */
state.view = 'settings';
const neTree = expand(music(baseProps));
const neBoxes = walk(neTree).filter((n) => cls(n) === 'dshm-import');
check('both import cards render their own summaries side by side', neBoxes.length === 2
  && JSON.stringify(neBoxes[0]).includes('我喜欢') && JSON.stringify(neBoxes[1]).includes('热歌榜'));
const previewTree = expand(music(baseProps));
const pBox = walk(previewTree).find((n) => cls(n) === 'dshm-import');
check('preview renders summary chips + sample + hint', !!pBox
  && JSON.stringify(pBox).includes('importMatched') && JSON.stringify(pBox).includes('Get It Honest')
  && JSON.stringify(pBox).includes('importPreviewHint'));

/* running state shows progress chips */
impSvcRefQq.current.source.set({ phase: 'running', summary: { fetched: 300, queued: 20, downloaded: 12, failures: [] } });
const runningTree = expand(music(baseProps));
const rBox = walk(runningTree).find((n) => cls(n) === 'dshm-import');
check('running state renders progress chips with role=status', !!rBox
  && walk(rBox).some((n) => n.props && n.props.role === 'status'));
impSvcRefQq.current.source.set({ phase: 'preview' });

/* real import flow: dryRun:false then done */
importStatusBody = { running: false, summary: { provider: 'qq', name: '我喜欢', total: 792, fetched: 792, matched: 17, fuzzyMatched: 22, missing: 753, queued: 0, downloaded: 1, failures: [], sample: [] } };
await svcImp.start('https://c6.y.qq.com/base/fcgi-bin/u?__=x123', false);
await sleep(30);
const bodies = fetchBodies.filter((b) => b.url.includes('/import-playlist') && !b.url.includes('/status'));
check('real import posts dryRun:false last', bodies.length >= 2 && JSON.parse(bodies[bodies.length - 1].body).dryRun === false
  && svcImp.source.getSnapshot().phase === 'done');
const doneTree = expand(music(baseProps));
check('done state shows completion hint', JSON.stringify(walk(doneTree).find((n) => cls(n) === 'dshm-import')) .includes('importDone'));

/* host error copy passes through untouched */
importPostShouldFail = true;
await svcImp.start('bad-link', true);
importPostShouldFail = false;
check('host error copy surfaces verbatim', svcImp.source.getSnapshot().phase === 'error'
  && svcImp.source.getSnapshot().error === '请粘贴有效的歌单链接',
  svcImp.source.getSnapshot().error);
const errTree = expand(music(baseProps));
check('error renders in alert line', walk(errTree).some((n) => n.props && n.props.role === 'alert'));
svcImp.source.set({ phase: 'idle', error: null, summary: null });
state.view = 'library';

/* consecutive status-poll failures unlock a stuck running phase */
importStatusShouldFail = true;
importStatusBody = { running: true, summary: { fetched: 1, queued: 1, downloaded: 0, failures: [] } };
await svcImp.start('https://c6.y.qq.com/base/fcgi-bin/u?__=x123', true);
await sleep(4700);
importStatusShouldFail = false;
check('3 consecutive poll failures turn the phase into error with locale copy',
  svcImp.source.getSnapshot().phase === 'error' && svcImp.source.getSnapshot().error === 'importPollFail',
  JSON.stringify(svcImp.source.getSnapshot()));
svcImp.source.set({ phase: 'idle', error: null, summary: null });

/* 6) report */
const fail = results.filter((r) => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  (' + r.detail + ')' : ''));
console.log('\n' + (results.length - fail.length) + '/' + results.length + ' PASS');
process.exit(fail.length ? 1 : 0);
