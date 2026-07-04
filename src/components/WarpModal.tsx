import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Pause, Play, Check } from 'lucide-react';
import type { Project, Status } from '../types';

/*
 * WARP — a deep-focus session poured into one project. A calm fullscreen
 * charging star + timer. The minutes you actually focus are logged to the
 * project and make its star burn brighter in the Cosmos. Real work → real light.
 */

interface Props {
  project: Project;
  onClose: () => void;
  onComplete: (minutes: number) => void;
}

const STAR: Record<Status, string> = { unfinished: '#ff5a48', finished: '#ffd27a', dropped: '#9fb2c6' };
const RING_MINUTES = 25; // one full ring = one pomodoro

function fmt(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function WarpModal({ project, onClose, onComplete }: Props) {
  const [sec, setSec] = useState(0);
  const [paused, setPaused] = useState(false);
  const startRef = useRef(Date.now());
  const accRef = useRef(0); // accumulated ms while running
  const lastTick = useRef(Date.now());
  const color = STAR[project.status];

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      if (!paused) accRef.current += now - lastTick.current;
      lastTick.current = now;
      setSec(Math.floor(accRef.current / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [paused]);

  // ring progress within the current pomodoro
  const ringPct = ((sec / 60) % RING_MINUTES) / RING_MINUTES;
  const rings = Math.floor(sec / 60 / RING_MINUTES);
  const charge = Math.min(1, (sec / 60) / RING_MINUTES); // 0..1 first-ring glow, then stays lit

  function finish() {
    const minutes = Math.round(accRef.current / 60000);
    onComplete(minutes);
  }

  const R = 96;
  const circ = 2 * Math.PI * R;

  return (
    <motion.div className="warp-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
      <button className="cosmos-close warp-x" onClick={onClose} title="Leave without logging"><X size={17} /></button>

      <div className="warp-stage">
        <svg width="260" height="260" viewBox="0 0 260 260" className="warp-svg">
          <defs>
            <radialGradient id="warp-core" cx="40%" cy="35%" r="70%">
              <stop offset="0%" stopColor="#fff" stopOpacity={0.95} />
              <stop offset="45%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity={0.7} />
            </radialGradient>
          </defs>
          {/* ambient glow (grows with charge) */}
          <circle cx="130" cy="130" r={R + 24} fill={color} opacity={0.06 + charge * 0.14} className="warp-glow" />
          {/* progress ring track + fill */}
          <circle cx="130" cy="130" r={R} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="4" />
          <circle
            cx="130" cy="130" r={R} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - ringPct)}
            transform="rotate(-90 130 130)" style={{ transition: 'stroke-dashoffset .25s linear', filter: `drop-shadow(0 0 6px ${color})` }}
          />
          {/* the star */}
          <circle cx="130" cy="130" r={38 + charge * 6} fill="url(#warp-core)" className={paused ? '' : 'warp-pulse'}
            style={{ filter: `drop-shadow(0 0 ${18 + charge * 22}px ${color})` }} />
        </svg>

        <div className="warp-timer">{fmt(sec)}</div>
        <div className="warp-name">
          {paused ? 'Paused' : 'Pouring your focus into'} <span style={{ color }}>{project.name}</span>
        </div>
        {rings > 0 && (
          <div className="warp-rings">{Array.from({ length: rings }).map((_, i) => <span key={i} style={{ background: color }} />)} {rings} charge{rings === 1 ? '' : 's'} sealed</div>
        )}

        <div className="warp-controls">
          <button className="warp-btn" onClick={() => setPaused((p) => !p)}>
            {paused ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Pause</>}
          </button>
          <button className="warp-btn warp-done" onClick={finish} disabled={sec < 1}>
            <Check size={16} /> End &amp; log {Math.round(sec / 60)}m
          </button>
        </div>
        <div className="warp-hint">Every minute here makes {project.name}’s star burn brighter in your Cosmos.</div>
      </div>
    </motion.div>
  );
}
