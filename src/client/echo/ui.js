import { createLife, applyLifeEvent, getMorphology } from '../../../bundle/shared/life-core.js';
import { createCreatureComponents } from './creature.js';
import { createEchoMiniComponent } from './mini.js';
import { createHabitatComponent } from './habitat.js';

const shortDate = at => new Date(at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
const formatTime = seconds => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;
const durationText = ms => ms < 60000 ? `${Math.floor(ms / 1000)} 秒` : `${Math.floor(ms / 60000)} 分钟`;
function downloadJSON(data, filename) {
  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
const paths = {
  arrow: 'M4 10h12m-5-5 5 5-5 5',
  close: 'm5 5 10 10M15 5 5 15',
  play: 'm7 4 9 6-9 6Z', pause: 'M7 4v12M13 4v12',
  next: 'm4 4 8 6-8 6ZM15 4v12', previous: 'm16 4-8 6 8 6ZM5 4v12',
  edit: 'm12 4 4 4M4 16l4-1L17 6a2.8 2.8 0 0 0-4-4L4 11Z',
  memory: 'M5 3h10v14l-5-3-5 3ZM8 7h4',
  sound: 'M3 8v4h3l4 4V4L6 8ZM13 7a5 5 0 0 1 0 6M16 4a9 9 0 0 1 0 12',
  moon: 'M15.9 12.6A7 7 0 0 1 7.4 4.1 7 7 0 1 0 15.9 12.6Z',
  sun: 'M10 1v2M10 17v2M1 10h2M17 10h2M4 4l1 1M15 15l1 1M4 16l1-1M15 5l1-1M14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  download: 'M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4',
  grid: 'M3 3h5v5H3ZM12 3h5v5h-5ZM3 12h5v5H3ZM12 12h5v5h-5Z',
  info: 'M10 9v5M10 6v.1M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  greet: 'M3 10c3-8 4 8 7 0s4 8 7 0',
  fold: 'm3 6 7 7 7-7M5 3l5 5 5-5',
  heart: 'M10 17 3.7 11C-1 6.5 5 1 10 6c5-5 11 .5 6.3 5Z',
  dislike: 'M14 3H7L3 8v4h5l-1 4c0 2 2 2 3 0l4-5ZM14 3h3v9h-3',
  lyrics: 'M3 3h14v11H9l-4 3v-3H3ZM6 7h8M6 10h5',
  more: 'M4 10h.1M10 10h.1M16 10h.1',
  loading: 'M17 10a7 7 0 1 1-7-7',
};

export function createEchoUI(React) {
  const h = React.createElement;
  const { useState, useEffect, useRef, useMemo } = React;
  const { Creature } = createCreatureComponents(React);
  function Icon({ name, size = 18 }) {
    return h('svg', { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] || paths.info }));
  }
  function Button({ children, icon, className = '', ...props }) {
    return h('button', { type: 'button', className: `echo-button ${className}`, ...props }, icon ? h(Icon, { name: icon }) : null, children);
  }
  function useLife(service) {
    const [state, setState] = useState(service.source.getSnapshot());
    useEffect(() => {
      const unsubscribe = service.source.subscribe(() => setState(service.source.getSnapshot()));
      setState(service.source.getSnapshot());
      if (!service.source.getSnapshot().life) service.load().then(() => service.retry()).catch(() => {});
      return unsubscribe;
    }, [service]);
    return state;
  }
  const EchoMini = createEchoMiniComponent(React, { Creature, Icon, useLife, formatTime });
  function Dialog({ title, subtitle, children, close, wide = false }) {
    const ref = useRef(null);
    useEffect(() => {
      const previous = document.activeElement;
      const first = ref.current?.querySelector('input,textarea') || ref.current?.querySelector('button:not(.echo-dialog-close)') || ref.current?.querySelector('button');
      first?.focus();
      const handle = event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key !== 'Tab') return;
        const focusable = [...(ref.current?.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"]') || [])];
        if (!focusable.length) return;
        const a = focusable[0], b = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === a) { event.preventDefault(); b.focus(); }
        else if (!event.shiftKey && document.activeElement === b) { event.preventDefault(); a.focus(); }
      };
      document.addEventListener('keydown', handle);
      return () => { document.removeEventListener('keydown', handle); previous?.focus?.(); };
    }, []);
    return h('div', { className: 'echo-modal-shade', onMouseDown: event => { if (event.target === event.currentTarget) close(); } },
      h('section', { className: `echo-dialog ${wide ? 'echo-dialog-wide' : ''}`, role: 'dialog', 'aria-modal': true, 'aria-label': title, ref },
        h('button', { type: 'button', className: 'echo-dialog-close', onClick: close, 'aria-label': '关闭' }, h(Icon, { name: 'close' })),
        h('p', { className: 'echo-eyebrow' }, 'A MOMENT BETWEEN YOU'),
        h('h2', null, title), subtitle ? h('p', { className: 'echo-dialog-copy' }, subtitle) : null, children));
  }
  function EditDialog({ kind, life, track, close, save }) {
    const [title, setTitle] = useState(kind === 'rename' ? (life.name === '未命名' ? '' : life.name) : kind === 'memory' && track ? `一起听《${track.title}》` : '');
    const [artist, setArtist] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const config = kind === 'rename' ? ['给它一个名字', '一个只属于它的称呼。随时可以再改。', '名字']
      : kind === 'share' ? ['把一首歌介绍给它', '记录你主动分享的音乐，不会将它记作已经播放。', '歌曲名称']
        : ['留住这一刻', '这段经历会留下一个小小的身体印记，轻触它就能回来。', '这一刻，叫什么？'];
    async function submit(event) {
      event.preventDefault();
      if (!title.trim() || busy) return;
      setBusy(true); setError('');
      try {
        await save(kind, kind === 'rename' ? { name: title.trim() } : kind === 'share' ? { title: title.trim(), artist: artist.trim(), note: note.trim() } : { title: title.trim(), note: note.trim(), ...(track ? { track: { id: track.id, title: track.title, artist: track.artist } } : {}) });
        close();
      } catch (err) { setError(err.message); } finally { setBusy(false); }
    }
    return h(Dialog, { title: config[0], subtitle: config[1], close },
      h('form', { onSubmit: submit },
        h('label', { className: 'echo-field' }, h('span', null, config[2]), h('input', { value: title, onChange: e => setTitle(e.target.value), maxLength: kind === 'rename' ? 40 : 160, required: true, placeholder: kind === 'rename' ? '例如：小折' : kind === 'share' ? '输入歌名' : '给这段记忆取个名字' })),
        kind === 'share' ? h('label', { className: 'echo-field' }, h('span', null, '音乐人 · 选填'), h('input', { value: artist, onChange: e => setArtist(e.target.value), maxLength: 160 })) : null,
        kind !== 'rename' ? h('label', { className: 'echo-field' }, h('span', null, '想留下的话 · 选填'), h('textarea', { value: note, onChange: e => setNote(e.target.value), maxLength: 1000, rows: 3, placeholder: '只记录你愿意分享的部分。' })) : null,
        error ? h('p', { className: 'echo-error', role: 'alert' }, error) : null,
        h('button', { type: 'submit', disabled: busy || !title.trim(), className: 'echo-button echo-button-primary echo-submit' }, busy ? '正在保存…' : kind === 'rename' ? '就叫这个名字' : '保存这一刻')));
  }
  function GreetingDialog({ close, save, life }) {
    const [taps, setTaps] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const ref = useRef([]);
    const tap = () => {
      if (busy || ref.current.length >= 9) return;
      const now = performance.now();
      const previous = ref.current.at(-1);
      if (previous != null && now - previous < 50) return;
      if (previous != null && now - previous > 5000) ref.current = [];
      ref.current = [...ref.current, now]; setTaps(ref.current);
    };
    const pattern = taps.slice(1).map((at, i) => Math.round(at - taps[i]));
    return h(Dialog, { title: life.greeting ? '再教它一个招呼' : '教它一个你们的招呼', subtitle: '轻敲至少三下。它会用自己的身体，记住你的节奏。', close },
      h('button', { type: 'button', className: 'echo-tap-pad', onClick: tap, disabled: busy || taps.length >= 9, 'aria-label': '敲击节奏' }, h(Icon, { name: 'greet', size: 58 }), h('span', null, taps.length ? `已经敲了 ${taps.length} 下` : '在这里轻敲'), h('small', null, '每两下间隔不超过 5 秒')),
      h('div', { className: 'echo-beat-sequence', 'aria-label': `已记录 ${pattern.length} 个间隔` }, Array.from({ length: 8 }, (_, i) => h('i', { key: i, className: i < pattern.length ? 'is-filled' : '', style: i < pattern.length ? { width: `${Math.min(48, 12 + pattern[i] / 45)}px` } : undefined }))),
      error ? h('p', { className: 'echo-error', role: 'alert' }, error) : null,
      h('div', { className: 'echo-dialog-actions' }, h(Button, { onClick: () => { ref.current = []; setTaps([]); setError(''); }, disabled: busy }, '重新敲一遍'),
        h(Button, { className: 'echo-button-primary', disabled: busy || pattern.length < 2, onClick: async () => {
          setBusy(true); try { await save('greeting', { pattern }); close(); } catch (err) { setError(err.message); } finally { setBusy(false); }
        } }, busy ? '正在记住…' : '记住这个招呼')));
  }
  function MemoryDialog({ memory, close }) {
    return h(Dialog, { title: memory.title, subtitle: shortDate(memory.at), close },
      h('div', { className: 'echo-memory-reading' }, memory.note ? h('p', null, memory.note) : h('p', null, '你们把这一刻留了下来。'), memory.track ? h('div', { className: 'echo-related-track' }, h(Icon, { name: 'sound' }), h('span', null, `${memory.track.title || '音乐'}${memory.track.artist ? ' · ' + memory.track.artist : ''}`)) : null));
  }
  function Status({ state, lifeService }) {
    if (!state.pending && !state.syncError && !state.rejectedCount && !state.storageError) return null;
    const message = state.volatileCount ? `${state.volatileCount} 条经历仅留在当前页面，尚未可靠保存。请重试或先导出。`
      : state.storageError ? `本机暂存遇到问题：${state.storageError}`
        : state.syncError ? `暂未保存到生命档案：${state.syncError}`
          : state.pending ? `${state.pending} 条经历正在保存` : `${state.rejectedCount} 条经历尚未写入档案，已单独保留。`;
    return h('div', { className: 'echo-sync-status' },
      h('div', { className: 'echo-sync-summary', role: 'status' }, h('span', null, message),
        h('button', { type: 'button', onClick: () => lifeService.retry().catch(() => {}) }, '重试保存'),
        (state.syncError || state.storageError || state.rejectedCount) && lifeService.exportOutbox ? h('button', { type: 'button', onClick: () => downloadJSON(lifeService.exportOutbox(), 'ECHO-pending-experiences.json') }, '导出待保存经历') : null),
      state.rejectedCount ? h('details', null, h('summary', null, `查看 ${state.rejectedCount} 条未写入经历`),
        h('ul', null, (state.rejected || []).map(item => h('li', { key: item.id }, h('span', null, item.message || '这段经历未能写入档案。'), h('button', { type: 'button', onClick: () => lifeService.retryRejected(item.id).catch(() => {}) }, '再次尝试'))))) : null);
  }
  function EmptyLife({ state, lifeService }) {
    return h('div', { className: 'echo-empty-life' }, h('span', { className: 'echo-wait-mark' }), h('h2', null, state.status === 'error' ? '暂时没能打开它的档案' : '正在与你的生命见面'), h('p', null, state.error || '形态、习惯和记忆，会一起保存在这里。'), state.status === 'error' ? h(Button, { onClick: () => lifeService.retry().catch(() => {}), icon: 'arrow' }, '重新打开') : null);
  }
  function EchoHome({ lifeService, player, usePlayer, openView }) {
    const state = useLife(lifeService);
    const track = usePlayer(s => s.track);
    const playing = usePlayer(s => s.playing);
    const [dialog, setDialog] = useState(null);
    const [gesture, setGesture] = useState(0);
    const [resting, setResting] = useState(false);
    const [notice, setNotice] = useState('');
    const touchAt = useRef(0);
    useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 5500); return () => clearTimeout(id); }, [notice]);
    if (!state.life) return h(EmptyLife, { state, lifeService });
    const life = state.life;
    const named = life.name && life.name !== '未命名';
    const name = named ? life.name : '你的音灵';
    const days = Math.max(1, Math.floor((Date.now() - life.createdAt) / 86400000) + 1);
    const close = () => setDialog(null);
    async function save(type, payload) {
      try {
        await lifeService.dispatch(type, payload);
        setNotice(type === 'greeting' ? '它记住了你们的招呼。再试着叫它一次吧。' : type === 'rename' ? '它有自己的名字了。' : '这一刻，已经留下。');
      } catch (error) {
        if (error.queued) { setNotice('这段经历已在本机暂存，连接恢复后会继续保存。'); return; }
        throw error;
      }
    }
    const greet = () => {
      if (!life.greeting) { setDialog({ kind: 'greeting' }); return; }
      setGesture(n => n + 1);
      lifeService.dispatch('interaction', { action: 'greet' }).catch(error => setNotice(error.queued ? '招呼已暂存，等待同步。' : error.message));
    };
    const touch = () => {
      const now = Date.now(); if (now - touchAt.current < 1200) return; touchAt.current = now;
      setGesture(n => n + 1);
      lifeService.dispatch('interaction', { action: 'touch' }).catch(error => { if (!error.queued) setNotice(error.message); });
    };
    const toggleRest = () => {
      setResting(value => !value);
      if (!resting) lifeService.dispatch('interaction', { action: 'rest' }).catch(error => { if (!error.queued) setNotice(error.message); });
    };
    return h('div', { className: 'echo-home' },
      h('div', { className: 'echo-chapter' }, h('span', { className: 'echo-eyebrow' }, 'A LIFE, UNLIKE ANY OTHER'), h('span', { className: 'echo-chapter-day' }, h('i'), `相识第 ${days} 天`)),
      h('div', { className: 'echo-home-intro' }, h('h2', null, named ? `和${name}，待一会儿。` : '一个生命，慢慢成为它自己。'), h('p', null, named ? '一起听，轻轻回应。你们的经历，会留在它身上。' : '从第一次回应开始，长出只属于你们的模样。')),
      h('div', { className: 'echo-habitat' },
        h('div', { className: 'echo-habitat-light', 'aria-hidden': true }), h('div', { className: 'echo-habitat-ground', 'aria-hidden': true }),
        h('div', { className: 'echo-specimen-note' }, h('span', null, 'ECHO'), h('small', null, life.id.slice(-8).toUpperCase())),
        h('div', { className: 'echo-creature-stage' }, h(Creature, { life, morphology: state.morphology, active: playing && !resting, compact: resting, gesture, onTouch: touch, onMemorySelect: id => { const memory = life.memories.find(m => m.id === id); if (memory) setDialog({ kind: 'read', memory }); }, label: `${name}，轻触互动` })),
        h('div', { className: 'echo-identity' }, h('div', { className: 'echo-name-row' }, h('h3', null, name), h('button', { type: 'button', onClick: () => setDialog({ kind: 'rename' }), className: 'echo-quiet-icon', 'aria-label': '给生命命名' }, h(Icon, { name: 'edit', size: 14 }))),
          h('p', null, resting ? '收拢身体，安静待一会儿。' : playing ? '此刻，与你一起听。' : life.greeting ? '它记得你们的招呼。' : '轻触它，看看它如何回应。')),
        h('div', { className: 'echo-habitat-tools' }, h('button', { type: 'button', className: `echo-quiet-icon ${resting ? 'is-active' : ''}`, onClick: toggleRest, title: resting ? '舒展身体' : '安静待一会儿', 'aria-label': resting ? '舒展身体' : '安静待一会儿', 'aria-pressed': resting }, h(Icon, { name: resting ? 'sun' : 'moon' }))),
        life.memories.length ? h('button', { type: 'button', className: 'echo-mark-caption', onClick: () => setDialog({ kind: 'read', memory: life.memories.at(-1) }) }, h('i'), '轻触身上的印记，重回那一刻', h(Icon, { name: 'arrow', size: 13 })) : null),
      h('div', { className: 'echo-action-row' }, h(Button, { icon: 'greet', onClick: greet }, life.greeting ? '打个招呼' : '教它一个招呼'), h(Button, { icon: 'memory', onClick: () => setDialog({ kind: 'memory' }) }, '留住这一刻'), h(Button, { icon: 'play', className: 'echo-button-primary', onClick: () => { if (track) { if (!playing) player.toggle(); } else openView('library'); } }, playing ? '正在一起听' : '一起听音乐')),
      h('div', { className: 'echo-home-bottom' }, h('div', { className: 'echo-bottom-story' }, h('span', { className: 'echo-eyebrow' }, 'EVERY LITTLE MOMENT'), h('p', null, life.stats.listenedMs ? `已经一起听过 ${durationText(life.stats.listenedMs)}。故事仍在继续。` : '它刚刚来到这里。第一段经历，等你留下。')),
        h('div', { className: 'echo-text-actions' }, h('button', { type: 'button', onClick: () => setDialog({ kind: 'share' }) }, '介绍一首歌', h(Icon, { name: 'arrow', size: 14 })), h('button', { type: 'button', onClick: () => openView('echo-gallery') }, '看看不同的生命', h(Icon, { name: 'grid', size: 14 })), h('button', { type: 'button', onClick: () => setDialog({ kind: 'about' }), 'aria-label': '了解音乐与成长' }, h(Icon, { name: 'info', size: 15 })))),
      h(Status, { state, lifeService }), notice ? h('div', { className: 'echo-notice', role: 'status' }, notice) : null,
      dialog?.kind === 'greeting' ? h(GreetingDialog, { close, save, life }) : null,
      ['rename', 'memory', 'share'].includes(dialog?.kind) ? h(EditDialog, { kind: dialog.kind, life, track: playing ? track : null, close, save }) : null,
      dialog?.kind === 'read' ? h(MemoryDialog, { memory: dialog.memory, close }) : null,
      dialog?.kind === 'about' ? h(Dialog, { title: '音乐会慢慢长进它的身体', subtitle: '每个个体都有自己的起点，经历则决定后来的变化。', close }, h('div', { className: 'echo-about-copy' },
        h('p', null, '在这里播放本地音乐时，节奏变化、声音能量、明暗和纹理会影响它的比例、曲面与材质。它会保留自己的身份，逐渐长成不同的模样。'),
        h('p', null, '主动介绍的歌曲会单独记录，不会被算作已经听过。离开一段时间也不会失去成长。'),
        h('dl', null, h('dt', null, '当前音乐输入'), h('dd', null, state.audioStatus === 'audio' ? '正在读取本地播放的声音特征' : state.audioStatus === 'time-only' ? '声音特征不可用，仅记录播放时长' : '等待下一次共同聆听'), h('dt', null, '成长记录'), h('dd', null, '取得声音特征的有效播放每累计五分钟，留下一次外形快照。'), h('dt', null, '生命档案'), h('dd', null, '本机保存，可在“记忆”页面完整导出。')),
        life.greeting ? h(Button, { onClick: () => setDialog({ kind: 'greeting' }), icon: 'greet' }, '重新教一个招呼') : null)) : null);
  }
  function EchoMemories({ lifeService, openView }) {
    const state = useLife(lifeService);
    const [selected, setSelected] = useState(null);
    const [memory, setMemory] = useState(null);
    const [error, setError] = useState('');
    if (!state.life) return h(EmptyLife, { state, lifeService });
    const life = state.life;
    const timeline = life.timeline || [];
    const index = selected == null ? timeline.length - 1 : Math.min(selected, timeline.length - 1);
    const point = timeline[index];
    async function download() {
      try {
        const archive = await lifeService.exportArchive();
        downloadJSON(archive, `ECHO-${life.id}.json`); setError('');
      } catch (err) { setError(err.message); }
    }
    return h('div', { className: 'echo-memories-page' }, h('div', { className: 'echo-page-heading' }, h('div', null, h('p', { className: 'echo-eyebrow' }, 'BECOMING, TOGETHER'), h('h2', null, '它如何成为今天的自己。'), h('p', null, '每一次被留下的变化，都有真实的来处。')), h(Button, { icon: 'download', onClick: download }, '带走生命档案')),
      h('section', { className: 'echo-time-room' }, h('div', { className: 'echo-timeline-creature' }, h(Creature, { life, morphology: point?.morphology || state.morphology, motionEnabled: false, onMemorySelect: id => setMemory(life.memories.find(m => m.id === id)) })),
        h('div', { className: 'echo-timeline-story' }, h('p', { className: 'echo-eyebrow' }, point ? shortDate(point.at) : 'TODAY'), h('h3', null, point?.reason || '初次相遇'), h('p', null, timeline.length > 1 ? '沿着时间，看看它一点点发生的变化。' : '第一张生命快照已经留下。一起听音乐、教它招呼或保存记忆，都会为这里添上新的片段。'),
          h('input', { type: 'range', min: 0, max: Math.max(0, timeline.length - 1), value: Math.max(0, index), disabled: timeline.length < 2, onChange: e => setSelected(Number(e.target.value)), 'aria-label': '成长时间线' }), h('div', { className: 'echo-range-labels' }, h('span', null, '初次相遇'), h('span', null, `${timeline.length} 个片段`), h('button', { type: 'button', onClick: () => setSelected(null) }, '最近一次')),
          life.timelineOmitted ? h('small', null, `更早的 ${life.timelineOmitted} 个普通节点已归并，原始经历仍在完整档案中。`) : null)),
      h('div', { className: 'echo-memory-heading' }, h('h3', null, '留在身上的记忆'), h('span', null, `${life.memories.length} 段`)),
      life.memories.length ? h('div', { className: 'echo-memory-list' }, [...life.memories].reverse().map((m, i) => h('button', { type: 'button', className: 'echo-memory-item', key: m.id, onClick: () => setMemory(m) }, h('span', { className: 'echo-memory-number' }, String(life.memories.length - i).padStart(2, '0')), h('div', null, h('h4', null, m.title), h('p', null, m.note || '一段你愿意留下的共同经历')), h('time', null, shortDate(m.at)), h(Icon, { name: 'arrow' })))) : h('div', { className: 'echo-memory-empty' }, h(Icon, { name: 'memory', size: 28 }), h('p', null, '有些时刻，值得慢慢留下。'), h(Button, { onClick: () => openView('home') }, '回去和它待一会儿')),
      h(Status, { state, lifeService }), error ? h('p', { className: 'echo-error', role: 'alert' }, error) : null,
      memory ? h(MemoryDialog, { memory, close: () => setMemory(null) }) : null);
  }
  function EchoGallery({ openView }) {
    const [mode, setMode] = useState('birth');
    const [monochrome, setMonochrome] = useState(false);
    const [compact, setCompact] = useState(false);
    const specimens = useMemo(() => {
      const out = [], counts = { fold: 0, shell: 0, ribbon: 0 };
      for (let i = 0; out.length < 9 && i < 200; i++) {
        const life = createLife({ seed: `echo-study-${i}`, now: 1700000000000, name: `个体 ${String(out.length + 1).padStart(2, '0')}` });
        if (counts[life.genome.structure] >= 3) continue;
        counts[life.genome.structure]++;
        out.push(life);
      }
      return out;
    }, []);
    const evolved = useMemo(() => specimens.map(initial => {
      if (mode === 'birth') return initial;
      let life = initial;
      const features = mode === 'gentle' ? { energy: 0.2, brightness: 0.25, rhythm: 0.15, texture: 0.35 } : { energy: 0.8, brightness: 0.75, rhythm: 0.85, texture: 0.65 };
      for (let i = 0; i < 40; i++) life = applyLifeEvent(life, { id: `study-${i}`, type: 'listening', at: initial.createdAt + (i + 1) * 30000, sessionId: 'study-session', track: { id: 'study-track', title: '模拟声音输入', artist: '形态验证' }, listenedMs: 30000, featureSource: 'audio', features });
      return life;
    }), [mode, specimens]);
    return h('div', { className: 'echo-gallery-page' }, h('div', { className: 'echo-page-heading' }, h('div', null, h('p', { className: 'echo-eyebrow' }, 'ONE WORLD. DIFFERENT LIVES.'), h('h2', null, '每一个，都有自己的模样。'), h('p', null, '同样的音乐，会在不同的生命身上留下不同的变化。')), h(Button, { icon: 'arrow', onClick: () => openView('home') }, '回到自己的生命')),
      h('div', { className: 'echo-study-controls' }, h('div', { className: 'echo-segmented', role: 'group', 'aria-label': '模拟音乐输入' }, [['birth', '初生'], ['gentle', '柔和的声音'], ['dynamic', '鲜明的节奏']].map(([key, text]) => h('button', { key, type: 'button', 'aria-pressed': mode === key, onClick: () => setMode(key) }, text))),
        h('label', null, h('input', { type: 'checkbox', checked: monochrome, onChange: e => setMonochrome(e.target.checked) }), '只看轮廓'), h('label', null, h('input', { type: 'checkbox', checked: compact, onChange: e => setCompact(e.target.checked) }), '收拢身体')),
      h('p', { className: 'echo-study-note' }, '形态示例 · 后两项使用 20 分钟模拟声音特征，仅用于比较，不会写入你的生命档案。'),
      h('div', { className: `echo-specimen-grid ${monochrome ? 'is-silhouette' : ''}` }, evolved.map((life, index) => h('article', { key: life.id, className: 'echo-specimen-card' }, h('div', { className: 'echo-specimen-creature' }, h(Creature, { life, compact, motionEnabled: false, label: `形态示例 ${index + 1}` })), h('div', { className: 'echo-specimen-caption' }, h('span', null, String(index + 1).padStart(2, '0')), h('span', null, mode === 'birth' ? '最初的模样' : '同一输入，各自生长'))))));
  }
  function EchoDock({ player, usePlayer, openView }) {
    const track = usePlayer(s => s.track), playing = usePlayer(s => s.playing), position = usePlayer(s => s.position), duration = usePlayer(s => s.duration), volume = usePlayer(s => s.volume), muted = usePlayer(s => s.muted), error = usePlayer(s => s.error);
    return h('footer', { className: 'echo-dock' }, h('button', { type: 'button', className: 'echo-dock-track', onClick: () => openView(track ? 'now' : 'library') }, h('span', { className: 'echo-dock-art' }, track?.coverUrl ? h('img', { src: new URL(track.coverUrl.replace(/^\//, ''), document.baseURI).href, alt: '', onError: e => { e.currentTarget.style.display = 'none'; } }) : h(Icon, { name: 'sound', size: 21 })), h('span', null, h('strong', null, track?.title || '一起听点什么'), h('small', null, track?.artist || '从你的本地音乐开始'))),
      h('div', { className: 'echo-dock-center' }, h('div', { className: 'echo-play-controls' }, h('button', { type: 'button', disabled: !track, onClick: player.prev, 'aria-label': '上一首' }, h(Icon, { name: 'previous' })), h('button', { type: 'button', className: 'echo-play-main', disabled: !track, onClick: player.toggle, 'aria-label': playing ? '暂停' : '播放' }, h(Icon, { name: playing ? 'pause' : 'play', size: 20 })), h('button', { type: 'button', disabled: !track, onClick: player.next, 'aria-label': '下一首' }, h(Icon, { name: 'next' }))), h('div', { className: 'echo-dock-progress' }, h('time', null, formatTime(position)), h('input', { type: 'range', min: 0, max: duration || 1, step: 0.1, value: Math.min(position || 0, duration || 1), disabled: !track || !duration, onChange: e => player.seek(Number(e.target.value)), 'aria-label': '播放进度' }), h('time', null, formatTime(duration)))),
      h('div', { className: 'echo-dock-volume' }, h('button', { type: 'button', onClick: player.toggleMute, 'aria-label': muted ? '取消静音' : '静音', 'aria-pressed': muted }, h(Icon, { name: 'sound' })), h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: muted ? 0 : volume, onChange: e => player.setVolume(Number(e.target.value)), 'aria-label': '音量' })),
      error ? h('span', { className: 'echo-playback-error', role: 'alert' }, error) : null);
  }
  const EchoHabitat = createHabitatComponent(React, { Creature, Icon, useLife, EditDialog, GreetingDialog, MemoryDialog, Status, EmptyLife, formatTime, shortDate, downloadJSON });
  return { EchoHome, EchoMemories, EchoGallery, EchoDock, EchoMini, EchoHabitat, Creature };
}
