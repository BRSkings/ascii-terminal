import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const api = window.terminalApi;

/* ------------------------------------------------------------------ *
 * Background: the ASCII Life engine
 * ------------------------------------------------------------------ */

const SCENES = [
  { id: 'butterfly', label: 'Butterfly', color: '#f9a8d4' },
  { id: 'koi',        label: 'Koi',        color: '#fb923c' },
  { id: 'jellyfish',  label: 'Jellyfish',  color: '#c4b5fd' },
  { id: 'dragonfly',  label: 'Dragonfly',  color: '#67e8f9' },
  { id: 'frog',       label: 'Frog',       color: '#86efac' }
];

const DEFAULT_SCENE = 'koi';
const sceneOf = (id) => SCENES.find((s) => s.id === id) || SCENES[1];

let currentScene = 'koi';
let life = null;

try {
  if (typeof window.AsciiLife === 'function') {
    life = new window.AsciiLife(document.getElementById('bg-stage'), {
      scene: DEFAULT_SCENE,
      background: 'transparent',
      grid: false,
      cols: 130,
      fps: 30,
      maxDpr: 1.5,
      pointer: 'flee',
      trail: 0.18,
      waterScale: 1
    }).start();
  } else {
    console.error('[ascii-term] AsciiLife was not loaded');
  }
} catch (err) {
  console.error('[ascii-term] failed to start ascii-life:', err);
}

const statusScene = document.getElementById('status-scene');
const scenesNav = document.getElementById('scenes');

function buildSceneButtons() {
  SCENES.forEach((scene) => {
    const btn = document.createElement('button');
    btn.className = 'scene-btn';
    btn.dataset.scene = scene.id;
    btn.title = scene.label + ' background';
    btn.innerHTML = '<span class="scene-dot" style="background:' + scene.color + '"></span>' + scene.label;
    btn.addEventListener('click', () => setScene(scene.id));
    scenesNav.appendChild(btn);
  });
}

function setScene(id, persist = true) {
  if (!sceneOf(id)) return;
  currentScene = id;
  if (persist) {
    try { localStorage.setItem('ascii-term.scene', id); } catch (_) { /* noop */ }
  }
  if (life) {
    try { life.set({ scene: id }); } catch (err) { console.error('[ascii-term] setScene failed', err); }
  }
  Array.from(scenesNav.children).forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.scene === id);
  });
  if (statusScene) statusScene.textContent = 'Scene: ' + sceneOf(id).label;
}

buildSceneButtons();
let savedScene = DEFAULT_SCENE;
try { savedScene = localStorage.getItem('ascii-term.scene') || DEFAULT_SCENE; } catch (_) { /* noop */ }
setScene(sceneOf(savedScene).id, false);

/* ------------------------------------------------------------------ *
 * Terminals
 * ------------------------------------------------------------------ */

const terms = new Map();   // id -> { term, fit, wrapper, label, sessionBar, seen }
const pending = new Map(); // id -> string[] (data received before the terminal existed)
let activeId = null;

const sessionGlass = document.getElementById('session-glass');
const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function updateSessionGlass() {
  const entry = terms.get(activeId);
  const show = !!(entry && !entry.closed && entry.sessionBar);
  sessionGlass.classList.toggle('visible', show);
}

const terminalsEl = document.getElementById('terminals');
const tabsEl = document.getElementById('tabs');

const THEME = {
  // Transparent so the frosted glass behind the session row can show through.
  // A dim layer in CSS keeps the rest of the terminal readable.
  background: 'rgba(0, 0, 0, 0)',
  foreground: '#dbeafe',
  cursor: '#7dd3fc',
  cursorAccent: '#020617',
  selectionBackground: 'rgba(56, 189, 248, 0.32)',
  selectionForeground: '#f8fafc',
  black: '#0b1120',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#e879f9',
  cyan: '#22d3ee',
  white: '#e2e8f0',
  brightBlack: '#64748b',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#f0abfc',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff'
};

function updateTabButtons() {
  Array.from(tabsEl.querySelectorAll('.tab')).forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.id === activeId);
  });
}

function renderTab(id, label) {
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.id = id;
  tab.setAttribute('role', 'tab');

  const dot = document.createElement('span');
  dot.className = 'tab-dot';

  const name = document.createElement('span');
  name.className = 'tab-name';
  name.textContent = label;

  const close = document.createElement('span');
  close.className = 'tab-close';
  close.textContent = '\u00d7';
  close.title = 'Close tab';
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(id);
  });

  tab.appendChild(dot);
  tab.appendChild(name);
  tab.appendChild(close);
  tab.addEventListener('click', () => switchTab(id));
  tabsEl.appendChild(tab);
  updateTabButtons();
}

function switchTab(id) {
  if (!terms.has(id)) return;
  activeId = id;
  terms.forEach((entry, tid) => entry.wrapper.classList.toggle('active', tid === id));
  updateTabButtons();
  requestAnimationFrame(() => {
    const entry = terms.get(id);
    if (!entry || entry.closed) return;
    try { entry.fit.fit(); } catch (_) { /* noop */ }
    api.resize(id, entry.term.cols, entry.term.rows);
    entry.term.focus();
  });
  updateSessionGlass();
}

function fitActive() {
  const entry = terms.get(activeId);
  if (!entry || entry.closed) return;
  try { entry.fit.fit(); } catch (_) { /* noop */ }
  api.resize(activeId, entry.term.cols, entry.term.rows);
}

function createTerminal(id, label) {
  const wrapper = document.createElement('div');
  wrapper.className = 'term-wrapper';
  wrapper.dataset.id = id;

  const mount = document.createElement('div');
  wrapper.appendChild(mount);
  terminalsEl.appendChild(wrapper);

  const term = new Terminal({
    fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace',
    fontSize: 14,
    lineHeight: 1,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 6000,
    allowTransparency: true,
    theme: THEME
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(mount);

  const entry = { term, fit, wrapper, label, closed: false, sessionBar: false, seen: '' };
  terms.set(id, entry);
  renderTab(id, label);

  term.onData((data) => api.sendInput(id, data));
  term.onSelectionChange(() => {
    try {
      if (term.hasSelection()) api.clipboardWrite(term.getSelection());
    } catch (_) { /* noop */ }
  });

  switchTab(id);

  const buffered = pending.get(id);
  if (buffered) {
    buffered.forEach((chunk) => term.write(stripOpaqueRowBg(chunk)));
    pending.delete(id);
  }

  return entry;
}

async function newTab() {
  let result;
  try {
    result = await api.createTab();
  } catch (err) {
    console.error('[ascii-term] createTab failed', err);
    return;
  }
  if (!result || !result.id) return;
  createTerminal(result.id, result.label || 'Shell');
}

function removeTabLocal(id) {
  const entry = terms.get(id);
  if (!entry || entry.closed) return;
  entry.closed = true;
  try { entry.term.dispose(); } catch (_) { /* noop */ }
  if (entry.wrapper.parentNode) entry.wrapper.parentNode.removeChild(entry.wrapper);
  terms.delete(id);
  pending.delete(id);

  const tabBtn = tabsEl.querySelector('.tab[data-id="' + id + '"]');
  if (tabBtn && tabBtn.parentNode) tabBtn.parentNode.removeChild(tabBtn);

  if (activeId === id) {
    const remaining = Array.from(terms.keys());
    if (remaining.length) switchTab(remaining[remaining.length - 1]);
    else {
      activeId = null;
      newTab();
    }
  }
}

function closeTab(id) {
  try { api.closeTab(id); } catch (_) { /* noop */ }
  removeTabLocal(id);
}

/* ---------- incoming PTY events ---------- */

// OpenCode paints its UI surfaces (session row, the "Terminal"/"File"/
// "Current" working badges, etc.) with per-character near-black background
// gradients. They are not always neutral: the badges use warm dark shades
// like 42;37;34 -> 41;36;33 -> 33;30;27 -> 21;19;17, which is what makes
// them look like dark stickers. Strip any dark fill (all channels <= 45)
// back to the default (transparent) background. The one exception is the
// OpenCode logo's 32;32;32 shade; 64;64;64 is above the threshold and stays.
const DARK_BG = /\x1b\[48;2;(\d{1,3});(\d{1,3});(\d{1,3})m/g;
function stripOpaqueRowBg(data) {
  return data.replace(DARK_BG, (match, r, g, b) => {
    const R = Number(r), G = Number(g), B = Number(b);
    const dark = Math.max(R, G, B) <= 45;
    const logoShade = R === 32 && G === 32 && B === 32;
    return (dark && !logoShade) ? '\x1b[49m' : match;
  });
}

api.onData(({ id, data }) => {
  const entry = terms.get(id);
  if (entry && !entry.closed) {
    entry.term.write(stripOpaqueRowBg(data));

    // Detect OpenCode's session bar ("+ New session") in the plain text.
    // Keep a small rolling window so split escape/data chunks are handled.
    entry.seen = (entry.seen + data.replace(ANSI_RE, '')).slice(-4000);
    if (!entry.sessionBar && /New session/i.test(entry.seen)) {
      entry.sessionBar = true;
      if (id === activeId) updateSessionGlass();
    }
  } else {
    if (!pending.has(id)) pending.set(id, []);
    const queue = pending.get(id);
    queue.push(data);
    if (queue.length > 200) queue.shift();
  }
});

api.onExit(({ id, exitCode }) => {
  const entry = terms.get(id);
  if (entry && !entry.closed) {
    entry.term.write('\r\n\x1b[38;2;148;163;184m[Process exited with code ' + exitCode + ']\x1b[0m\r\n');
  }
  setTimeout(() => removeTabLocal(id), 500);
});

/* ---------- clipboard & keyboard ---------- */

async function paste() {
  if (!activeId) return;
  try {
    const text = await api.clipboardRead();
    if (text) api.sendInput(activeId, text);
  } catch (err) {
    console.error('[ascii-term] paste failed', err);
  }
}

function copySelection() {
  const entry = terms.get(activeId);
  if (!entry) return false;
  try {
    if (!entry.term.hasSelection()) return false;
    api.clipboardWrite(entry.term.getSelection());
    return true;
  } catch (_) {
    return false;
  }
}

window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || !e.shiftKey) return;
  const key = e.key.toLowerCase();

  if (key === 't') {
    e.preventDefault();
    e.stopPropagation();
    newTab();
  } else if (key === 'w') {
    e.preventDefault();
    e.stopPropagation();
    if (activeId) closeTab(activeId);
  } else if (key === 'c') {
    if (copySelection()) {
      e.preventDefault();
      e.stopPropagation();
    }
  } else if (key === 'v') {
    e.preventDefault();
    e.stopPropagation();
    paste();
  }
}, true);

terminalsEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  paste();
});

/* ---------- resize ---------- */

let resizeRaf = 0;
const resizeObserver = new ResizeObserver(() => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(fitActive);
});
resizeObserver.observe(terminalsEl);
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(fitActive);
});

/* ---------- window buttons ---------- */

document.getElementById('new-tab').addEventListener('click', newTab);
document.getElementById('win-min').addEventListener('click', () => api.minimize());
document.getElementById('win-max').addEventListener('click', () => api.maximize());
document.getElementById('win-close').addEventListener('click', () => api.closeWindow());

/* ---------- boot ---------- */

newTab();

// Small hook used by the automated verification script.
window.__asciiTerm = {
  get life() { return life; },
  get activeId() { return activeId; },
  get terms() { return terms; },
  get scene() { return currentScene; },
  setScene,
  newTab,
  send: (text) => activeId && api.sendInput(activeId, text),
  buffer: (id) => {
    const entry = terms.get(id || activeId);
    if (!entry) return '';
    const lines = [];
    for (let i = 0; i < entry.term.buffer.active.length; i++) {
      lines.push(entry.term.buffer.active.getLine(i).translateToString(true));
    }
    return lines.join('\n');
  }
};
