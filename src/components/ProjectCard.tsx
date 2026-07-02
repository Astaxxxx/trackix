import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Globe, GitBranch, Clock } from 'lucide-react';
import type { Project } from '../types';
import { timeAgo } from '../util';

interface Props {
  project: Project;
  index?: number; // position in its column — used for the staggered entrance
  onOpen: () => void;
  onDragStart: () => void;
  onDrag: (clientX: number, clientY: number) => void;
  onDragEnd: (clientX: number, clientY: number) => void;
}

// forwardRef is required so framer-motion's <AnimatePresence mode="popLayout">
// can measure the card on exit.
const ProjectCard = forwardRef<HTMLDivElement, Props>(function ProjectCard(
  { project, index = 0, onOpen, onDragStart, onDrag, onDragEnd }, ref
) {
  const tools = project.tools.slice(0, 4);
  const extra = project.tools.length - tools.length;

  return (
    <motion.div
      ref={ref}
      layout
      layoutId={project.id}
      className={`card ${project.status}`}
      drag
      dragSnapToOrigin
      dragElastic={0.12}
      whileDrag={{ scale: 1.05, rotate: -1.5, zIndex: 60, boxShadow: '0 30px 60px -18px rgba(224,48,30,0.55)', cursor: 'grabbing' }}
      onDragStart={onDragStart}
      onDrag={(_e, info) => onDrag(info.point.x, info.point.y)}
      onDragEnd={(_e, info) => onDragEnd(info.point.x, info.point.y)}
      onClick={onOpen}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 30, delay: Math.min(index * 0.05, 0.4) } }}
      exit={{ opacity: 0, scale: 0.85, filter: 'blur(4px)' }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      whileHover={{ y: -4 }}
    >
      {project.status === 'finished' && <span className="stamp">DONE</span>}
      <div className="card-top">
        <div>
          <div className="card-name">{project.name}</div>
          <div className="card-host">
            {project.hosting === 'Local only'
              ? <><GitBranch size={12} /> {project.hosting}</>
              : <><Globe size={12} /> {project.hosting}</>}
          </div>
        </div>
      </div>

      {project.why
        ? <div className="card-why">{project.why}</div>
        : project.readmeExcerpt
          ? <div className="card-why">{project.readmeExcerpt}</div>
          : <div className="card-why" style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>No description yet — open to add one.</div>}

      {tools.length > 0 && (
        <div className="tools">
          {tools.map((t) => <span key={t} className="chip">{t}</span>)}
          {extra > 0 && <span className="chip more">+{extra}</span>}
        </div>
      )}

      <div className="progress">
        <motion.div
          className="progress-fill"
          initial={{ width: 0 }}
          animate={{ width: `${project.completion}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      <div className="card-meta">
        <span className="completion-label">{project.completion}% complete</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={11} /> {timeAgo(project.lastModified)}
        </span>
      </div>
    </motion.div>
  );
});

export default ProjectCard;
