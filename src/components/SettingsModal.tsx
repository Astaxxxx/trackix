import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Sparkles, ShieldCheck, Loader2, CheckCircle2, AlertTriangle, ExternalLink, Ghost, Trash2 } from 'lucide-react';
import type { AiStatus, Settings } from '../types';
import { api, isDesktop } from '../api';

interface Props {
  settings: Settings;
  projectCount: number;
  onChange: (patch: Partial<Settings>) => void;
  onClearAll: () => void;
  onClose: () => void;
}

export default function SettingsModal({ settings, projectCount, onChange, onClearAll, onClose }: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  async function test() {
    setTesting(true);
    setStatus(await api.aiStatus(
      settings.aiProvider === 'claude'
        ? { provider: 'claude', model: settings.claudeModel, apiKey: settings.claudeApiKey }
        : { provider: 'ollama', model: settings.aiModel },
    ));
    setTesting(false);
  }

  const modelKnown = status?.running && status.models.some((m) => m.startsWith(settings.aiModel));
  const isClaude = settings.aiProvider === 'claude';

  const CLAUDE_MODELS = [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable (recommended)' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — fast + smart' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest, cheapest' },
  ];

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
            {/* provider picker */}
            <div className="provider-row">
              <button
                className={`provider ${!isClaude ? 'active' : ''}`}
                onClick={() => { onChange({ aiProvider: 'ollama' }); setStatus(null); }}
              >
                <div className="p-name">Local (Ollama)</div>
                <div className="p-sub">Free · 100% private · runs on your PC</div>
              </button>
              <button
                className={`provider ${isClaude ? 'active' : ''}`}
                onClick={() => { onChange({ aiProvider: 'claude' }); setStatus(null); }}
              >
                <div className="p-name">Claude API</div>
                <div className="p-sub">Best in market · your own API key</div>
              </button>
            </div>

            {isClaude ? (
              <>
                <div className="field">
                  <label>Anthropic API key</label>
                  <input
                    className="input"
                    type="password"
                    value={settings.claudeApiKey}
                    onChange={(e) => onChange({ claudeApiKey: e.target.value })}
                    placeholder="sk-ant-…"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label>Model</label>
                  <select
                    className="input"
                    value={settings.claudeModel}
                    onChange={(e) => onChange({ claudeModel: e.target.value })}
                  >
                    {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <div className="field">
                <label>Ollama model</label>
                <input
                  className="input"
                  value={settings.aiModel}
                  onChange={(e) => onChange({ aiModel: e.target.value })}
                  placeholder="llama3.2"
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <button className="btn" onClick={test} disabled={testing}>
                {testing ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                Test connection
              </button>
              {status && (
                status.running
                  ? <span style={{ fontSize: 12.5, color: 'var(--ok)', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <CheckCircle2 size={14} /> {isClaude ? 'Claude API ready' : `Ollama running · ${status.models.length} model${status.models.length === 1 ? '' : 's'}`}
                    </span>
                  : <span style={{ fontSize: 12.5, color: 'var(--red-deep)', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <AlertTriangle size={14} /> {status.error || 'Not reachable'}
                    </span>
              )}
            </div>

            {!isClaude && status?.running && !modelKnown && (
              <div style={{ fontSize: 12, color: 'var(--red-deep)', marginTop: 8 }}>
                "{settings.aiModel}" isn’t pulled yet. Run <code>ollama pull {settings.aiModel}</code> in a terminal.
              </div>
            )}

            {isClaude ? (
              <div className="suggestion" style={{ marginTop: 14 }}>
                <AlertTriangle size={18} style={{ color: 'var(--red-deep)', flexShrink: 0 }} />
                <span>
                  Uses <b>your</b> Anthropic API key (stored only on this device, billed to your account).
                  Heads up: this sends project <i>metadata</i> — name, tools, README snippet — to Anthropic.
                  Your code files are never sent. Prefer total privacy? Use Local (Ollama).
                  <br />
                  <a
                    href="https://console.anthropic.com"
                    onClick={(e) => { e.preventDefault(); api.openExternal('https://console.anthropic.com'); }}
                    style={{ color: 'var(--red-deep)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6 }}
                  >
                    Get an API key <ExternalLink size={12} />
                  </a>
                </span>
              </div>
            ) : (
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
            )}
          </>
        )}

        {/* desktop buddy toggle */}
        <div className="ai-row" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Ghost size={18} style={{ color: 'var(--red)' }} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Desktop buddy</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                {isDesktop ? 'A floating mascot on your desktop — click it to open Trackix' : 'Available in the desktop app'}
              </div>
            </div>
          </div>
          <button
            className={`switch ${settings.buddyEnabled ? 'on' : ''}`}
            onClick={() => isDesktop && onChange({ buddyEnabled: !settings.buddyEnabled })}
            aria-pressed={settings.buddyEnabled}
            disabled={!isDesktop}
            style={!isDesktop ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
          >
            <span className="knob" />
          </button>
        </div>

        {/* danger zone — start fresh */}
        <div className="section-title" style={{ marginTop: 22 }}>Start fresh</div>
        <div className="danger-row">
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Remove <b>all {projectCount}</b> tracked project{projectCount === 1 ? '' : 's'} and empty every column.
            This can’t be undone (your files aren’t touched — only Trackix’s list).
          </div>
          {!confirmClear ? (
            <button className="btn danger" onClick={() => setConfirmClear(true)} disabled={projectCount === 0}>
              <Trash2 size={15} /> Clear all
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setConfirmClear(false)}>Cancel</button>
              <button className="btn danger-solid" onClick={() => { onClearAll(); setConfirmClear(false); onClose(); }}>
                <Trash2 size={15} /> Yes, clear all
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
