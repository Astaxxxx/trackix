import type { DB, ScanResult, AiStatus, Status, AiConfig, ChatMsg, Audit } from './types';

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
