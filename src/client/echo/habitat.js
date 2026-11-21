const SCENES = { home: 'encounter', library: 'search', reco: 'discover', 'echo-memory': 'memory', now: 'listening' };
const UTILITIES = {
  'library-manage': '管理曲库', 'reco-manage': '在线发现', studio: '策展', history: '聆听历史',
  artist: '音乐人', 'echo-gallery': '生命形态示例', welcome: '音乐来源', command: '音乐指令', 'now-manage': '完整歌词与队列',
};
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
const trackKey = track => String(track?.id || `${track?.artist || ''}::${track?.title || ''}`);
const sameTrack = (a, b) => !!a && !!b && trackKey(a) === trackKey(b);
function readPreference(key, fallback) { try { return window.localStorage.getItem(key) || fallback; } catch { return fallback; } }
function storePreference(key, value) { try { window.localStorage.setItem(key, value); } catch {} }

export function createHabitatComponent(React, { Creature, Icon, useLife, EditDialog, GreetingDialog, MemoryDialog, Status, EmptyLife, formatTime, shortDate, downloadJSON }) {
  const h = React.createElement;
  const { useState, useEffect, useMemo, useRef } = React;
  function QuietButton({ icon, children, className = '', ...props }) {
    return h('button', { type: 'button', className: `eh-action ${className}`, ...props }, icon ? h(Icon, { name: icon, size: 17 }) : null, children);
  }

  return function EchoHabitat({ lifeService, player, library, lyrics, likes, usePlayer, useLibrary, useLyrics, useLikes, openView, openArtistPage, setMiniHidden, renderUtility, requestedView = 'home', commandRequest = 0 }) {
    const state = useLife(lifeService);
    const playback = usePlayer(s => s);
    const collection = useLibrary(s => s);
    const lyricState = useLyrics(s => s);
    const taste = useLikes(s => s);
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(40);
    const [discoveryOffset, setDiscoveryOffset] = useState(0);
    const [dialog, setDialog] = useState(null);
    const [menu, setMenu] = useState(false);
    const [resting, setResting] = useState(false);
    const [gesture, setGesture] = useState(0);
    const [reviewIndex, setReviewIndex] = useState(null);
    const [feedback, setFeedback] = useState(null);
    const [preferencePending, setPreferencePending] = useState(false);
    const [undo, setUndo] = useState(null);
    const [seekDraft, setSeekDraft] = useState(null);
    const [tone, setTone] = useState(() => readPreference('dsh-music.echo.habitat-tone', 'dark'));
    const [lyricVisible, setLyricVisible] = useState(() => readPreference('dsh-music.echo.habitat-lyrics', 'false') === 'true');
    const rootRef = useRef(null), searchRef = useRef(null), findRef = useRef(null), menuRef = useRef(null), menuButtonRef = useRef(null), layerRef = useRef(null);
    const touchAt = useRef(0), pendingRef = useRef(false), commandSeen = useRef(commandRequest), seekRef = useRef(null);
    const scene = SCENES[requestedView] || 'utility';
    const life = state.life;
    const name = life?.name && life.name !== '未命名' ? life.name : '你的音灵';
    const { track, playing, loading, position = 0, duration = 0, volume = 1, muted, queue = [], shuffle, repeat, error: playbackError } = playback;
    const tracks = collection.tracks || [];
    const timeline = life?.timeline || [];
    const reviewing = scene === 'memory' && reviewIndex != null && !!timeline.length;
    const snapshot = reviewing ? timeline[Math.min(reviewIndex, timeline.length - 1)] : null;
    const selectedMorphology = snapshot?.morphology || state.morphology;
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    const results = useMemo(() => tracks.filter(item => {
      const text = normalize(`${item.title} ${item.artist} ${item.album || ''}`);
      return tokens.every(token => text.includes(token));
    }), [tracks, query]);
    const discoveries = useMemo(() => {
      const available = tracks.filter(item => item.audioUrl && !likes.isDisliked(item));
      const ordered = [...available.filter(item => likes.isLiked(item)), ...available.filter(item => !likes.isLiked(item))];
      if (!ordered.length) return [];
      return Array.from({ length: Math.min(3, ordered.length) }, (_, i) => ordered[(discoveryOffset * 3 + i) % ordered.length]);
    }, [tracks, taste, discoveryOffset, likes]);
    const liked = !!track && likes.isLiked(track), disliked = !!track && likes.isDisliked(track);
    const currentLyrics = track && lyricState.trackId === track.id ? lyricState : null;
    const lyricData = currentLyrics?.data;
    let activeLine = '';
    if (lyricData?.synced && lyricData.lines?.length) {
      for (const line of lyricData.lines) { if (line.time > position + .2) break; if (line.text?.trim()) activeLine = line.text; }
    }

    function go(route) { setMenu(false); if (route !== 'echo-memory') setReviewIndex(null); openView(route); }
    function returnHome() { go('home'); window.setTimeout(() => findRef.current?.focus(), 0); }
    function report(message, isError = false) { setFeedback({ message, isError }); }
    function action(fn) { try { Promise.resolve(fn()).catch(err => report(err.message || '这次操作未能完成。', true)); } catch (err) { report(err.message || '这次操作未能完成。', true); } }
    useEffect(() => {
      if (collection.status === 'idle') action(() => library.load());
      if (!taste.loaded && likes.load) action(() => likes.load());
    }, [library, likes]);
    useEffect(() => { if (scene !== 'memory') setReviewIndex(null); }, [scene]);
    useEffect(() => { seekRef.current = null; setSeekDraft(null); }, [track?.id]);
    useEffect(() => {
      if (scene === 'encounter') return;
      const id = window.setTimeout(() => {
        if (scene === 'search') searchRef.current?.focus();
        else layerRef.current?.querySelector('[data-eh-heading]')?.focus();
      }, 0);
      return () => window.clearTimeout(id);
    }, [scene, requestedView]);
    useEffect(() => {
      if (commandSeen.current === commandRequest) return;
      commandSeen.current = commandRequest;
      setMenu(false); setDialog(null);
      if (scene !== 'search') openView('library');
      const id = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }, [commandRequest, scene, openView]);
    useEffect(() => {
      if (!menu) return;
      const outside = event => { if (!menuRef.current?.contains(event.target) && !menuButtonRef.current?.contains(event.target)) setMenu(false); };
      document.addEventListener('pointerdown', outside);
      return () => document.removeEventListener('pointerdown', outside);
    }, [menu]);
    useEffect(() => {
      storePreference('dsh-music.echo.habitat-lyrics', String(lyricVisible));
      if (lyricVisible && track?.id) action(() => lyrics.load(track.id));
    }, [lyricVisible, track?.id, lyrics]);
    useEffect(() => { storePreference('dsh-music.echo.habitat-tone', tone); }, [tone]);
    useEffect(() => {
      if (!feedback || feedback.isError) return;
      const id = window.setTimeout(() => setFeedback(null), 7000);
      return () => window.clearTimeout(id);
    }, [feedback]);

    async function save(type, payload) {
      try {
        await lifeService.dispatch(type, payload);
        report(type === 'rename' ? '它记住了这个名字。' : type === 'greeting' ? '它记住了你们的招呼。' : '这一刻，已经留下。');
      } catch (err) {
        if (!err.queued) throw err;
        report('这段经历已在本机暂存，连接恢复后会继续保存。');
      }
    }
    function touch() {
      if (reviewing || Date.now() - touchAt.current < 1200) return;
      touchAt.current = Date.now(); setGesture(value => value + 1);
      action(() => lifeService.dispatch('interaction', { action: life?.greeting ? 'greet' : 'touch' }));
    }
    function greet() {
      setMenu(false);
      if (!life?.greeting) setDialog({ kind: 'greeting' });
      else { setGesture(value => value + 1); action(() => lifeService.dispatch('interaction', { action: 'greet' })); }
    }
    function rest() {
      setResting(value => !value); setMenu(false);
      if (!resting) action(() => lifeService.dispatch('interaction', { action: 'rest' }));
    }
    function playSelection(list, index) {
      const playable = list.filter(item => item.audioUrl), selected = list[index], playableIndex = playable.indexOf(selected);
      if (playableIndex < 0) { report('这首歌暂时没有可播放的音频。可以在曲库管理中重新扫描。', true); return; }
      action(async () => {
        await player.playTracks(playable, playableIndex, { shuffle: false, ordered: true });
        go('home');
      });
    }
    function commitSeek() {
      const draft = seekRef.current;
      seekRef.current = null; setSeekDraft(null);
      if (draft && sameTrack(player.source.getSnapshot().track, draft.track)) action(() => player.seek(draft.value));
    }
    async function preference(kind) {
      if (!track || pendingRef.current) return;
      const original = track, before = likes.isLiked(original) ? 'like' : likes.isDisliked(original) ? 'dislike' : 'none';
      const target = kind === 'like' ? before !== 'like' : before !== 'dislike';
      pendingRef.current = true; setPreferencePending(true);
      try {
        const result = kind === 'like' ? await likes.toggle(original, target) : await likes.setDislike(original, target);
        if (result?.error) throw new Error(result.error);
        if (kind === 'dislike' && target) {
          setUndo({ track: original, before });
          const current = player.source.getSnapshot();
          if (sameTrack(current.track, original)) {
            let next = -1;
            for (let step = 1; step <= current.queue.length; step++) {
              const index = (current.queueIndex + step) % current.queue.length, candidate = current.queue[index];
              if (!sameTrack(candidate, original) && !likes.isDisliked(candidate)) { next = index; break; }
            }
            if (next >= 0) { player.jumpTo(next); report(`不喜欢已保存，已跳过《${original.title}》。`); }
            else { player.pause(); report('不喜欢已保存。队列里没有其他可播放的歌，已暂停。'); }
          } else report('不喜欢已保存，没有打断你后来选择的歌。');
        } else {
          setUndo(null);
          report(result?.downloading ? '喜欢已保存，正在加入曲库；入库结果可在曲库管理查看。' : result?.message || (target ? '喜欢已保存。' : '已取消这项偏好。'));
        }
      } catch (err) { report(`偏好未能保存：${err.message}`, true); }
      finally { pendingRef.current = false; setPreferencePending(false); }
    }
    async function undoPreference() {
      if (!undo || pendingRef.current) return;
      const original = undo;
      if (!likes.isDisliked(original.track)) { setUndo(null); report('这首歌的偏好已更新。'); return; }
      pendingRef.current = true; setPreferencePending(true);
      try {
        const result = original.before === 'like'
          ? await likes.toggle({ ...original.track, verification: undefined }, true)
          : await likes.setDislike(original.track, false);
        if (result?.error) throw new Error(result.error);
        setUndo(null); report('已恢复原来的偏好，当前播放保持不变。');
      } catch (err) { report(`暂未撤销：${err.message}`, true); }
      finally { pendingRef.current = false; setPreferencePending(false); }
    }
    function readMemory(id) {
      const memory = life?.memories?.find(item => item.id === id);
      if (memory) setDialog({ kind: 'read', memory });
    }
    function onKeyDown(event) {
      if (event.key === 'Escape' && !dialog) {
        event.preventDefault();
        if (menu) { setMenu(false); menuButtonRef.current?.focus(); }
        else if (scene !== 'encounter') returnHome();
      }
      if (event.key === 'Tab' && scene === 'utility' && !dialog && layerRef.current) {
        const focusable = [...layerRef.current.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]')].filter(node => !node.closest('[hidden]'));
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement?.hasAttribute('data-eh-heading'))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    function openDialog(kind) { setMenu(false); setDialog({ kind }); }
    function heading(title, note) {
      return h('header', { className: 'eh-context-heading' }, h('div', null, h('h2', { tabIndex: -1, 'data-eh-heading': true }, title), note ? h('p', null, note) : null),
        h(QuietButton, { icon: 'close', onClick: returnHome, 'aria-label': '回到生命空间', title: '回到生命空间' }));
    }
    function songRows(list, kind) {
      return h('ol', { className: `eh-song-list eh-song-list-${kind}` }, list.map((item, index) => h('li', { key: `${item.id}-${index}` },
        h('button', { type: 'button', className: 'eh-song', disabled: !item.audioUrl, onClick: () => playSelection(kind === 'search' ? results : list, index), 'aria-label': item.audioUrl ? `播放 ${item.title} · ${item.artist || '未知音乐人'}` : `${item.title} · 音频暂不可用` },
          h('span', { className: 'eh-song-index', 'aria-hidden': true }, sameTrack(item, track) && playing ? h(Icon, { name: 'sound', size: 16 }) : String(index + 1).padStart(2, '0')),
          h('span', { className: 'eh-song-copy' }, h('strong', null, item.title || '未命名曲目'), h('small', null, item.artist || '未知音乐人', kind === 'discover' ? ` · ${likes.isLiked(item) ? '你喜欢的歌' : '来自你的曲库'}` : item.album ? ` · ${item.album}` : '')),
          h('span', { className: 'eh-song-tail', 'aria-hidden': true }, h('time', null, !item.audioUrl ? '音频不可用' : item.duration ? formatTime(item.duration) : ''), h(Icon, { name: 'play', size: 15 }))))));
    }
    function lyricContent(compact = false) {
      if (!track) return h('p', { className: 'eh-lyric-note' }, '开始播放后，这里会出现歌词。');
      if (!currentLyrics || currentLyrics.status === 'loading' || currentLyrics.status === 'idle') return h('p', { className: 'eh-lyric-note', role: 'status' }, '正在寻找这首歌的歌词…');
      if (currentLyrics.error || currentLyrics.status === 'error') return h('div', { className: 'eh-lyric-note', role: 'alert' }, h('p', null, currentLyrics.error || '歌词暂时未能载入。'), h(QuietButton, { onClick: () => action(() => lyrics.load(track.id)) }, '重试歌词'));
      if (lyricData?.synced && lyricData.lines?.length) return h('p', { className: 'eh-lyric-line', 'aria-label': '当前歌词' }, activeLine || '前奏 · 等待第一句');
      if (lyricData?.plain?.trim()) return h('div', { className: 'eh-plain-lyrics' }, h('small', null, '纯文本歌词 · 没有时间标记'), h('p', null, compact ? lyricData.plain.split(/\r?\n/).find(line => line.trim()) : lyricData.plain));
      return h('p', { className: 'eh-lyric-note' }, lyricData?.message || '暂未找到这首歌的歌词。');
    }

    let content = null;
    if (scene === 'search') content = h('section', { className: 'eh-context eh-search', ref: layerRef, 'aria-label': '找音乐' },
      heading('想一起听什么？', '从你的曲库，选一首开始。'),
      h('label', { className: 'eh-search-field' }, h('span', { className: 'eh-sr-only' }, '搜索曲库'), h('input', { ref: searchRef, value: query, type: 'search', placeholder: '歌名、音乐人或专辑', onChange: event => { setQuery(event.target.value); setLimit(40); }, autoComplete: 'off' }), h('kbd', { 'aria-hidden': true }, 'esc')),
      collection.status === 'loading' ? h('p', { className: 'eh-empty', role: 'status' }, '正在打开曲库…') : collection.error ? h('div', { className: 'eh-empty', role: 'alert' }, h('p', null, collection.error), h(QuietButton, { onClick: () => action(() => library.load()) }, '重试打开曲库')) : null,
      tracks.length ? h(React.Fragment, null, h('div', { className: 'eh-list-caption' }, h('span', null, query.trim() ? `找到 ${results.length} 首` : `${tracks.length} 首本地音乐`), h(QuietButton, { onClick: () => go('reco') }, '帮我挑几首', h(Icon, { name: 'arrow', size: 14 }))),
        results.length ? songRows(results.slice(0, limit), 'search') : h('p', { className: 'eh-empty' }, '曲库里还没有匹配的音乐。可以换一个词，或打开在线发现。'),
        results.length > limit ? h(QuietButton, { onClick: () => setLimit(value => value + 40), className: 'eh-load-more' }, `再看一些 · 还有 ${results.length - limit} 首`) : null)
        : collection.status !== 'loading' && !collection.error ? h('div', { className: 'eh-empty' }, h('p', null, '这里还没有音乐。添加音乐来源后，就能一起听。'), h(QuietButton, { onClick: () => go('welcome'), icon: 'arrow' }, '添加音乐来源')) : null,
      h('footer', { className: 'eh-context-foot' }, h(QuietButton, { onClick: () => go('reco-manage') }, '在线发现'), h(QuietButton, { onClick: () => go('library-manage') }, '管理曲库')));
    if (scene === 'discover') content = h('section', { className: 'eh-context eh-discover', ref: layerRef, 'aria-label': '选几首一起听' },
      heading('从熟悉的声音开始。', '从喜欢的歌和本地曲库中挑选。'),
      collection.status === 'loading' ? h('p', { className: 'eh-empty', role: 'status' }, '正在打开曲库…') : collection.error ? h('div', { className: 'eh-empty', role: 'alert' }, h('p', null, collection.error), h(QuietButton, { onClick: () => action(() => library.load()) }, '重试')) : null,
      discoveries.length ? songRows(discoveries, 'discover') : collection.status !== 'loading' ? h('p', { className: 'eh-empty' }, tracks.length ? '暂时没有其他候选。可以去曲库重新挑选。' : '添加一些本地音乐，熟悉的声音就会出现在这里。') : null,
      h('footer', { className: 'eh-context-foot' }, discoveries.length && tracks.filter(item => item.audioUrl && !likes.isDisliked(item)).length > 3 ? h(QuietButton, { onClick: () => setDiscoveryOffset(value => value + 1) }, '换几首') : null, h(QuietButton, { onClick: () => go('library') }, '自己找一首'), h(QuietButton, { onClick: () => go('reco-manage') }, '在线发现')));
    if (scene === 'memory') content = h('section', { className: 'eh-context eh-memory', ref: layerRef, 'aria-label': '共同记忆' },
      heading('时间留在它身上。', reviewing ? '你正在回看当时的模样。' : '这是此刻的它。沿着时间，看看它的变化。'),
      h('div', { className: 'eh-time-control' }, h('div', { className: 'eh-time-caption' }, h('time', null, snapshot ? shortDate(snapshot.at) : '此刻'), h('strong', null, snapshot?.reason || '现在的模样')),
        h('input', { type: 'range', min: 0, max: timeline.length, value: reviewing ? Math.min(reviewIndex, timeline.length - 1) : timeline.length, disabled: !timeline.length, onChange: event => { const value = Number(event.target.value); setReviewIndex(value === timeline.length ? null : value); }, 'aria-label': '回看成长时间线', 'aria-valuetext': snapshot ? `${shortDate(snapshot.at)}，${snapshot.reason || '成长片段'}` : '此刻的生命' }),
        h('div', { className: 'eh-time-labels' }, h('span', null, timeline.length ? shortDate(timeline[0].at) : '初次相遇'), h(QuietButton, { disabled: !reviewing, onClick: () => setReviewIndex(null) }, '回到现在')),
        life?.timelineOmitted ? h('p', { className: 'eh-subtle' }, `更早的 ${life.timelineOmitted} 个普通片段已归并，原始经历仍在完整档案中。`) : null),
      h('div', { className: 'eh-list-caption' }, h('span', null, `${life?.memories?.length || 0} 段共同记忆`), h(QuietButton, { icon: 'memory', disabled: !life, onClick: () => openDialog('memory') }, '留住这一刻')),
      life?.memories?.length ? h('ol', { className: 'eh-memory-list' }, [...life.memories].reverse().map(memory => h('li', { key: memory.id }, h('button', { type: 'button', onClick: () => readMemory(memory.id) }, h('time', null, shortDate(memory.at)), h('strong', null, memory.title), h(Icon, { name: 'arrow', size: 16 }))))) : h('p', { className: 'eh-empty' }, '轻触“留住这一刻”，让第一段记忆留在它身上。'),
      h('footer', { className: 'eh-context-foot' }, h(QuietButton, { icon: 'download', disabled: !life, onClick: () => action(async () => downloadJSON(await lifeService.exportArchive(), `ECHO-${life.id}.json`)) }, '导出生命档案')));
    if (scene === 'listening') content = h('section', { className: 'eh-context eh-listening', ref: layerRef, 'aria-label': '音乐操作' },
      heading(track?.title || '一起听点什么。', track?.artist || '选一首歌，让音乐进入这里。'),
      !track ? h(QuietButton, { onClick: () => go('library'), icon: 'arrow' }, '找音乐') : h(React.Fragment, null,
        track.artist && openArtistPage ? h(QuietButton, { className: 'eh-artist-link', onClick: () => openArtistPage(track.artist) }, `走近 ${track.artist}`, h(Icon, { name: 'arrow', size: 14 })) : null,
        h('div', { className: 'eh-listening-controls' }, h(QuietButton, { icon: 'previous', onClick: () => action(() => player.prev()), 'aria-label': '上一首' }), h(QuietButton, { icon: loading ? 'loading' : playing ? 'pause' : 'play', className: 'eh-play-expanded', disabled: loading, onClick: () => action(() => player.toggle()), 'aria-label': loading ? '正在载入音乐' : playing ? '暂停' : '播放' }), h(QuietButton, { icon: 'next', onClick: () => action(() => player.next()), 'aria-label': '下一首' })),
        h('div', { className: 'eh-progress' }, h('input', { type: 'range', min: 0, max: duration || 1, step: .1, value: Math.max(0, Math.min(seekDraft ?? position, duration || 1)), disabled: !duration, onChange: event => { const value = Number(event.target.value); seekRef.current = { track, value }; setSeekDraft(value); }, onPointerUp: commitSeek, onKeyUp: commitSeek, onBlur: commitSeek, 'aria-label': '播放进度' }), h('div', null, h('time', null, formatTime(seekDraft ?? position)), h('time', null, formatTime(duration)))),
        h('div', { className: 'eh-taste-controls' }, h(QuietButton, { icon: 'heart', disabled: preferencePending || !taste.loaded || !!taste.error, 'aria-pressed': liked, onClick: () => preference('like') }, liked ? '已喜欢' : '喜欢'), h(QuietButton, { icon: 'dislike', disabled: preferencePending || !taste.loaded || !!taste.error, 'aria-pressed': disliked, onClick: () => preference('dislike') }, disliked ? '取消不喜欢' : '不喜欢并跳过'), preferencePending || !taste.loaded ? h('small', { role: 'status' }, preferencePending ? '正在保存偏好…' : '正在读取偏好…') : null,
          taste.error ? h('small', { role: 'alert' }, `偏好未能载入：${taste.error}`, likes.load ? h(QuietButton, { onClick: () => action(() => likes.load()) }, '重试读取') : null) : null),
        h('div', { className: 'eh-volume' }, h(QuietButton, { icon: 'sound', 'aria-label': muted ? '取消静音' : '静音', 'aria-pressed': muted, onClick: () => action(() => player.toggleMute()) }), h('input', { type: 'range', min: 0, max: 1, step: .01, value: muted ? 0 : volume, onChange: event => action(() => player.setVolume(Number(event.target.value))), 'aria-label': '音量' }), h(QuietButton, { onClick: () => action(() => player.cycleMode()), 'aria-label': '切换播放模式' }, shuffle ? '随机' : repeat === 'one' ? '单曲循环' : '顺序'))),
      h('footer', { className: 'eh-context-foot' }, h(QuietButton, { icon: 'lyrics', 'aria-pressed': lyricVisible, onClick: () => setLyricVisible(value => !value) }, lyricVisible ? '收起歌词' : '显示歌词'), h(QuietButton, { onClick: () => go('now-manage') }, `完整歌词与队列${queue.length ? ` · ${queue.length}` : ''}`)),
      lyricVisible ? h('div', { className: 'eh-lyrics-detail' }, lyricContent()) : null);
    if (scene === 'utility') content = h('section', { className: 'eh-utility', ref: layerRef, role: 'dialog', 'aria-modal': true, 'aria-label': UTILITIES[requestedView] || '音乐工具' },
      h('header', { className: 'eh-utility-heading' }, h(QuietButton, { icon: 'arrow', className: 'eh-back', onClick: returnHome }, '回到生命空间'), h('h2', { tabIndex: -1, 'data-eh-heading': true }, UTILITIES[requestedView] || '音乐工具'), h(QuietButton, { icon: 'close', onClick: returnHome, 'aria-label': '关闭工具' })),
      h('div', { className: 'eh-utility-scroll' }, renderUtility?.(requestedView) || h('p', { className: 'eh-empty' }, '这项工具暂时不可用。')));

    return h('section', { className: 'echo-living-space', 'data-scene': scene, 'data-tone': tone, 'data-playing': !!playing, 'data-reviewing': reviewing, ref: rootRef, onKeyDown, 'aria-label': '生命空间' },
      h('div', { className: 'eh-atmosphere', 'aria-hidden': true }, h('div', { className: 'eh-distant-light' }), h('div', { className: 'eh-ground' })),
      h('header', { className: 'eh-presence-header', inert: scene === 'utility' || !!dialog ? true : undefined },
        h('button', { type: 'button', className: 'eh-name', disabled: !life, onClick: () => openDialog('rename'), 'aria-label': '给生命命名' }, h('span', { className: 'eh-name-mark', 'aria-hidden': true }), h('strong', null, name), h('small', null, life ? `相识第 ${Math.max(1, Math.floor((Date.now() - life.createdAt) / 86400000) + 1)} 天` : '正在相遇')),
        h(QuietButton, { className: 'eh-menu-toggle', icon: 'more', ref: menuButtonRef, onClick: () => setMenu(value => !value), 'aria-label': '打开空间工具', 'aria-expanded': menu })),
      h('div', { className: 'eh-being-space', key: 'persistent-being', inert: scene === 'utility' || !!dialog ? true : undefined },
        h('div', { className: 'eh-being' }, life ? h(Creature, { life, morphology: selectedMorphology, framing: 'presence', tone, active: !!playing && !loading && !playbackError && !resting && !reviewing, compact: resting, gesture, motionEnabled: !reviewing, onTouch: touch, onMemorySelect: readMemory, label: reviewing ? `${name}，${shortDate(snapshot.at)}的模样` : `${name}，轻触互动` }) : h(EmptyLife, { state, lifeService })),
        h('div', { className: 'eh-being-whisper', 'aria-live': 'polite' }, reviewing ? `${shortDate(snapshot.at)} · ${snapshot.reason || '成长片段'}` : resting ? '安静待一会儿。' : loading ? '等音乐轻轻进来。' : playing && !playbackError ? '此刻，与你一起听。' : life?.greeting ? '轻触它，打个你们的招呼。' : '轻轻碰一下，认识彼此。')),
      h('div', { className: 'eh-relationship', inert: scene === 'utility' || !!dialog ? true : undefined },
        h(QuietButton, { icon: 'memory', onClick: () => go(scene === 'memory' ? 'home' : 'echo-memory'), 'aria-pressed': scene === 'memory' }, '共同记忆'),
        h(QuietButton, { icon: 'greet', disabled: !life, onClick: greet }, life?.greeting ? '打个招呼' : '教它招呼')),
      content,
      scene === 'encounter' && lyricVisible ? h('div', { className: 'eh-lyric-presence' }, lyricContent(true)) : null,
      h('footer', { className: 'eh-music-ground', inert: scene === 'utility' || !!dialog ? true : undefined },
        h('button', { type: 'button', className: 'eh-current-track', onClick: () => go(track ? 'now' : 'library'), 'aria-label': track ? '打开音乐操作' : '选一首一起听' }, h('span', { className: `eh-playing-mark ${playing ? 'is-playing' : ''}`, 'aria-hidden': true }, h('i'), h('i'), h('i')), h('span', null, h('strong', null, track?.title || '一起听点什么'), h('small', null, loading ? '正在载入音乐…' : track?.artist || '第一首歌，从这里开始'))),
        h('div', { className: 'eh-direct-controls' }, h(QuietButton, { icon: loading ? 'loading' : playing ? 'pause' : 'play', className: 'eh-main-play', disabled: !track || loading, onClick: () => action(() => player.toggle()), 'aria-label': loading ? '正在载入音乐' : playing ? '暂停' : '播放' }), h(QuietButton, { icon: 'next', disabled: !track, onClick: () => action(() => player.next()), 'aria-label': '下一首' })),
        h('button', { type: 'button', ref: findRef, className: 'eh-find', onClick: () => go('library'), 'aria-label': '找音乐' }, '找音乐', h('kbd', { 'aria-hidden': true }, '⌘ K'))),
      menu ? h('div', { className: 'eh-tools', ref: menuRef, role: 'region', 'aria-label': '空间工具' },
        h('div', { className: 'eh-tool-group' }, h(QuietButton, { icon: 'memory', disabled: !life, onClick: () => openDialog('memory') }, '留住这一刻'), h(QuietButton, { icon: 'greet', disabled: !life, onClick: () => openDialog('greeting') }, life?.greeting ? '再教一个招呼' : '教它一个招呼'), h(QuietButton, { icon: 'sound', disabled: !life, onClick: () => openDialog('share') }, '介绍一首歌'), h(QuietButton, { icon: resting ? 'sun' : 'moon', disabled: !life, onClick: rest }, resting ? '舒展身体' : '安静待一会儿')),
        h('div', { className: 'eh-tool-group' }, [['reco', '选几首一起听'], ['library-manage', '管理曲库'], ['reco-manage', '在线发现'], ['studio', '策展'], ['history', '聆听历史'], ['echo-gallery', '生命形态示例'], ['welcome', '音乐来源'], ['command', '音乐指令']].map(([route, label]) => h(QuietButton, { key: route, onClick: () => go(route) }, label))),
        h('div', { className: 'eh-tool-group' }, h(QuietButton, { icon: tone === 'dark' ? 'sun' : 'moon', onClick: () => setTone(value => value === 'dark' ? 'light' : 'dark') }, tone === 'dark' ? '清浅空间' : '深色空间'), setMiniHidden ? h(QuietButton, { icon: 'fold', onClick: () => { setMiniHidden(false); setMenu(false); report('关闭主空间后，它会在伴生窗里继续陪你。'); } }, '显示伴生窗') : null)) : null,
      h('div', { className: 'eh-system-status' }, h(Status, { state, lifeService }), playbackError ? h('p', { className: 'eh-feedback is-error', role: 'alert' }, playbackError) : null,
        feedback ? h('div', { className: `eh-feedback ${feedback.isError ? 'is-error' : ''}`, role: feedback.isError ? 'alert' : 'status' }, h('span', null, feedback.message), h(QuietButton, { icon: 'close', 'aria-label': '关闭提示', onClick: () => setFeedback(null) })) : null,
        undo ? h('button', { type: 'button', className: 'eh-undo', disabled: preferencePending, onClick: undoPreference }, `撤销对《${undo.track.title}》的不喜欢`) : null),
      dialog?.kind === 'greeting' && life ? h(GreetingDialog, { life, save, close: () => setDialog(null) }) : null,
      ['rename', 'memory', 'share'].includes(dialog?.kind) && life ? h(EditDialog, { kind: dialog.kind, life, track: playing ? track : null, save, close: () => setDialog(null) }) : null,
      dialog?.kind === 'read' ? h(MemoryDialog, { memory: dialog.memory, close: () => setDialog(null) }) : null);
  };
}
