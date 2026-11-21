/**
 * A small preview host for the actual, generated Harness client artifact.
 * Only the slot/module/locale adapter lives here. The life, music, interaction,
 * and companion UI are all rendered by bundle/client/index.js itself.
 */
import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';

const expectedModule = '@vicyangorg/dsh-music';
const dictionaries = new Map();
const entries = new Map();
const effects = [];
const listeners = new Set();
let state = { status: 'loading', activePanel: 'music', registrations: [], error: null };
let currentSlot = null;
let applied = false;
let disposed = false;
let registrationSequence = 0;

function update(patch) {
  if (disposed) return;
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener();
}

const hostStore = {
  getSnapshot: () => state,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

function lookup(dictionary, key) {
  if (dictionary && Object.prototype.hasOwnProperty.call(dictionary, key)) return dictionary[key];
  return String(key).split('.').reduce((value, part) => value && value[part], dictionary);
}

function bindLocale(namespace) {
  return (key, values = {}) => {
    const dictionariesForNamespace = dictionaries.get(namespace);
    const value = lookup(dictionariesForNamespace?.zh, key) ?? lookup(dictionariesForNamespace?.en, key) ?? String(key);
    if (typeof value === 'function') return value(values);
    if (typeof value !== 'string') return String(key);
    return value.replace(/\{([\w]+)\}/g, (token, name) => values != null && Object.prototype.hasOwnProperty.call(Object(values), name) ? String(values[name]) : token);
  };
}

function cleanupFor(result) {
  if (typeof result === 'function') return result;
  if (result && typeof result.dispose === 'function') return () => result.dispose();
  return () => {};
}

/**
 * Subscribe to the immutable whole snapshot, THEN apply the selector.
 * Passing a selector's freshly created object to useSyncExternalStore would
 * turn useUi(s => ({ ... })) into an infinite render loop.
 */
function selectorHook(source, name) {
  if (!source || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') {
    throw new Error(`无法挂载 ${name}：缺少 getSnapshot/subscribe。`);
  }
  const subscribe = (listener) => source.subscribe(listener);
  const getSnapshot = () => source.getSnapshot();
  return function useSource(selector = (snapshot) => snapshot) {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return selector(snapshot);
  };
}

const context = {
  effect(action) {
    const cleanup = cleanupFor(action());
    let called = false;
    const once = () => {
      if (called) return;
      called = true;
      cleanup();
    };
    effects.push(once);
    return once;
  },
  locale: {
    register(namespace, dictionary) {
      dictionaries.set(namespace, dictionary);
      return () => {
        if (dictionaries.get(namespace) === dictionary) dictionaries.delete(namespace);
      };
    },
    bind: bindLocale,
  },
  layout: {
    selectPanel(panel) {
      update({ activePanel: panel || 'music' });
    },
  },
  slots: {
    inject(name, action) {
      const previous = currentSlot;
      currentSlot = name;
      try { return action(); } finally { currentSlot = previous; }
    },
    register(definition, Component) {
      const slot = definition.name || currentSlot;
      const id = definition.id || definition.key || `entry-${++registrationSequence}`;
      const key = `${slot}:${id}`;
      const supplied = typeof definition.inject === 'function' ? definition.inject() : (definition.inject || {});
      const hooks = {};
      for (const [name, source] of Object.entries(supplied.hooks || {})) {
        const hookName = `use${name[0].toUpperCase()}${name.slice(1)}`;
        hooks[hookName] = selectorHook(source, `${slot}.${name}`);
      }
      const entry = {
        key, slot, id, definition, Component,
        props: { ...supplied, ...hooks, t: bindLocale(definition.locale || 'dshMusic') },
      };
      entries.set(key, entry);
      update({ registrations: [...entries.values()] });
      return {
        dispose() {
          if (entries.get(key) !== entry) return;
          entries.delete(key);
          update({ registrations: [...entries.values()] });
        },
      };
    },
  },
};

function fail(error) {
  console.error('ECHO preview host:', error);
  update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
}

window.__ModuleLoader__ = {
  load(definition) {
    if (definition?.id !== expectedModule) throw new Error(`预览收到未知模块：${definition?.id || '(未命名)'}`);
    if (applied) return;
    try {
      const plugin = definition.factory((name) => {
        if (name === 'react') return React;
        if (name === 'react-dom') return { createPortal };
        throw new Error(`独立预览未提供宿主模块：${name}`);
      });
      if (!plugin || typeof plugin.apply !== 'function') throw new Error('客户端没有导出 apply。');
      applied = true;
      plugin.apply(context);
      update({ status: 'ready' });
    } catch (error) {
      fail(error);
    }
  },
};

class SlotBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('ECHO preview slot:', this.props.name, error); }
  render() {
    if (this.state.error) return (
      <section className="preview-error" role="alert">
        <p className="preview-eyebrow">PREVIEW</p>
        <h1>这个面板未能载入</h1>
        <p>{this.state.error.message || String(this.state.error)}</p>
        <button type="button" onClick={() => window.location.reload()}>重新载入预览</button>
      </section>
    );
    return this.props.children;
  }
}

function Slot({ entry }) {
  const Component = entry.Component;
  return <SlotBoundary name={entry.key}><Component {...entry.props} /></SlotBoundary>;
}

function Workspace({ showCompanion, returnToMusic }) {
  const [note, setNote] = useState('');
  return (
    <section className="preview-workspace" aria-label="预览工作区">
      <div className="preview-workspace-heading">
        <div>
          <p className="preview-eyebrow">WORKSPACE</p>
          <h1>留一点空间，继续手边的事。</h1>
          <p>这是独立预览的工作区。切换面板后，播放与音灵仍由同一个插件继续运行。</p>
        </div>
        <button type="button" className="preview-quiet-button" onClick={showCompanion}>显示伴生</button>
      </div>
      <label className="preview-notepad">
        <span>随手记</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="在这里写几行文字，观察它安静地待在身边。" aria-label="工作区随手记" />
      </label>
      <div className="preview-workspace-footer">
        <span>这里的文字仅在当前页面停留，不会发送给音灵。</span>
        <button type="button" onClick={returnToMusic}>回到音灵 <span aria-hidden="true">↗</span></button>
      </div>
    </section>
  );
}

function PreviewApp() {
  const snapshot = useSyncExternalStore(hostStore.subscribe, hostStore.getSnapshot, hostStore.getSnapshot);
  const main = snapshot.registrations.find((entry) => entry.slot === 'main' && entry.id === snapshot.activePanel);
  const musicEntry = snapshot.registrations.find((entry) => entry.slot === 'main' && entry.id === 'music');
  const overlays = snapshot.registrations.filter((entry) => entry.slot === 'shell.overlay');
  const returnToMusic = () => context.layout.selectPanel('music');
  const showCompanion = () => musicEntry?.props.setMiniHidden?.(false);

  return (
    <div className="preview-host">
      <header className="preview-hostbar">
        <div className="preview-host-label">
          <span className="preview-host-symbol" aria-hidden="true">∿</span>
          <span>DSH <span className="preview-host-separator">/</span> <strong>独立预览</strong></span>
        </div>
        <nav aria-label="预览宿主面板" className="preview-host-tabs">
          <button type="button" data-testid="preview-music" aria-current={snapshot.activePanel === 'music' ? 'page' : undefined} onClick={returnToMusic}>音灵</button>
          <button type="button" data-testid="preview-workspace" aria-current={snapshot.activePanel === 'workspace' ? 'page' : undefined} onClick={() => context.layout.selectPanel('workspace')}>工作区</button>
        </nav>
        <span className="preview-source-note"><i aria-hidden="true" />原创合成试听<span className="preview-source-extra"> · 独立存档</span></span>
      </header>

      <main className="preview-main" aria-label="插件预览">
        {snapshot.status === 'error' ? (
          <section className="preview-error" role="alert">
            <p className="preview-eyebrow">PREVIEW</p>
            <h1>预览暂时没有载入</h1>
            <p>{snapshot.error}</p>
            <button type="button" onClick={() => window.location.reload()}>重新载入</button>
          </section>
        ) : snapshot.status === 'loading' ? (
          <div className="preview-loading" role="status"><span aria-hidden="true">∿</span><p>正在载入 ECHO…</p></div>
        ) : main ? <Slot key={main.key} entry={main} />
          : <Workspace showCompanion={showCompanion} returnToMusic={returnToMusic} />}
      </main>

      <div className="preview-overlay-slot" aria-label="常驻伴生">
        {overlays.map((entry) => <Slot key={entry.key} entry={entry} />)}
      </div>
    </div>
  );
}

const styles = document.createElement('style');
styles.setAttribute('data-echo-preview-host', '');
styles.textContent = `
  :root{color-scheme:light;--dsw-alias-label-primary:#263c35;--dsw-alias-label-secondary:#64716a;--dsw-alias-label-tertiary:#89928b;--dsw-alias-bg-base:#f5f4ee;--dsw-alias-bg-layer-1:#f5f4ee;--dsw-alias-bg-layer-2:#eaece3;--dsw-alias-bg-layer-3:#dde2d7;--dsw-alias-border-l1:#e1e3da;--dsw-alias-border-l2:#d1d7cc;--dsw-alias-brand-primary:#476858;--dsw-alias-bg-module-platform:#eff1e9;--dsw-alias-status-error:#ab564b;}
  html,body,#root{height:100%;min-height:100%;margin:0;}body{overflow:hidden;}button{cursor:pointer;}
  .preview-host{height:100vh;height:100dvh;display:flex;flex-direction:column;min-width:0;overflow:hidden;}
  .preview-hostbar{height:43px;min-height:43px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:0 23px;background:#e9ece3;border-bottom:1px solid #dce1d6;color:#69776e;font-size:11px;letter-spacing:.025em;position:relative;z-index:5;}
  .preview-host-label{display:flex;align-items:center;gap:10px;white-space:nowrap;font-size:10px;letter-spacing:.12em;}.preview-host-label strong{font-weight:500;letter-spacing:.07em;color:#43594d;}.preview-host-symbol{font-family:Georgia,serif;font-size:29px;line-height:1;color:#446552;}.preview-host-separator{margin:0 9px;opacity:.55;}
  .preview-host-tabs{display:flex;align-items:center;gap:3px;padding:3px;border:1px solid #d4dbce;border-radius:7px;background:#e0e6d9;}.preview-host-tabs button{border:0;background:transparent;border-radius:4px;padding:4px 15px;color:#6c796e;font-size:11px;line-height:1.3;}.preview-host-tabs button[aria-current="page"]{background:#f7f8f2;color:#2e4b3d;box-shadow:0 1px 3px #283f2b0d;}
  .preview-source-note{display:flex;align-items:center;white-space:nowrap;gap:6px;font-size:10px;letter-spacing:.02em;}.preview-source-note i{display:inline-block;width:4px;height:4px;border-radius:50%;background:#78927a;}.preview-source-extra{margin-left:-3px;}
  .preview-main{position:relative;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;}.preview-main>.dshm-panel{height:100%;flex:1;min-height:0;}.preview-overlay-slot{pointer-events:none;}.preview-overlay-slot>*{pointer-events:auto;}
  .preview-workspace{width:min(1040px,100%);margin:0 auto;padding:clamp(24px,6vw,80px) clamp(20px,5vw,70px);height:100%;display:flex;flex-direction:column;gap:30px;overflow:auto;}.preview-workspace-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:25px;}.preview-eyebrow{font-size:10px;font-weight:500;letter-spacing:.18em;color:#84917d;margin:0 0 17px;}.preview-workspace h1{font-size:clamp(24px,3vw,35px);letter-spacing:-.04em;font-weight:450;line-height:1.3;color:#2e4438;margin:0 0 15px;}.preview-workspace-heading p:last-child{font-size:12px;line-height:1.9;color:#7c857c;max-width:420px;margin:0;}
  .preview-quiet-button{border:1px solid #d6dcd0;border-radius:7px;padding:9px 14px;background:transparent;color:#58715e;font-size:11px;white-space:nowrap;}.preview-notepad{min-height:230px;flex:1;display:flex;flex-direction:column;border-top:1px solid #dce1d5;padding-top:20px;gap:15px;}.preview-notepad>span{color:#7d897c;font-size:11px;}.preview-notepad textarea{resize:none;flex:1;min-height:210px;width:100%;border:0;outline:0;background:transparent;font-size:15px;line-height:2;color:#3f5546;}.preview-notepad textarea::placeholder{color:#a7afa1;}.preview-workspace-footer{display:flex;justify-content:space-between;align-items:center;gap:20px;border-top:1px solid #e2e5dc;padding-top:15px;font-size:10px;color:#939d8d;}.preview-workspace-footer button{border:0;background:transparent;color:#526d59;font-size:11px;white-space:nowrap;padding:7px 0;}.preview-workspace-footer button span{padding-left:7px;}
  .preview-loading{margin:auto;text-align:center;color:#7d8d7c;}.preview-loading>span{font:64px Georgia,serif;color:#6d856c;}.preview-loading p{font-size:12px;margin-top:14px;}.preview-error{margin:auto;padding:40px;max-width:650px;color:#6f6b60;}.preview-error h1{font-size:25px;font-weight:500;color:#354d3e;}.preview-error p{font-size:13px;line-height:1.8;overflow-wrap:anywhere;}.preview-error button{margin-top:15px;padding:10px 16px;border:1px solid #d3dacd;border-radius:7px;background:#eff2e9;color:#435c49;font-size:12px;}
  .preview-hostbar button:focus-visible,.preview-workspace button:focus-visible,.preview-error button:focus-visible,.preview-notepad textarea:focus-visible{outline:2px solid #758a6c;outline-offset:3px;}
  @media(max-width:650px){.preview-hostbar{height:40px;min-height:40px;padding:0 12px;gap:10px;}.preview-host-label{gap:7px;font-size:9px;}.preview-host-separator{margin:0 5px;}.preview-host-tabs button{padding:4px 11px;font-size:10px;}.preview-source-note{font-size:9px;}.preview-source-extra{display:none;}.preview-workspace{gap:24px;}.preview-workspace-heading{gap:15px;}.preview-workspace-heading p:last-child{font-size:11px;}.preview-workspace-footer{align-items:flex-start;}.preview-workspace-footer>span{max-width:210px;line-height:1.7;}}
  @media(max-width:410px){.preview-source-note{display:none;}.preview-hostbar{justify-content:space-between;}.preview-workspace-heading{flex-direction:column;}.preview-workspace{padding:28px 22px;}.preview-workspace h1{font-size:25px;}}
`;
document.head.appendChild(styles);

// Avoid StrictMode here: apply() is deliberately one plugin activation and the
// preview must not simulate a second activation or duplicate audio ownership.
const root = createRoot(document.getElementById('root'));
root.render(<PreviewApp />);

const client = document.createElement('script');
client.src = '/client/index.js';
client.async = true;
client.onload = () => { if (!applied) fail(new Error('客户端已下载，但没有注册预期模块。请先运行 npm run build。')); };
client.onerror = () => fail(new Error('无法加载真实客户端文件。请先运行 npm run build，再启动预览。'));
document.head.appendChild(client);

window.addEventListener('pagehide', (event) => {
  if (event.persisted || disposed) return;
  disposed = true;
  for (const cleanup of [...effects].reverse()) {
    try { cleanup(); } catch (error) { console.warn('Preview cleanup:', error); }
  }
  root.unmount();
  listeners.clear();
});
