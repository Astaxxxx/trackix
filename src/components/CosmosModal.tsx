import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Orbit } from 'lucide-react';
import type { Project } from '../types';
import { daysSince } from '../mystic';
import { timeAgo, STATUS_LABEL } from '../util';

/*
 * THE COSMOS — the board rendered as a living night sky.
 *  star size  = completion · star colour = status · pulse = momentum
 *  constellation lines connect projects sharing 2+ tools
 * Pure canvas, no AI, works instantly offline.
 */

interface Props {
  projects: Project[];
  onOpenProject: (id: string) => void;
  onClose: () => void;
}

interface Star {
  p: Project;
  bx: number; by: number;      // base position (0..1)
  r: number;                    // core radius px
  color: string; glow: string;
  pulse: number;                // pulse speed (momentum)
  phase: number;                // per-star animation offset
  x: number; y: number;         // last drawn position (for hit-testing)
}

function h32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const frac = (n: number) => (n % 10000) / 10000;

const COLORS: Record<string, { core: string; glow: string }> = {
  unfinished: { core: '#ff5a48', glow: 'rgba(224,48,30,' },
  finished:   { core: '#ffd27a', glow: 'rgba(255,190,90,' },
  dropped:    { core: '#8fa3b8', glow: 'rgba(120,145,170,' },
};

export default function CosmosModal({ projects, onOpenProject, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ star: Star; sx: number; sy: number } | null>(null);
  const hoverRef = useRef<Star | null>(null);
  const mouse = useRef({ x: 0.5, y: 0.5 });

  const stars = useMemo<Star[]>(() => projects.map((p) => {
    const seed = h32(p.id + p.name);
    const idle = daysSince(p.lastModified);
    const c = COLORS[p.status];
    return {
      p,
      bx: 0.08 + frac(seed) * 0.84,
      by: 0.14 + frac(seed >> 3) * 0.72,
      r: 3.5 + (p.completion / 100) * 9,
      color: c.core,
      glow: c.glow,
      pulse: idle <= 2 ? 2.2 : idle <= 7 ? 1.4 : idle <= 30 ? 0.8 : 0.35,
      phase: frac(seed >> 5) * Math.PI * 2,
      x: 0, y: 0,
    };
  }), [projects]);

  /** constellation edges: share 2+ tools (or 1 tool for tiny boards) */
  const edges = useMemo<[number, number][]>(() => {
    const need = projects.length <= 6 ? 1 : 2;
    const out: [number, number][] = [];
    const linkCount = new Array(stars.length).fill(0);
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        if (linkCount[i] >= 3 || linkCount[j] >= 3) continue;
        const a = stars[i].p.tools, b = new Set(stars[j].p.tools);
        let shared = 0;
        for (const t of a) if (b.has(t)) shared++;
        if (shared >= need) { out.push([i, j]); linkCount[i]++; linkCount[j]++; }
      }
    }
    return out;
  }, [stars, projects.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let W = 0, H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // ambient dust + one shooting star
    const dust = Array.from({ length: 90 }, (_, i) => ({
      x: frac(h32('d' + i)), y: frac(h32('e' + i)), r: 0.5 + frac(h32('f' + i)) * 1.1, tw: frac(h32('g' + i)) * Math.PI * 2,
    }));
    let shoot: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
    let nextShoot = performance.now() + 2500;

    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      canvas!.width = W * dpr; canvas!.height = H * dpr;
      canvas!.style.width = W + 'px'; canvas!.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    function draw(t: number) {
      ctx.clearRect(0, 0, W, H);
      const time = t / 1000;
      const px = (mouse.current.x - 0.5) * 24; // parallax
      const py = (mouse.current.y - 0.5) * 16;

      // nebulae
      const neb = ctx.createRadialGradient(W * 0.78, H * 0.2, 0, W * 0.78, H * 0.2, W * 0.5);
      neb.addColorStop(0, 'rgba(224,48,30,0.16)'); neb.addColorStop(1, 'transparent');
      ctx.fillStyle = neb; ctx.fillRect(0, 0, W, H);
      const neb2 = ctx.createRadialGradient(W * 0.15, H * 0.85, 0, W * 0.15, H * 0.85, W * 0.45);
      neb2.addColorStop(0, 'rgba(90,60,160,0.12)'); neb2.addColorStop(1, 'transparent');
      ctx.fillStyle = neb2; ctx.fillRect(0, 0, W, H);

      // dust
      for (const d of dust) {
        const a = 0.25 + 0.3 * Math.abs(Math.sin(time * 0.6 + d.tw));
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.arc(d.x * W + px * 0.3, d.y * H + py * 0.3, d.r, 0, Math.PI * 2); ctx.fill();
      }

      // star positions this frame
      for (const s of stars) {
        s.x = s.bx * W + Math.sin(time * 0.12 + s.phase) * 14 + px;
        s.y = s.by * H + Math.cos(time * 0.1 + s.phase * 1.7) * 10 + py;
      }

      // constellation lines
      ctx.lineWidth = 1;
      for (const [i, j] of edges) {
        const a = stars[i], b = stars[j];
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, a.glow + '0.28)'); grad.addColorStop(1, b.glow + '0.28)');
        ctx.strokeStyle = grad;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      // stars
      for (const s of stars) {
        const pulse = 1 + 0.18 * Math.sin(time * s.pulse + s.phase);
        const R = s.r * pulse;
        const hovered = hoverRef.current === s;
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R * 4.2);
        g.addColorStop(0, s.glow + (hovered ? '0.9)' : '0.55)'));
        g.addColorStop(0.4, s.glow + '0.18)');
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s.x, s.y, R * 4.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, R * (hovered ? 1.25 : 1), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(s.x - R * 0.3, s.y - R * 0.3, R * 0.32, 0, Math.PI * 2); ctx.fill();
      }

      // shooting star
      if (!shoot && t > nextShoot) {
        shoot = { x: Math.random() * W * 0.6 + W * 0.2, y: Math.random() * H * 0.25, vx: 7 + Math.random() * 5, vy: 2.4 + Math.random() * 2, life: 1 };
        nextShoot = t + 3500 + Math.random() * 4000;
      }
      if (shoot) {
        shoot.x += shoot.vx; shoot.y += shoot.vy; shoot.life -= 0.02;
        if (shoot.life <= 0 || shoot.x > W || shoot.y > H) shoot = null;
        else {
          const tail = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - shoot.vx * 9, shoot.y - shoot.vy * 9);
          tail.addColorStop(0, `rgba(255,255,255,${0.85 * shoot.life})`); tail.addColorStop(1, 'transparent');
          ctx.strokeStyle = tail; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x - shoot.vx * 9, shoot.y - shoot.vy * 9); ctx.stroke();
        }
      }

      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [stars, edges]);

  function findStar(cx: number, cy: number): Star | null {
    let best: Star | null = null, bd = 28;
    for (const s of stars) {
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  return (
    <motion.div
      className="cosmos-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={(e) => {
          mouse.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
          const s = findStar(e.clientX, e.clientY);
          hoverRef.current = s;
          setHover(s ? { star: s, sx: e.clientX, sy: e.clientY } : null);
        }}
        onClick={(e) => {
          const s = findStar(e.clientX, e.clientY);
          if (s) { onOpenProject(s.p.id); onClose(); }
        }}
        style={{ cursor: hover ? 'pointer' : 'default' }}
      />

      <div className="cosmos-head">
        <div>
          <div className="cosmos-title"><Orbit size={17} /> Your cosmos</div>
          <div className="cosmos-sub">
            {projects.length} worlds · {projects.filter((p) => p.status === 'finished').length} shining ·{' '}
            {projects.filter((p) => p.status === 'unfinished').length} burning ·{' '}
            {projects.filter((p) => p.status === 'dropped').length} fading
          </div>
        </div>
        <button className="cosmos-close" onClick={onClose}><X size={17} /></button>
      </div>

      <div className="cosmos-legend">
        <span><i style={{ background: '#ff5a48' }} /> in progress</span>
        <span><i style={{ background: '#ffd27a' }} /> finished</span>
        <span><i style={{ background: '#8fa3b8' }} /> dropped</span>
        <span className="dim">star size = completion · pulse = momentum · lines = shared stack</span>
      </div>

      {hover && (
        <div className="cosmos-tooltip" style={{ left: Math.min(hover.sx + 16, window.innerWidth - 230), top: Math.max(hover.sy - 74, 12) }}>
          <div className="ct-name">{hover.star.p.name}</div>
          <div className="ct-sub">
            {STATUS_LABEL[hover.star.p.status]} · {hover.star.p.completion}% · {timeAgo(hover.star.p.lastModified)}
          </div>
          <div className="ct-hint">click to open</div>
        </div>
      )}
    </motion.div>
  );
}
