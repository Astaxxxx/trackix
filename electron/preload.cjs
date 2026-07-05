/*
 * Preload — the ONLY bridge between the sandboxed renderer and the OS.
 * Everything is an explicit, typed, allow-listed function. The renderer can
 * never reach `require`, `fs`, or arbitrary IPC channels.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('astax', {
  isDesktop: true,
  platform: process.platform,

  // storage
  loadDB: () => ipcRenderer.invoke('db:load'),
  saveDB: (data) => ipcRenderer.invoke('db:save', data),

  // project scanning (always scoped to a folder the user picks)
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  scanProjects: (root) => ipcRenderer.invoke('scan:projects', root),
  rescanOne: (dir) => ipcRenderer.invoke('scan:one', dir),

  // shell
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // AI — Ollama (fully local) or the Claude API with the user's own key
  aiStatus: (cfg) => ipcRenderer.invoke('ai:status', cfg),
  aiRefine: (payload) => ipcRenderer.invoke('ai:refine', payload),
  aiRevive: (payload) => ipcRenderer.invoke('ai:revive', payload),
  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  aiDeepScan: (payload) => ipcRenderer.invoke('ai:deepscan', payload),

  // desktop buddy (floating mascot)
  setBuddy: (enabled) => ipcRenderer.invoke('buddy:set', enabled),
  setBuddyStartup: (enabled) => ipcRenderer.invoke('buddy:setStartup', enabled),
  onBuddyDismissed: (cb) => {
    const h = () => cb();
    ipcRenderer.on('buddy:dismissed', h);
    return () => ipcRenderer.removeListener('buddy:dismissed', h);
  },
});
