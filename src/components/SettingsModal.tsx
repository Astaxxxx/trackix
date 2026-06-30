import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Sparkles, ShieldCheck, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import type { AiStatus, Settings } from '../types';
import { api } from '../api';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export default function SettingsModal({ settings, onChange, onClose }: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [testing, setTesting] = useState(false);

  async function test() {
    setTesting(true);
    setStatus(await api.aiStatus());
    setTesting(false);
  }

  const modelKnown = status?.running && status.models.some((m) => m.startsWith(settings.aiModel));

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
            <div className="modal-title">Settings</div>
            <div className="modal-sub">Smarter status detection with a local AI — optional and 100% on your device.</div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {/* AI toggle */}
        <div className="ai-row" style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles size={18} style={{ color: 'var(--red)' }} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Local AI analysis</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Use a local model to judge finished / unfinished / dropped</div>
            </div>
          </div>
          <button
            className={`switch ${settings.aiEnabled ? 'on' : ''}`}
            onClick={() => onChange({ aiEnabled: !settings.aiEnabled })}
            aria-pressed={settings.aiEnabled}
          >
            <span className="knob" />
          </button>
        </div>

        {settings.aiEnabled && (
          <>
            <div className="field">
              <label>Ollama model</label>
              <input
                className="input"
                value={settings.aiModel}
                onChange={(e) => onChange({ aiModel: e.target.value })}
                placeholder="llama3.2"
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <button className="btn" onClick={test} disabled={testing}>
                {testing ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                Test connection
              </button>
              {status && (
                status.running
                  ? <span style={{ fontSize: 12.5, color: 'var(--ok)', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <CheckCircle2 size={14} /> Ollama running · {status.models.length} model{status.models.length === 1 ? '' : 's'}
                    </span>
                  : <span style={{ fontSize: 12.5, color: 'var(--red-deep)', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <AlertTriangle size={14} /> Not reachable
                    </span>
              )}
            </div>

            {status?.running && !modelKnown && (
              <div style={{ fontSize: 12, color: 'var(--red-deep)', marginTop: 8 }}>
                "{settings.aiModel}" isn’t pulled yet. Run <code>ollama pull {settings.aiModel}</code> in a terminal.
              </div>
            )}

            <div className="suggestion" style={{ marginTop: 14 }}>
              <ShieldCheck size={18} style={{ color: 'var(--ok)', flexShrink: 0 }} />
              <span>
                Requires <b>Ollama</b> installed and running locally. Trackix only talks to
                <code> localhost:11434</code> — your code and projects never leave your machine.
                <br />
                <a
                  href="https://ollama.com"
                  onClick={(e) => { e.preventDefault(); api.openExternal('https://ollama.com'); }}
                  style={{ color: 'var(--red-deep)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6 }}
                >
                  Get Ollama <ExternalLink size={12} />
                </a>
              </span>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
