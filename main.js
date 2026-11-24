'use strict';

const { app, BrowserWindow, ipcMain, clipboard, Menu, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('node-pty');

let mainWindow = null;
let tabCounter = 0;
const tabs = new Map(); // id -> { pty, label }

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    killAllPties();
    app.quit();
  });

  app.on('before-quit', killAllPties);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 700,
    minHeight: 460,
    frame: false,
    show: false,
    backgroundColor: '#06070a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function killAllPties() {
  for (const { pty: proc } of tabs.values()) {
    try { proc.kill(); } catch (_) { /* already gone */ }
  }
  tabs.clear();
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

/* ---------- shell selection ---------- */

function pickShell() {
  if (process.platform === 'win32') {
    const candidates = [
      {
        file: process.env.WINDIR
          ? path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
          : 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        args: ['-NoLogo'],
        label: 'PowerShell'
      },
      { file: 'pwsh.exe', args: ['-NoLogo'], label: 'PowerShell 7' },
      { file: process.env.ComSpec || 'cmd.exe', args: ['/Q'], label: 'Command Prompt' }
    ];
    for (const c of candidates) {
      if (c.file.includes(path.sep) ? fs.existsSync(c.file) : true) return c;
    }
    return candidates[candidates.length - 1];
  }
  return {
    file: process.env.SHELL || '/bin/bash',
    args: ['-l'],
    label: 'Shell'
  };
}

function safeCwd() {
  try {
    const home = os.homedir();
    if (home && fs.existsSync(home)) return home;
  } catch (_) { /* fall through */ }
  return app.getAppPath();
}

function spawnShell(id) {
  const cfg = pickShell();
  const env = Object.assign({}, process.env, {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor'
  });
  delete env.ELECTRON_RUN_AS_NODE;

  const proc = pty.spawn(cfg.file, cfg.args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: safeCwd(),
    env,
    // ConPTY is used by default on Windows 10+; keep it explicit for clarity.
    windowsPty: process.platform === 'win32' ? { useConpty: true } : undefined
  });

  tabs.set(id, { pty: proc, label: cfg.label });

  proc.onData((data) => send('term:data', { id, data }));

  proc.onExit(({ exitCode, signal }) => {
    tabs.delete(id);
    send('term:exit', { id, exitCode, signal: signal || null });
  });

  return cfg.label;
}

/* ---------- IPC ---------- */

function registerIpc() {
  ipcMain.handle('term:createTab', () => {
    const id = 'tab-' + (++tabCounter);
    try {
      const label = spawnShell(id);
      return { id, label };
    } catch (err) {
      send('term:data', { id, data: '\r\n\x1b[31mFailed to start shell: ' + err.message + '\x1b[0m\r\n' });
      return { id, label: 'Unavailable' };
    }
  });

  ipcMain.on('term:closeTab', (_event, id) => {
    const entry = tabs.get(id);
    if (!entry) return;
    try { entry.pty.kill(); } catch (_) { /* noop */ }
    tabs.delete(id);
  });

  ipcMain.on('term:input', (_event, id, data) => {
    const entry = tabs.get(id);
    if (!entry) return;
    try { entry.pty.write(data); } catch (_) { /* noop */ }
  });

  ipcMain.on('term:resize', (_event, id, cols, rows) => {
    const entry = tabs.get(id);
    if (!entry) return;
    const c = Math.max(2, Math.min(500, Number(cols) || 80));
    const r = Math.max(2, Math.min(300, Number(rows) || 24));
    try { entry.pty.resize(c, r); } catch (_) { /* noop */ }
  });

  ipcMain.handle('clipboard:write', (_event, text) => {
    try { clipboard.writeText(String(text || '')); } catch (_) { /* noop */ }
    return true;
  });

  ipcMain.handle('clipboard:read', () => {
    try { return clipboard.readText(); } catch (_) { return ''; }
  });

  ipcMain.on('win:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.on('win:maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });

  ipcMain.on('win:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });

  ipcMain.handle('app:openExternal', (_event, url) => {
    try { shell.openExternal(url); } catch (_) { /* noop */ }
    return true;
  });
}
