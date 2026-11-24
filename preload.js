'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalApi', {
  createTab: () => ipcRenderer.invoke('term:createTab'),
  closeTab: (id) => ipcRenderer.send('term:closeTab', id),
  sendInput: (id, data) => ipcRenderer.send('term:input', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),

  onData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('term:data', listener);
    return () => ipcRenderer.removeListener('term:data', listener);
  },
  onExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('term:exit', listener);
    return () => ipcRenderer.removeListener('term:exit', listener);
  },

  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),

  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  closeWindow: () => ipcRenderer.send('win:close'),

  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
});
