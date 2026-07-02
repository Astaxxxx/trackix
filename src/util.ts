/** Normalise a path so the same folder can't be added twice
 *  (case-insensitive, trailing slash + backslash agnostic). */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function uid(): string {
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function timeAgo(ms: number | null): string {
  if (!ms) return 'unknown';
  const diff = Date.now() - ms;
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export const STATUS_LABEL: Record<string, string> = {
  unfinished: 'In Progress',
  finished: 'Finished',
  dropped: 'Dropped',
};
