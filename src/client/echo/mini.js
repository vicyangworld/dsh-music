/* The companion is a life first. Music is an explicitly opened, shared control
 * surface; touching the body or its memories never opens it or changes audio. */
const POSITION_KEY = 'dsh-music.echo.mini-position';
const LYRICS_KEY = 'dsh-music.echo.mini-lyrics';
const empty = Object.freeze({});
const identity = track => track ? String(track.id || `${track.artist || ''}::${track.title || ''}`) : '';
const bounded = (value, low, high) => Math.max(low, Math.min(Math.max(low, high), value));
function preference(key, fallback) {
  try { const saved = JSON.parse(window.localStorage.getItem(key)); return saved == null ? fallback : saved; } catch { return fallback; }
}
function remember(key, value) { try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Nonessential display preference. */ } }

export function companionPlacement(anchor, panel, viewport) {
  const gap = 10, margin = 12;
  const width = Math.min(panel.width || 286, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(panel.height || 240, Math.max(0, viewport.height - margin * 2));
  let left, top, side;
  if (viewport.width - anchor.right >= width + gap + margin) { left = anchor.right + gap; top = anchor.top + 30; side = 'right'; }
  else if (anchor.left >= width + gap + margin) { left = anchor.left - width - gap; top = anchor.top + 30; side = 'left'; }
  else {
    side = 'stack'; left = anchor.left + anchor.width / 2 - width / 2;
    top = viewport.height - anchor.bottom >= height + gap + margin ? anchor.bottom + gap : anchor.top - height - gap;
  }
  return { left: bounded(left, margin, viewport.width - width - margin), top: bounded(top, margin, viewport.height - height - margin), width, maxHeight: Math.max(0, viewport.height - margin * 2), side };
}

export function createEchoMiniComponent(React, { Creature, Icon, useLife, formatTime }) {
  const h = React.createElement;
  const { useState, useEffect, useRef } = React;
  const useBeforePaint = typeof window === 'undefined' ? useEffect : React.useLayoutEffect || useEffect;
  function useSource(source) {
    const [snapshot, setSnapshot] = useState(() => source?.getSnapshot() || empty);
    useEffect(() => {
      const update = () => setSnapshot(source?.getSnapshot() || empty);
      update(); return source?.subscribe(update);
    }, [source]);
    return snapshot;
  }

  return function EchoMini({ lifeService, player, lyrics, likes, usePlayer, useUi, openHome, openNow, openLibrary, setMiniHidden, setMiniCollapsed }) {
    const state = useLife(lifeService);
    const playback = usePlayer(s => s);
    const hidden = useUi(s => s.miniHidden || s.dockVisible);
    const collapsed = useUi(s => !!s.miniCollapsed);
    const lyricState = useSource(lyrics?.source);
    useSource(likes?.source);
    const { track, playing, loading, position: playPosition = 0, duration = 0, volume = 1, muted, queue = [], queueIndex = -1, shuffle, repeat, error } = playback;
    const trackKey = identity(track);
    const [position, setPosition] = useState(() => {
      const saved = preference(POSITION_KEY, null);
      return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
    });
    const [musicOpen, setMusicOpen] = useState(false);
    const [more, setMore] = useState(false);
    const [showQueue, setShowQueue] = useState(false);
    const [showLyrics, setShowLyrics] = useState(() => preference(LYRICS_KEY, false) === true);
    const [paper, setPaper] = useState(null);
    const [gesture, setGesture] = useState(0);
    const [feedback, setFeedback] = useState(null);
    const [undo, setUndo] = useState(null);
    const [busy, setBusy] = useState(null);
    const [seekDraft, setSeekDraft] = useState(null);
    const [placement, setPlacement] = useState(null);
    const [paperPlacement, setPaperPlacement] = useState(null);
    const [tone, setTone] = useState('light');
    const miniRef = useRef(null), menuRef = useRef(null), paperRef = useRef(null), musicRef = useRef(null), moreRef = useRef(null), queueRef = useRef(null);
    const positionRef = useRef(position), drag = useRef(null), touchAt = useRef(0), feedbackRef = useRef(null);
    const operation = useRef(null), mounted = useRef(true), greetingTimer = useRef(null);
    const redrawRef = useRef(null);
    const life = state.life;
    const name = life?.name && life.name !== '未命名' ? life.name : '你的音灵';
    const liked = !!(track && likes?.isLiked(track)), disliked = !!(track && likes?.isDisliked(track));
    const modeName = shuffle ? '随机播放' : repeat === 'one' ? '单曲循环' : '顺序播放';

    function anchorBox() {
      const box = miniRef.current?.getBoundingClientRect();
      if (box?.width && box?.height) return box;
      const width = Math.min(320, window.innerWidth - 24), height = width * 388 / 496 + 62;
      const left = positionRef.current?.x ?? Math.max(12, window.innerWidth - width - 20);
      const top = positionRef.current?.y ?? Math.max(12, window.innerHeight - height - 20);
      return { left, top, width, height, right: left + width, bottom: top + height };
    }
    function redraw() {
      if (!miniRef.current) return;
      const anchor = anchorBox(), viewport = { width: window.innerWidth, height: window.innerHeight };
      const next = companionPlacement(anchor, { width: 286, height: menuRef.current?.offsetHeight || 240 }, viewport);
      setPlacement(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      const width = Math.min(280, window.innerWidth - 24), height = Math.min(paperRef.current?.offsetHeight || 88, window.innerHeight - 24);
      const sheet = { left: bounded(anchor.left + (anchor.width - width) / 2, 12, window.innerWidth - width - 12), top: bounded(anchor.top - height - 10, 12, window.innerHeight - height - 12), width, maxHeight: Math.max(80, window.innerHeight - 24) };
      setPaperPlacement(previous => JSON.stringify(previous) === JSON.stringify(sheet) ? previous : sheet);
    }
    redrawRef.current = redraw;
    function moveTo(next) {
      const box = anchorBox();
      const value = { x: bounded(next.x, 0, window.innerWidth - box.width), y: bounded(next.y, 0, window.innerHeight - box.height) };
      positionRef.current = value; setPosition(value);
    }
    useEffect(() => {
      mounted.current = true;
      const move = event => {
        const current = drag.current;
        if (!current || (event.pointerId != null && current.pointerId !== event.pointerId)) return;
        if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4) return;
        current.moved = true; moveTo({ x: event.clientX - current.x, y: event.clientY - current.y });
      };
      const end = () => { if (drag.current?.moved) remember(POSITION_KEY, positionRef.current); drag.current = null; };
      const resize = () => { if (positionRef.current) { moveTo(positionRef.current); remember(POSITION_KEY, positionRef.current); } redrawRef.current?.(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('resize', resize);
      const media = window.matchMedia?.('(prefers-color-scheme: dark)');
      const appearance = () => setTone(media?.matches ? 'dark' : 'light');
      appearance(); media?.addEventListener?.('change', appearance);
      return () => { mounted.current = false; clearTimeout(greetingTimer.current); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('resize', resize); media?.removeEventListener?.('change', appearance); };
    }, []);
    useBeforePaint(() => { if (!hidden && life) { if (positionRef.current) moveTo(positionRef.current); redraw(); } }, [hidden, !!life, collapsed, position?.x, position?.y, musicOpen, more, showQueue, showLyrics, paper, feedback, busy, error, loading]);
    useEffect(() => {
      if (!hidden) return;
      setMusicOpen(false); setMore(false); setShowQueue(false); setSeekDraft(null); setPaper(null);
      clearTimeout(greetingTimer.current);
    }, [hidden]);
    useEffect(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => redrawRef.current?.());
      [miniRef.current, menuRef.current, paperRef.current].forEach(node => { if (node) observer.observe(node); });
      return () => observer.disconnect();
    }, [hidden, musicOpen, paper, showLyrics]);
    useEffect(() => {
      setSeekDraft(null);
      if (paper?.kind === 'greeting') setPaper(null);
    }, [trackKey]);
    useEffect(() => {
      if (showLyrics && track?.id && lyrics) Promise.resolve(lyrics.load(track.id)).catch(() => {});
    }, [showLyrics, track?.id, lyrics]);

    function closeMusic(restore = true) {
      setMusicOpen(false); setMore(false); setShowQueue(false); setSeekDraft(null);
      if (restore) musicRef.current?.focus();
    }
    function say(message, failed = false) { if (mounted.current) setFeedback({ message, failed }); }
    function touch() {
      const now = Date.now(); if (now - touchAt.current < 1200) return; touchAt.current = now;
      setGesture(value => value + 1);
      setPaper({ kind: 'greeting', title: name, text: playing ? '在呢，一起听。' : '在呢，陪你安静一会儿。' });
      clearTimeout(greetingTimer.current);
      greetingTimer.current = setTimeout(() => { if (mounted.current) setPaper(current => current?.kind === 'greeting' ? null : current); }, 2600);
      lifeService.dispatch('interaction', { action: life?.greeting ? 'greet' : 'touch' }).catch(problem => {
        if (problem.queued) return;
        if (mounted.current) setPaper({ kind: 'error', title: '这次回应暂未保存', text: problem.message || '请稍后重试。' });
      });
    }
    function readMemory(id) {
      const memory = life?.memories?.find(item => item.id === id);
      if (!memory) return;
      clearTimeout(greetingTimer.current); closeMusic(false);
      setPaper({ kind: 'memory', title: memory.title, text: memory.note || '你们把这一刻留了下来。', memory });
    }
    async function preferenceAction(item, action) {
      if (!item || !likes || operation.current) return;
      const key = identity(item); operation.current = key; setBusy({ key, title: item.title });
      try { await action(); }
      catch (problem) { say(`《${item.title || '这首歌'}》的偏好未能保存：${problem.message || '请重试'}`, true); }
      finally { operation.current = null; if (mounted.current) setBusy(null); }
    }
    async function checked(result) {
      const value = await result;
      if (value?.error) throw new Error(value.error);
      return value || {};
    }
    function toggleLike() {
      const item = { ...track }, wasLiked = likes?.isLiked(track);
      return preferenceAction(item, async () => {
        const result = await checked(likes.toggle(item, !wasLiked));
        if (!mounted.current) return;
        setUndo(old => identity(old?.track) === identity(item) ? null : old);
        say(result.message || (wasLiked ? `已取消喜欢《${item.title}》。` : result.downloading ? `已喜欢《${item.title}》，正在加入曲库。` : `已喜欢《${item.title}》。`));
      });
    }
    function toggleDislike() {
      const item = { ...track }, before = likes?.isDisliked(track) ? 'dislike' : likes?.isLiked(track) ? 'like' : null;
      return preferenceAction(item, async () => {
        await checked(likes.setDislike(item, before !== 'dislike'));
        if (before === 'dislike') {
          if (mounted.current) { setUndo(old => identity(old?.track) === identity(item) ? null : old); say(`已取消对《${item.title}》的不喜欢。`); }
          return;
        }
        let outcome = '这次没有打断你后来选择的歌曲';
        // A pending request belongs to the captured song. Never skip a new song
        // that the user selected while the preference was being persisted.
        const latest = player.source.getSnapshot();
        if (identity(latest.track) === identity(item)) {
          const list = latest.queue || []; let candidate = -1;
          for (let step = 1; step <= list.length; step++) {
            const index = ((latest.queueIndex || 0) + step) % list.length;
            if (identity(list[index]) !== identity(item) && !likes.isDisliked(list[index])) { candidate = index; break; }
          }
          if (candidate >= 0) { player.jumpTo(candidate); outcome = '已切换下一首'; }
          else { if (player.pause) player.pause(); else if (latest.playing) player.toggle(); outcome = '队列里没有其他可播放的歌，已暂停'; }
        }
        if (mounted.current) {
          setUndo({ track: item, before });
          say(`已将《${item.title}》标记为不喜欢。${outcome}。`);
        }
      });
    }
    function undoDislike() {
      if (!undo) return;
      const original = undo;
      if (!likes?.isDisliked(original.track)) {
        setUndo(null); say(`《${original.track.title}》的偏好已更新，已保留你的新选择。`); return;
      }
      return preferenceAction(original.track, async () => {
        await checked(likes.setDislike(original.track, false));
        if (original.before === 'like') {
          // Restoring a preference must not re-start a preview download. The
          // host still restores the like without a verification token.
          try { await checked(likes.toggle({ ...original.track, verification: undefined }, true)); }
          catch (problem) { throw new Error(`不喜欢已撤销，原来的喜欢尚未恢复：${problem.message}`); }
        }
        if (mounted.current) { setUndo(null); say(`已恢复《${original.track.title}》的原偏好，继续当前播放。`); }
      });
    }
    function commitSeek() {
      if (seekDraft != null) { player.seek(seekDraft); setSeekDraft(null); }
    }
    function iconButton(label, icon, onClick, extra = {}) {
      return h('button', { type: 'button', 'aria-label': label, title: label, onClick, ...extra }, h(Icon, { name: icon, size: extra.size || 17 }));
    }
    function playButton(className) {
      return iconButton(playing ? '暂停' : '播放', loading ? 'loading' : playing ? 'pause' : 'play', player.toggle, { className, disabled: !track, 'aria-busy': !!loading });
    }
    if (!life || hidden) return null;

    const currentLyrics = lyricState.trackId === track?.id ? lyricState : null;
    let displayedPaper = paper;
    if (!displayedPaper && showLyrics && track) {
      const data = currentLyrics?.data;
      if (currentLyrics?.status === 'error') displayedPaper = { kind: 'lyric-error', title: '歌词暂未取得', text: currentLyrics.error || '可以稍后重试。' };
      else if (!currentLyrics || currentLyrics.status === 'loading') displayedPaper = { kind: 'lyrics', title: track.title, text: '正在查找歌词…' };
      else if (data?.synced && data.lines?.length) {
        const line = [...data.lines].reverse().find(item => Number.isFinite(item.time) && playPosition + 0.2 >= item.time);
        displayedPaper = { kind: 'lyrics', title: track.title, text: line?.text || track.title };
      } else displayedPaper = { kind: data?.plain ? 'plain-lyrics' : 'lyrics', title: track.title, text: data?.plain ? '这首歌只有未同步歌词。' : data?.message || '暂时没有这首歌的歌词。' };
    }
    const paperVisible = displayedPaper && (!musicOpen || placement?.side !== 'stack');
    const menuStyle = placement ? { left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight } : undefined;
    const count = queue.length;
    const libraryTrack = /^[a-f0-9]{16}$/.test(String(track?.id || ''));
    const likeLabel = liked ? '取消喜欢这首歌' : libraryTrack ? '喜欢这首歌' : track?.verification ? '喜欢并加入曲库' : '喜欢这首歌（暂不入库）';
    return h('aside', {
      ref: miniRef, className: `echo-mini echo-mini-presence ${collapsed ? 'is-compact' : ''}`, 'aria-label': '音灵伴生窗', 'data-tone': tone,
      style: position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined,
      onKeyDown: event => {
        if (event.key !== 'Escape') return;
        if (showQueue) { setShowQueue(false); queueRef.current?.focus(); event.preventDefault(); }
        else if (more) { setSeekDraft(null); setMore(false); moreRef.current?.focus(); event.preventDefault(); }
        else if (musicOpen) { closeMusic(); event.preventDefault(); }
        else if (paper) { setPaper(null); event.preventDefault(); }
      },
    },
    h('button', { type: 'button', className: 'echo-mini-grip', title: '拖动伴生窗，或用方向键移动', 'aria-label': '移动伴生窗，使用方向键',
      onPointerDown: event => { if (event.button !== 0) return; const box = anchorBox(); drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX - box.left, y: event.clientY - box.top, moved: false }; event.preventDefault(); },
      onKeyDown: event => { const delta = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[event.key]; if (!delta) return; event.preventDefault(); const box = anchorBox(); moveTo({ x: box.left + delta[0], y: box.top + delta[1] }); remember(POSITION_KEY, positionRef.current); },
    }, h('i'), h('i'), h('i')),
    h('div', { className: 'echo-mini-creature' }, h(Creature, { life, body: state.body, motionProvider: lifeService.motion, motionMemory: lifeService.motionMemory, music: state.features, morphology: state.morphology, framing: 'presence', compact: collapsed || (!!track && !playing), active: playing && !loading && !error && !collapsed, gesture, onTouch: touch, onMemorySelect: readMemory, label: name, tone }),
      life.memories?.length ? iconButton('回看最近共同记忆', 'memory', () => readMemory(life.memories.at(-1).id), { className: 'echo-mini-memory-button' }) : null),
    h('div', { className: 'echo-mini-foot', role: 'group', 'aria-label': '随手控制音乐' },
      track ? playButton('echo-mini-quiet') : iconButton('选一首歌', 'play', openLibrary || openNow || openHome, { className: 'echo-mini-quiet' }),
      iconButton('下一首', 'next', player.next, { className: 'echo-mini-quiet', disabled: !track || !count }),
      h('button', { type: 'button', className: 'echo-mini-music', ref: musicRef, onClick: () => musicOpen ? closeMusic(false) : setMusicOpen(true), 'aria-label': '音乐操作', 'aria-expanded': musicOpen }, h(Icon, { name: 'sound', size: 16 }), h('span', null, '音乐'))),
    error && !musicOpen ? h('button', { type: 'button', className: 'echo-mini-playback-status is-error', onClick: () => setMusicOpen(true) }, '播放失败，查看原因') : loading && !musicOpen ? h('div', { className: 'echo-mini-playback-status', role: 'status' }, '正在加载音乐…') : null,
    paperVisible ? h('section', { ref: paperRef, className: `echo-mini-paper is-${displayedPaper.kind}`, style: paperPlacement || undefined, 'aria-label': displayedPaper.kind === 'memory' ? '共同记忆' : displayedPaper.kind === 'greeting' ? '音灵的回应' : '伴随歌词' },
      h('div', { className: 'echo-mini-paper-title' }, displayedPaper.title),
      h('p', null, displayedPaper.text),
      displayedPaper.memory?.track ? h('small', null, `${displayedPaper.memory.track.title || '音乐'}${displayedPaper.memory.track.artist ? ` · ${displayedPaper.memory.track.artist}` : ''}`) : null,
      displayedPaper.kind === 'lyric-error' ? h('button', { type: 'button', className: 'echo-mini-text', onClick: () => lyrics?.load(track.id) }, '重试歌词') : null,
      displayedPaper.kind === 'plain-lyrics' ? h('button', { type: 'button', className: 'echo-mini-text', onClick: openNow }, '打开完整歌词') : null,
      iconButton('收起纸条', 'close', () => { if (paper) setPaper(null); else { setShowLyrics(false); remember(LYRICS_KEY, false); } musicRef.current?.focus(); }, { className: 'echo-mini-paper-close' })) : null,
    musicOpen ? h('section', { ref: menuRef, className: 'echo-mini-tools', style: menuStyle, 'aria-label': '伴生音乐操作' },
      h('div', { className: 'echo-mini-tools-head' }, h('div', null, h('strong', null, track?.title || '一起听点什么'), h('small', null, track?.artist || '从你的音乐开始')), iconButton('收起音乐操作', 'close', () => closeMusic(), { className: 'echo-mini-close' })),
      h('div', { className: 'echo-mini-transport', role: 'group', 'aria-label': '播放控制' }, iconButton('上一首', 'previous', player.prev, { disabled: !track }), playButton('echo-mini-play-main'), iconButton('下一首', 'next', player.next, { disabled: !track || !count })),
      !track ? h('button', { type: 'button', className: 'echo-mini-select-track', onClick: openLibrary || openNow || openHome }, '选一首歌') : null,
      loading ? h('p', { className: 'echo-mini-hint', role: 'status' }, '正在加载音乐…') : null,
      error ? h('div', { className: 'echo-mini-error', role: 'alert' }, h('p', null, error), h('button', { type: 'button', onClick: player.play || player.toggle }, '重试播放')) : null,
      h('div', { className: 'echo-mini-actions' },
        h('button', { type: 'button', disabled: !track || !likes || !!busy, onClick: toggleLike, 'aria-pressed': liked, 'aria-label': likeLabel, title: likeLabel }, h(Icon, { name: 'heart', size: 17 }), h('span', null, liked ? '已喜欢' : '喜欢')),
        h('button', { type: 'button', disabled: !track || !likes || !!busy, onClick: toggleDislike, 'aria-pressed': disliked, 'aria-label': disliked ? '取消不喜欢这首歌' : '不喜欢这首歌并跳过', title: disliked ? '取消不喜欢这首歌' : '不喜欢这首歌并跳过，可撤销' }, h(Icon, { name: 'dislike', size: 17 }), h('span', null, disliked ? '已标记' : '不喜欢')),
        h('button', { type: 'button', onClick: () => { const next = !showLyrics; setShowLyrics(next); remember(LYRICS_KEY, next); setPaper(null); closeMusic(); }, 'aria-pressed': showLyrics, 'aria-label': showLyrics ? '关闭伴随歌词' : '显示伴随歌词' }, h(Icon, { name: 'lyrics', size: 17 }), h('span', null, '歌词')),
        h('button', { type: 'button', ref: moreRef, onClick: () => { setMore(value => !value); setShowQueue(false); }, 'aria-expanded': more, 'aria-label': '更多播放操作' }, h(Icon, { name: 'more', size: 17 }), h('span', null, '更多'))),
      busy ? h('p', { className: 'echo-mini-hint', role: 'status' }, `正在保存《${busy.title || '这首歌'}》的偏好…`) : null,
      feedback ? h('div', { ref: feedbackRef, className: `echo-mini-feedback ${feedback.failed ? 'is-error' : ''}`, role: feedback.failed ? 'alert' : 'status' }, h('p', null, feedback.message), undo ? h('button', { type: 'button', onClick: undoDislike, disabled: !!busy }, `撤销对《${undo.track.title}》的不喜欢`) : null) : null,
      more ? h('div', { className: 'echo-mini-more' },
        h('label', { className: 'echo-mini-range' }, h('span', null, '进度', h('time', null, `${formatTime(seekDraft ?? playPosition)} / ${formatTime(duration)}`)), h('input', { type: 'range', min: 0, max: duration || 1, step: 0.1, value: Math.min(seekDraft ?? playPosition, duration || 1), disabled: !track || !duration, 'aria-label': '伴生播放进度', onChange: event => setSeekDraft(Number(event.target.value)), onPointerUp: commitSeek, onKeyUp: commitSeek, onBlur: commitSeek })),
        h('div', { className: 'echo-mini-volume' }, iconButton(muted ? '取消静音' : '静音', 'sound', player.toggleMute, { 'aria-pressed': !!muted }), h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: muted ? 0 : volume, onChange: event => player.setVolume(Number(event.target.value)), 'aria-label': '伴生音量' })),
        h('div', { className: 'echo-mini-secondary' }, h('button', { type: 'button', onClick: player.cycleMode, 'aria-label': `播放模式：${modeName}` }, modeName), h('button', { type: 'button', ref: queueRef, onClick: () => setShowQueue(value => !value), 'aria-expanded': showQueue }, `队列 · ${count}`)),
        showQueue ? h('ol', { className: 'echo-mini-queue', 'aria-label': '当前播放队列' }, queue.map((item, index) => h('li', { key: `${identity(item)}-${index}` }, h('button', { type: 'button', 'aria-current': index === queueIndex ? 'true' : undefined, onClick: () => player.jumpTo(index) }, h('span', null, item.title || '未命名音乐'), h('small', null, item.artist || ''))))) : null,
        h('div', { className: 'echo-mini-window-actions' }, h('button', { type: 'button', onClick: () => setMiniCollapsed(!collapsed), 'aria-label': collapsed ? '展开伴生窗' : '收拢伴生窗' }, h(Icon, { name: collapsed ? 'sun' : 'moon', size: 15 }), collapsed ? '舒展身体' : '安静栖息'), h('button', { type: 'button', onClick: openHome }, '回到主舞台'), h('button', { type: 'button', onClick: () => setMiniHidden(true), 'aria-label': '隐藏伴生窗', title: '隐藏伴生窗，音乐继续播放' }, '隐藏伴生窗'))) : null) : null);
  };
}
