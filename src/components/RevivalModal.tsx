import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Flame, Sparkles, Skull } from 'lucide-react';
import type { AiConfig, Project, RevivalPlan } from '../types';
import { api } from '../api';
import { heuristicRevival } from '../mystic';

interface Props {
  project: Project;
  ai: AiConfig | null;
  onClose: () => void;
  onAccept: (plan: RevivalPlan) => void;
}

const RITUAL_MS = 2600; // minimum time the ritual plays, even if the plan is instant

export default function RevivalModal({ project, ai, onClose, onAccept }: Props) {
  const [plan, setPlan] = useState<RevivalPlan | null>(null);
  const done = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [aiPlan] = await Promise.all([
        ai ? api.aiRevive(project, ai).catch(() => null) : Promise.resolve(null),
        new Promise((r) => setTimeout(r, RITUAL_MS)),
      ]);
      if (!alive) return;
      setPlan(aiPlan
        ? {
            stallReason: aiPlan.stallReason,
            summary: aiPlan.summary,
            steps: aiPlan.steps.map((text) => ({ text, done: false })),
            generatedAt: Date.now(),
            aiTagged: true,
          }
        : heuristicRevival(project));
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function accept() {
    if (!plan || done.current) return;
    done.current = true;
    onAccept(plan);
  }

  return (
    <div className="modal" onClick={onClose}>
      <motion.div
        className="modal-card ritual-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      >
        <AnimatePresence mode="wait">
          {!plan ? (
            /* ---------- phase 1: the ritual ---------- */
            <motion.div key="ritual" className="ritual-stage" exit={{ opacity: 0, scale: 1.06, filter: 'blur(6px)' }} transition={{ duration: 0.45 }}>
              <div className="ritual-circle">
                <div className="glyph-ring g1" />
                <div className="glyph-ring g2" />
                <div className="ritual-core"><Skull size={34} /></div>
                {Array.from({ length: 10 }).map((_, i) => (
                  <span key={i} className="ritual-ember" style={{ ['--x' as string]: `${6 + i * 9}%`, ['--d' as string]: `${2.2 + (i % 5) * 0.5}s`, ['--delay' as string]: `${i * 0.28}s` }} />
                ))}
              </div>
              <div className="ritual-title">Reviving <span>{project.name}</span></div>
              <div className="ritual-sub">{ai ? 'The AI reads what remains of this project…' : 'Reading what remains of this project…'}</div>
            </motion.div>
          ) : (
            /* ---------- phase 2: the revival path ---------- */
            <motion.div key="plan" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Flame size={20} style={{ color: 'var(--red)' }} /> {project.name} can live again
                    {plan.aiTagged && <span className="ai-chip"><Sparkles size={9} /> AI</span>}
                  </div>
                  <div className="modal-sub">{plan.summary}</div>
                </div>
                <button className="icon-btn" onClick={onClose}><X size={16} /></button>
              </div>

              <div className="section-title">Why it died</div>
              <div className="stall-reason">{plan.stallReason}</div>

              <div className="section-title">The revival path</div>
              <ol className="revival-steps">
                {plan.steps.map((s, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.12 }}>
                    <span className="step-num">{i + 1}</span> {s.text}
                  </motion.li>
                ))}
              </ol>

              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 18 }} onClick={accept}>
                <Flame size={16} /> Begin the revival
              </button>
              <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--text-faint)', marginTop: 8 }}>
                Moves the project back to In Progress with this checklist attached.
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
