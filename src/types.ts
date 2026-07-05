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
  audit?: Audit;          // latest Deep Scan report
  lastAutopilot?: AutopilotRun; // summary of the most recent Autopilot pass
}

/** A record of one Autopilot run, stored on the project. */
export interface AutopilotRun {
  at: number;
  filesChanged: string[];
  summary: string;
  humanTasks: string[];
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

/** A message in a Vega conversation. */
export interface ChatMsg { role: 'user' | 'assistant'; content: string; }

/** Deep Scan audit of a project's real files. */
export interface Audit {
  summary: string;
  health: string;
  risks: string[];
  nextActions: string[];
  scannedAt?: number;
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

/* ------------------------------ Autopilot ------------------------------ */
/**
 * Autopilot finishes an unfinished project by generating the missing code in
 * the user's own style — reusing patterns from their OTHER tracked projects —
 * with a git snapshot first and a per-file diff-approval gate before any write.
 * The agent loop runs in the main process (Claude tool-use); these events stream
 * to the renderer over IPC so the ArchitectModal can show live progress.
 */
export type AutopilotEvent =
  /** Git safety snapshot result before any write. */
  | { type: 'snapshot'; mode: 'commit' | 'clean' | 'init' | 'none'; detail: string }
  /** Which of the user's other projects seeded the "your style" context. */
  | { type: 'context'; sources: string[] }
  /** Free-form narration / plan text from the model. */
  | { type: 'assistant'; text: string }
  /** The agent read or listed a file/dir (read-only tool). */
  | { type: 'tool'; tool: 'read_file' | 'list_dir'; path: string }
  /** A proposed write is awaiting the user's Approve / Skip decision. */
  | { type: 'diff_request'; id: string; path: string; before: string; after: string; isNew: boolean }
  | { type: 'file_written'; path: string }
  | { type: 'file_skipped'; path: string }
  /** Live running spend so the user always sees the cost as it happens. */
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheRead: number; costUsd: number }
  /** Final report, in Vega's voice. */
  | { type: 'done'; summary: string; filesChanged: string[]; humanTasks: string[] }
  | { type: 'stopped'; reason?: string }
  | { type: 'error'; message: string };

/** What the renderer hands the main process to launch an Autopilot session. */
export interface AutopilotStart {
  provider: AiProvider;
  model: string;
  apiKey?: string;
  path: string;   // the target project's folder
  name: string;   // the target project's name
  tools: string[]; // the target's primary stack (for portfolio matching)
  /** The user's OTHER tracked projects — the portfolio we mine for their style. */
  others: { name: string; path: string; tools: string[] }[];
}
