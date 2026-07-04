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

/** One step on a project's Revival Path. */
export interface RevivalStep {
  text: string;
  done: boolean;
}

/** The plan produced by the Revival Ritual for a stalled/dropped project. */
export interface RevivalPlan {
  stallReason: string;   // why the project most likely died
  summary: string;       // one-line rally cry
  steps: RevivalStep[];  // concrete path back to shipping
  generatedAt: number;
  aiTagged: boolean;     // came from an AI provider vs the built-in heuristic
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
  revival?: RevivalPlan; // set once the Revival Ritual has been performed
  focusMinutes?: number;  // total real minutes spent in Warp focus sessions
  focusSessions?: number; // how many focus sessions logged
  lastFocus?: number;     // timestamp of the most recent focus session
}

/** AI settings. Ollama runs fully on-device; the Claude API sends project
 *  metadata (name, tools, README excerpt) to Anthropic using YOUR key. */
export type AiProvider = 'ollama' | 'claude';

export interface Settings {
  aiEnabled: boolean;
  aiProvider: AiProvider;
  aiModel: string;       // Ollama model tag
  claudeApiKey: string;  // stored locally in the Trackix DB only
  claudeModel: string;
  buddyEnabled: boolean;
  buddyStartup: boolean; // launch the floating avatar when the laptop boots
}

export const DEFAULT_SETTINGS: Settings = {
  aiEnabled: false,
  aiProvider: 'ollama',
  aiModel: 'llama3.2',
  claudeApiKey: '',
  claudeModel: 'claude-opus-4-8',
  buddyEnabled: false, // opt-in: never floats or auto-starts until the user turns it on
  buddyStartup: false, // opt-in: never floats or auto-starts until the user turns it on
};

/** Everything the AI backend needs to run one classification. */
export interface AiConfig {
  provider: AiProvider;
  model: string;   // ollama tag or claude model id
  apiKey?: string; // claude only
}

export interface AiStatus {
  running: boolean;
  models: string[];
  error?: string;
}

export interface DB {
  /** 1 = original schema · 2 = added AI provider + buddy settings */
  version: number;
  projects: Project[];
  lastRoot?: string;
  settings?: Settings;
}
