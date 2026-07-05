import type { DB, ScanResult, AiStatus, Status, AiConfig, ChatMsg, Audit, AutopilotEvent, AutopilotStart } from './types';

/**
 * Single data-access layer. In Electron it talks to the secure `window.astax`
 * bridge. In a plain browser (used for UI development / preview) it falls back
 * to a localStorage-backed mock with sample scan data, so the whole UI is
 * testable without packaging the desktop app.
 */

interface AstaxBridge {
  isDesktop: true;
  platform: string;
  loadDB(): Promise<DB | null>;
  saveDB(data: DB): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  scanProjects(root: string): Promise<{ root: string; projects: ScanResult[] }>;
  rescanOne(dir: string): Promise<ScanResult | null>;
  openPath(p: string): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  aiStatus(cfg: AiConfig): Promise<AiStatus>;
  aiRefine(payload: AiPayload): Promise<{ status: Status; reason: string } | null>;
  aiRevive(payload: AiPayload): Promise<{ stallReason: string; summary: string; steps: string[] } | null>;
  aiChat(payload: AiConfig & { board: unknown; messages: ChatMsg[] }): Promise<{ text: string; error?: string } | null>;
  aiDeepScan(payload: AiConfig & { path: string; name: string }): Promise<{ audit?: Audit; error?: string } | null>;
  autopilotStart(payload: AutopilotStart): Promise<{ summary?: string; filesChanged?: string[]; humanTasks?: string[]; stopped?: boolean; error?: string }>;
  autopilotApprove(id: string): Promise<boolean>;
  autopilotReject(id: string): Promise<boolean>;
  autopilotStop(): Promise<boolean>;
  onAutopilot(cb: (ev: AutopilotEvent) => void): () => void;
  setBuddy(enabled: boolean): Promise<boolean>;
  setBuddyStartup(enabled: boolean): Promise<boolean>;
  onBuddyDismissed(cb: () => void): () => void;
}

/** What we hand the model to classify a project. */
interface AiPayload extends AiConfig {
  name: string;
  tools: string[];
  hosting: string;
  completion: number;
  daysSinceEdit: number;
  todos: number;
  hasReadme: boolean;
  hasTests: boolean;
  hasGit: boolean;
  readmeExcerpt: string;
}

declare global {
  interface Window { astax?: AstaxBridge }
}

export const isDesktop = typeof window !== 'undefined' && !!window.astax;

/* ----------------------------- mock (browser) ----------------------------- */
const MOCK_KEY = 'astax-tracker-db';

const SAMPLE: ScanResult[] = [
  {
    path: 'C:/Users/you/Downloads/llmscan', name: 'llmscan',
    tools: ['Python', 'Docker'], hosting: 'GitHub', lastModified: Date.now() - 2 * 86400000,
    todos: 9, hasReadme: true, hasTests: true, hasGit: true, completion: 58,
    suggestedStatus: 'unfinished', suggestedReason: '9 TODO/FIXME markers — still has open work.',
    readmeExcerpt: 'OWASP LLM Top-10 red-team scanner for LLM apps. Canary-leak detection, Typer CLI...',
  },
  {
    path: 'C:/Users/you/Downloads/dontpaythat', name: 'dontpaythat',
    tools: ['Next.js', 'TypeScript', 'Stripe', 'Claude API'], hosting: 'Vercel',
    lastModified: Date.now() - 17 * 86400000, todos: 1, hasReadme: true, hasTests: false,
    completion: 84, hasGit: true, suggestedStatus: 'finished',
    suggestedReason: 'Has a README, deploy config and a clean setup — looks shipped.',
    readmeExcerpt: 'UK parking ticket appeal SaaS. Generates tailored appeal letters with AI...',
  },
  {
    path: 'C:/Users/you/Downloads/manhwa-edit', name: 'manhwa-edit',
    tools: ['Node.js'], hosting: 'Local only', lastModified: Date.now() - 200 * 86400000,
    todos: 4, hasReadme: false, hasTests: false, hasGit: false, completion: 24,
    suggestedStatus: 'dropped', suggestedReason: 'Untouched for 200 days and looks incomplete.',
    readmeExcerpt: '',
  },
];

function mockLoad(): DB | null {
  const raw = localStorage.getItem(MOCK_KEY);
  return raw ? (JSON.parse(raw) as DB) : null;
}
function mockSave(db: DB) { localStorage.setItem(MOCK_KEY, JSON.stringify(db)); }

/* ---- Autopilot browser mock (so the ArchitectModal is testable in preview) ---- */
const mockAutopilotListeners = new Set<(ev: AutopilotEvent) => void>();
let mockDecide: ((d: 'approve' | 'skip' | 'stop') => void) | null = null;
function mockEmit(ev: AutopilotEvent) { mockAutopilotListeners.forEach((cb) => cb(ev)); }
function mockWait(id: string): Promise<'approve' | 'skip' | 'stop'> {
  return new Promise((resolve) => { mockDecide = (d) => { mockDecide = null; resolve(d); }; void id; });
}
function mockAutopilotDecide(d: 'approve' | 'skip' | 'stop') { if (mockDecide) mockDecide(d); return true; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mockAutopilotStart(payload: AutopilotStart) {
  await sleep(400);
  mockEmit({ type: 'snapshot', mode: 'commit', detail: 'Committed a snapshot — run `git reset --hard HEAD~1` to undo everything Autopilot writes.' });
  await sleep(500);
  mockEmit({ type: 'context', sources: payload.others.slice(0, 2).map((o) => o.name) });
  await sleep(500);
  mockEmit({ type: 'assistant', text: `Here's my plan for ${payload.name}:\n1. Wire the API client to the UI\n2. Add the missing error states\n3. Fill in the empty route handler` });
  mockEmit({ type: 'usage', inputTokens: 21000, outputTokens: 900, cacheRead: 0, costUsd: 0.13 });
  await sleep(500);
  mockEmit({ type: 'tool', tool: 'list_dir', path: 'src' });
  await sleep(400);
  mockEmit({ type: 'tool', tool: 'read_file', path: 'src/App.tsx' });
  mockEmit({ type: 'usage', inputTokens: 24000, outputTokens: 2400, cacheRead: 19000, costUsd: 0.21 });
  await sleep(600);
  const changed: string[] = [];
  const files: { path: string; before: string; after: string; isNew: boolean }[] = [
    { path: 'src/api.ts', before: '', after: 'export async function getData() {\n  const res = await fetch("/api/data");\n  return res.json();\n}\n', isNew: true },
    { path: 'src/App.tsx', before: 'export default function App() {\n  return <div>TODO</div>;\n}\n', after: 'import { getData } from "./api";\n\nexport default function App() {\n  // wired up in your style\n  return <div className="app">Ready</div>;\n}\n', isNew: false },
  ];
  for (const f of files) {
    const id = 'mock_' + f.path;
    mockEmit({ type: 'diff_request', id, path: f.path, before: f.before, after: f.after, isNew: f.isNew });
    const d = await mockWait(id);
    if (d === 'stop') { mockEmit({ type: 'stopped' }); return { stopped: true }; }
    if (d === 'approve') { mockEmit({ type: 'file_written', path: f.path }); changed.push(f.path); }
    else mockEmit({ type: 'file_skipped', path: f.path });
    mockEmit({ type: 'usage', inputTokens: 26000, outputTokens: 4200 + changed.length * 1500, cacheRead: 40000, costUsd: 0.28 + changed.length * 0.06 });
    await sleep(300);
  }
  const humanTasks = ['Add your API keys to the environment', 'Run it locally and click through the flow', 'Deploy when it looks right'];
  mockEmit({ type: 'done', summary: `Nice — I moved ${payload.name} forward. I wired the API client into your app and filled the stub, matching the patterns from ${payload.others[0]?.name || 'your other work'}. A few human things remain.`, filesChanged: changed, humanTasks });
  return { summary: 'done', filesChanged: changed, humanTasks };
}

/* ------------------------------- public API ------------------------------- */
export const api = {
  platform: isDesktop ? window.astax!.platform : 'web',

  async loadDB(): Promise<DB | null> {
    return isDesktop ? window.astax!.loadDB() : mockLoad();
  },
  async saveDB(db: DB): Promise<boolean> {
    if (isDesktop) return window.astax!.saveDB(db);
    mockSave(db); return true;
  },
  async pickFolder(): Promise<string | null> {
    if (isDesktop) return window.astax!.pickFolder();
    return 'C:/Users/you/Downloads (demo)';
  },
  async scanProjects(root: string): Promise<{ root: string; projects: ScanResult[] }> {
    if (isDesktop) return window.astax!.scanProjects(root);
    await new Promise((r) => setTimeout(r, 700)); // simulate scan time
    return { root, projects: SAMPLE };
  },
  async rescanOne(dir: string): Promise<ScanResult | null> {
    if (isDesktop) return window.astax!.rescanOne(dir);
    const found = SAMPLE.find((s) => s.path === dir) ?? null;
    return found ? { ...found, lastModified: Date.now() } : null;
  },
  async openPath(p: string) {
    if (isDesktop) return window.astax!.openPath(p);
    return false;
  },
  async openExternal(url: string) {
    if (isDesktop) return window.astax!.openExternal(url);
    window.open(url, '_blank'); return true;
  },

  /* ---- local AI (Ollama) ---- */
  async aiStatus(cfg: AiConfig): Promise<AiStatus> {
    if (isDesktop) return window.astax!.aiStatus(cfg);
    return { running: false, models: [], error: 'AI runs only in the desktop app.' };
  },

  /** Ask the configured AI to classify a scanned project. Returns null if AI is
   *  unavailable, so callers transparently keep the heuristic suggestion. */
  async aiRefine(scan: ScanResult, cfg: AiConfig): Promise<{ status: Status; reason: string } | null> {
    const daysSinceEdit = scan.lastModified ? Math.round((Date.now() - scan.lastModified) / 86400000) : 9999;
    const payload = {
      ...cfg, name: scan.name, tools: scan.tools, hosting: scan.hosting,
      completion: scan.completion, daysSinceEdit, todos: scan.todos,
      hasReadme: scan.hasReadme, hasTests: scan.hasTests, hasGit: scan.hasGit,
      readmeExcerpt: scan.readmeExcerpt,
    };
    if (isDesktop) return window.astax!.aiRefine(payload);
    return null;
  },

  /** Ask the configured AI for a revival plan. Returns null when unavailable —
   *  the caller falls back to the heuristic plan from mystic.ts. */
  async aiRevive(scan: ScanResult, cfg: AiConfig): Promise<{ stallReason: string; summary: string; steps: string[] } | null> {
    const daysSinceEdit = scan.lastModified ? Math.round((Date.now() - scan.lastModified) / 86400000) : 9999;
    const payload = {
      ...cfg, name: scan.name, tools: scan.tools, hosting: scan.hosting,
      completion: scan.completion, daysSinceEdit, todos: scan.todos,
      hasReadme: scan.hasReadme, hasTests: scan.hasTests, hasGit: scan.hasGit,
      readmeExcerpt: scan.readmeExcerpt,
    };
    if (isDesktop) return window.astax!.aiRevive(payload);
    return null;
  },

  /** Chat with Vega, grounded in a compact summary of the whole board. */
  async aiChat(cfg: AiConfig, board: unknown, messages: ChatMsg[]): Promise<{ text: string; error?: string } | null> {
    if (isDesktop) return window.astax!.aiChat({ ...cfg, board, messages });
    return { text: 'Vega only runs in the desktop app.' };
  },

  /** Deep-scan a project's real files for an AI audit. */
  async aiDeepScan(cfg: AiConfig, path: string, name: string): Promise<{ audit?: Audit; error?: string } | null> {
    if (isDesktop) return window.astax!.aiDeepScan({ ...cfg, path, name });
    return { error: 'Deep Scan only runs in the desktop app.' };
  },

  /* ---- Autopilot ---- */
  async autopilotStart(payload: AutopilotStart) {
    if (isDesktop) return window.astax!.autopilotStart(payload);
    return mockAutopilotStart(payload);
  },
  async autopilotApprove(id: string) {
    if (isDesktop) return window.astax!.autopilotApprove(id);
    return mockAutopilotDecide('approve');
  },
  async autopilotReject(id: string) {
    if (isDesktop) return window.astax!.autopilotReject(id);
    return mockAutopilotDecide('skip');
  },
  async autopilotStop() {
    if (isDesktop) return window.astax!.autopilotStop();
    return mockAutopilotDecide('stop');
  },
  onAutopilot(cb: (ev: AutopilotEvent) => void): () => void {
    if (isDesktop) return window.astax!.onAutopilot(cb);
    mockAutopilotListeners.add(cb);
    return () => mockAutopilotListeners.delete(cb);
  },

  /* ---- desktop buddy ---- */
  async setBuddy(enabled: boolean): Promise<boolean> {
    if (isDesktop) return window.astax!.setBuddy(enabled);
    return false; // only available in the desktop app
  },
  async setBuddyStartup(enabled: boolean): Promise<boolean> {
    if (isDesktop) return window.astax!.setBuddyStartup(enabled);
    return false;
  },
  onBuddyDismissed(cb: () => void): () => void {
    if (isDesktop) return window.astax!.onBuddyDismissed(cb);
    return () => {};
  },
};
