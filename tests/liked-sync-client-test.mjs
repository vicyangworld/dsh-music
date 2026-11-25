#!/usr/bin/env node
/**
 * 喜欢列表导入（客户端）测试：QR 编码器金标 + createLikedSyncService 状态机。
 *
 * 直接加载真实的 bundle/client/index.js（vm 沙箱 + 最小 React mock），
 * 通过 apply(ctx) 拿到注入的 likedSync 服务，不复制任何实现。
 *
 * 运行：node tests/liked-sync-client-test.mjs   （exit 0 = 全部通过）
 */
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../bundle/client/index.js', import.meta.url), 'utf8');
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (err) { console.log('  ✗ ' + name + '\n    ' + (err && err.stack || err)); process.exitCode = 1; }
}

/* ---------- 1. QR 编码器金标（模块矩阵 sha256 前 16 位，由 zxing-cpp + OpenCV 独立解码验证过的实现生成） ---------- */
console.log('QR encoder');
{
  const a = src.indexOf('/* QR-BEGIN');
  const b = src.indexOf('/* QR-END */') + '/* QR-END */'.length;
  assert.ok(a > 0 && b > a, 'QR block markers present');
  const block = src.slice(a, b);
  const sandbox = { TextEncoder, console };
  vm.createContext(sandbox);
  vm.runInContext(block + '\nthis.qrEncode = qrEncode;', sandbox);
  const qr = sandbox.qrEncode;
  const fp = (text) => {
    const r = qr(text);
    if (!r) return null;
    return { version: r.version, size: r.size, mask: r.mask, hash: crypto.createHash('sha256').update(r.modules).digest('hex').slice(0, 16) };
  };
  const golden = [
    ['HELLO', { version: 1, size: 21, mask: 4, hash: 'b7e69d6fb795bcda' }],
    ['https://music.163.com/login?codekey=8126df9b-1e4c-4a7b-9f3a-2b6c8d5e7f90', { version: 5, size: 37, mask: 2, hash: '408962ae26427e5c' }],
    ['A'.repeat(120), { version: 7, size: 45, mask: 3, hash: 'b53eaf32027bf553' }],
    ['网易云音乐扫码登录 https://music.163.com/login?codekey=abc', { version: 5, size: 37, mask: 1, hash: '653f37d189a0f3f9' }],
    ['x'.repeat(213), { version: 10, size: 57, mask: 0, hash: 'b27c5d8141e70c48' }],
  ];
  for (const [text, want] of golden) {
    await test('golden v' + want.version + ' mask ' + want.mask + ' (' + text.length + ' chars)', () => {
      assert.equal(JSON.stringify(fp(text)), JSON.stringify(want));
    });
  }
  await test('超过 v10-M 容量（214 字节）返回 null 而不是报错', () => { assert.equal(qr('x'.repeat(214)), null); });
  await test('矩阵包含三个定位图形 + 定时图形', () => {
    const r = qr('HELLO');
    const n = r.size;
    const at = (x, y) => r.modules[y * n + x];
    /* 左上定位图形 7×7 外框为暗、内白环为亮、中心 3×3 为暗 */
    assert.equal(at(0, 0), 1); assert.equal(at(6, 0), 1); assert.equal(at(0, 6), 1); assert.equal(at(6, 6), 1);
    assert.equal(at(1, 1), 0); assert.equal(at(5, 5), 0);
    assert.equal(at(2, 2), 1); assert.equal(at(3, 3), 1); assert.equal(at(4, 4), 1);
    /* 右上 / 左下 */
    assert.equal(at(n - 1, 0), 1); assert.equal(at(n - 7, 6), 1);
    assert.equal(at(0, n - 1), 1); assert.equal(at(6, n - 7), 1);
    /* 定时图形：第 6 行/列交替 */
    for (let i = 8; i < n - 8; i++) { assert.equal(at(i, 6), i % 2 === 0 ? 1 : 0); assert.equal(at(6, i), i % 2 === 0 ? 1 : 0); }
    /* 暗模块 */
    assert.equal(at(8, n - 8), 1);
    /* 模块数与尺寸一致 */
    assert.equal(r.modules.length, n * n);
  });
  await test('确定性：同一输入两次编码结果一致', () => {
    assert.deepEqual(fp('https://music.163.com/login?codekey=abc'), fp('https://music.163.com/login?codekey=abc'));
  });
}

/* ---------- 2. createLikedSyncService 状态机（通过真实 apply(ctx)） ---------- */
console.log('liked-sync service');
const noop = () => {};
const React = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}) }, children: children.flat(Infinity) }),
  useState: (init) => [typeof init === 'function' ? init() : init, noop],
  useEffect: noop, useMemo: (fn) => fn(), useRef: (init) => ({ current: init ?? null }), useCallback: (fn) => fn,
};
let captured = null;
const windowMock = { __ModuleLoader__: { load: (def) => { captured = def; } }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, addEventListener: noop, removeEventListener: noop, innerWidth: 1440, innerHeight: 900 };
const calls = [];
let replies = {};
const fetchMock = async (url, init = {}) => {
  calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  const key = Object.keys(replies).find((k) => url.includes(k));
  const body = key ? replies[key] : { imageUrl: null, thumbnailUrl: null };
  if (body instanceof Error) throw body;
  if (body && body.__http) return { ok: false, status: body.__http.status, json: async () => ({ error: body.__http.error }) };
  return { ok: true, status: 200, json: async () => body };
};
const sandbox = { window: windowMock, localStorage: windowMock.localStorage, console, setTimeout, clearTimeout, fetch: fetchMock, TextEncoder,
  document: { createElement: () => ({ setAttribute: noop, textContent: '', remove: noop }), head: { appendChild: noop }, addEventListener: noop, removeEventListener: noop } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'client/index.js' });
const mod = captured.factory((id) => { if (id === 'react') return React; throw new Error('unexpected require ' + id); });
const services = {};
mod.apply({ effect: (fn) => { const r = fn(); return typeof r === 'function' ? r : noop; }, locale: { register: noop, bind: () => (k) => k }, layout: { selectPanel: noop },
  slots: { inject: (name, fn) => fn(), register: (def) => { if (def.inject) services[def.key || def.id || def.name] = def.inject(); return { dispose: noop }; } } });
const svc = services.music.likedSync;
const snap = () => svc.source.getSnapshot();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const statusBody = (netease, qq) => ({ enabled: true, providers: { netease, qq } });
const off = { label: '网易云音乐', connected: false, account: null, busy: false, lastSyncAt: null, lastResult: null, knownCount: 0 };

await test('服务已注入，初始态关闭且未轮询', () => {
  assert.equal(typeof svc.open, 'function');
  assert.equal(snap().open, false);
  assert.equal(snap().qrPhase, 'idle');
});

await test('open() 拉取状态并自动生成二维码，之后 801 轮询 → 802 已确认 → 803 登录成功', async () => {
  replies = {
    '/liked-sync/status': statusBody(off, off),
    '/liked-sync/netease/qr': { key: 'k1', url: 'https://music.163.com/login?codekey=8126df9b-1e4c-4a7b-9f3a-2b6c8d5e7f90' },
  };
  /* 轮询按顺序返回 801 / 802 / 803，每次轮询用手动闸门放行，断言中间相位 */
  const gates = [Promise.withResolvers(), Promise.withResolvers(), Promise.withResolvers()];
  const polls = [];
  const origFetch = sandbox.fetch;
  sandbox.fetch = async (url, init) => {
    if (url.includes('/qr/poll')) {
      const i = polls.length;
      polls.push(url);
      await gates[i].promise;
      const code = i === 0 ? 801 : i === 1 ? 802 : 803;
      if (code === 803) replies['/liked-sync/status'] = statusBody({ ...off, connected: true, account: { uid: 7, nickname: '小云', loginAt: 1 }, knownCount: 12, lastSyncAt: 5 }, off);
      return { ok: true, json: async () => (code === 803 ? { code, message: '授权登录成功', account: { uid: 7, nickname: '小云', loginAt: 1 } } : { code, message: code === 801 ? '等待扫码' : '待确认' }) };
    }
    return origFetch(url, init);
  };
  /* 轮询间隔 2000ms：用即时定时器，只验证状态机不验证间隔 */
  const realSetTimeout = sandbox.setTimeout;
  sandbox.setTimeout = (fn) => { realSetTimeout(fn, 0); return 1; };
  svc.open('netease');
  assert.equal(snap().open, true);
  assert.equal(snap().tab, 'netease');
  await tick(20);
  assert.equal(snap().qrPhase, 'waiting');
  assert.ok(snap().qr && snap().qr.key === 'k1' && snap().qr.matrix && snap().qr.matrix.size === 37, '二维码已本地编码（72 字节 → v5 37×37）');
  const created = calls.find((c) => c.url.includes('/liked-sync/netease/qr'));
  assert.ok(created && created.method === 'POST' && created.body === null, 'POST /netease/qr 无请求体');
  assert.equal(polls.length, 1, '二维码就绪后立即发起第一次轮询');
  gates[0].resolve(); await tick(20);
  assert.equal(snap().qrPhase, 'waiting', '801 → 继续等待');
  assert.equal(polls.length, 2, '2000ms 定时器触发第二次轮询');
  gates[1].resolve(); await tick(20);
  assert.equal(snap().qrPhase, 'confirmed', '802 → 已扫码待确认');
  /* 803 之后服务会自动导入一次（新用户不用再点「导入」） */
  replies['/liked-sync/netease/sync'] = { provider: 'netease', at: 2, durationMs: 4, total: 12, unavailable: 0, playlistName: '喜欢的音乐', added: 10, existed: 2, skippedDisliked: 0, removed: 0, removedItems: [] };
  gates[2].resolve(); await tick(40);
  assert.equal(snap().qrPhase, 'done', '803 → 登录成功');
  assert.equal(snap().result && snap().result.provider, 'netease', '803 → 自动导入');
  assert.equal(snap().result && snap().result.added, 10);
  assert.equal(snap().syncing, null);
  assert.ok(calls.some((c) => c.url.includes('/liked-sync/netease/sync') && c.method === 'POST'), '自动导入走了 sync 路由');
  assert.equal(snap().providers.netease.connected, true);
  assert.equal(snap().providers.netease.account.nickname, '小云');
  assert.ok(polls.every((u) => u.includes('key=k1')));
  assert.equal(polls.length, 3, '登录成功后停止轮询');
  sandbox.setTimeout = realSetTimeout;
  sandbox.fetch = origFetch;
});

await test('主机 404（会话过期）→ qrPhase expired，不再轮询', async () => {
  replies = { '/liked-sync/status': statusBody(off, off), '/liked-sync/netease/qr': { key: 'k2', url: 'https://music.163.com/login?codekey=zzz' } };
  await svc.load();
  assert.equal(snap().providers.netease.connected, false);
  const origFetch = sandbox.fetch;
  let polls = 0;
  sandbox.fetch = async (url, init) => {
    if (url.includes('/qr/poll')) { polls++; return { ok: false, status: 404, json: async () => ({ error: '二维码会话已过期，请重新生成' }) }; }
    return origFetch(url, init);
  };
  svc.open('netease');
  await tick(30);
  assert.equal(snap().qrPhase, 'expired');
  assert.match(snap().qrMessage, /过期/);
  await tick(30);
  assert.equal(polls, 1);
  sandbox.fetch = origFetch;
});

await test('close() 停止轮询并关闭', async () => {
  svc.close();
  assert.equal(snap().open, false);
});

await test('QQ 扫码：open("qq") 取主机矩阵 → 801 等待 → 803 登录 → 自动导入；切到 Cookie 模式不再取码，切回扫码重新取码', async () => {
  replies = {
    '/liked-sync/status': statusBody(off, off),
    '/liked-sync/qq/qr': { key: 'qk1', matrix: { size: 21, modules: Array(441).fill(0) }, png: 'data:image/png;base64,AAAA' },
    '/liked-sync/qq/sync': { provider: 'qq', at: 1, durationMs: 3, total: 10, unavailable: 0, playlistName: '我喜欢', added: 3, existed: 7, skippedDisliked: 0, removed: 0, removedItems: [] },
  };
  const gates = [Promise.withResolvers(), Promise.withResolvers()];
  const origFetch = sandbox.fetch;
  const realSetTimeout = sandbox.setTimeout;
  sandbox.setTimeout = (fn) => { realSetTimeout(fn, 0); return 1; };
  sandbox.fetch = async (url, init) => {
    if (url.includes('/qq/qr/poll')) {
      const i = gates.indexOf(gates.find((g) => !g.done));
      const gate = gates.find((g) => !g.done);
      gate.done = true;
      await gate.promise;
      if (gate.code === 803) replies['/liked-sync/status'] = statusBody(off, { ...off, connected: true, account: { uid: '123', nickname: '小Q', loginAt: 9 }, knownCount: 3 });
      return { ok: true, json: async () => (gate.code === 803 ? { code: 803, message: '登录成功', account: { uid: '123', nickname: '小Q' } } : { code: gate.code, message: '二维码未失效' }) };
    }
    return origFetch(url, init);
  };
  const qrCalls = () => calls.filter((c) => c.url.includes('/liked-sync/qq/qr') && c.method === 'POST').length;
  const before = qrCalls();
  svc.open('qq');
  await tick(20);
  assert.equal(snap().tab, 'qq');
  assert.equal(snap().qqMode, 'qr');
  assert.equal(qrCalls(), before + 1, 'QQ 页签默认扫码 → POST /qq/qr');
  assert.equal(snap().qr.provider, 'qq');
  assert.equal(snap().qr.matrix.size, 21);
  assert.equal(snap().qr.matrix.modules.length, 441);
  assert.equal(snap().qr.png, 'data:image/png;base64,AAAA');
  assert.equal(snap().qrPhase, 'waiting');
  gates[0].code = 801; gates[0].resolve();
  await tick(20);
  assert.equal(snap().qrPhase, 'waiting', '801 继续等');
  gates[1].code = 803; gates[1].resolve();
  await tick(40);
  assert.equal(snap().qrPhase, 'done');
  assert.ok(calls.some((c) => c.url.includes('/liked-sync/qq/sync') && c.method === 'POST'), '803 → 自动导入');
  assert.equal(snap().result.provider, 'qq');
  assert.equal(snap().result.added, 3);
  assert.equal(snap().providers.qq.connected, true);
  const taken = qrCalls();
  svc.setQqMode('cookie');
  assert.equal(snap().qqMode, 'cookie');
  assert.equal(snap().qr, null);
  assert.equal(snap().qrPhase, 'idle');
  svc.selectTab('qq');
  await tick(10);
  assert.equal(qrCalls(), taken, 'Cookie 模式不取码');
  svc.setQqMode('qr');
  await tick(20);
  assert.equal(qrCalls(), taken + 1, '切回扫码 → 重新取码');
  assert.equal(snap().qr.provider, 'qq');
  svc.close();
  sandbox.fetch = origFetch;
  sandbox.setTimeout = realSetTimeout;
});

await test('QQ：空 Cookie → importCookieEmpty；连接成功 → notice + 状态刷新 + 清空输入', async () => {
  replies = { '/liked-sync/status': statusBody(off, { ...off, connected: false }), '/liked-sync/qq/connect': { __http: { status: 401, error: 'QQ 音乐 Cookie 已失效或未登录，请重新登录 y.qq.com 后复制 Cookie' } } };
  svc.setQqMode('cookie');
  svc.open('qq');
  await tick(10);
  assert.equal(snap().tab, 'qq');
  assert.equal(snap().qqMode, 'cookie');
  assert.equal(snap().qrPhase, 'idle', 'Cookie 模式下 QQ 页签不生成二维码');
  await svc.connectQq();
  assert.equal(snap().error, 'importCookieEmpty');
  svc.setQqCookie('  qm_keyst=abc; uin=123  ');
  assert.equal(snap().qqCookie, '  qm_keyst=abc; uin=123  ');
  await svc.connectQq();
  assert.equal(snap().connecting, false);
  assert.match(snap().error, /已失效/);
  replies['/liked-sync/qq/connect'] = { account: { uid: '123', nickname: '小Q', loginAt: 9 }, likedDir: { tid: 1, name: '我喜欢', songCount: 3 } };
  replies['/liked-sync/qq/sync'] = { provider: 'qq', at: 1, durationMs: 3, total: 10, unavailable: 0, playlistName: '我喜欢', added: 3, existed: 7, skippedDisliked: 0, removed: 0, removedItems: [] };
  replies['/liked-sync/status'] = statusBody(off, { ...off, connected: true, account: { uid: '123', nickname: '小Q', loginAt: 9 }, knownCount: 3 });
  await svc.connectQq();
  const c = calls.filter((x) => x.url.includes('/qq/connect')).pop();
  assert.equal(c.method, 'POST');
  assert.equal(JSON.stringify(c.body), JSON.stringify({ cookie: 'qm_keyst=abc; uin=123' }));
  assert.equal(snap().qqCookie, '', '连接成功后清空输入');
  assert.equal(snap().providers.qq.connected, true);
  assert.equal(snap().connecting, false);
  assert.equal(snap().error, null);
  assert.ok(calls.some((x) => x.url.includes('/qq/sync') && x.method === 'POST'), '连接成功 → 自动导入');
  assert.equal(snap().result && snap().result.provider, 'qq', '自动导入的结果');
  assert.equal(snap().result && snap().result.added, 3);
});

await test('sync(qq) → 结果带 provider，通知 onChange 刷新 ♥ 列表，再拉取状态', async () => {
  /* onChange 在 apply 内绑定到 likesService.load；这里通过 fetch 计数验证其触发了 /library/likes */
  replies['/liked-sync/qq/sync'] = { provider: 'qq', at: 1, durationMs: 3, total: 10, unavailable: 0, playlistName: '我喜欢', added: 4, existed: 6, skippedDisliked: 0, removed: 0, removedItems: [] };
  const likesBefore = calls.filter((c) => c.url.includes('/library/likes')).length;
  await svc.sync('qq');
  assert.equal(snap().syncing, null);
  assert.equal(snap().result.provider, 'qq');
  assert.equal(snap().result.added, 4);
  assert.ok(calls.filter((c) => c.url.includes('/library/likes')).length > likesBefore, 'onChange → likes.load()');
  assert.ok(calls.some((c) => c.url.includes('/liked-sync/qq/sync') && c.method === 'POST'));
});

await test('sync 期间 syncing 置位且并发调用被忽略', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const origFetch = sandbox.fetch;
  sandbox.fetch = async (url, init) => {
    if (url.includes('/qq/sync')) { calls.push({ url, method: init && init.method }); await gate; return { ok: true, json: async () => ({ provider: 'qq', total: 1 }) }; }
    return origFetch(url, init);
  };
  const before = calls.filter((c) => c.url.includes('/qq/sync')).length;
  const p1 = svc.sync('qq');
  assert.equal(snap().syncing, 'qq');
  const p2 = svc.sync('qq'); /* 应被忽略 */
  release();
  await Promise.all([p1, p2]);
  assert.equal(calls.filter((c) => c.url.includes('/qq/sync')).length - before, 1);
  sandbox.fetch = origFetch;
});

await test('sync 失败 → error 保留主机文案，syncing 复位', async () => {
  replies['/liked-sync/qq/sync'] = { __http: { status: 401, error: '请先登录QQ 音乐' } };
  await svc.sync('qq');
  assert.equal(snap().syncing, null);
  assert.equal(snap().error, '请先登录QQ 音乐');
});

await test('disconnect(qq) → POST disconnect → 状态刷新；网易云断开后重新生成二维码', async () => {
  replies['/liked-sync/qq/disconnect'] = { ok: true, provider: 'qq' };
  replies['/liked-sync/status'] = statusBody(off, off);
  await svc.disconnect('qq');
  assert.ok(calls.some((c) => c.url.includes('/liked-sync/qq/disconnect') && c.method === 'POST'));
  assert.equal(snap().providers.qq.connected, false);
  replies['/liked-sync/netease/qr'] = { key: 'k9', url: 'https://music.163.com/login?codekey=k9' };
  svc.selectTab('netease');
  await tick(10);
  assert.equal(snap().tab, 'netease');
  assert.ok(snap().qr && snap().qr.key === 'k9', '切到网易云且未连接 → 自动生成二维码');
  await svc.disconnect('netease');
  await tick(10);
  assert.ok(snap().qr, '断开后重新生成二维码');
});

await test('主机关闭导入（enabled:false）→ 服务报告 enabled=false', async () => {
  replies['/liked-sync/status'] = { enabled: false, providers: {} };
  await svc.load();
  assert.equal(snap().enabled, false);
  assert.equal(Object.keys(snap().providers).length, 0);
});

await test('QQ 新手工具：无剪贴板环境 copyCookieCommand 返回 false 不抛错；openUrl 无 window 也不抛错', async () => {
  assert.equal(await svc.copyCookieCommand(), false);
  assert.equal(snap().copied, false);
  svc.openUrl('https://y.qq.com/');
});

/* 轮询定时器会让进程挂着：显式 dispose 再退出 */
svc.dispose();
const total = 20;
console.log(passed === total ? '\n全部通过（' + passed + ' 项）' : '\n通过 ' + passed + '/' + total + ' 项');
setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
