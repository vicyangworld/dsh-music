import { MOTION_LIMITS, MotionError, validateMotionRequest, validateMotionStatus, validateMotionSequence } from '../../../bundle/shared/motion-core.js';

async function readJson(response, maxBytes) {
  if (Number(response.headers?.get?.('content-length')) > maxBytes) throw new MotionError('运动响应过大。', 'MOTION_TOO_LARGE', 502);
  const reader = response.body?.getReader?.();
  let text = '';
  if (reader) {
    const decoder = new TextDecoder();
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new MotionError('运动响应过大。', 'MOTION_TOO_LARGE', 502);
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
  } else {
    text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) throw new MotionError('运动响应过大。', 'MOTION_TOO_LARGE', 502);
  }
  let value;
  try { value = JSON.parse(text); } catch { throw new MotionError('运动响应不是有效 JSON。', 'MOTION_PROVIDER_ERROR', 502); }
  if (!response.ok) throw new MotionError(typeof value.error === 'string' ? value.error.slice(0, 240) : '运动服务暂时不可用。', typeof value.code === 'string' ? value.code : 'MOTION_PROVIDER_ERROR', response.status);
  return value;
}

/** Shared lifetime is owned by the life service. Views cancel only their own
 * generate call using AbortSignal. No auto-retry, sample clips, or fake model. */
export function createMotionProvider({ resolveUrl, fetcher = (...args) => fetch(...args), getCurrentBody, timeoutMs = 2500 } = {}) {
  let snapshot = { status: 'unavailable', available: false, reason: '未连接学习型运动模型。', model: null };
  let disposed = false, busy = false, statusJob = null;
  const listeners = new Set(), active = new Set();
  const notify = patch => {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    for (const callback of listeners) { try { callback(); } catch { /* A view cannot interrupt model cleanup. */ } }
  };
  const url = path => resolveUrl ? resolveUrl(`/dsh-music/api/life/motion${path}`) : `/dsh-music/api/life/motion${path}`;
  async function request(path, value, signal) {
    if (disposed) throw new MotionError('运动服务已关闭。', 'MOTION_SERVICE_CLOSED', 503);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.max(100, Math.min(15000, Number.isFinite(timeoutMs) ? timeoutMs : 2500)));
    active.add(controller);
    try {
      const response = await fetcher(url(path), { method: value ? 'POST' : 'GET', headers: { Accept: 'application/json', ...(value ? { 'Content-Type': 'application/json' } : {}) }, body: value ? JSON.stringify(value) : undefined, signal: controller.signal });
      return await readJson(response, value ? MOTION_LIMITS.responseBytes : 16 * 1024);
    } catch (err) {
      if (controller.signal.aborted) throw new MotionError(signal?.aborted ? '运动请求已取消。' : '运动模型响应超时。', signal?.aborted ? 'MOTION_ABORTED' : 'MOTION_TIMEOUT', 503);
      if (err instanceof MotionError) throw err;
      throw new MotionError('运动模型暂时无法连接。', 'MOTION_PROVIDER_UNAVAILABLE', 503);
    } finally {
      clearTimeout(timer);
      active.delete(controller);
      signal?.removeEventListener('abort', abort);
    }
  }
  function refreshStatus() {
    if (statusJob) return statusJob;
    if (disposed) return Promise.resolve(snapshot);
    notify({ status: 'checking' });
    statusJob = (async () => {
      try {
        const status = validateMotionStatus(await request('', null));
        notify({ ...status, retryable: false });
      } catch (err) { notify({ status: 'unavailable', available: false, model: null, reason: err.message, retryable: err.status !== 404 }); }
      finally { statusJob = null; }
      return snapshot;
    })();
    return statusJob;
  }
  async function generate(raw, { signal } = {}) {
    if (disposed) throw new MotionError('运动服务已关闭。', 'MOTION_SERVICE_CLOSED', 503);
    if (!snapshot.available) throw new MotionError(snapshot.reason || '学习型运动模型尚未就绪。', 'MOTION_MODEL_UNAVAILABLE', 503);
    if (busy) throw new MotionError('上一段运动仍在生成。', 'MOTION_BUSY', 429);
    const input = validateMotionRequest(raw, { authoritativeBody: getCurrentBody?.() });
    if (!snapshot.supportedTopologies?.includes(input.body.topology)) throw new MotionError('模型不支持当前身体。', 'MOTION_BODY_UNSUPPORTED', 409);
    const model = snapshot.model;
    busy = true;
    notify({ status: 'generating' });
    try {
      const result = validateMotionSequence(await request('/generate', input, signal), input, { currentBody: getCurrentBody?.(), expectedModel: model });
      notify({ status: 'ready', reason: null });
      return result;
    } catch (err) {
      if (['MOTION_ABORTED', 'MOTION_BODY_STALE', 'MOTION_RESULT_STALE', 'MOTION_BUSY'].includes(err.code)) notify({ status: 'ready' });
      else notify({ status: 'unavailable', available: false, reason: err.message, model: null, retryable: err.status >= 500 });
      throw err;
    } finally { busy = false; }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const controller of active) controller.abort();
    active.clear(); listeners.clear();
    snapshot = { status: 'unavailable', available: false, reason: '运动服务已关闭。', model: null };
  }
  return { getSnapshot: () => snapshot, subscribe: fn => { if (disposed) return () => {}; listeners.add(fn); return () => listeners.delete(fn); }, refreshStatus, generate, dispose };
}
