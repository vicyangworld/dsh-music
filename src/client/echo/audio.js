import { eventId } from './service.js';

const clamp = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

// Only count elapsed, audible playback. Seeking and suspended/background gaps
// do not become listening time. Media distance is normalized by playback rate.
export function playbackDelta(previous, current) {
  const audible = frame => frame && frame.playing && !frame.seeking && !frame.muted
    && Number.isFinite(frame.volume) && frame.volume > 0 && Number.isFinite(frame.readyState) && frame.readyState >= 2
    && Number.isFinite(frame.clock) && Number.isFinite(frame.position)
    && Number.isFinite(frame.rate) && frame.rate > 0;
  if (!audible(previous) || !audible(current) || previous.rate !== current.rate || previous.trackId !== current.trackId) return 0;
  const wall = current.clock - previous.clock;
  const media = (current.position - previous.position) * 1000 / current.rate;
  if (wall <= 0 || wall > 3000 || media < 0 || media > wall + Math.max(50, wall * 0.35)) return 0;
  return Math.round(Math.max(0, Math.min(wall, media)));
}

export function summarizeSpectrum(frequencies, waveform, prior = null) {
  if (prior?.length !== frequencies.length) prior = null;
  let power = 0, total = 0, weighted = 0, flux = 0, logSum = 0;
  for (let i = 0; i < waveform.length; i++) { const value = (waveform[i] - 128) / 128; power += value * value; }
  for (let i = 1; i < frequencies.length; i++) {
    const value = frequencies[i] / 255;
    total += value;
    weighted += value * i / frequencies.length;
    logSum += Math.log(Math.max(value, 0.001));
    if (prior) flux += Math.max(0, value - prior[i] / 255);
  }
  const bins = Math.max(1, frequencies.length - 1);
  const rms = Math.sqrt(power / Math.max(1, waveform.length));
  const flatness = total > 0 ? Math.exp(logSum / bins) / Math.max(total / bins, 0.001) : 0;
  return {
    energy: clamp(rms * 3.5),
    brightness: clamp(total > 0 ? weighted / total * 2.5 : 0),
    rhythm: clamp(prior ? flux / bins * 16 : 0),
    texture: clamp(flatness),
  };
}

export function createPlaybackObserver({ audio, submit, onStatus = () => {}, now = () => performance.now() }) {
  if (!audio) return { activate: async () => false, setTrack() {}, flush() {}, dispose() {} };
  let track = null, session = null, sequence = 0, previous = null;
  let segments = [], listenedMs = 0;
  let context = null, analyser = null, mediaSource = null, activation = null;
  let playbackConnected = false;
  let frequencies = null, waveform = null, previousSpectrum = null;
  let disposed = false;
  const cleanups = [];
  const keys = ['energy', 'brightness', 'rhythm', 'texture'];
  const status = (...args) => { if (!disposed) { try { onStatus(...args); } catch { /* UI observers cannot interrupt audio. */ } } };
  const safeText = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160).trim();
  function snapshot(terminal = false) {
    const routeRunning = !mediaSource || context?.state === 'running';
    return {
      clock: now(), position: audio.currentTime,
      playing: routeRunning && (terminal ? !!previous?.playing : !audio.paused && !audio.ended),
      muted: !!audio.muted, volume: audio.volume, readyState: audio.readyState,
      seeking: !!audio.seeking, rate: audio.playbackRate, trackId: track?.id,
    };
  }
  function resetBaseline() { previous = track ? snapshot() : null; previousSpectrum = null; }
  function flushPending() {
    if (!track || !session || !listenedMs) return;
    const pending = segments;
    segments = []; listenedMs = 0;
    for (const segment of pending) {
      let remaining = segment.ms;
      while (remaining > 0) {
        const duration = Math.min(60000, remaining);
        const event = {
          id: `${session}-${sequence++}`, type: 'listening', at: Date.now(), sessionId: session,
          track: { id: track.id, title: safeText(track.title) || '未命名曲目', artist: safeText(track.artist) },
          listenedMs: duration, featureSource: segment.source,
          ...(segment.source === 'audio' ? { features: Object.fromEntries(keys.map(key => [key, clamp(segment.sums[key] / segment.ms)])) } : {}),
        };
        // Enqueue synchronously so pagehide gets a durable outbox write. Both a
        // throwing enqueue and a rejected send must leave music unaffected.
        try { Promise.resolve(submit(event)).catch(() => {}); } catch { /* Outbox owns user-visible failure reporting. */ }
        remaining -= duration;
      }
    }
  }
  function disableAnalysis() {
    if (analyser) {
      try { mediaSource?.disconnect(analyser); } catch { /* Direct playback stays connected. */ }
      try { analyser.disconnect(); } catch { /* Optional branch cleanup. */ }
    }
    analyser = null; frequencies = null; waveform = null; previousSpectrum = null;
    status('time-only');
  }
  function sample(terminal = false) {
    if (disposed || !track) return;
    const current = snapshot(terminal);
    // Native media looping may not fire ended. A wrap starts a fresh observed
    // session; the unobserved wrap interval itself is deliberately not inferred.
    if (audio.loop && previous && current.playing && !current.seeking && current.position < previous.position) {
      flushPending(); session = eventId('listen'); sequence = 0;
    }
    const delta = playbackDelta(previous, current);
    previous = current;
    if (!delta) { previousSpectrum = null; return; }
    listenedMs += delta;
    let features = null;
    if (analyser && context?.state === 'running') {
      try {
        analyser.getByteFrequencyData(frequencies);
        analyser.getByteTimeDomainData(waveform);
        features = summarizeSpectrum(frequencies, waveform, previousSpectrum);
        previousSpectrum = frequencies.slice();
        if (Math.floor(current.clock / 2000) !== Math.floor((current.clock - delta) / 2000)) status('audio', features);
      } catch { disableAnalysis(); }
    }
    const source = features ? 'audio' : 'none';
    let segment = segments.at(-1);
    if (!segment || segment.source !== source) {
      segment = { source, ms: 0, sums: Object.fromEntries(keys.map(key => [key, 0])) };
      segments.push(segment);
    }
    segment.ms += delta;
    if (features) for (const key of keys) segment.sums[key] += features[key] * delta;
    // Feature coverage is segmented; 500ms of FFT cannot stand for 30s of audio.
    if (listenedMs >= 30000) flushPending();
  }
  function flush() { if (!disposed) { sample(); flushPending(); } }
  async function closeContext(target) {
    if (target && target.state !== 'closed') { try { await target.close(); } catch { /* Already closing or unavailable. */ } }
  }
  async function activate() {
    if (disposed) return false;
    if (activation) return activation;
    activation = (async () => {
      try {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) { status('time-only'); return false; }
        sample();
        context ||= new AudioContextClass();
        const activeContext = context;
        if (activeContext.state !== 'running') await activeContext.resume();
        if (disposed) { await closeContext(activeContext); return false; }
        // Never reroute the element into a suspended context: music must remain audible.
        if (activeContext.state !== 'running') { status('time-only'); return false; }
        let candidate = analyser;
        if (!candidate) {
          candidate = activeContext.createAnalyser();
          candidate.fftSize = 1024;
          candidate.smoothingTimeConstant = 0.6;
        }
        if (!mediaSource) {
          mediaSource = activeContext.createMediaElementSource(audio);
        }
        if (!playbackConnected) {
          mediaSource.connect(activeContext.destination);
          playbackConnected = true;
        }
        if (!analyser) {
          // The audible path does not pass through analysis. An AnalyserNode's
          // output can stay unconnected, so branch failures cannot mute playback.
          mediaSource.connect(candidate);
          analyser = candidate;
          frequencies = new Uint8Array(analyser.frequencyBinCount);
          waveform = new Uint8Array(analyser.fftSize);
        }
        resetBaseline();
        status('audio');
        return true;
      } catch {
        disableAnalysis();
        return false;
      }
    })().finally(() => { activation = null; });
    return activation;
  }
  const on = (name, fn) => { audio.addEventListener(name, fn); cleanups.push(() => audio.removeEventListener(name, fn)); };
  on('pause', () => { sample(true); flushPending(); previous = null; status('idle'); });
  on('ended', () => { sample(true); flushPending(); previous = null; status('idle'); });
  on('seeking', () => { previous = null; previousSpectrum = null; });
  on('seeked', resetBaseline);
  on('volumechange', resetBaseline);
  on('ratechange', resetBaseline);
  on('playing', () => { resetBaseline(); status(analyser && context?.state === 'running' ? 'audio' : 'time-only'); });
  on('emptied', () => { flushPending(); previous = null; previousSpectrum = null; });
  const timer = setInterval(sample, 250);
  const leave = () => { sample(); flushPending(); };
  globalThis.addEventListener?.('pagehide', leave);
  return {
    activate, flush,
    setTrack(value) {
      if (disposed) return;
      sample(true); flushPending(); previous = null; previousSpectrum = null;
      track = value && /^[0-9a-f]{8,}$/.test(value.id || '') ? value : null;
      session = track ? eventId('listen') : null; sequence = 0;
      segments = []; listenedMs = 0;
      if (!track) status('idle');
    },
    dispose() {
      if (disposed) return;
      sample(true); flushPending(); disposed = true; clearInterval(timer);
      for (const fn of cleanups) fn();
      globalThis.removeEventListener?.('pagehide', leave);
      // The owner pauses/disposes the audio element in the same cleanup.
      void closeContext(context);
    },
  };
}
