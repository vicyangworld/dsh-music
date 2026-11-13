/** 播放状态服务：内存态，由 Client 播放器上报；S3 收听历史据此落盘。
 * 不驱动播放（播放由 Client HTMLAudioElement 单例负责），只持有/校验状态。
 * S1-003：注入 validateTrack 后，trackId 与 queue 元素必须存在于曲库索引。
 * 二期批1：mode 三态（single/sequential/shuffle）+ nextTrack 下一曲决策。 */
const STATUSES = new Set(['playing', 'paused', 'stopped'])
const REPEATS = new Set(['off', 'all', 'one'])
const MODES = new Set(['single', 'sequential', 'shuffle'])

export function createPlayback({ validateTrack } = {}) {
  let state = {
    trackId: null,
    status: 'stopped',
    position: 0,
    duration: null,
    volume: 1,
    queue: [],
    shuffle: false,
    repeat: 'off',
    mode: 'sequential',
    updatedAt: 0,
  }
  const listeners = new Set()
  let shufflePlayed = new Set()
  let shuffleQueueKey = null
  let shuffleLast = null

  function get() {
    return { ...state, queue: [...state.queue] }
  }

  /** 合并一次上报；字段非法时抛中文错误，路由转为 400。 */
  function report(patch = {}) {
    const next = { ...state }
    if ('trackId' in patch) {
      next.trackId = typeof patch.trackId === 'string' && patch.trackId ? patch.trackId : null
      if (next.trackId !== null && validateTrack && !validateTrack(next.trackId)) {
        throw new Error('trackId 不存在于曲库')
      }
    }
    if ('status' in patch) {
      if (!STATUSES.has(patch.status)) throw new Error('status 必须是 playing/paused/stopped')
      next.status = patch.status
    }
    if ('position' in patch) {
      const p = Number(patch.position)
      if (!Number.isFinite(p) || p < 0) throw new Error('position 必须是非负数字（秒）')
      next.position = p
    }
    if ('duration' in patch) {
      const d = patch.duration === null ? null : Number(patch.duration)
      if (d !== null && (!Number.isFinite(d) || d < 0)) throw new Error('duration 必须是 null 或非负数字（秒）')
      next.duration = d
    }
    if ('volume' in patch) {
      const v = Number(patch.volume)
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error('volume 必须在 0~1 之间')
      next.volume = v
    }
    if ('queue' in patch) {
      if (!Array.isArray(patch.queue) || patch.queue.some((x) => typeof x !== 'string')) {
        throw new Error('queue 必须是曲目 id 字符串数组')
      }
      if (validateTrack && patch.queue.some((id) => !validateTrack(id))) {
        throw new Error('queue 含不存在于曲库的 trackId')
      }
      next.queue = [...patch.queue]
    }
    if ('mode' in patch) {
      if (!MODES.has(patch.mode)) throw new Error('mode 必须是 single/sequential/shuffle')
      next.mode = patch.mode
      // 与旧字段保持同步，老上报路径不破坏
      next.shuffle = patch.mode === 'shuffle'
      next.repeat = patch.mode === 'single' ? 'one' : 'off'
    }
    if ('shuffle' in patch) next.shuffle = Boolean(patch.shuffle)
    if ('repeat' in patch) {
      if (!REPEATS.has(patch.repeat)) throw new Error('repeat 必须是 off/all/one')
      next.repeat = patch.repeat
    }
    // 仅上报旧字段（无 mode）时推导 mode，向后兼容
    if (!('mode' in patch) && ('shuffle' in patch || 'repeat' in patch)) {
      next.mode = next.shuffle ? 'shuffle' : (next.repeat === 'one' ? 'single' : 'sequential')
    }
    next.updatedAt = Date.now()
    state = next
    for (const fn of listeners) {
      try {
        fn(get())
      } catch {
        /* 监听者异常不影响状态服务 */
      }
    }
    return get()
  }

  /** 下一曲决策：single=重播当前；sequential=队列下一（末尾回绕）；
   * shuffle=随机不重复（队列一轮内不重样，轮尽重置；队列变化自动重置）。 */
  function nextTrack(currentId) {
    const queue = state.queue
    const mode = state.mode
    if (!Array.isArray(queue) || queue.length === 0) return { trackId: null, mode, reason: 'empty' }
    const current = typeof currentId === 'string' && currentId ? currentId : state.trackId
    if (mode === 'single') return { trackId: current ?? queue[0], mode, reason: 'replay' }
    if (mode === 'shuffle') {
      const key = queue.join(',')
      if (key !== shuffleQueueKey) {
        shuffleQueueKey = key
        shufflePlayed = new Set()
        shuffleLast = null
      }
      let pool = queue.filter((id) => id !== current && id !== shuffleLast && !shufflePlayed.has(id))
      if (pool.length === 0) {
        // 一轮播尽：重置已播集合，但仍避开当前曲与刚播的一首
        shufflePlayed = new Set()
        pool = queue.filter((id) => id !== current && id !== shuffleLast)
        if (pool.length === 0) pool = queue.filter((id) => id !== current)
        if (pool.length === 0) pool = [...queue]
      }
      const pick = pool[Math.floor(Math.random() * pool.length)]
      shufflePlayed.add(pick)
      shuffleLast = pick
      return { trackId: pick, mode, reason: 'shuffle' }
    }
    const idx = current ? queue.indexOf(current) : -1
    return { trackId: queue[(idx + 1) % queue.length], mode, reason: 'next' }
  }

  return {
    get,
    report,
    nextTrack,
    onChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}