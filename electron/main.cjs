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

/* ---- Revival Ritual (AI plan) ---- */
const REVIVE_SYSTEM = [
  'You are helping a developer resurrect a stalled/abandoned coding project.',
  'Given the project signals, produce:',
  '- stallReason: one sentence — the most likely reason it died (be specific, not generic).',
  '- summary: one energising sentence about the realistic path back.',
  '- steps: 4 to 6 concrete, small, ordered actions that get it from its current state to SHIPPED.',
  '  Each step must be doable in one sitting. First step should rebuild context; last step should be shipping.',
].join('\n');

const REVIVE_SCHEMA = {
  type: 'object',
  properties: {
    stallReason: { type: 'string' },
    summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['stallReason', 'summary', 'steps'],
  additionalProperties: false,
};

function coerceRevival(parsed) {
  if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) return null;
  return {
    stallReason: String(parsed.stallReason || '').slice(0, 300),
    summary: String(parsed.summary || '').slice(0, 300),
    steps: parsed.steps.slice(0, 6).map((s) => String(s).slice(0, 200)),
  };
}

async function claudeRevive(payload) {
  const client = anthropicClient(payload.apiKey);
  const response = await client.messages.create({
    model: payload.model,
    max_tokens: 1024,
    system: REVIVE_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: REVIVE_SCHEMA } },
    messages: [{ role: 'user', content: 'Project signals:\n' + aiSignals(payload) }],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.find((b) => b.type === 'text');
  return coerceRevival(JSON.parse(text ? text.text : '{}'));
}

async function ollamaRevive(payload) {
  const r = await fetch(OLLAMA + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: payload.model,
      prompt: REVIVE_SYSTEM
        + '\n\nReply with ONLY JSON: {"stallReason":"...","summary":"...","steps":["...","..."]}.'
        + '\n\nProject signals:\n' + aiSignals(payload),
      stream: false,
      format: 'json',
      options: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return coerceRevival(JSON.parse((j.response || '').trim()));
}

ipcMain.handle('ai:revive', async (_e, payload) => {
  if (!payload || typeof payload.model !== 'string') return null;
  try {
    if (payload.provider === 'claude') {
      if (!payload.apiKey) return null;
      return await claudeRevive(payload);
    }
    return await ollamaRevive(payload);
  } catch {
    return null; // caller falls back to the heuristic plan
  }
});

/* ---- Vega: the AI companion you chat with about your board ---- */
const VEGA_SYSTEM = [
  'You are Vega, the keeper of the user\'s "cosmos" inside Trackix — a local project tracker.',
  'You are warm, sharp, and encouraging, with a light cosmic flavour (stars, orbits, momentum) — but never cheesy or long-winded.',
  'You know the user\'s whole project board (given below as JSON). Ground every answer in that real data:',
  'reference specific project names, their status, completion %, tools, focus time and staleness.',
  'Be concise and practical — a few sentences, or a short list. When they ask what to do, give a clear recommendation, not a survey.',
  'You cannot run code or change files; you advise. Never invent projects that are not in the board.',
].join('\n');

async function claudeChat(payload) {
  const client = anthropicClient(payload.apiKey);
  const response = await client.messages.create({
    model: payload.model,
    max_tokens: 700,
    system: VEGA_SYSTEM + '\n\nThe user\'s project board (JSON):\n' + JSON.stringify(payload.board || []),
    messages: (payload.messages || []).slice(-12),
  });
  if (response.stop_reason === 'refusal') return { text: 'I had to hold back on that one — ask me another way?' };
  const t = response.content.find((b) => b.type === 'text');
  return { text: t ? t.text : '' };
}

async function ollamaChat(payload) {
  const r = await fetch(OLLAMA + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: payload.model,
      messages: [
        { role: 'system', content: VEGA_SYSTEM + '\n\nThe user\'s project board (JSON):\n' + JSON.stringify(payload.board || []) },
        ...(payload.messages || []).slice(-12),
      ],
      stream: false,
      options: { temperature: 0.6 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return { text: (j.message && j.message.content) || '' };
}

ipcMain.handle('ai:chat', async (_e, payload) => {
  if (!payload || typeof payload.model !== 'string') return null;
  try {
    if (payload.provider === 'claude') {
      if (!payload.apiKey) return null;
      return await claudeChat(payload);
    }
    return await ollamaChat(payload);
  } catch (e) {
    return { text: '', error: (e && e.message) || 'Vega could not reach the model.' };
  }
});

/* ---- Deep Scan: the AI reads a project's real files and audits it ---- */
// Reads only README + a few entry/source files inside the chosen project,
// capped hard. On Claude this sends code excerpts to Anthropic (user's key,
// their own code) — disclosed in the UI. On Ollama it never leaves the machine.
const DEEPSCAN_CANDIDATES = [
  'README.md', 'README.txt', 'readme.md', 'package.json', 'requirements.txt', 'pyproject.toml',
  'Cargo.toml', 'go.mod', 'src/main.tsx', 'src/main.ts', 'src/index.tsx', 'src/index.ts',
  'src/App.tsx', 'src/app.py', 'main.py', 'app.py', 'main.go', 'index.js', 'src/index.js', 'main.js',
];

async function gatherProjectContent(dir) {
  const resolved = path.resolve(dir);
  const parts = [];
  let budget = 15000;
  // include a shallow file listing for structure
  try {
    const top = await fsp.readdir(resolved, { withFileTypes: true });
    parts.push('FILES: ' + top.filter((e) => !e.name.startsWith('.')).map((e) => e.name + (e.isDirectory() ? '/' : '')).slice(0, 40).join(', '));
  } catch { /* ignore */ }
  for (const rel of DEEPSCAN_CANDIDATES) {
    if (budget <= 0) break;
    const full = path.join(resolved, rel);
    if (!full.startsWith(resolved)) continue;
    try {
      const st = await fsp.stat(full);
      if (!st.isFile() || st.size > 200 * 1024) continue;
      let txt = await fsp.readFile(full, 'utf8');
      txt = txt.slice(0, Math.min(3200, budget));
      budget -= txt.length;
      parts.push('=== ' + rel + ' ===\n' + txt);
    } catch { /* not present */ }
  }
  return parts.join('\n\n');
}

const DEEPSCAN_SYSTEM = [
  'You are a senior engineer reviewing a coding project from its real files (listing + excerpts).',
  'Produce an honest, specific audit:',
  '- summary: 1-2 sentences on what this project actually is and its apparent maturity.',
  '- health: one blunt sentence on its overall state (well-structured? messy? abandoned-looking?).',
  '- risks: 1-4 concrete problems or gaps you can see (missing tests, no error handling, secrets, dead code, no README, etc.). If none are visible, return an empty array.',
  '- nextActions: exactly the 3 highest-leverage next steps to move it toward shipped.',
  'Judge only from the provided material; do not invent files you were not shown.',
].join('\n');

const DEEPSCAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    health: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    nextActions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'health', 'risks', 'nextActions'],
  additionalProperties: false,
};

function coerceAudit(parsed) {
  if (!parsed || typeof parsed.summary !== 'string') return null;
  return {
    summary: String(parsed.summary).slice(0, 400),
    health: String(parsed.health || '').slice(0, 300),
    risks: (Array.isArray(parsed.risks) ? parsed.risks : []).slice(0, 4).map((s) => String(s).slice(0, 200)),
    nextActions: (Array.isArray(parsed.nextActions) ? parsed.nextActions : []).slice(0, 3).map((s) => String(s).slice(0, 200)),
  };
}

async function claudeDeepScan(payload, content) {
  const client = anthropicClient(payload.apiKey);
  const response = await client.messages.create({
    model: payload.model,
    max_tokens: 1024,
    system: DEEPSCAN_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: DEEPSCAN_SCHEMA } },
    messages: [{ role: 'user', content: `Project "${payload.name}" files:\n\n${content}` }],
  });
  if (response.stop_reason === 'refusal') return null;
  const t = response.content.find((b) => b.type === 'text');
  return coerceAudit(JSON.parse(t ? t.text : '{}'));
}

async function ollamaDeepScan(payload, content) {
  const r = await fetch(OLLAMA + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: payload.model,
      prompt: DEEPSCAN_SYSTEM
        + '\n\nReply with ONLY JSON: {"summary":"...","health":"...","risks":["..."],"nextActions":["...","...","..."]}.'
        + `\n\nProject "${payload.name}" files:\n\n${content}`,
      stream: false,
      format: 'json',
      options: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return coerceAudit(JSON.parse((j.response || '').trim()));
}

ipcMain.handle('ai:deepscan', async (_e, payload) => {
  if (!payload || typeof payload.model !== 'string' || typeof payload.path !== 'string') return null;
  try {
    const content = await gatherProjectContent(payload.path);
    if (!content || content.length < 20) return { error: 'Nothing readable found in this project folder.' };
    const audit = payload.provider === 'claude'
      ? (payload.apiKey ? await claudeDeepScan(payload, content) : null)
      : await ollamaDeepScan(payload, content);
    return audit ? { audit } : { error: 'The model did not return a usable report.' };
  } catch (e) {
    return { error: (e && e.message) || 'Deep scan failed.' };
  }
});

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
