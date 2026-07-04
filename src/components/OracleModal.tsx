import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Eye, ArrowRight, RotateCcw } from 'lucide-react';
import type { Project } from '../types';
import { consultOracle, nextReading, type OracleReading } from '../mystic';

interface Props {
  projects: Project[];
  onClose: () => void;
  onOpenProject: (id: string) => void;
}

const GAZE_MS = 2200;

export default function OracleModal({ projects, onClose, onOpenProject }: Props) {
  const [reading, setReading] = useState<OracleReading | null | 'empty'>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const r = consultOracle(projects);
      setReading(r ?? 'empty');
    }, GAZE_MS);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function again() {
    if (reading && reading !== 'empty') {
      const r = nextReading(reading);
      if (r) setReading(r);
    }
  }

  return (
    <div className="modal" onClick={onClose}>
      <motion.div
        className="modal-card oracle-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      >
        <AnimatePresence mode="wait">
          {reading === null ? (
            /* ---------- the gaze ---------- */
            <motion.div key="gaze" className="ritual-stage" exit={{ opacity: 0, scale: 1.06, filter: 'blur(6px)' }} transition={{ duration: 0.45 }}>
              <div className="ritual-circle">
                <div className="glyph-ring g1" />
                <div className="glyph-ring g2" />
                <div className="ritual-core oracle-eye"><Eye size={34} /></div>
              </div>
              <div className="ritual-title">The Oracle gazes upon your work…</div>
              <div className="ritual-sub">Weighing momentum, distance to done, and the pull of the graveyard.</div>
            </motion.div>
          ) : reading === 'empty' ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '30px 10px' }}>
              <div className="modal-title">The board is at peace</div>
              <div className="modal-sub" style={{ marginTop: 8 }}>
                Nothing in progress, nothing in the graveyard. Add projects and the Oracle will have something to see.
              </div>
              <button className="btn" style={{ marginTop: 18 }} onClick={onClose}>Close</button>
            </motion.div>
          ) : (
            /* ---------- the reveal ---------- */
            <motion.div key={reading.project.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="oracle-label"><Eye size={13} /> The Oracle has chosen</div>
                <button className="icon-btn" onClick={onClose}><X size={16} /></button>
              </div>

              <motion.div
                className="chosen-name"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
              >
                {reading.project.name}
              </motion.div>

              <div className="prophecy">“{reading.prophecy}”</div>

              <div className="omens">
                {reading.omens.map((o, i) => (
                  <motion.div key={o.label} className="omen" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.12 }}>
                    <div className="omen-value">{o.value}</div>
                    <div className="omen-label">{o.label}</div>
                  </motion.div>
                ))}
              </div>

              <div className="oracle-reason">{reading.reason}</div>

              <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { onOpenProject(reading.project.id); onClose(); }}>
                  Answer the call <ArrowRight size={15} />
                </button>
                {reading.alternates.length > 0 && (
                  <button className="btn" onClick={again} title="Ask the Oracle to look again">
                    <RotateCcw size={15} /> Consult again
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
