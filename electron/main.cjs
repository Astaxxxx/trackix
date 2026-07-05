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
const { execFile } = require('node:child_process');
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

/* ---- Autopilot: portfolio-aware agentic code generation ---------------- */
// The novel feature. Claude finishes an unfinished project by generating the
// missing code IN THE USER'S OWN STYLE — reusing patterns from their OTHER
// tracked projects. Every file access is scoped to the target project folder
// (same resolve+startsWith guard as scanner.cjs), a git snapshot is taken
// before any write, and every write must be explicitly approved via a diff
// gate in the renderer. The model never runs code; it reads, plans, and
// proposes file writes.

const AUTOPILOT_MODEL_FALLBACK = 'claude-opus-4-8';
const AP_MAX_ITERATIONS = 10;      // agent turns
const AP_MAX_WRITES = 10;          // files it may create/modify in one pass
const AP_MAX_FILE_BYTES = 40 * 1024;   // reject writes larger than this
const AP_READ_RETURN_CAP = 20 * 1024;  // trim file reads to keep context (and cost) lean
const AP_MAX_TOKENS = 16000;           // per-turn output cap
const AP_COST_CAP_USD = 0.75;          // hard spend cap — the loop stops when a pass reaches this
const AP_SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'release', '.next', '.nuxt',
  '.expo', '.cache', '.turbo', 'coverage', 'venv', '.venv', '__pycache__',
  'target', 'bin', 'obj', 'vendor', '.idea', '.vscode',
]);

/** Rough per-token USD prices so we can show a live cost meter and enforce a
 *  spend cap. Cache writes bill ~1.25x input, cache reads ~0.1x input. */
function apPrices(model) {
  const m = (model || '').toLowerCase();
  let inRate = 5e-6, outRate = 25e-6; // opus default
  if (m.includes('haiku')) { inRate = 1e-6; outRate = 5e-6; }
  else if (m.includes('sonnet')) { inRate = 3e-6; outRate = 15e-6; }
  else if (m.includes('fable') || m.includes('mythos')) { inRate = 10e-6; outRate = 50e-6; }
  return { inRate, outRate };
}
function apCostOf(usage, prices) {
  if (!usage) return 0;
  const fresh = usage.input_tokens || 0;
  const out = usage.output_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  return fresh * prices.inRate + out * prices.outRate + cw * prices.inRate * 1.25 + cr * prices.inRate * 0.1;
}

/** Prompt caching is a prefix match. Cache the (static) system prompt + a
 *  rolling breakpoint on the newest message so each turn re-reads the growing
 *  history at ~0.1x instead of full price. Clear old breakpoints first so we
 *  never exceed the 4-breakpoint limit. */
function apMarkCache(messages) {
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) { if (b && typeof b === 'object' && b.cache_control) delete b.cache_control; }
    }
  }
  const last = messages[messages.length - 1];
  if (last && Array.isArray(last.content) && last.content.length) {
    const block = last.content[last.content.length - 1];
    if (block && typeof block === 'object') block.cache_control = { type: 'ephemeral' };
  }
}

/** Resolve `rel` against `root`, rejecting anything that escapes the folder. */
function scopedPath(root, rel) {
  const base = path.resolve(root);
  const full = path.resolve(base, rel || '.');
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || '').trim(), err: (stderr || '').trim() });
    });
  });
}

/** Take a revert point before any write. Commits the current tree (or inits a
 *  repo first). Identity is passed inline so it works on projects with no git
 *  config, and gpg signing is disabled to avoid interactive prompts. */
async function autopilotSnapshot(dir) {
  const inside = await runGit(dir, ['rev-parse', '--is-inside-work-tree']);
  let mode = 'commit';
  if (!inside.ok || inside.out !== 'true') {
    const init = await runGit(dir, ['init']);
    if (!init.ok) return { mode: 'none', detail: 'Could not create a git snapshot — proceeding with the approval gate as your only safety net.' };
    mode = 'init';
  }
  await runGit(dir, ['add', '-A']);
  const commit = await runGit(dir, [
    '-c', 'user.name=Trackix Autopilot', '-c', 'user.email=autopilot@trackix.local',
    '-c', 'commit.gpgsign=false', 'commit', '-m', 'Trackix Autopilot snapshot',
  ]);
  if (!commit.ok) {
    // Almost always "nothing to commit" — the tree is already a clean revert point.
    if (/nothing to commit/i.test(commit.out + commit.err)) {
      return { mode: 'clean', detail: 'Working tree already clean — your last commit is the revert point.' };
    }
    return { mode: 'none', detail: 'Git snapshot failed (' + (commit.err || 'unknown') + ') — the approval gate is your safety net.' };
  }
  return {
    mode,
    detail: mode === 'init'
      ? 'Initialised a git repo and committed a snapshot — run `git reset --hard HEAD~1` to undo everything.'
      : 'Committed a snapshot — run `git reset --hard HEAD~1` to undo everything Autopilot writes.',
  };
}

/** Pull a handful of short, representative source files from ONE project so the
 *  model can imitate the user's real style. Filenames matching common concerns
 *  (auth, upload, api, client, hooks…) are preferred; otherwise the first few
 *  source files. Scoped + size-capped like every other read in this app. */
async function gatherStyleSnippets(dir, budget) {
  const base = path.resolve(dir);
  const PREF = /(auth|login|upload|api|client|fetch|hook|store|db|model|route|handler|service|util|component)/i;
  const CODE = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|vue|svelte)$/i;
  const found = [];
  async function walk(d, depth) {
    if (depth > 3 || found.length >= 60) return;
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found.length >= 60) return;
      if (e.name.startsWith('.') || AP_SKIP.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (!full.startsWith(base)) continue;
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (CODE.test(e.name)) found.push(full);
    }
  }
  await walk(base, 0);
  found.sort((a, b) => (PREF.test(path.basename(b)) ? 1 : 0) - (PREF.test(path.basename(a)) ? 1 : 0));
  const parts = [];
  let left = budget;
  for (const f of found.slice(0, 4)) {
    if (left <= 0) break;
    try {
      const st = await fsp.stat(f);
      if (!st.isFile() || st.size > AP_MAX_FILE_BYTES) continue;
      let txt = await fsp.readFile(f, 'utf8');
      txt = txt.slice(0, Math.min(1800, left));
      left -= txt.length;
      parts.push('--- ' + path.basename(dir) + '/' + path.relative(base, f).replace(/\\/g, '/') + ' ---\n' + txt);
    } catch { /* ignore */ }
  }
  return parts.join('\n\n');
}

/** Build the "your existing style" context from the user's OTHER projects that
 *  share a primary tool with the target. Returns { text, sources }. */
async function gatherPortfolioContext(targetTools, others) {
  const want = new Set((targetTools || []).map((t) => t.toLowerCase()));
  const matches = (others || [])
    .filter((o) => (o.tools || []).some((t) => want.has(t.toLowerCase())))
    .slice(0, 3);
  const blocks = [];
  const sources = [];
  let budget = 6000;
  for (const o of matches) {
    if (budget <= 0) break;
    const snip = await gatherStyleSnippets(o.path, Math.min(2600, budget));
    if (snip) { blocks.push(`### From your project "${o.name}" (${(o.tools || []).join(', ')})\n${snip}`); sources.push(o.name); budget -= snip.length; }
  }
  return { text: blocks.join('\n\n'), sources };
}

const AUTOPILOT_SYSTEM = [
  'You are Autopilot, a senior engineer embedded in Trackix. Your job is to ACTUALLY FINISH an unfinished coding project by WRITING CODE — not by describing it. You match the user\'s own style, reusing patterns from their OTHER projects (provided as "your existing style").',
  'You have three tools, scoped to the target project folder: read_file, list_dir, write_file. The ONLY way to change the project is to CALL write_file. Describing a change in prose does nothing — you must call the tool.',
  'The user pays per token from their own wallet, so be fast and decisive: minimal reading, then write.',
  'Do exactly this in one continuous session — never stop to ask permission (the user approves each file via a diff gate):',
  '1. Give a ONE-LINE plan of which files you will create or edit. Do not write paragraphs of analysis.',
  '2. Read at most 1-3 files you truly need (a file listing and key files are already provided below). Do not re-read or re-list what you already have.',
  '3. Immediately CALL write_file for each change — one call per file, the COMPLETE new file contents, focused (well under ~400 lines). Complete existing stubs and wire things together; mirror the naming, imports and formatting in the user\'s code. Do NOT just say what you would write — write it with the tool.',
  '4. Keep scope tight: the smallest set of real, working changes that moves the project toward shipped. No unrequested features, tests, refactors, or abstractions. Never write secrets or credentials.',
  'You cannot run, compile, or install anything. ONLY after you have written the files, stop calling tools and give a short final report in Vega\'s warm, encouraging voice: what you built and the human tasks that remain (deploy, add secrets, test it).',
  'If you catch yourself only analysing, stop and call write_file. Every write is shown as a diff the user approves or skips; if they skip one, continue with the rest and do not re-propose it.',
].join('\n');

const AUTOPILOT_TOOLS = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the target project. Path is relative to the project root.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Project-relative file path, e.g. "src/App.tsx".' } },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List the entries of a directory inside the target project. Path is relative to the project root ("." for the root).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Project-relative directory path.' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Propose creating or overwriting a file inside the target project with the given full contents. The user must approve the diff before it is written.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative file path to write.' },
        contents: { type: 'string', description: 'The complete new contents of the file.' },
      },
      required: ['path', 'contents'],
    },
  },
];

// One session at a time. The approval gate parks a resolver here that the
// renderer's approve/reject/stop handlers fulfil.
let autopilot = null; // { dir, aborted, pending: { id, resolve } }

function apSend(event) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('autopilot:event', event);
}

function apAwaitDecision(id) {
  return new Promise((resolve) => { autopilot.pending = { id, resolve }; });
}

async function apExecReadOnly(dir, name, input) {
  if (name === 'read_file') {
    const full = scopedPath(dir, input && input.path);
    if (!full) return { content: 'Error: path escapes the project folder — refused.', is_error: true };
    apSend({ type: 'tool', tool: 'read_file', path: String(input.path) });
    try {
      const st = await fsp.stat(full);
      if (!st.isFile()) return { content: 'Error: not a file.', is_error: true };
      let txt = await fsp.readFile(full, 'utf8');
      if (txt.length > AP_READ_RETURN_CAP) txt = txt.slice(0, AP_READ_RETURN_CAP) + '\n… (truncated — read a specific region if you need more)';
      return { content: txt.length ? txt : '(empty file)' };
    } catch {
      return { content: 'Error: file not found.', is_error: true };
    }
  }
  // list_dir
  const full = scopedPath(dir, input && input.path);
  if (!full) return { content: 'Error: path escapes the project folder — refused.', is_error: true };
  apSend({ type: 'tool', tool: 'list_dir', path: String((input && input.path) || '.') });
  try {
    const entries = await fsp.readdir(full, { withFileTypes: true });
    const listed = entries
      .filter((e) => !e.name.startsWith('.') && !AP_SKIP.has(e.name))
      .map((e) => e.name + (e.isDirectory() ? '/' : ''))
      .slice(0, 100);
    return { content: listed.length ? listed.join('\n') : '(empty directory)' };
  } catch {
    return { content: 'Error: directory not found.', is_error: true };
  }
}

/** Handle a write_file tool call: snapshot the before/after, send a diff to the
 *  renderer, and block on the user's Approve / Skip decision. */
async function apExecWrite(dir, input, counters) {
  const rel = input && input.path;
  const contents = input && input.contents;
  const full = scopedPath(dir, rel);
  if (!full) return { content: 'Error: path escapes the project folder — refused.', is_error: true };
  if (typeof contents !== 'string') return { content: 'Error: missing contents.', is_error: true };
  if (Buffer.byteLength(contents, 'utf8') > AP_MAX_FILE_BYTES) {
    return { content: 'Error: file exceeds the size cap — split it into smaller files.', is_error: true };
  }
  if (counters.writes >= AP_MAX_WRITES) {
    return { content: 'Error: reached the per-run file limit. Wrap up and give your final report.', is_error: true };
  }

  let before = '';
  let isNew = false;
  try { before = await fsp.readFile(full, 'utf8'); } catch { isNew = true; }
  if (!isNew && before === contents) {
    return { content: 'No change — the file already has these exact contents.' };
  }

  const id = 'ap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  apSend({ type: 'diff_request', id, path: String(rel), before, after: contents, isNew });
  const decision = await apAwaitDecision(id);

  if (decision === 'stop') return { content: 'The user stopped the session.', is_error: true };
  if (decision !== 'approve') {
    apSend({ type: 'file_skipped', path: String(rel) });
    return { content: 'The user skipped this file. Do not propose it again; continue with the rest.' };
  }
  try {
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, contents, 'utf8');
    counters.writes += 1;
    counters.changed.push(String(rel));
    apSend({ type: 'file_written', path: String(rel) });
    return { content: 'Written successfully.' };
  } catch (e) {
    return { content: 'Error writing file: ' + ((e && e.message) || 'unknown'), is_error: true };
  }
}

async function runAutopilot(payload) {
  const dir = path.resolve(payload.path);
  autopilot = { dir, aborted: false, pending: null };
  const counters = { writes: 0, changed: [] };

  // Step 0 — safety snapshot before ANY write.
  const snap = await autopilotSnapshot(dir);
  apSend({ type: 'snapshot', mode: snap.mode, detail: snap.detail });
  if (autopilot.aborted) { apSend({ type: 'stopped' }); return { stopped: true }; }

  // Step 1 — gather context: the target's real files + the user's own style.
  const target = await gatherProjectContent(dir);
  const portfolio = await gatherPortfolioContext(payload.tools, payload.others);
  apSend({ type: 'context', sources: portfolio.sources });

  const client = anthropicClient(payload.apiKey);
  const model = typeof payload.model === 'string' && payload.model ? payload.model : AUTOPILOT_MODEL_FALLBACK;

  const userIntro =
    `Target project: "${payload.name}" (stack: ${(payload.tools || []).join(', ') || 'unknown'}).\n\n` +
    `=== The project's current files ===\n${target || '(nothing readable)'}\n\n` +
    (portfolio.text
      ? `=== Your existing style (patterns from your other projects — imitate these) ===\n${portfolio.text}\n\n`
      : '=== No matching sibling projects were found; infer the style from the target\'s own code. ===\n\n') +
    'Finish this project. Start with your short plan, then read only what you need and propose the file writes.';

  // System prompt is static → cache it so it isn't re-billed every turn.
  const system = [{ type: 'text', text: AUTOPILOT_SYSTEM, cache_control: { type: 'ephemeral' } }];
  const messages = [{ role: 'user', content: [{ type: 'text', text: userIntro }] }];

  const prices = apPrices(model);
  let costUsd = 0;
  let inTok = 0, outTok = 0, cacheReadTok = 0;

  let finalText = '';
  let capped = false;
  let nudged = false;
  for (let turn = 0; turn < AP_MAX_ITERATIONS; turn++) {
    if (autopilot.aborted) { apSend({ type: 'stopped' }); return { stopped: true }; }

    apMarkCache(messages); // rolling cache breakpoint on the newest message

    let response;
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: AP_MAX_TOKENS,
        system,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
        tools: AUTOPILOT_TOOLS,
        messages,
      });
      response = await stream.finalMessage();
    } catch (e) {
      apSend({ type: 'error', message: (e && e.message) || 'The model call failed.' });
      return { error: (e && e.message) || 'model error' };
    }

    // Track real spend and show it live.
    const u = response.usage || {};
    costUsd += apCostOf(u, prices);
    inTok += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    outTok += u.output_tokens || 0;
    cacheReadTok += u.cache_read_input_tokens || 0;
    apSend({ type: 'usage', inputTokens: inTok, outputTokens: outTok, cacheRead: cacheReadTok, costUsd });

    if (response.stop_reason === 'refusal') {
      apSend({ type: 'error', message: 'The model declined this request.' });
      return { error: 'refusal' };
    }

    // Surface any narration/plan text to the modal.
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        finalText = block.text;
        apSend({ type: 'assistant', text: block.text });
      }
    }

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // The model stopped without (further) tool calls. If it has written
      // nothing, it likely only analysed — nudge it ONCE to actually write.
      if (counters.writes === 0 && !nudged && !autopilot.aborted && costUsd < AP_COST_CAP_USD) {
        nudged = true;
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: [{ type: 'text', text: 'You have not created any files yet — analysing is not enough. Call the write_file tool NOW to implement the changes you described: one call per file, the full file contents. Do not reply with prose.' }] });
        continue;
      }
      break;
    }

    // Keep the full assistant turn (incl. thinking + tool_use) for replay.
    messages.push({ role: 'assistant', content: response.content });

    const results = [];
    for (const tu of toolUses) {
      if (autopilot.aborted) break;
      let out;
      if (tu.name === 'write_file') out = await apExecWrite(dir, tu.input, counters);
      else if (tu.name === 'read_file' || tu.name === 'list_dir') out = await apExecReadOnly(dir, tu.name, tu.input);
      else out = { content: 'Unknown tool.', is_error: true };
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.content, ...(out.is_error ? { is_error: true } : {}) });
    }

    if (autopilot.aborted) { apSend({ type: 'stopped' }); return { stopped: true }; }
    messages.push({ role: 'user', content: results });

    // Hard spend cap — stop a runaway before it drains the wallet.
    if (costUsd >= AP_COST_CAP_USD) { capped = true; break; }

    if (counters.writes >= AP_MAX_WRITES) {
      messages.push({ role: 'user', content: [{ type: 'text', text: 'You have reached the file limit for this pass. Stop writing and give your final report now.' }] });
    }
  }

  if (capped) {
    apSend({ type: 'stopped', reason: `Reached the ~$${AP_COST_CAP_USD.toFixed(2)} spend cap for one pass. ${counters.changed.length} file${counters.changed.length === 1 ? '' : 's'} written. Run Autopilot again to continue.` });
    return { stopped: true, filesChanged: counters.changed };
  }

  // Ask for a clean closing report in Vega's voice if the model ended on tools.
  const humanTasks = extractHumanTasks(finalText);
  apSend({ type: 'done', summary: finalText || 'Autopilot finished this pass.', filesChanged: counters.changed, humanTasks });
  return { summary: finalText, filesChanged: counters.changed, humanTasks };
}

/** Best-effort pull of a "remaining human tasks" list out of the final report. */
function extractHumanTasks(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const tasks = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*\S)/);
    if (m) tasks.push(m[1].replace(/\*\*/g, '').slice(0, 160));
  }
  return tasks.slice(0, 6);
}

ipcMain.handle('autopilot:start', async (_e, payload) => {
  if (!payload || payload.provider !== 'claude' || !payload.apiKey || typeof payload.path !== 'string') {
    return { error: 'Autopilot needs the Claude provider and an API key.' };
  }
  if (autopilot) return { error: 'An Autopilot session is already running.' };
  try {
    return await runAutopilot(payload);
  } catch (e) {
    apSend({ type: 'error', message: (e && e.message) || 'Autopilot crashed.' });
    return { error: (e && e.message) || 'crash' };
  } finally {
    autopilot = null;
  }
});

ipcMain.handle('autopilot:approve', (_e, id) => {
  if (autopilot && autopilot.pending && autopilot.pending.id === id) {
    const { resolve } = autopilot.pending; autopilot.pending = null; resolve('approve');
  }
  return true;
});

ipcMain.handle('autopilot:reject', (_e, id) => {
  if (autopilot && autopilot.pending && autopilot.pending.id === id) {
    const { resolve } = autopilot.pending; autopilot.pending = null; resolve('skip');
  }
  return true;
});

ipcMain.handle('autopilot:stop', () => {
  if (autopilot) {
    autopilot.aborted = true;
    if (autopilot.pending) { const { resolve } = autopilot.pending; autopilot.pending = null; resolve('stop'); }
  }
  return true;
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
