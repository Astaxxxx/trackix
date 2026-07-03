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
const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { scanProjects, analyseProject } = require('./scanner.cjs');

const isDev = process.env.ASTAX_DEV === '1';
// Started by the OS login item: show only the floating buddy; the main window
// opens on demand when the buddy is clicked.
const buddyOnly = process.argv.includes('--buddy-only');

let mainWindow = null;
let buddyWindow = null;

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

/* ------------------------- desktop buddy ------------------------- */
// A small always-on-top mascot that floats on the desktop. Click it to open
// Trackix, drag it anywhere, or dismiss it. Its own hardened preload; it can
// only move itself, focus the main window, or hide.
function mascotFileUrl() {
  const p = isDev
    ? path.join(__dirname, '..', 'public', 'mascot.png')
    : path.join(__dirname, '..', 'dist', 'mascot.png');
  return 'file://' + p.replace(/\\/g, '/');
}

function createBuddy() {
  if (buddyWindow && !buddyWindow.isDestroyed()) { buddyWindow.show(); return; }
  const { workArea } = screen.getPrimaryDisplay();
  const W = 168, H = 196;
  buddyWindow = new BrowserWindow({
    width: W, height: H,
    x: workArea.x + workArea.width - W - 24,
    y: workArea.y + workArea.height - H - 24,
    frame: false, transparent: true, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'buddy-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  buddyWindow.setAlwaysOnTop(true, 'screen-saver');
  buddyWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  buddyWindow.loadFile(path.join(__dirname, 'buddy.html'));
  buddyWindow.on('closed', () => { buddyWindow = null; });
}

function destroyBuddy() {
  if (buddyWindow && !buddyWindow.isDestroyed()) buddyWindow.close();
  buddyWindow = null;
}

// Show / hide the floating buddy while the app is running. Does NOT touch the
// OS login item — "launch on startup" is a separate, explicit choice below.
ipcMain.handle('buddy:set', (_e, enabled) => {
  enabled ? createBuddy() : destroyBuddy();
  return true;
});

// Register / clear the OS login item so the avatar appears when the laptop boots
// (packaged builds only — dev has no login item). `--buddy-only` starts it as
// just the floating avatar; clicking it opens the full app.
ipcMain.handle('buddy:setStartup', (_e, enabled) => {
  if (!isDev) app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--buddy-only'] });
  return true;
});
ipcMain.handle('buddy:mascot', () => mascotFileUrl());
ipcMain.handle('buddy:getPos', () => (buddyWindow ? buddyWindow.getPosition() : [0, 0]));
ipcMain.handle('buddy:setPos', (_e, x, y) => { if (buddyWindow) buddyWindow.setPosition(Math.round(x), Math.round(y)); });
ipcMain.handle('buddy:openMain', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
});
ipcMain.handle('buddy:hide', () => { destroyBuddy(); if (mainWindow) mainWindow.webContents.send('buddy:dismissed'); });

/** Read saved settings straight from disk (main process, pre-renderer). */
async function readSettings() {
  try {
    const raw = await fsp.readFile(dbPath(), 'utf8');
    return JSON.parse(raw).settings || {};
  } catch { return {}; }
}

app.whenReady().then(async () => {
  const settings = await readSettings();
  if (buddyOnly && settings.buddyStartup === true) {
    // Laptop boot with "launch on startup" enabled: show only the floating
    // avatar. The main window opens when the buddy is clicked.
    createBuddy();
  } else {
    // Normal launch — or a stale login item while startup is now off:
    // clean the login item up and open the app the ordinary way.
    if (buddyOnly && !isDev) app.setLoginItemSettings({ openAtLogin: false, args: ['--buddy-only'] });
    createWindow();
    if (settings.buddyEnabled === true) createBuddy();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', destroyBuddy);

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

/* ----------------------------- AI backends ----------------------------- */
// Two opt-in providers, both driven from the main process:
//  - Ollama: runs on the user's own machine (localhost:11434) — nothing leaves it.
//  - Claude API: uses the user's OWN key (stored locally); sends only project
//    metadata (name, tools, README excerpt) to Anthropic. Clearly disclosed in UI.
const OLLAMA = 'http://127.0.0.1:11434';

const AI_SYSTEM = [
  'You triage local coding projects. Classify the project status as exactly one of:',
  '- "unfinished": actively being built, has open work / TODOs, no clear release.',
  '- "finished": shipped or complete (README + deploy/host, clean, low open work).',
  '- "dropped": abandoned — untouched for a long time AND incomplete.',
  'Keep "reason" under 14 words.',
].join('\n');

function aiSignals(p) {
  return JSON.stringify({
    name: p.name, tools: p.tools, hosting: p.hosting,
    heuristicCompletionPercent: p.completion, daysSinceLastEdit: p.daysSinceEdit,
    todoMarkers: p.todos, hasReadme: p.hasReadme, hasTests: p.hasTests, hasGit: p.hasGit,
    readme: (p.readmeExcerpt || '').slice(0, 240),
  });
}

const VALID_STATUS = ['unfinished', 'finished', 'dropped'];

function coerceResult(parsed) {
  if (!parsed || !VALID_STATUS.includes(parsed.status)) return null;
  return { status: parsed.status, reason: String(parsed.reason || '').slice(0, 160) };
}

/* ---- Claude API (official SDK, called with the user's own key) ---- */
let AnthropicSDK = null;
function anthropicClient(apiKey) {
  if (!AnthropicSDK) AnthropicSDK = require('@anthropic-ai/sdk');
  return new AnthropicSDK({ apiKey });
}

async function claudeStatus(cfg) {
  try {
    const client = anthropicClient(cfg.apiKey);
    const m = await client.models.retrieve(cfg.model);
    return { running: true, models: [m.id] };
  } catch (e) {
    const msg = e && e.status === 401 ? 'Invalid API key'
      : e && e.status === 404 ? `Model "${cfg.model}" not found`
      : (e && e.message) || 'Claude API not reachable';
    return { running: false, models: [], error: msg };
  }
}

async function claudeRefine(payload) {
  const client = anthropicClient(payload.apiKey);
  // Structured output guarantees valid JSON matching our schema.
  const response = await client.messages.create({
    model: payload.model,
    max_tokens: 512, // tiny classification call
    system: AI_SYSTEM,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: VALID_STATUS },
            reason: { type: 'string' },
          },
          required: ['status', 'reason'],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: 'user', content: 'Project signals:\n' + aiSignals(payload) }],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.find((b) => b.type === 'text');
  return coerceResult(JSON.parse(text ? text.text : '{}'));
}

/* ---- Ollama (fully local) ---- */
async function ollamaStatus() {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { running: false, models: [], error: 'Ollama returned HTTP ' + r.status };
    const j = await r.json();
    return { running: true, models: (j.models || []).map((m) => m.name) };
  } catch (e) {
    return { running: false, models: [], error: (e && e.message) || 'Ollama not reachable' };
  }
}

async function ollamaRefine(payload) {
  const r = await fetch(OLLAMA + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: payload.model,
      prompt: AI_SYSTEM
        + '\n\nReply with ONLY JSON: {"status":"unfinished|finished|dropped","reason":"<=14 words"}.'
        + '\n\nProject signals:\n' + aiSignals(payload),
      stream: false,
      format: 'json',
      options: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return coerceResult(JSON.parse((j.response || '').trim()));
}

/* ---- IPC ---- */
ipcMain.handle('ai:status', async (_e, cfg) => {
  if (cfg && cfg.provider === 'claude') {
    if (!cfg.apiKey) return { running: false, models: [], error: 'Enter your Anthropic API key first' };
    return claudeStatus(cfg);
  }
  return ollamaStatus();
});

ipcMain.handle('ai:refine', async (_e, payload) => {
  if (!payload || typeof payload.model !== 'string') return null;
  try {
    if (payload.provider === 'claude') {
      if (!payload.apiKey) return null;
      return await claudeRefine(payload);
    }
    return await ollamaRefine(payload);
  } catch {
    return null; // callers silently keep the heuristic suggestion
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
