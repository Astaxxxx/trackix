import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, FolderOpen, RefreshCw, Trash2, Sparkles, Calendar, Server, Wrench, CheckCircle2, Globe, Flame, Zap, ScanSearch, Loader2, Rocket } from 'lucide-react';
import type { AiConfig, Project, Status } from '../types';
import { api } from '../api';
import { timeAgo, STATUS_LABEL } from '../util';

interface Props {
  project: Project;
  ai: AiConfig | null;
  onClose: () => void;
  onChange: (patch: Partial<Project>) => void;
  onRefresh: () => Promise<void>;
  onDelete: () => void;
  onRevive: () => void;
  onWarp: () => void;
  onAutopilot: () => void;
}

const STATUSES: Status[] = ['unfinished', 'finished', 'dropped'];

function fmtFocus(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ProjectDetail({ project, ai, onClose, onChange, onRefresh, onDelete, onRevive, onWarp, onAutopilot }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);

  async function doRefresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  async function deepScan() {
    if (!ai) return;
    setScanning(true); setScanErr(null);
    const out = await api.aiDeepScan(ai, project.path, project.name);
    setScanning(false);
    if (out?.audit) onChange({ audit: { ...out.audit, scannedAt: Date.now() } });
    else setScanErr(out?.error || 'Deep scan failed.');
  }

  function toggleStep(i: number) {
    if (!project.revival) return;
    const steps = project.revival.steps.map((s, idx) => (idx === i ? { ...s, done: !s.done } : s));
    onChange({ revival: { ...project.revival, steps } });
  }

  const revivalDone = project.revival ? project.revival.steps.filter((s) => s.done).length : 0;

  return (
    <div className="overlay" onClick={onClose}>
      <motion.div
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        initial={{ x: 480 }}
        animate={{ x: 0 }}
        exit={{ x: 480 }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      >
        <div className="detail-head">
          <div>
            <div className="detail-name">{project.name}</div>
            <div className="card-host" style={{ marginTop: 6 }}>
              <Globe size={12} /> {project.hosting}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => api.openPath(project.path)}>
            <FolderOpen size={15} /> Open folder
          </button>
          <button className="btn" onClick={doRefresh} title="Re-scan this project">
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> Refresh
          </button>
        </div>

        {/* Warp — deep focus session */}
        <button
          className="btn"
          style={{ width: '100%', justifyContent: 'center', marginTop: 10, borderColor: 'var(--red)', color: 'var(--red-deep)' }}
          onClick={onWarp}
          title="Start a deep-focus session on this project"
        >
          <Zap size={15} /> Warp in — deep focus
        </button>

        {(project.focusMinutes || 0) > 0 && (
          <div className="focus-stat">
            <Zap size={18} style={{ color: 'var(--red)', flexShrink: 0 }} />
            <div>
              <div className="v">{fmtFocus(project.focusMinutes || 0)} focused</div>
              <div className="k">across {project.focusSessions || 0} session{project.focusSessions === 1 ? '' : 's'} · last {timeAgo(project.lastFocus || null)}</div>
            </div>
          </div>
        )}

        {/* Autopilot — portfolio-aware agentic build (Claude only) */}
        {ai && ai.provider === 'claude' && !!ai.apiKey && (
          <button
            className="btn btn-autopilot"
            style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
            onClick={onAutopilot}
            title="Let Autopilot finish this project in your own style — every write needs your approval"
          >
            <Rocket size={15} /> Autopilot — finish it for me
          </button>
        )}
        {ai && ai.provider === 'ollama' && (
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 8, lineHeight: 1.5 }}>
            <Rocket size={11} style={{ verticalAlign: -1 }} /> Autopilot needs the Claude provider (strong tool-use) — switch in Settings to unlock it.
          </div>
        )}

        {project.lastAutopilot && (
          <div className="suggestion" style={{ marginTop: 10 }}>
            <Rocket size={18} style={{ color: 'var(--red)', flexShrink: 0 }} />
            <span>
              <span className="badge">Autopilot · {timeAgo(project.lastAutopilot.at)}</span><br />
              {project.lastAutopilot.filesChanged.length} file{project.lastAutopilot.filesChanged.length === 1 ? '' : 's'} changed{project.lastAutopilot.filesChanged.length > 0 && <> — {project.lastAutopilot.filesChanged.slice(0, 3).join(', ')}{project.lastAutopilot.filesChanged.length > 3 ? '…' : ''}</>}
            </span>
          </div>
        )}

        {/* Deep Scan — AI reads the real files */}
        {ai && (
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
            onClick={deepScan}
            disabled={scanning}
            title="Let the AI read this project's real files and audit it"
          >
            {scanning ? <Loader2 size={15} className="spin" /> : <ScanSearch size={15} />}
            {scanning ? 'Reading the code…' : project.audit ? 'Re-scan with AI' : 'Deep scan with AI'}
          </button>
        )}
        {scanErr && <div style={{ fontSize: 12, color: 'var(--red-deep)', marginTop: 6 }}>{scanErr}</div>}

        {project.audit && (
          <>
            <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ScanSearch size={13} style={{ color: 'var(--red)' }} /> Deep Scan report
              <span className="ai-chip"><Sparkles size={9} /> AI</span>
            </div>
            <div className="audit-box">
              <div className="audit-summary">{project.audit.summary}</div>
              {project.audit.health && <div className="audit-health">{project.audit.health}</div>}
              {project.audit.risks.length > 0 && <>
                <div className="audit-h">Risks & gaps</div>
                <ul className="audit-list risk">{project.audit.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </>}
              {project.audit.nextActions.length > 0 && <>
                <div className="audit-h">Top next moves</div>
                <ul className="audit-list">{project.audit.nextActions.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </>}
            </div>
          </>
        )}

        {/* Revival Ritual — for anything that isn't finished yet */}
        {project.status !== 'finished' && !project.revival && (
          <button
            className="btn"
            style={{ width: '100%', justifyContent: 'center', marginTop: 10, borderColor: 'var(--red)', color: 'var(--red-deep)' }}
            onClick={onRevive}
            title="Generate a concrete path from stalled to shipped"
          >
            <Flame size={15} /> {project.status === 'dropped' ? 'Revive this project' : 'Forge a revival path'}
          </button>
        )}

        {/* AI / heuristic suggestion */}
        <div className="suggestion" style={{ marginTop: 18 }}>
          <Sparkles size={18} style={{ color: 'var(--violet-bright)', flexShrink: 0 }} />
          <span>
            <span className="badge">Suggested: {STATUS_LABEL[project.suggestedStatus]}</span>
            {project.aiTagged && <span className="ai-chip"><Sparkles size={9} /> AI</span>}<br />
            {project.suggestedReason}
          </span>
        </div>

        {/* status switch */}
        <div className="section-title">Status</div>
        <div className="status-switch">
          {STATUSES.map((s) => (
            <button
              key={s}
              className={`${s} ${project.status === s ? 'active' : ''}`}
              onClick={() => onChange({ status: s })}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {/* revival path checklist */}
        {project.revival && (
          <>
            <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Flame size={13} style={{ color: 'var(--red)' }} /> Revival path · {revivalDone}/{project.revival.steps.length}
              {project.revival.aiTagged && <span className="ai-chip"><Sparkles size={9} /> AI</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {project.revival.steps.map((s, i) => (
                <label key={i} className={`revival-check ${s.done ? 'done' : ''}`}>
                  <input type="checkbox" checked={s.done} onChange={() => toggleStep(i)} />
                  <span>{s.text}</span>
                </label>
              ))}
            </div>
            {revivalDone === project.revival.steps.length && (
              <div className="suggestion" style={{ marginTop: 10 }}>
                <CheckCircle2 size={18} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                <span><b>The revival is complete.</b> Mark it Finished and take the win.</span>
              </div>
            )}
          </>
        )}

        {/* info cards — "tools used / where hosted / etc." */}
        <div className="section-title">Project info</div>
        <div className="info-grid">
          <div className="info-cell">
            <div className="k"><Wrench size={11} style={{ verticalAlign: -1 }} /> Tools used</div>
            <div className="v">{project.tools.length ? project.tools.join(', ') : '—'}</div>
          </div>
          <div className="info-cell">
            <div className="k"><Server size={11} style={{ verticalAlign: -1 }} /> Hosted</div>
            <div className="v">{project.hosting}</div>
          </div>
          <div className="info-cell">
            <div className="k"><CheckCircle2 size={11} style={{ verticalAlign: -1 }} /> Completion</div>
            <div className="v">{project.completion}%</div>
          </div>
          <div className="info-cell">
            <div className="k"><Calendar size={11} style={{ verticalAlign: -1 }} /> Last worked on</div>
            <div className="v">{timeAgo(project.lastModified)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-faint)', flexWrap: 'wrap' }}>
          <span>{project.hasGit ? '✓ Git repo' : '○ No git'}</span>
          <span>{project.hasReadme ? '✓ README' : '○ No README'}</span>
          <span>{project.hasTests ? '✓ Tests' : '○ No tests'}</span>
          <span>{project.todos} TODO marker{project.todos === 1 ? '' : 's'}</span>
        </div>

        {/* why + notes */}
        <div className="field" style={{ marginTop: 20 }}>
          <label>Why you created it</label>
          <textarea
            className="textarea"
            placeholder="e.g. To track parking-ticket appeals and auto-generate letters…"
            value={project.why}
            onChange={(e) => onChange({ why: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea
            className="textarea"
            placeholder="Anything you want to remember — next steps, ideas, blockers…"
            value={project.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
          />
        </div>

        {project.path && (
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 14, wordBreak: 'break-all' }}>
            {project.path}
          </div>
        )}

        <button
          className="btn btn-ghost"
          style={{ marginTop: 18, color: 'var(--magenta)' }}
          onClick={onDelete}
        >
          <Trash2 size={15} /> Remove from tracker
        </button>
      </motion.div>
    </div>
  );
}
