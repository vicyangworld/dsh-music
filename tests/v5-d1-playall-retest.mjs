#!/usr/bin/env node
/**
 * 五期 D1 复测：直接执行 `bundle/client/index.js` 里真实的 `playTracks` 源码，
 * 用桩替代 React store / 播放器 / Host 上报，验证「播放全部」是否跟随播放模式。
 *
 * 为什么要这样测：GUI 点击本轮受窗口焦点/模态框干扰无法稳定驱动，
 * 但 D1 的修复就是 `playTracks` 一个纯逻辑分支，抽出来执行可以给出可复现证据。
 *
 * 用法：node tests/v5-d1-playall-retest.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, '..', 'bundle', 'client', 'index.js'), 'utf8');

/* ---------- 从源码里截出 playTracks 函数体（大括号配平） ---------- */
const start = SRC.indexOf('function playTracks(');
if (start < 0) throw new Error('未找到 playTracks 定义');
let depth = 0, end = -1, seen = false;
for (let i = start; i < SRC.length; i++) {
  const c = SRC[i];
  if (c === '{') { depth++; seen = true; }
  else if (c === '}') { depth--; if (seen && depth === 0) { end = i + 1; break; } }
}
const fnSrc = SRC.slice(start, end);
console.log('--- 被测源码（首 8 行）---');
console.log(fnSrc.split('\n').slice(0, 8).join('\n'));
console.log('…');

/* ---------- 桩：store / player / host ---------- */
function makePlayTracks(shuffle) {
  const state = { queue: null, queueIndex: null, shuffle: null, loaded: null, hosted: null };
  const snap = () => ({ track: null, shuffle, repeat: 'off' });
  const report = () => {};
  const set = (patch) => Object.assign(state, patch);
  const loadTrack = (tr) => { state.loaded = tr; };
  const syncHost = (extra) => { state.hosted = extra; };
  const writePrefs = (patch) => { state.prefs = patch; };

  // eslint-disable-next-line no-new-func
  const playTracks = new Function('snap', 'report', 'set', 'loadTrack', 'syncHost', 'writePrefs',
    `${fnSrc}; return playTracks;`)(snap, report, set, loadTrack, syncHost, writePrefs);
  return { playTracks, state };
}

const tracks = Array.from({ length: 30 }, (_, i) => ({ id: 't' + i, audioUrl: '/a' + i, title: 'T' + i }));
const ids = tracks.map((t) => t.id);

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`PASS ${label}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`); }
};

/* ---------- 1. 随机模式：队列打乱 + 起播随机 ---------- */
const shuffledOrderRuns = [];
const startIndexes = [];
for (let run = 0; run < 3; run++) {
  const { playTracks, state } = makePlayTracks(true);
  playTracks(tracks, 0); // 工具栏「播放全部」的真实调用：playAll(list) → playTracks(list, 0)
  const queueIds = state.queue.map((t) => t.id);
  shuffledOrderRuns.push(queueIds.join(',') !== ids.join(','));
  startIndexes.push(state.queueIndex);
  check(state.shuffle === true, `run${run + 1} 队列模式保持 shuffle`, `shuffle=${state.shuffle}`);
  check(queueIds.length === tracks.length && new Set(queueIds).size === tracks.length,
    `run${run + 1} 打乱后仍是完整队列（无丢曲/无重复）`, `len=${queueIds.length}`);
}
check(shuffledOrderRuns.every(Boolean), '随机模式：队列顺序 ≠ 曲库顺序（3/3 次都打乱）', shuffledOrderRuns.join(' / '));
check(new Set(startIndexes).size > 1 || startIndexes.some((i) => i !== 0),
  '随机模式：起播索引不固定为 0', `indexes=${startIndexes.join(',')}`);
check(!shuffledOrderRuns.includes(false), '随机模式：不存在未打乱的情况', '');

/* ---------- 2. 顺序模式：队列=原顺序 + 从第 0 首起播 ---------- */
{
  const { playTracks, state } = makePlayTracks(false);
  playTracks(tracks, 0);
  const queueIds = state.queue.map((t) => t.id);
  check(queueIds.join(',') === ids.join(','), '顺序模式：队列顺序 = 曲库顺序', '');
  check(state.queueIndex === 0, '顺序模式：从第 1 首起播', `index=${state.queueIndex}`);
  check(state.shuffle === false, '顺序模式：shuffle=false', '');
}

/* ---------- 3. 显式 opts 覆盖（播放单曲时不该打乱） ---------- */
{
  const { playTracks, state } = makePlayTracks(true); // 全局是随机
  playTracks([tracks[5]], 0, { shuffle: false });     // 但显式关闭（例如点单行播放传 false）
  check(state.queue.length === tracks.length - 29, '显式 opts.shuffle=false 覆盖全局随机', `len=${state.queue.length}`);
}

/* ---------- 4. Host 上报的队列与本地一致 ---------- */
{
  const { playTracks, state } = makePlayTracks(true);
  playTracks(tracks, 0);
  const localIds = state.queue.map((t) => t.id).join(',');
  check(state.hosted && state.hosted.queue.join(',') === localIds,
    'Host 上报的 queue 与本地打乱后队列一致', '');
  check(state.hosted.trackId === state.queue[state.queueIndex].id,
    'Host 上报的 trackId = 实际起播曲目', '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
