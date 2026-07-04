import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Orbit, FolderOpen, ArrowRight, Flame } from 'lucide-react';
import type { Project, Status } from '../types';
import { daysSince } from '../mystic';
import { timeAgo, STATUS_LABEL } from '../util';
import { api } from '../api';

/*
 * THE COSMOS v2 — a driveable universe, not a poster.
 *  - Big-Bang entry: stars burst from the core to their constellations
 *  - gravity: stars lean toward your cursor and brighten
 *  - energy pulses travel along constellation lines
 *  - click a star: the camera flies to it and a dock opens with real actions
 *  - lenses filter the sky (burning / shining / fading / stale)
 */

interface Props {
  projects: Project[];
  onOpenProject: (id: string) => void;
  onRevive: (id: string) => void;
  onClose: () => void;
}

type Lens = 'all' | 'unfinished' | 'finished' | 'dropped' | 'stale';

interface Star {
  p: Project;
  bx: number; by: number;
  r: number;
  color: string; glow: string;
  pulse: number; phase: number;
  idle: number;
  x: number; y: number;   // world position this frame
  sx: number; sy: number; // screen position this frame (after camera)
}

function h32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const frac = (n: number) => (n % 10000) / 10000;
const ease3 = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

const COLORS: Record<Status, { core: string; glow: string }> = {
  unfinished: { core: '#ff5a48', glow: 'rgba(224,48,30,' },
  finished:   { core: '#ffd27a', glow: 'rgba(255,190,90,' },
  dropped:    { core: '#8fa3b8', glow: 'rgba(120,145,170,' },
};

const LENSES: { key: Lens; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unfinished', label: '🔥 Burning' },
  { key: 'finished', label: '✨ Shining' },
  { key: 'dropped', label: '🌫 Fading' },
  { key: 'stale', label: '⚠ Losing heat' },
];

export default function CosmosModal({ projects, onOpenProject, onRevive, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>('all');
  const [tip, setTip] = useState<{ name: string; sub: string; x: number; y: number } | null>(null);

  // refs so the rAF loop always sees current values without re-subscribing
  const lensRef = useRef<Lens>('all');
  const selectedRef = useRef<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const mouse = useRef({ x: -9999, y: -9999 });
  lensRef.current = lens;
  selectedRef.current = selectedId;
  hoverRef.current = hoverId;

  const stars = useMemo<Star[]>(() => projects.map((p) => {
    const seed = h32(p.id + p.name);
    const idle = daysSince(p.lastModified);
    const c = COLORS[p.status];
    return {
      p,
      bx: 0.08 + frac(seed) * 0.84,
      by: 0.16 + frac(seed >> 3) * 0.68,
      r: 4 + (p.completion / 100) * 10,
      color: c.core, glow: c.glow,
      pulse: idle <= 2 ? 2.4 : idle <= 7 ? 1.5 : idle <= 30 ? 0.8 : 0.35,
      phase: frac(seed >> 5) * Math.PI * 2,
      idle,
      x: 0, y: 0, sx: 0, sy: 0,
    };
  }), [projects]);

  const edges = useMemo<[number, number][]>(() => {
    const need = projects.length <= 6 ? 1 : 2;
    const out: [number, number][] = [];
    const links = new Array(stars.length).fill(0);
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        if (links[i] >= 3 || links[j] >= 3) continue;
        const b = new Set(stars[j].p.tools);
        let shared = 0;
        for (const t of stars[i].p.tools) if (b.has(t)) shared++;
        if (shared >= need) { out.push([i, j]); links[i]++; links[j]++; }
      }
    }
    return out;
  }, [stars, projects.length]);

  /** HUD facts */
  const hud = useMemo(() => {
    const integrity = projects.length
      ? Math.round(projects.reduce((a, p) => a + p.completion, 0) / projects.length) : 0;
    const counts = new Map<string, number>();
    for (const p of projects) for (const t of p.tools) counts.set(t, (counts.get(t) || 0) + 1);
    let top = '', n = 0;
    for (const [t, c] of counts) if (c > n) { top = t; n = c; }
    return { integrity, constellation: n >= 2 ? `${top} (${n} worlds)` : null };
  }, [projects]);

  function matches(p: Project, l: Lens): boolean {
    if (l === 'all') return true;
    if (l === 'stale') return p.status === 'unfinished' && daysSince(p.lastModified) > 14;
    return p.status === l;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0, W = 0, H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const born = performance.now();

    const dust = Array.from({ length: 110 }, (_, i) => ({
      x: frac(h32('d' + i)), y: frac(h32('e' + i)),
      r: 0.4 + frac(h32('f' + i)) * 1.2, tw: frac(h32('g' + i)) * Math.PI * 2,
      drift: 0.4 + frac(h32('h' + i)) * 0.8,
    }));
    let shoot: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
    let nextShoot = born + 2000;

    // camera (world coords the screen centre looks at + zoom)
    const cam = { x: 0, y: 0, s: 1 };
    let camInit = false;

    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      canvas!.width = W * dpr; canvas!.height = H * dpr;
      canvas!.style.width = W + 'px'; canvas!.style.height = H + 'px';
      if (!camInit) { cam.x = W / 2; cam.y = H / 2; camInit = true; }
    }
    resize();
    window.addEventListener('resize', resize);

    function draw(t: number) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const time = t / 1000;
      const age = t - born;
      const l = lensRef.current;
      const sel = stars.find((s) => s.p.id === selectedRef.current) || null;

      /* ---- camera: fly to selection, else drift with the mouse ---- */
      const mx = mouse.current.x >= 0 ? mouse.current.x / W - 0.5 : 0;
      const my = mouse.current.y >= 0 ? mouse.current.y / H - 0.5 : 0;
      const target = sel
        ? { x: sel.x, y: sel.y, s: 1.5 }
        : { x: W / 2 + mx * 46, y: H / 2 + my * 32, s: 1 };
      cam.x += (target.x - cam.x) * 0.06;
      cam.y += (target.y - cam.y) * 0.06;
      cam.s += (target.s - cam.s) * 0.06;

      const toScreen = (wx: number, wy: number): [number, number] =>
        [(wx - cam.x) * cam.s + W / 2, (wy - cam.y) * cam.s + H / 2];

      /* ---- nebulae (slowly swirling) ---- */
      const nx = W * (0.78 + 0.04 * Math.sin(time * 0.07));
      const ny = H * (0.2 + 0.05 * Math.cos(time * 0.09));
      const neb = ctx.createRadialGradient(nx, ny, 0, nx, ny, W * 0.5);
      neb.addColorStop(0, 'rgba(224,48,30,0.18)'); neb.addColorStop(1, 'transparent');
      ctx.fillStyle = neb; ctx.fillRect(0, 0, W, H);
      const n2x = W * (0.14 + 0.05 * Math.cos(time * 0.06));
      const neb2 = ctx.createRadialGradient(n2x, H * 0.85, 0, n2x, H * 0.85, W * 0.45);
      neb2.addColorStop(0, 'rgba(90,60,160,0.14)'); neb2.addColorStop(1, 'transparent');
      ctx.fillStyle = neb2; ctx.fillRect(0, 0, W, H);

      /* ---- dust (parallax with camera) ---- */
      for (const d of dust) {
        const a = 0.2 + 0.32 * Math.abs(Math.sin(time * d.drift + d.tw));
        const [dxs, dys] = toScreen(d.x * W, d.y * H);
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.arc(W / 2 + (dxs - W / 2) * 0.35, H / 2 + (dys - H / 2) * 0.35, d.r, 0, Math.PI * 2); ctx.fill();
      }

      /* ---- star world positions: big-bang entry + wander + cursor gravity ---- */
      stars.forEach((s, i) => {
        const entry = ease3((age - i * 26) / 1100);
        const tx = s.bx * W + Math.sin(time * 0.14 + s.phase) * 16;
        const ty = s.by * H + Math.cos(time * 0.11 + s.phase * 1.7) * 12;
        let wx = W / 2 + (tx - W / 2) * entry;
        let wy = H / 2 + (ty - H / 2) * entry;

        // gravity well around the cursor (world-space)
        if (mouse.current.x >= 0 && entry >= 1 && !sel) {
          const [msx, msy] = [mouse.current.x, mouse.current.y];
          const [ssx, ssy] = toScreen(wx, wy);
          const d = Math.hypot(msx - ssx, msy - ssy);
          if (d < 200 && d > 1) {
            const f = (1 - d / 200) * 22;
            wx += ((msx - ssx) / d) * f;
            wy += ((msy - ssy) / d) * f;
          }
        }
        s.x = wx; s.y = wy;
        const [sx, sy] = toScreen(wx, wy);
        s.sx = sx; s.sy = sy;
      });

      /* ---- constellation lines + travelling energy pulses ---- */
      ctx.lineWidth = 1;
      edges.forEach(([i, j], ei) => {
        const a = stars[i], b = stars[j];
        const on = matches(a.p, l) && matches(b.p, l);
        const alpha = on ? 0.3 : 0.05;
        const grad = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
        grad.addColorStop(0, a.glow + alpha + ')');
        grad.addColorStop(1, b.glow + alpha + ')');
        ctx.strokeStyle = grad;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();

        if (on) {
          // two pulses per edge, offset
          for (let k = 0; k < 2; k++) {
            const pt = (time * 0.22 + frac(h32('p' + ei)) + k * 0.5) % 1;
            const px = a.sx + (b.sx - a.sx) * pt;
            const py = a.sy + (b.sy - a.sy) * pt;
            const pg = ctx.createRadialGradient(px, py, 0, px, py, 5);
            pg.addColorStop(0, 'rgba(255,255,255,0.85)');
            pg.addColorStop(1, 'transparent');
            ctx.fillStyle = pg;
            ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
          }
        }
      });

      /* ---- stars ---- */
      for (const s of stars) {
        const on = matches(s.p, l);
        const hovered = hoverRef.current === s.p.id;
        const isSel = selectedRef.current === s.p.id;
        const entry = ease3((age - stars.indexOf(s) * 26) / 1100);
        const boost = hovered || isSel ? 1.35 : 1;
        const pulse = 1 + 0.2 * Math.sin(time * s.pulse + s.phase);
        const R = s.r * pulse * boost * cam.s;
        const dim = on ? 1 : 0.12;

        const g = ctx.createRadialGradient(s.sx, s.sy, 0, s.sx, s.sy, R * 4.4);
        g.addColorStop(0, s.glow + (0.6 * dim * entry) + ')');
        g.addColorStop(0.4, s.glow + (0.18 * dim * entry) + ')');
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s.sx, s.sy, R * 4.4, 0, Math.PI * 2); ctx.fill();

        ctx.globalAlpha = dim * entry;
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.sx, s.sy, R, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath(); ctx.arc(s.sx - R * 0.3, s.sy - R * 0.3, R * 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        // selection ring
        if (isSel) {
          ctx.strokeStyle = s.glow + '0.9)';
          ctx.lineWidth = 1.6;
          ctx.setLineDash([5, 6]);
          ctx.lineDashOffset = -time * 24;
          ctx.beginPath(); ctx.arc(s.sx, s.sy, R + 11, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      /* ---- shooting star ---- */
      if (!shoot && t > nextShoot) {
        shoot = { x: Math.random() * W * 0.6 + W * 0.2, y: Math.random() * H * 0.25, vx: 8 + Math.random() * 5, vy: 2.6 + Math.random() * 2, life: 1 };
        nextShoot = t + 2600 + Math.random() * 3000;
      }
      if (shoot) {
        shoot.x += shoot.vx; shoot.y += shoot.vy; shoot.life -= 0.02;
        if (shoot.life <= 0 || shoot.x > W || shoot.y > H) shoot = null;
        else {
          const tail = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - shoot.vx * 10, shoot.y - shoot.vy * 10);
          tail.addColorStop(0, `rgba(255,255,255,${0.9 * shoot.life})`); tail.addColorStop(1, 'transparent');
          ctx.strokeStyle = tail; ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x - shoot.vx * 10, shoot.y - shoot.vy * 10); ctx.stroke();
        }
      }

      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [stars, edges]); // eslint-disable-line react-hooks/exhaustive-deps

  function findStar(cx: number, cy: number): Star | null {
    let best: Star | null = null, bd = 30;
    for (const s of stars) {
      if (!matches(s.p, lensRef.current)) continue;
      const d = Math.hypot(s.sx - cx, s.sy - cy);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  const selected = projects.find((p) => p.id === selectedId) || null;

  return (
    <motion.div className="cosmos-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}>
      <canvas
        ref={canvasRef}
        onMouseMove={(e) => {
          mouse.current = { x: e.clientX, y: e.clientY };
          const s = findStar(e.clientX, e.clientY);
          setHoverId(s ? s.p.id : null);
          setTip(s && s.p.id !== selectedId ? {
            name: s.p.name,
            sub: `${STATUS_LABEL[s.p.status]} · ${s.p.completion}% · ${timeAgo(s.p.lastModified)}`,
            x: Math.min(e.clientX + 16, window.innerWidth - 230),
            y: Math.max(e.clientY - 70, 12),
          } : null);
        }}
        onMouseLeave={() => { mouse.current = { x: -9999, y: -9999 }; setHoverId(null); setTip(null); }}
        onClick={(e) => {
          const s = findStar(e.clientX, e.clientY);
          setSelectedId(s ? s.p.id : null);
          if (s) setTip(null);
        }}
        style={{ cursor: hoverId ? 'pointer' : 'default' }}
      />

      {/* header + HUD */}
      <div className="cosmos-head">
        <div>
          <div className="cosmos-title"><Orbit size={17} /> Your cosmos</div>
          <div className="cosmos-sub">
            {projects.length} worlds · universe {hud.integrity}% complete
            {hud.constellation && <> · strongest constellation: {hud.constellation}</>}
          </div>
        </div>
        <button className="cosmos-close" onClick={onClose}><X size={17} /></button>
      </div>

      {/* lenses */}
      <div className="cosmos-lenses">
        {LENSES.map((l) => (
          <button key={l.key} className={`lens ${lens === l.key ? 'active' : ''}`} onClick={() => setLens(l.key)}>
            {l.label}
          </button>
        ))}
      </div>

      <div className="cosmos-legend">
        <span><i style={{ background: '#ff5a48' }} /> in progress</span>
        <span><i style={{ background: '#ffd27a' }} /> finished</span>
        <span><i style={{ background: '#8fa3b8' }} /> dropped</span>
        <span className="dim">size = completion · pulse = momentum · lines = shared stack · click a star</span>
      </div>

      {/* hover tooltip */}
      {tip && (
        <div className="cosmos-tooltip" style={{ left: tip.x, top: tip.y }}>
          <div className="ct-name">{tip.name}</div>
          <div className="ct-sub">{tip.sub}</div>
          <div className="ct-hint">click to focus</div>
        </div>
      )}

      {/* star dock */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key={selected.id}
            className="star-dock"
            initial={{ x: 340, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 340, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            <div className="sd-head">
              <div className="sd-name">{selected.name}</div>
              <button className="cosmos-close sd-close" onClick={() => setSelectedId(null)}><X size={14} /></button>
            </div>
            <div className={`sd-status ${selected.status}`}>{STATUS_LABEL[selected.status]}</div>
            <div className="sd-bar"><div className="sd-fill" style={{ width: `${selected.completion}%` }} /></div>
            <div className="sd-meta">
              <span>{selected.completion}% complete</span>
              <span>{timeAgo(selected.lastModified)}</span>
            </div>
            {selected.tools.length > 0 && (
              <div className="sd-tools">{selected.tools.slice(0, 5).map((t) => <em key={t}>{t}</em>)}</div>
            )}
            <div className="sd-facts">
              {selected.todos > 0 && <span>{selected.todos} TODO{selected.todos === 1 ? '' : 's'}</span>}
              <span>{selected.hasReadme ? '✓ README' : '○ no README'}</span>
              <span>{selected.hosting}</span>
            </div>
            <div className="sd-actions">
              <button className="btn btn-primary" onClick={() => { onOpenProject(selected.id); onClose(); }}>
                Open <ArrowRight size={14} />
              </button>
              <button className="btn sd-ghost" onClick={() => api.openPath(selected.path)}>
                <FolderOpen size={14} /> Folder
              </button>
              {selected.status !== 'finished' && (
                <button className="btn sd-ghost" onClick={() => { onRevive(selected.id); onClose(); }}>
                  <Flame size={14} /> Revive
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
