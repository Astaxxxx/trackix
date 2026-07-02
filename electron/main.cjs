/*
 * Astax Tracker — Electron main process
 * ------------------------------------------------------------------
 * Security posture (deliberate):
 *  - Renderer runs with contextIsolation:true, nodeIntegration:false,
 *    sandbox:true. It can ONLY talk to the OS through the typed,
 *    allow-listed channels in preload.cjs.
 *  - Filesystem access is scoped: the renderer can never name an
 *    arbitrary path. It can only scan a folder the user picked via the
 *    native dialog, and every scan is re-validated against that root.
 *  - No remote content is ever loaded. External links open in the OS
 *    browser, never inside the app window.
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { scanProjects, analyseProject } = require('./scanner.cjs');

const isDev = process.env.ASTAX_DEV === '1';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f4f1ec',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Block in-app navigation to remote origins and force links to the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const ok = isDev ? url.startsWith('http://localhost:5173') : url.startsWith('file://');
    if (!ok) e.preventDefault();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ----------------------------- storage ----------------------------- */
// Single JSON file in the OS-appropriate userData dir. Local only.
function dbPath() {
  return path.join(app.getPath('userData'), 'astax-tracker.json');
}

ipcMain.handle('db:load', async () => {
  try {
    const raw = await fsp.readFile(dbPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null; // first run
  }
});

ipcMain.handle('db:save', async (_e, data) => {
  const tmp = dbPath() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, dbPath()); // atomic-ish write
  return true;
});

/* ----------------------------- dialogs ----------------------------- */
ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder that contains your projects',
    properties: ['openDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

ipcMain.handle('shell:openPath', async (_e, p) => {
  if (typeof p !== 'string') return false;
  await shell.openPath(p);
  return true;
});

ipcMain.handle('shell:openExternal', async (_e, url) => {
  if (typeof url !== 'string') return false;
  if (!/^https?:\/\//.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

/* ------------------------- local AI (Ollama) ------------------------- */
// Optional, opt-in. We talk to Ollama running on the user's own machine
// (http://localhost:11434). The call is made from the main process so there
// are no CORS issues, and crucially: no project data ever leaves the device.
const OLLAMA = 'http://127.0.0.1:11434';

ipcMain.handle('ai:status', async () => {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { running: false, models: [], error: 'Ollama returned HTTP ' + r.status };
    const j = await r.json();
    return { running: true, models: (j.models || []).map((m) => m.name) };
  } catch (e) {
    return { running: false, models: [], error: (e && e.message) || 'Ollama not reachable' };
  }
});

function buildAiPrompt(p) {
  return [
    'You triage local coding projects. Classify the project status as exactly one of:',
    '- "unfinished": actively being built, has open work / TODOs, no clear release.',
    '- "finished": shipped or complete (README + deploy/host, clean, low open work).',
    '- "dropped": abandoned — untouched for a long time AND incomplete.',
    '',
    'Reply with ONLY JSON: {"status":"unfinished|finished|dropped","reason":"<=14 words"}.',
    '',
    'Project signals:',
    JSON.stringify({
      name: p.name, tools: p.tools, hosting: p.hosting,
      heuristicCompletionPercent: p.completion, daysSinceLastEdit: p.daysSinceEdit,
      todoMarkers: p.todos, hasReadme: p.hasReadme, hasTests: p.hasTests, hasGit: p.hasGit,
      readme: (p.readmeExcerpt || '').slice(0, 240),
    }),
  ].join('\n');
}

ipcMain.handle('ai:refine', async (_e, payload) => {
  if (!payload || typeof payload.model !== 'string') return null;
  try {
    const r = await fetch(OLLAMA + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: payload.model,
        prompt: buildAiPrompt(payload),
        stream: false,
        format: 'json',
        options: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const parsed = JSON.parse((j.response || '').trim());
    const status = ['unfinished', 'finished', 'dropped'].includes(parsed.status) ? parsed.status : null;
    if (!status) return null;
    return { status, reason: String(parsed.reason || '').slice(0, 160) };
  } catch {
    return null;
  }
});

/* ----------------------------- scanning ----------------------------- */
// All scanning logic lives in scanner.cjs (pure, Electron-free, testable).
// These handlers just validate input and delegate. Every scan is scoped to a
// path the user chose; the renderer can never name an arbitrary location.

ipcMain.handle('scan:projects', async (_e, root) => {
  if (typeof root !== 'string') throw new Error('Invalid path');
  try {
    return await scanProjects(root);
  } catch (err) {
    throw new Error('Could not scan that folder: ' + (err && err.message));
  }
});

/** Re-analyse one known project (used by the Refresh buttons). */
ipcMain.handle('scan:one', async (_e, dir) => {
  if (typeof dir !== 'string') throw new Error('Invalid path');
  return analyseProject(path.resolve(dir));
});
