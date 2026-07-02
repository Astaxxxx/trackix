export type Status = 'unfinished' | 'finished' | 'dropped';

/** What the scanner returns for a folder it analysed. */
export interface ScanResult {
  path: string;
  name: string;
  tools: string[];
  hosting: string;
  lastModified: number | null;
  todos: number;
  hasReadme: boolean;
  hasTests: boolean;
  hasGit: boolean;
  completion: number; // 0-100
  suggestedStatus: Status;
  suggestedReason: string;
  readmeExcerpt: string;
}

/** A project the user is tracking. Superset of ScanResult + user fields. */
export interface Project extends ScanResult {
  id: string;
  status: Status;
  why: string; // why you created it (user-written)
  notes: string;
  addedAt: number;
  pinned?: boolean;
  aiTagged?: boolean; // suggestion came from the local AI, not the heuristic
}

/** Optional local-AI (Ollama) settings. Everything stays on-device. */
export interface Settings {
  aiEnabled: boolean;
  aiModel: string;
  buddyEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = { aiEnabled: false, aiModel: 'llama3.2', buddyEnabled: false };

export interface AiStatus {
  running: boolean;
  models: string[];
  error?: string;
}

export interface DB {
  version: 1;
  projects: Project[];
  lastRoot?: string;
  settings?: Settings;
}
