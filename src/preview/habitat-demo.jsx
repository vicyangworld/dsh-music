/* Conversation preview of the actual Habitat component. All services below
 * are local demo adapters. They do not read or write a user's music or archive,
 * and the player intentionally emits no audio. Production uses Harness stores. */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createEchoUI } from '../client/echo/ui.js';
import { createLife, applyLifeEvent, getMorphology } from '../../bundle/shared/life-core.js';

const root = document.getElementById('echo-continuous-world');
if (!root) throw new Error('Missing ECHO preview root');
const mount = root.querySelector('[data-echo-mount]');
function store(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    set: patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); },
  };
}
const hook = source => selector => selector(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot));
const tracks = [
  { id: 'ec00000000000001', title: '折线', artist: 'ECHO · 示例音轨', album: '界面交互演示', genre: 'electronic', duration: 90, audioUrl: 'demo:fold' },
  { id: 'ec00000000000002', title: '潮汐', artist: 'ECHO · 示例音轨', album: '界面交互演示', genre: 'ambient', duration: 90, audioUrl: 'demo:tide' },
  { id: 'ec00000000000003', title: '余响', artist: 'ECHO · 示例音轨', album: '界面交互演示', genre: 'instrumental', duration: 90, audioUrl: 'demo:echo' },
];
const bornAt = Date.now() - 3 * 86400000;
let initial;
for (let index = 0; index < 100; index++) {
  const life = createLife({ seed: `echo-world-demo-${index}`, now: bornAt, name: '小序' });
  if (life.genome.structure === 'fold') { initial = life; break; }
}
let life = initial;
const events = [];
function evolve(event) { events.push(event); life = applyLifeEvent(life, event); }
for (let index = 0; index < 40; index++) evolve({
  id: `demo-listening-${index}`, type: 'listening', at: bornAt + (index + 1) * 30000,
  sessionId: 'explicit-simulated-preview', track: tracks[index < 20 ? 0 : 1],
  listenedMs: 30000, featureSource: 'audio', features: index < 20
    ? { energy: 0.68, brightness: 0.6, rhythm: 0.7, texture: 0.42 }
    : { energy: 0.24, brightness: 0.32, rhythm: 0.18, texture: 0.52 },
});
evolve({ id: 'demo-greeting', type: 'greeting', at: bornAt + 1201000, pattern: [180, 360] });
evolve({ id: 'demo-memory-one', type: 'memory', at: bornAt + 1202000, title: '第一次一起听', note: '这是一段示例记忆。你可以回看它，也可以试着留下自己的文字。', track: tracks[0] });
evolve({ id: 'demo-memory-two', type: 'memory', at: bornAt + 1203000, title: '让旋律慢下来', note: '在同一个空间里，回到被留下的那一刻。', track: tracks[1] });
const lifeSource = store({ status: 'ready', life, morphology: getMorphology(life), audioStatus: 'none', pending: 0, rejectedCount: 0, volatileCount: 0 });
let sequence = 0;
const lifeService = {
  source: lifeSource,
  load: async () => lifeSource.getSnapshot(), retry: async () => {},
  dispatch: async (type, payload) => {
    evolve({ ...payload, id: `demo-action-${++sequence}`, type, at: Date.now() });
    lifeSource.set({ life, morphology: getMorphology(life) });
    return lifeSource.getSnapshot();
  },
  exportArchive: async () => ({ format: 'echo-life-archive', demo: true, initial, events, life }),
  exportOutbox: () => ({ demo: true, pending: [] }),
};
const playerSource = store({ track: null, queue: [], queueIndex: -1, playing: false, loading: false, position: 0, duration: 0, volume: 0.7, muted: false, shuffle: false, repeat: 'off', error: null });
function playIndex(index) {
  const state = playerSource.getSnapshot();
  if (!state.queue.length) return;
  const next = (index + state.queue.length) % state.queue.length;
  playerSource.set({ track: state.queue[next], queueIndex: next, position: 0, duration: state.queue[next].duration, playing: true, loading: false, error: null });
}
const player = {
  source: playerSource,
  playTracks: (queue, index = 0) => { playerSource.set({ queue: [...queue] }); playIndex(index); },
  play: () => { if (playerSource.getSnapshot().track) playerSource.set({ playing: true }); },
  pause: () => playerSource.set({ playing: false }),
  toggle: () => { const state = playerSource.getSnapshot(); if (state.track) playerSource.set({ playing: !state.playing }); },
  prev: () => playIndex(playerSource.getSnapshot().queueIndex - 1),
  next: () => playIndex(playerSource.getSnapshot().queueIndex + 1),
  jumpTo: playIndex,
  seek: value => playerSource.set({ position: Math.max(0, Math.min(playerSource.getSnapshot().duration, Number(value) || 0)) }),
  setVolume: volume => playerSource.set({ volume: Math.max(0, Math.min(1, volume)), muted: false }),
  toggleMute: () => playerSource.set({ muted: !playerSource.getSnapshot().muted }),
  cycleMode: () => { const state = playerSource.getSnapshot(); playerSource.set(state.shuffle ? { shuffle: false, repeat: 'one' } : state.repeat === 'one' ? { repeat: 'off' } : { shuffle: true, repeat: 'off' }); },
};
const timer = window.setInterval(() => {
  const state = playerSource.getSnapshot();
  if (document.hidden || !state.playing || !state.track) return;
  const next = state.position + 0.25;
  if (next < state.duration) playerSource.set({ position: next });
  else if (state.repeat === 'one') playerSource.set({ position: 0 });
  else player.next();
}, 250);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });

const key = item => `${item.artist || ''}::${item.title || ''}`.toLowerCase();
const likedTrack = tracks[1];
const likeSource = store({ loaded: true, error: null, keys: { [key(likedTrack)]: true }, items: [{ ...likedTrack, key: key(likedTrack), trackId: likedTrack.id }], dislikes: {} });
function preference(item, type, value) {
  const current = likeSource.getSnapshot();
  const keys = { ...current.keys }, dislikes = { ...current.dislikes }, id = key(item);
  if (type === 'like') { if (value) { keys[id] = true; delete dislikes[id]; } else delete keys[id]; }
  else if (value) { dislikes[id] = true; delete keys[id]; } else delete dislikes[id];
  likeSource.set({ keys, dislikes, items: tracks.filter(track => keys[key(track)]).map(track => ({ ...track, key: key(track), trackId: track.id })) });
  return Promise.resolve({ ok: true, key: id });
}
const likes = {
  source: likeSource, load: async () => likeSource.getSnapshot(), refresh: async () => likeSource.getSnapshot(),
  isLiked: item => !!likeSource.getSnapshot().keys[key(item)],
  isDisliked: item => !!likeSource.getSnapshot().dislikes[key(item)],
  toggle: (item, next) => preference(item, 'like', next ?? !likes.isLiked(item)),
  setDislike: (item, next) => preference(item, 'dislike', next),
};
const librarySource = store({ status: 'ready', tracks, error: null });
const library = { source: librarySource, load: async () => librarySource.getSnapshot(), rescan: async () => librarySource.getSnapshot() };
const lyricSource = store({ trackId: null, status: 'ready', data: null });
const lyrics = { source: lyricSource, load: async trackId => lyricSource.set({ trackId, status: 'ready', data: { synced: false, message: '示例音轨没有歌词。' } }) };
const historySource = store({ status: 'ready', events: [{ trackId: tracks[0].id, title: tracks[0].title, artist: tracks[0].artist, timestamp: bornAt + 600000 }], stats: {}, error: null });
const history = { source: historySource, load: async () => historySource.getSnapshot() };
const recoSource = store({ status: 'ready', sections: { today: tracks, artist: [], new: [] }, items: tracks, error: null });
const reco = { source: recoSource, load: async () => recoSource.getSnapshot(), refresh: async () => recoSource.getSnapshot() };
const ui = store({ view: 'home', miniHidden: false, miniCollapsed: false, dockVisible: true });
const useUi = hook(ui);
const { EchoHabitat } = createEchoUI(React);
function Demo() {
  const requestedView = useUi(state => state.view);
  const [commandRequest, setCommandRequest] = useState(0);
  const openView = view => ui.set({ view });
  useEffect(() => {
    const handle = event => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      event.preventDefault(); openView('library'); setCommandRequest(value => value + 1);
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  return <EchoHabitat
    lifeService={lifeService} player={player} library={library} lyrics={lyrics} likes={likes} reco={reco} history={history}
    ui={ui} usePlayer={hook(playerSource)} useLibrary={hook(librarySource)} useLyrics={hook(lyricSource)} useLikes={hook(likeSource)} useHistory={hook(historySource)} useReco={hook(recoSource)} useUi={useUi}
    requestedView={requestedView} commandRequest={commandRequest} openView={openView} openArtistPage={() => openView('artist')} setMiniHidden={value => ui.set({ miniHidden: value })}
    renderUtility={route => <section className="echo-demo-utility"><h2>{({ 'library-manage': '曲库管理', 'reco-manage': '联网推荐', 'now-manage': '完整音乐操作', studio: '音乐策展', history: '收听历史', artist: '歌手资料', welcome: '音乐来源', 'echo-gallery': '形态研究' })[route] || '音乐工具'}</h2><p>完整工具已保留在插件中。此演示只连接示例曲目与记忆，便于体验新的空间与操作路径。</p><button type="button" onClick={() => openView('home')}>回到它身边</button></section>}
  />;
}
class PreviewBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('ECHO interaction preview:', error); }
  render() { return this.state.failed ? <p role="alert">这次预览未能打开，请重新展开试试。</p> : this.props.children; }
}
createRoot(mount).render(<PreviewBoundary><Demo /></PreviewBoundary>);
