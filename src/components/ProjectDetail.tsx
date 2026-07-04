import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, FolderOpen, RefreshCw, Trash2, Sparkles, Calendar, Server, Wrench, CheckCircle2, Globe, Flame } from 'lucide-react';
import type { Project, Status } from '../types';
import { api } from '../api';
import { timeAgo, STATUS_LABEL } from '../util';

interface Props {
  project: Project;
  onClose: () => void;
  onChange: (patch: Partial<Project>) => void;
  onRefresh: () => Promise<void>;
  onDelete: () => void;
  onRevive: () => void;
}

const STATUSES: Status[] = ['unfinished', 'finished', 'dropped'];

export default function ProjectDetail({ project, onClose, onChange, onRefresh, onDelete, onRevive }: Props) {
  const [refreshing, setRefreshing] = useState(false);

  async function doRefresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
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
