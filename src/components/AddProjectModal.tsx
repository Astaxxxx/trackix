import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, Loader2, X, Sparkles, ShieldCheck, Plus } from 'lucide-react';
import type { ScanResult, Status, AiConfig } from '../types';
import { api } from '../api';
import { STATUS_LABEL, normPath } from '../util';

export type ScanResultTagged = ScanResult & { aiTagged?: boolean };

interface Props {
  existingPaths: Set<string>;
  ai: AiConfig | null;
  onClose: () => void;
  onAdd: (results: ScanResultTagged[]) => void;
}

export default function AddProjectModal({ existingPaths, ai, onClose, onAdd }: Props) {
  const [root, setRoot] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [results, setResults] = useState<ScanResultTagged[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scanned, setScanned] = useState(false);

  async function pickAndScan() {
    const folder = await api.pickFolder();
    if (!folder) return;
    setRoot(folder);
    setScanning(true);
    setScanned(false);
    try {
      const { projects } = await api.scanProjects(folder);
      const fresh: ScanResultTagged[] = projects.filter((p) => !existingPaths.has(normPath(p.path)));
      setResults(fresh);
      setPicked(new Set(fresh.map((p) => p.path)));
      setScanning(false);
      setScanned(true);

      // optional: let the local AI refine each suggestion in place
      if (ai && fresh.length) {
        setAiBusy(true);
        for (const r of fresh) {
          const out = await api.aiRefine(r, ai);
          if (out) {
            setResults((prev) => prev.map((x) =>
              x.path === r.path ? { ...x, suggestedStatus: out.status, suggestedReason: out.reason, aiTagged: true } : x));
          }
        }
        setAiBusy(false);
      }
    } finally {
      setScanning(false);
      setScanned(true);
    }
  }

  function toggle(p: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }

  function confirm() {
    onAdd(results.filter((r) => picked.has(r.path)));
  }

  return (
    <div className="modal" onClick={onClose}>
      <motion.div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="modal-title">Add projects</div>
            <div className="modal-sub">
              Pick a folder (e.g. your <b>Downloads</b> or a <b>projects</b> folder). Trackix scans the
              folders inside it, detects the tools and how finished each looks — then you choose which to track.
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="suggestion" style={{ marginTop: 16 }}>
          <ShieldCheck size={18} style={{ color: 'var(--ok)', flexShrink: 0 }} />
          <span>
            <b>Your privacy:</b> Trackix only looks inside the folder you choose. It never scans your whole
            computer or system files, and nothing ever leaves your device.
          </span>
        </div>

        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} onClick={pickAndScan}>
          {scanning ? <Loader2 size={16} className="spin" /> : <FolderOpen size={16} />}
          {scanning ? 'Scanning…' : root ? 'Choose a different folder' : 'Choose folder to scan'}
        </button>

        {root && <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8, wordBreak: 'break-all' }}>{root}</div>}

        <AnimatePresence>
          {scanned && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: 18 }}>
              {results.length === 0 ? (
                <div className="empty-col">
                  No new projects found here. Either they’re already tracked, or this folder has no
                  recognisable projects (a project usually has a <code>.git</code>, <code>package.json</code>, etc.).
                </div>
              ) : (
                <>
                  <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={13} /> Found {results.length} — {picked.size} selected
                    {aiBusy && <span style={{ color: 'var(--red-deep)', display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                      <Loader2 size={12} className="spin" /> AI analysing…
                    </span>}
                  </div>
                  <div className="scan-row">
                    {results.map((r) => (
                      <label key={r.path} className="scan-result" style={{ cursor: 'pointer', opacity: picked.has(r.path) ? 1 : 0.55 }}>
                        <input
                          type="checkbox"
                          className="chk"
                          checked={picked.has(r.path)}
                          onChange={() => toggle(r.path)}
                        />
                        <div className="grow">
                          <div className="nm">{r.name}</div>
                          <div className="sub">
                            {r.tools.slice(0, 3).join(' · ') || 'No tools detected'} · {r.completion}% · {r.suggestedReason}
                          </div>
                        </div>
                        <span className={`sugg-tag ${r.suggestedStatus}`}>
                          {r.aiTagged && '✦ '}{STATUS_LABEL[r.suggestedStatus as Status]}
                        </span>
                      </label>
                    ))}
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
                    disabled={picked.size === 0}
                    onClick={confirm}
                  >
                    <Plus size={16} /> Track {picked.size} project{picked.size === 1 ? '' : 's'}
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
