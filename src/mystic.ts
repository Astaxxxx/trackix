import type { Project, RevivalPlan } from './types';

/* ============================================================
   Trackix "mystic" engine — Revival Ritual + The Oracle.
   Pure heuristics: works offline, instant, free. The AI providers
   (Ollama / Claude) can replace the revival plan with a richer one.
   ============================================================ */

const DAY = 86400000;

export function daysSince(ms: number | null): number {
  return ms ? Math.round((Date.now() - ms) / DAY) : 9999;
}

/* ------------------------- Revival Ritual ------------------------- */

/** Why did this project most likely die? */
function guessStallReason(p: Project): string {
  const idle = daysSince(p.lastModified);
  if (!p.hasReadme && p.completion < 40) return 'It never got past the prototype stage — no README, no shape, just momentum that ran out.';
  if (p.todos > 8) return `It drowned in its own TODO list — ${p.todos} open markers scared you off every time you opened it.`;
  if (p.hosting === 'Local only' && p.completion >= 50) return 'It was nearly there but never shipped — with no deploy, there was no payoff to keep you going.';
  if (idle > 120) return `Life happened. ${idle} days of silence, and the context in your head evaporated.`;
  return 'The next step was never written down — so every return visit started with "wait, where was I?"';
}

/** Build the concrete path back to shipping, driven by the scanner signals. */
export function heuristicRevival(p: Project): RevivalPlan {
  const steps: string[] = [];

  // Always start by rebuilding context — the real killer of revived projects.
  steps.push('Open the folder and skim the entry point for 10 minutes — no editing, just remembering');

  if (!p.hasGit) steps.push('git init and commit what exists — give the project a heartbeat');
  if (!p.hasReadme) steps.push('Write a 5-line README: what it is, how to run it, what "done" means');
  if (p.completion < 50) steps.push('Cut the scope: cross out every feature that isn\'t needed for version 1');
  if (p.todos > 0) steps.push(`Burn down the ${p.todos} TODO/FIXME marker${p.todos === 1 ? '' : 's'} — delete the stale ones first`);
  if (!p.hasTests && p.completion >= 40) steps.push('Add one smoke test for the core flow so you can refactor without fear');
  if (p.hosting === 'Local only') steps.push('Ship it somewhere real — Vercel, a GitHub Release, anywhere with a link');

  steps.push('Move the card to Finished and take the win 🎉');

  return {
    stallReason: guessStallReason(p),
    summary: p.completion >= 50
      ? `${p.name} is ${p.completion}% of the way there — this is a rescue, not a rebuild.`
      : `${p.name} needs a smaller version 1 — shrink it until shipping feels easy.`,
    steps: steps.slice(0, 6).map((text) => ({ text, done: false })),
    generatedAt: Date.now(),
    aiTagged: false,
  };
}

/* --------------------------- The Oracle --------------------------- */

export interface OracleReading {
  project: Project;
  prophecy: string;
  reason: string;
  omens: { label: string; value: string }[];
  /** ranked runners-up so "consult again" can walk down the list */
  alternates: Project[];
}

function momentumBonus(idle: number): number {
  if (idle <= 2) return 30;
  if (idle <= 7) return 20;
  if (idle <= 30) return 10;
  return 0;
}

function score(p: Project): number {
  const idle = daysSince(p.lastModified);
  let s = p.completion * 0.6 + momentumBonus(idle);
  if (p.hasReadme) s += 5;
  if (p.hosting !== 'Local only') s += 5;
  if (idle > 90) s -= 10;
  if (p.revival && p.revival.steps.some((st) => !st.done)) s += 12; // an open revival path calls loudly
  return s;
}

/** Small deterministic hash so the same project gets the same prophecy phrasing. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function prophecyFor(p: Project): { prophecy: string; reason: string } {
  const idle = daysSince(p.lastModified);
  const nearlyDone = p.completion >= 65;
  const hot = idle <= 7;

  const pools: Record<string, string[]> = {
    nearly: [
      `${p.name} stands at the gate. One push, and it walks through.`,
      `The final stretch of ${p.name} is shorter than it looks. Finish it.`,
      `${p.name} is ${p.completion}% forged — the blade only needs an edge.`,
    ],
    hot: [
      `The embers of ${p.name} still glow. Strike now, while the metal is warm.`,
      `Your hands remember ${p.name}. Return before the memory cools.`,
      `${p.name} moved only days ago — momentum is a gift; do not waste it.`,
    ],
    revive: [
      `${p.name} whispers from the graveyard. It is not done with you.`,
      `Of all your fallen works, ${p.name} is the one worth raising.`,
      `${p.name} sleeps, but its bones are strong. Wake it.`,
    ],
  };

  const key = nearlyDone ? 'nearly' : hot ? 'hot' : 'revive';
  const pool = pools[key];
  const prophecy = pool[hash(p.id + p.name) % pool.length];

  const reason = nearlyDone
    ? `Closest to the finish line of everything on your board (${p.completion}% complete).`
    : hot
      ? `You touched it ${idle === 0 ? 'today' : idle === 1 ? 'yesterday' : idle + ' days ago'} — the context is still in your head.`
      : `Highest revival value among your stalled work — real progress already exists.`;

  return { prophecy, reason };
}

/** Consult the Oracle: rank everything unfinished (and rescue-worthy dropped). */
export function consultOracle(projects: Project[]): OracleReading | null {
  const candidates = projects.filter((p) => p.status === 'unfinished');
  // If nothing is in progress, the Oracle reaches into the graveyard.
  const pool = candidates.length > 0
    ? candidates
    : projects.filter((p) => p.status === 'dropped');
  if (pool.length === 0) return null;

  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  const chosen = ranked[0];
  const idle = daysSince(chosen.lastModified);
  const { prophecy, reason } = prophecyFor(chosen);

  return {
    project: chosen,
    prophecy,
    reason,
    omens: [
      { label: 'Path to done', value: `${chosen.completion}%` },
      { label: 'Momentum', value: idle > 999 ? 'unknown' : idle === 0 ? 'today' : `${idle}d ago` },
      { label: 'Open marks', value: `${chosen.todos} TODO${chosen.todos === 1 ? '' : 's'}` },
    ],
    alternates: ranked.slice(1),
  };
}

/** Re-consult: rotate the previous choice to the back of the queue. */
export function nextReading(prev: OracleReading): OracleReading | null {
  if (prev.alternates.length === 0) return null;
  const [next, ...rest] = prev.alternates;
  const idle = daysSince(next.lastModified);
  const { prophecy, reason } = prophecyFor(next);
  return {
    project: next,
    prophecy,
    reason,
    omens: [
      { label: 'Path to done', value: `${next.completion}%` },
      { label: 'Momentum', value: idle > 999 ? 'unknown' : idle === 0 ? 'today' : `${idle}d ago` },
      { label: 'Open marks', value: `${next.todos} TODO${next.todos === 1 ? '' : 's'}` },
    ],
    alternates: [...rest, prev.project],
  };
}
