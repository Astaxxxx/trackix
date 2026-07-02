/* Buddy window bridge — can only move itself, open/focus the app, or hide. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  mascot: () => ipcRenderer.invoke('buddy:mascot'),
  getPos: () => ipcRenderer.invoke('buddy:getPos'),
  setPos: (x, y) => ipcRenderer.invoke('buddy:setPos', x, y),
  openMain: () => ipcRenderer.invoke('buddy:openMain'),
  hide: () => ipcRenderer.invoke('buddy:hide'),
});
