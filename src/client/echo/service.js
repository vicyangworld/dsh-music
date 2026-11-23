import { validateBodyState } from '../../../bundle/shared/body-core.js';
import { createMotionProvider } from './motion-provider.js';

const OUTBOX_KEY = 'dsh-music.echo.outbox.v1';
const OUTBOX_VERSION = 2;
const MAX_PENDING = 500;
const MAX_EVENT_BYTES = 64 * 1024;

export function eventId(prefix = 'event') {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `echo-${prefix}-${token}`;
}

function failure(message, code, fields = {}) {
  return Object.assign(new Error(message), { code, ...fields });
}
function canonicalId(value) {
  if (typeof value !== 'string') throw failure('这条经历缺少有效标识。', 'INVALID_LIFE_EVENT');
  const id = value.trim().normalize('NFC');
  if (!id || id.length > 160 || /[\u0000-\u001f\u007f]/.test(id)) throw failure('这条经历的标识不正确。', 'INVALID_LIFE_EVENT');
  return id;
}
function copyEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('这条经历格式不正确。', 'INVALID_LIFE_EVENT');
  const id = canonicalId(value.id);
  if (typeof value.type !== 'string' || !value.type || value.type.length > 24 || !Number.isSafeInteger(value.at) || value.at < 0) {
    throw failure('这条经历的类型或时间不正确。', 'INVALID_LIFE_EVENT');
  }
  let json;
  try { json = JSON.stringify({ ...value, id }); }
  catch { throw failure('这条经历无法保存为本机记录。', 'INVALID_LIFE_EVENT'); }
  if (new TextEncoder().encode(json).length > MAX_EVENT_BYTES) throw failure('这条经历过长，请缩短后重试。', 'LIFE_REQUEST_TOO_LARGE');
  return JSON.parse(json);
}
function readFormat(raw) {
  const value = raw ? JSON.parse(raw) : [];
  const legacy = Array.isArray(value);
  if (!legacy && (!value || value.version !== OUTBOX_VERSION || !Array.isArray(value.pending) || !Array.isArray(value.rejected))) throw new Error('Unknown outbox format');
  const pending = legacy ? value : value.pending;
  const rejected = legacy ? [] : value.rejected;
  if (pending.length + rejected.length > MAX_PENDING) throw new Error('Outbox capacity exceeded');
  const ids = new Set();
  const unique = [];
  for (const rawEvent of pending) {
    const event = copyEvent(rawEvent);
    // Old versions queued duplicates. The host keeps the first canonical ID.
    if (!ids.has(event.id)) { ids.add(event.id); unique.push(event); }
  }
  const held = rejected.map(item => {
    const event = copyEvent(item?.event);
    if (ids.has(event.id) || !Number.isInteger(item.status) || typeof item.message !== 'string' || !Number.isSafeInteger(item.rejectedAt)) throw new Error('Invalid rejected event');
    ids.add(event.id);
    return { event, status: item.status, code: String(item.code || ''), message: item.message, rejectedAt: item.rejectedAt };
  });
  return { pending: unique, rejected: held };
}

export function createLifeClient(options = {}) {
  const {
    resolveUrl, fetcher = (...args) => fetch(...args), timers = globalThis,
    eventTarget = globalThis, retryDelay = 15000, requestTimeout = 20000,
  } = options;
  let storage;
  let rawStorage = null;
  let readError = null;
  let storageError = null;
  let syncError = null;
  let outbox = { pending: [], rejected: [] };
  let volatile = [];
  let state;
  let loadJob = null;
  let flushJob = null;
  let retryTimer = null;
  let disposed = false;
  let requestSequence = 0;
  let acceptedSequence = 0;
  let acceptedRevision = 0;
  let acceptedIds = new Set();
  let capabilitiesLoaded = false;
  let capabilityJob = null;
  let capabilityRetryAt = 0;
  let developmentJob = null;
  let developmentAfter = 0;
  let savedMotion = null;
  const motionMemory = {
    read(body) {
      if (!savedMotion || savedMotion.lifeId !== body?.lifeId || savedMotion.topology !== body?.topology || savedMotion.bodyRevision !== body?.bodyRevision) return null;
      return JSON.parse(JSON.stringify(savedMotion));
    },
    write(snapshot) {
      if (disposed || !snapshot || snapshot.lifeId !== state?.body?.lifeId || snapshot.topology !== state.body.topology || snapshot.bodyRevision !== state.body.bodyRevision) return;
      savedMotion = JSON.parse(JSON.stringify(snapshot));
    },
  };
  const motion = options.motionProvider || createMotionProvider({ resolveUrl, fetcher, getCurrentBody: () => state?.body });
  const listeners = new Set();
  const requests = new Set();
  const closed = () => failure('生命服务已经关闭。', 'LIFE_CLIENT_CLOSED');
  const active = () => { if (disposed) throw closed(); };
  const set = patch => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const fn of listeners) { try { fn(); } catch { /* UI observers cannot interrupt persistence. */ } }
  };
  const refresh = () => set({
    pending: outbox.pending.length + volatile.length,
    rejectedCount: outbox.rejected.length,
    rejected: outbox.rejected.map(({ event, ...reason }) => ({ id: event.id, type: event.type, ...reason })),
    volatileCount: volatile.length,
    storageError: storageError || readError,
    syncError: storageError || readError || syncError || (outbox.rejected.length ? `${outbox.rejected.length} 条经历未被接受，已单独保留，可导出或重新尝试。` : null),
  });
  function readStorage() {
    try {
      storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : globalThis.localStorage;
      if (!storage) throw new Error('Storage unavailable');
      rawStorage = storage.getItem(OUTBOX_KEY);
      outbox = readFormat(rawStorage);
      readError = null;
    } catch {
      readError = '待同步记录暂时无法读取，原始记录未被覆盖。请导出本机暂存内容并检查浏览器存储后重试。';
    }
  }
  readStorage();
  state = { status: 'idle', life: null, morphology: null, body: null, bodyGrowth: [], development: null, growthModel: { available: false, reason: 'not-checked' }, developmentError: null, error: readError, pending: 0, syncError: readError, audioStatus: 'idle', features: null };
  refresh();
  const source = { getSnapshot: () => state, subscribe: fn => { if (disposed) return () => {}; listeners.add(fn); return () => listeners.delete(fn); } };
  const url = path => resolveUrl ? resolveUrl(`/dsh-music/api/life${path}`) : `/dsh-music/api/life${path}`;

  // A transition replaces one storage value; memory changes after the write.
  function persist(next, remaining = volatile) {
    active();
    if (readError) throw failure(readError, 'LIFE_OUTBOX_READ');
    if (next.pending.length + next.rejected.length > MAX_PENDING) throw failure('本机暂存经历已满，请先恢复同步或导出暂存记录。', 'LIFE_OUTBOX_LIMIT');
    try {
      if (!storage) throw new Error('Storage unavailable');
      const raw = JSON.stringify({ version: OUTBOX_VERSION, ...next });
      storage.setItem(OUTBOX_KEY, raw);
      rawStorage = raw;
    } catch {
      storageError = '浏览器暂时无法保存经历。未落盘的记录仅保留在当前页面，请重试或导出暂存内容。';
      refresh();
      throw failure(storageError, 'LIFE_OUTBOX_WRITE');
    }
    outbox = next;
    volatile = remaining;
    storageError = null;
    refresh();
  }
  function recoverLocal() {
    active();
    if (readError) { readStorage(); refresh(); }
    if (readError) throw failure(readError, 'LIFE_OUTBOX_READ');
    if (volatile.length) {
      const ids = new Set([...outbox.pending.map(item => item.id), ...outbox.rejected.map(item => item.event.id)]);
      const waiting = volatile.filter(item => !ids.has(item.id));
      const available = Math.max(0, MAX_PENDING - outbox.pending.length - outbox.rejected.length);
      // Storage may become readable after a large older backlog was hidden by
      // a permission error. Drain that backlog before promoting the remainder.
      if (waiting.length && !available) {
        if (!outbox.pending.length) throw failure('本机暂存经历已满，请先导出保留的记录。当前页的新经历仍保留在内存中。', 'LIFE_OUTBOX_LIMIT');
        return;
      }
      persist({ ...outbox, pending: [...outbox.pending, ...waiting.slice(0, available)] }, waiting.slice(available));
    }
  }
  function clearRetry() {
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    retryTimer = null;
  }
  function scheduleRetry() {
    if (disposed || retryTimer !== null) return;
    retryTimer = timers.setTimeout(() => { retryTimer = null; void flush().catch(() => {}); }, retryDelay);
  }
  function retryable(error) {
    return !['LIFE_CLIENT_CLOSED', 'LIFE_OUTBOX_LIMIT'].includes(error.code)
      && (!error.status || error.status >= 500 || error.status === 408 || error.status === 429 || (error.code === 'LIFE_RESPONSE_INVALID' && error.status < 400));
  }
  function eventRejection(error) {
    return (error.status === 400 && error.code === 'INVALID_LIFE_EVENT')
      || (error.status === 404 && error.code === 'UNKNOWN_LIFE_TRACK')
      || (error.status === 413 && error.code === 'LIFE_REQUEST_TOO_LARGE')
      || (error.status === 409 && error.code === 'LIFE_MEMORY_LIMIT');
  }
  async function request(path, options = {}) {
    active();
    const sequence = ++requestSequence;
    const controller = new AbortController();
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    let deadline = null;
    const handle = { cancel(error) { if (deadline !== null) timers.clearTimeout(deadline); rejectAbort(error); controller.abort(); } };
    requests.add(handle);
    const timeout = path === '/development' && options.method === 'POST' ? Math.max(30000, requestTimeout) : requestTimeout;
    deadline = timers.setTimeout(() => handle.cancel(failure('连接生命档案超时，稍后会重试。', 'LIFE_REQUEST_TIMEOUT')), timeout);
    try {
      const response = await Promise.race([Promise.resolve().then(() => { active(); return fetcher(url(path), { cache: 'no-store', ...options, signal: controller.signal }); }), aborted]);
      let data;
      try { data = await Promise.race([response.json(), aborted]); }
      catch (error) {
        if (error?.code === 'LIFE_CLIENT_CLOSED' || error?.code === 'LIFE_REQUEST_TIMEOUT') throw error;
        throw failure('生命档案返回了无法读取的响应，请稍后重试。', 'LIFE_RESPONSE_INVALID', { status: response.status });
      }
      active();
      if (!response.ok) throw failure(data?.error || '生命档案暂时无法连接。', data?.code || 'LIFE_REQUEST_FAILED', { status: response.status });
      return { data, sequence };
    } finally {
      if (deadline !== null) timers.clearTimeout(deadline);
      requests.delete(handle);
    }
  }
  function accept(data, sequence) {
    if (!data?.life || !data?.morphology || typeof data.life.id !== 'string' || !Array.isArray(data.life.processedEventIds)) throw failure('生命档案响应不完整，请重试。', 'LIFE_RESPONSE_INVALID');
    if (state.body && state.life?.id === data.life.id && !data.body) throw failure('响应缺少当前身体版本，已有身体已保留。', 'LIFE_RESPONSE_INVALID');
    if (data.body) {
      try { validateBodyState(data.body, data.life); }
      catch { throw failure('身体与成长档案不一致，当前身体已保留。', 'LIFE_RESPONSE_INVALID'); }
    }
    const previous = state.life;
    if (previous?.id === data.life.id) {
      const difference = data.life.processedEventIds.length - previous.processedEventIds.length;
      const bodyDifference = data.body && state.body ? data.body.bodyRevision - state.body.bodyRevision : 0;
      if (difference < 0 || bodyDifference < 0 || (difference === 0 && bodyDifference === 0 && sequence < acceptedSequence)) return;
    } else if (previous && sequence < acceptedSequence) return;
    acceptedSequence = Math.max(acceptedSequence, sequence);
    acceptedRevision++;
    acceptedIds = new Set(data.life.processedEventIds);
    set({ life: data.life, morphology: data.morphology, body: data.body || null, bodyGrowth: data.bodyGrowth || [], development: data.development || null, status: 'ready', error: null });
  }
  async function refreshDevelopment() {
    try {
      const { data } = await request('/development');
      set({ growthModel: data?.available === true ? data : { available: false, reason: data?.reason || 'growth-model-unavailable' } });
      developmentAfter = Math.max(developmentAfter, Number.isFinite(data?.nextAttemptAt) ? data.nextAttemptAt : 0);
      void develop().catch(() => {});
      return true;
    } catch (error) {
      set({ growthModel: { available: false, reason: 'growth-model-unavailable' } });
      return error.status === 404;
    }
  }
  function refreshCapabilities(force = false) {
    if (disposed || !state.body || capabilityJob || (!force && (capabilitiesLoaded || Date.now() < capabilityRetryAt))) return capabilityJob || Promise.resolve();
    capabilityRetryAt = Date.now() + 60000;
    capabilityJob = Promise.allSettled([refreshDevelopment(), motion.refreshStatus()]).then(results => {
      capabilitiesLoaded = results[0].status === 'fulfilled' && results[0].value === true
        && results[1].status === 'fulfilled' && !results[1].value?.retryable;
    }).finally(() => { capabilityJob = null; });
    return capabilityJob;
  }
  function develop() {
    if (developmentJob) return developmentJob;
    if (disposed || !state.body || state.development?.eligible !== true || state.growthModel?.available !== true
        || outbox.pending.length || volatile.length || Date.now() < developmentAfter) return Promise.resolve(null);
    const body = state.body;
    developmentAfter = Date.now() + 60000;
    set({ developing: true, developmentError: null });
    developmentJob = request('/development', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseLifeRevision: body.lifeRevision, baseBodyRevision: body.bodyRevision }),
    }).then(({ data, sequence }) => {
      accept(data, sequence);
      if (data.developmentResult?.status === 'deferred') developmentAfter = Date.now() + 5 * 60000;
      if (Number.isFinite(data.developmentResult?.nextAttemptAt)) developmentAfter = Math.max(developmentAfter, data.developmentResult.nextAttemptAt);
      return data;
    }).catch(error => {
      if (error.code !== 'LIFE_CLIENT_CLOSED') set({ developmentError: error.message });
      throw error;
    }).finally(() => { developmentJob = null; set({ developing: false }); });
    return developmentJob;
  }
  function load() {
    if (disposed) return Promise.reject(closed());
    if (loadJob) return loadJob;
    const revision = acceptedRevision;
    set({ status: state.life ? 'ready' : 'loading' });
    loadJob = request('').then(({ data, sequence }) => {
      accept(data, sequence);
      if (data.body) void refreshCapabilities();
      return data;
    }).catch(error => {
      // A delayed failed GET cannot replace a newer successful POST's state.
      if (revision === acceptedRevision) set({ status: state.life ? 'ready' : 'error', error: error.message });
      if ((outbox.pending.length || volatile.length) && retryable(error)) scheduleRetry();
      throw error;
    }).finally(() => { loadJob = null; });
    return loadJob;
  }
  function flush() {
    if (disposed) return Promise.reject(closed());
    if (flushJob) return flushJob;
    clearRetry();
    flushJob = Promise.resolve().then(async () => {
      recoverLocal();
      if (!outbox.pending.length) { syncError = null; refresh(); return; }
      if (!state.life) await load();
      while (outbox.pending.length || volatile.length) {
        active();
        recoverLocal();
        if (!outbox.pending.length) break;
        const item = outbox.pending[0];
        try {
          if (!acceptedIds.has(item.id)) {
            const { data, sequence } = await request('/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
            if (!data?.life?.processedEventIds?.includes(item.id)) throw failure('这条经历尚未得到完整确认，将保留并重试。', 'LIFE_RESPONSE_INVALID');
            accept(data, sequence);
          }
          persist({ ...outbox, pending: outbox.pending.filter(event => event.id !== item.id) });
          syncError = null;
          refresh();
        } catch (error) {
          if (!eventRejection(error)) throw error;
          persist({
            pending: outbox.pending.filter(event => event.id !== item.id),
            rejected: [...outbox.rejected, { event: item, status: error.status, code: error.code, message: error.message, rejectedAt: Date.now() }],
          });
          syncError = null;
          refresh();
        }
      }
    }).catch(error => {
      syncError = error.message;
      refresh();
      if (retryable(error)) scheduleRetry();
      throw error;
    }).finally(() => { flushJob = null; void refreshCapabilities(); void develop().catch(() => {}); });
    return flushJob;
  }
  function rejectedError(record) {
    return failure(`${record.message} 这条经历已单独保留，可导出或重新尝试。`, record.code, { status: record.status, queued: false, quarantined: true });
  }
  function enqueue(rawEvent) {
    active();
    const id = canonicalId(rawEvent?.id);
    const held = outbox.rejected.find(item => item.event.id === id);
    if (held) throw rejectedError(held);
    if (acceptedIds.has(id) || outbox.pending.some(item => item.id === id) || volatile.some(item => item.id === id)) return id;
    if (outbox.pending.length + outbox.rejected.length + volatile.length >= MAX_PENDING) throw failure('本机暂存经历已满，请先恢复同步或导出暂存记录。', 'LIFE_OUTBOX_LIMIT');
    const event = copyEvent(rawEvent);
    try { persist({ ...outbox, pending: [...outbox.pending, ...volatile, event] }, []); }
    catch (error) {
      // The audio observer cannot retain an unsaved delta. Keep it for this
      // session, without advertising that this in-memory copy is durable.
      volatile = [...volatile, event];
      refresh();
      scheduleRetry();
      throw failure(error.message, error.code, { queued: false, unsaved: true });
    }
    return id;
  }
  async function send(id) {
    let error;
    do {
      try { await flush(); } catch (cause) { error = cause; }
      if (acceptedIds.has(id)) return;
      const held = outbox.rejected.find(item => item.event.id === id);
      if (held) throw rejectedError(held);
      if (error) break;
    } while (outbox.pending.some(item => item.id === id) || volatile.some(item => item.id === id));
    if (error) throw failure(error.message, error.code, {
      status: error.status, queued: outbox.pending.some(item => item.id === id), unsaved: volatile.some(item => item.id === id),
    });
  }
  function submit(event) {
    try { return send(enqueue(event)); }
    catch (error) { syncError = error.message; refresh(); return Promise.reject(error); }
  }
  const online = () => { void flush().catch(() => {}); };
  eventTarget.addEventListener?.('online', online);
  return {
    source, load, submit, motion, motionMemory, develop, refreshDevelopment,
    async dispatch(type, payload = {}) {
      const event = { ...payload, type, id: eventId(type), at: Date.now() };
      await submit(event);
      return event;
    },
    retry: async () => { recoverLocal(); await load(); void refreshCapabilities(true); return flush(); },
    async retryRejected(id) {
      recoverLocal();
      const target = id === undefined ? null : canonicalId(id);
      const held = outbox.rejected.filter(item => target === null || item.event.id === target);
      if (!held.length) return flush();
      const ids = new Set(held.map(item => item.event.id));
      persist({ pending: [...outbox.pending, ...held.map(item => item.event)], rejected: outbox.rejected.filter(item => !ids.has(item.event.id)) });
      await flush();
      const failed = outbox.rejected.find(item => ids.has(item.event.id));
      if (failed) throw rejectedError(failed);
    },
    setAudio: (audioStatus, features = null) => set({ audioStatus, features }),
    exportArchive: async () => (await request('/export')).data,
    exportOutbox: () => JSON.parse(JSON.stringify({
      format: 'echo-life-outbox', version: OUTBOX_VERSION, exportedAt: Date.now(),
      pending: outbox.pending, rejected: outbox.rejected, volatile,
      ...(readError ? { rawStorage, readError } : {}), ...(storageError ? { storageError } : {}),
    })),
    dispose() {
      if (disposed) return;
      disposed = true;
      savedMotion = null;
      motion.dispose();
      clearRetry();
      for (const request of requests) request.cancel(closed());
      listeners.clear();
      eventTarget.removeEventListener?.('online', online);
    },
  };
}
