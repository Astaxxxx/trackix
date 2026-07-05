import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Send, Volume2, VolumeX, Sparkles, Loader2 } from 'lucide-react';
import type { AiConfig, ChatMsg, Project } from '../types';
import { api } from '../api';
import { daysSince } from '../mystic';

/*
 * VEGA — an AI companion that knows your whole board. Chat with it, and it can
 * speak its replies aloud (browser SpeechSynthesis, offline). Grounded in a
 * compact summary of every project so its advice is about YOUR work.
 */

interface Props {
  projects: Project[];
  ai: AiConfig | null;
  onClose: () => void;
}

const STARTERS = [
  'What should I work on today?',
  'Which project is most worth finishing?',
  'What am I neglecting?',
  'Give me a plan to ship something this week.',
];

export default function VegaModal({ projects, ai, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const board = useMemo(() => projects.slice(0, 40).map((p) => ({
    name: p.name, status: p.status, completion: p.completion, tools: p.tools.slice(0, 4),
    daysSinceEdit: daysSince(p.lastModified), todos: p.todos,
    focusHours: Math.round(((p.focusMinutes || 0) / 60) * 10) / 10,
    why: p.why ? p.why.slice(0, 80) : undefined,
  })), [projects]);

  const greeting = `I'm Vega — keeper of your cosmos. I can see all ${projects.length} of your worlds. Ask me what to build next, what you're neglecting, or how to finish something.`;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  function speak(text: string) {
    if (!voiceOn || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02; u.pitch = 1;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (!ai) { setMessages((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: 'Turn on AI in Settings (the ✦ gear) and I can truly see and reason about your board.' }]); setInput(''); return; }
    const next: ChatMsg[] = [...messages, { role: 'user', content: q }];
    setMessages(next); setInput(''); setBusy(true);
    const out = await api.aiChat(ai, board, next);
    setBusy(false);
    const reply = out?.error ? `(${out.error})` : (out?.text?.trim() || 'The stars are quiet — try again.');
    setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    if (!out?.error) speak(reply);
  }

  function toggleVoice() {
    if (voiceOn) window.speechSynthesis?.cancel();
    setVoiceOn((v) => !v);
  }

  return (
    <div className="modal" onClick={onClose}>
      <motion.div
        className="modal-card vega-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        <div className="vega-head">
          <div className={`vega-orb ${busy || speaking ? 'active' : ''}`}>
            <span className="vo-ring" /><span className="vo-ring r2" /><span className="vo-core" />
          </div>
          <div style={{ flex: 1 }}>
            <div className="modal-title" style={{ fontSize: 18 }}>Vega</div>
            <div className="modal-sub" style={{ marginTop: 2 }}>
              {ai ? (ai.provider === 'claude' ? 'via Claude · knows your board' : 'via Ollama · knows your board') : 'AI is off — turn it on in Settings'}
            </div>
          </div>
          <button className={`icon-btn ${voiceOn ? 'ai-on' : ''}`} onClick={toggleVoice} title={voiceOn ? 'Mute voice' : 'Let Vega speak'}>
            {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="vega-thread" ref={scrollRef}>
          <div className="vega-msg vega">{greeting}</div>
          {messages.map((m, i) => <div key={i} className={`vega-msg ${m.role === 'user' ? 'me' : 'vega'}`}>{m.content}</div>)}
          {busy && <div className="vega-msg vega typing"><Loader2 size={13} className="spin" /> consulting the stars…</div>}
          {messages.length === 0 && !busy && (
            <div className="vega-starters">
              {STARTERS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
            </div>
          )}
        </div>

        <div className="vega-input">
          <input
            ref={inputRef}
            placeholder="Ask Vega about your projects…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(input); }}
          />
          <button className="btn btn-primary" onClick={() => send(input)} disabled={busy || !input.trim()}>
            {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          </button>
        </div>
        <div className="vega-foot"><Sparkles size={11} /> Vega advises from your real board — it can't change files.</div>
      </motion.div>
    </div>
  );
}
