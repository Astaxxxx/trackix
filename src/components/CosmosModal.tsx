import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Orbit, FolderOpen, ArrowRight, Flame, Zap } from 'lucide-react';
import type { Project, Status } from '../types';
import { daysSince } from '../mystic';
import { timeAgo, STATUS_LABEL } from '../util';
import { api } from '../api';

/*
 * THE COSMOS — a calm, driveable star map of your projects.
 *  - even golden-angle layout (no clumping, no cross-screen webs)
 *  - stars only link to nearby stars that share a stack (short, clean lines)
 *  - Big-Bang entry, gentle cursor gravity, focus-only energy pulses
 *  - click a star: camera glides to it and a dock opens with real actions
 *  - lenses filter the sky
 */

interface Props {
  projects: Project[];
  onOpenProject: (id: string) => void;
  onRevive: (id: string) => void;
  onWarp: (id: string) => void;
  onClose: () => void;
}

type Lens = 'all' | 'unfinished' | 'finished' | 'dropped' | 'stale';

interface Star {
  p: Project;
  nx: number; ny: number;       // stable normalised position (0..1)
  r: number;
  color: string; glow: string;
  pulse: number; phase: number;
  idle: number;
  x: number; y: number;         // world position this frame
  sx: number; sy: number;       // screen position this frame
}

function h32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const frac = (n: number) => (n % 10000) / 10000;
const ease3 = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~2.39996 rad

const COLORS: Record<Status, { core: string; glow: string }> = {
  unfinished: { core: '#ff5a48', glow: 'rgba(224,48,30,' },
  finished:   { core: '#ffd27a', glow: 'rgba(255,190,90,' },
  dropped:    { core: '#9fb2c6', glow: 'rgba(150,170,200,' },
};

const LENSES: { key: Lens; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unfinished', label: '🔥 Burning' },
  { key: 'finished', label: '✨ Shining' },
  { key: 'dropped', label: '🌫 Fading' },
  { key: 'stale', label: '⚠ Losing heat' },
];

export default function CosmosModal({ projects, onOpenProject, onRevive, onWarp, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>('all');
  const [tip, setTip] = useState<{ name: string; sub: string; x: number; y: number } | null>(null);

  const lensRef = useRef<Lens>('all');
  const selectedRef = useRef<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const mouse = useRef({ x: -9999, y: -9999 });
  lensRef.current = lens;
  selectedRef.current = selectedId;
  hoverRef.current = hoverId;

  // ---- even golden-angle layout (fills the screen, never clumps) ----
  const stars = useMemo<Star[]>(() => {
    const n = projects.length;
    return projects.map((p, i) => {
      const seed = h32(p.id + p.name);
      const idle = daysSince(p.lastModified);
      const c = COLORS[p.status];
      const rad = Math.sqrt((i + 0.5) / n) * 0.46;          // 0..0.46
      const ang = i * GOLDEN + frac(seed) * 0.5;             // golden angle + slight seeded turn
      const jx = (frac(seed >> 3) - 0.5) * 0.035;            // organic jitter
      const jy = (frac(seed >> 7) - 0.5) * 0.035;
      return {
        p,
        nx: 0.5 + Math.cos(ang) * rad + jx,
        ny: 0.53 + Math.sin(ang) * rad * 0.92 + jy,
        // base size from completion + a permanent brightness bonus from real focus time
        r: 4 + (p.completion / 100) * 9 + Math.min(4, Math.sqrt(p.focusMinutes || 0) / 4),
        color: c.core, glow: c.glow,
        pulse: idle <= 2 ? 2.2 : idle <= 7 ? 1.4 : idle <= 30 ? 0.8 : 0.35,
        phase: frac(seed >> 5) * Math.PI * 2,
        idle,
        x: 0, y: 0, sx: 0, sy: 0,
      };
    });
  }, [projects]);

  // ---- edges: only NEARBY stars sharing a stack, max 2 links each (no webs) ----
  const edges = useMemo<[number, number][]>(() => {
    const AR = 1.7; // approximate screen aspect for distance math
    const cand: { i: number; j: number; d: number }[] = [];
    for (let i = 0; i < stars.length; i++) {
      const b = new Set(stars[i].p.tools);
      for (let j = i + 1; j < stars.length; j++) {
        let shared = 0;
        for (const t of stars[j].p.tools) if (b.has(t)) { shared++; if (shared >= 1) break; }
        if (!shared) continue;
        const dx = (stars[i].nx - stars[j].nx) * AR;
        const dy = stars[i].ny - stars[j].ny;
        const d = Math.hypot(dx, dy);
        if (d < 0.19) cand.push({ i, j, d });
      }
    }
    cand.sort((a, b) => a.d - b.d);
    const deg = new Array(stars.length).fill(0);
    const out: [number, number][] = [];
    for (const e of cand) {
      if (deg[e.i] >= 2 || deg[e.j] >= 2) continue;
      out.push([e.i, e.j]); deg[e.i]++; deg[e.j]++;
    }
    return out;
  }, [stars]);

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

    const dust = Array.from({ length: 80 }, (_, i) => ({
      x: frac(h32('d' + i)), y: frac(h32('e' + i)),
      r: 0.4 + frac(h32('f' + i)) * 1.0, tw: frac(h32('g' + i)) * Math.PI * 2,
      drift: 0.4 + frac(h32('h' + i)) * 0.8,
    }));
    let shoot: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
    let nextShoot = born + 3000;

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
      const focusId = selectedRef.current || hoverRef.current;

      const mx = mouse.current.x >= 0 ? mouse.current.x / W - 0.5 : 0;
      const my = mouse.current.y >= 0 ? mouse.current.y / H - 0.5 : 0;
      const target = sel ? { x: sel.x, y: sel.y, s: 1.42 } : { x: W / 2 + mx * 34, y: H / 2 + my * 22, s: 1 };
      cam.x += (target.x - cam.x) * 0.06;
      cam.y += (target.y - cam.y) * 0.06;
      cam.s += (target.s - cam.s) * 0.06;
      const toScreen = (wx: number, wy: number): [number, number] =>
        [(wx - cam.x) * cam.s + W / 2, (wy - cam.y) * cam.s + H / 2];

      // subtle nebulae (much softer than before)
      const nx = W * (0.8 + 0.03 * Math.sin(time * 0.06));
      const ny = H * (0.24 + 0.04 * Math.cos(time * 0.08));
      const neb = ctx.createRadialGradient(nx, ny, 0, nx, ny, W * 0.55);
      neb.addColorStop(0, 'rgba(224,48,30,0.09)'); neb.addColorStop(1, 'transparent');
      ctx.fillStyle = neb; ctx.fillRect(0, 0, W, H);
      const n2x = W * (0.16 + 0.04 * Math.cos(time * 0.05));
      const neb2 = ctx.createRadialGradient(n2x, H * 0.82, 0, n2x, H * 0.82, W * 0.5);
      neb2.addColorStop(0, 'rgba(80,70,150,0.07)'); neb2.addColorStop(1, 'transparent');
      ctx.fillStyle = neb2; ctx.fillRect(0, 0, W, H);

      // dust
      for (const d of dust) {
        const a = 0.16 + 0.24 * Math.abs(Math.sin(time * d.drift + d.tw));
        const [dxs, dys] = toScreen(d.x * W, d.y * H);
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.arc(W / 2 + (dxs - W / 2) * 0.4, H / 2 + (dys - H / 2) * 0.4, d.r, 0, Math.PI * 2); ctx.fill();
      }

      // star positions (big-bang entry + gentle wander + soft cursor gravity)
      stars.forEach((s, i) => {
        const entry = ease3((age - i * 22) / 1000);
        const tx = s.nx * W + Math.sin(time * 0.12 + s.phase) * 10;
        const ty = s.ny * H + Math.cos(time * 0.1 + s.phase * 1.6) * 8;
        let wx = W / 2 + (tx - W / 2) * entry;
        let wy = H / 2 + (ty - H / 2) * entry;
        if (mouse.current.x >= 0 && entry >= 1 && !sel) {
          const [ssx, ssy] = toScreen(wx, wy);
          const dd = Math.hypot(mouse.current.x - ssx, mouse.current.y - ssy);
          if (dd < 150 && dd > 1) {
            const f = (1 - dd / 150) * 11;
            wx += ((mouse.current.x - ssx) / dd) * f;
            wy += ((mouse.current.y - ssy) / dd) * f;
          }
        }
        s.x = wx; s.y = wy;
        const [sx, sy] = toScreen(wx, wy);
        s.sx = sx; s.sy = sy;
      });

      // constellation lines — short, uniform, calm; pulses only near the focused star
      ctx.lineWidth = 1;
      for (const [i, j] of edges) {
        const a = stars[i], b = stars[j];
        const on = matches(a.p, l) && matches(b.p, l);
        const focused = focusId === a.p.id || focusId === b.p.id;
        const alpha = !on ? 0.04 : focused ? 0.32 : 0.12;
        ctx.strokeStyle = `rgba(226,214,208,${alpha})`;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
        if (on && focused) {
          const pt = (time * 0.5) % 1;
          const px = a.sx + (b.sx - a.sx) * pt, py = a.sy + (b.sy - a.sy) * pt;
          const pg = ctx.createRadialGradient(px, py, 0, px, py, 4);
          pg.addColorStop(0, 'rgba(255,255,255,0.9)'); pg.addColorStop(1, 'transparent');
          ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
        }
      }

      // stars
      for (let idx = 0; idx < stars.length; idx++) {
        const s = stars[idx];
        const on = matches(s.p, l);
        const hovered = hoverRef.current === s.p.id;
        const isSel = selectedRef.current === s.p.id;
        const entry = ease3((age - idx * 22) / 1000);
        const boost = hovered || isSel ? 1.3 : 1;
        const pulse = 1 + 0.16 * Math.sin(time * s.pulse + s.phase);
        const R = s.r * pulse * boost * cam.s;
        const dim = on ? 1 : 0.1;

        const g = ctx.createRadialGradient(s.sx, s.sy, 0, s.sx, s.sy, R * 4);
        g.addColorStop(0, s.glow + (0.5 * dim * entry) + ')');
        g.addColorStop(0.45, s.glow + (0.14 * dim * entry) + ')');
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s.sx, s.sy, R * 4, 0, Math.PI * 2); ctx.fill();

        ctx.globalAlpha = dim * entry;
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.sx, s.sy, R, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(s.sx - R * 0.28, s.sy - R * 0.28, R * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        if (isSel) {
          ctx.strokeStyle = s.glow + '0.85)';
          ctx.lineWidth = 1.4;
          ctx.setLineDash([4, 6]); ctx.lineDashOffset = -time * 20;
          ctx.beginPath(); ctx.arc(s.sx, s.sy, R + 10, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // occasional shooting star (calm)
      if (!shoot && t > nextShoot) {
        shoot = { x: Math.random() * W * 0.6 + W * 0.2, y: Math.random() * H * 0.22, vx: 7 + Math.random() * 4, vy: 2.4 + Math.random() * 1.6, life: 1 };
        nextShoot = t + 5000 + Math.random() * 5000;
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
  }, [stars, edges]); // eslint-disable-line react-hooks/exhaustive-deps

  function findStar(cx: number, cy: number): Star | null {
    let best: Star | null = null, bd = 28;
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
        onClick={(e) => { const s = findStar(e.clientX, e.clientY); setSelectedId(s ? s.p.id : null); if (s) setTip(null); }}
        style={{ cursor: hoverId ? 'pointer' : 'default' }}
      />

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

      <div className="cosmos-lenses">
        {LENSES.map((lz) => (
          <button key={lz.key} className={`lens ${lens === lz.key ? 'active' : ''}`} onClick={() => setLens(lz.key)}>{lz.label}</button>
        ))}
      </div>

      <div className="cosmos-legend">
        <span><i style={{ background: '#ff5a48' }} /> in progress</span>
        <span><i style={{ background: '#ffd27a' }} /> finished</span>
        <span><i style={{ background: '#9fb2c6' }} /> dropped</span>
        <span className="dim">size = completion · pulse = momentum · lines = shared stack</span>
      </div>

      {tip && (
        <div className="cosmos-tooltip" style={{ left: tip.x, top: tip.y }}>
          <div className="ct-name">{tip.name}</div>
          <div className="ct-sub">{tip.sub}</div>
          <div className="ct-hint">click to focus</div>
        </div>
      )}

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
            <div className="sd-meta"><span>{selected.completion}% complete</span><span>{timeAgo(selected.lastModified)}</span></div>
            {selected.tools.length > 0 && <div className="sd-tools">{selected.tools.slice(0, 5).map((tl) => <em key={tl}>{tl}</em>)}</div>}
            <div className="sd-facts">
              {selected.todos > 0 && <span>{selected.todos} TODO{selected.todos === 1 ? '' : 's'}</span>}
              <span>{selected.hasReadme ? '✓ README' : '○ no README'}</span>
              <span>{selected.hosting}</span>
            </div>
            {(selected.focusMinutes || 0) > 0 && (
              <div className="sd-focus"><Zap size={13} /> {Math.round((selected.focusMinutes || 0) / 60 * 10) / 10}h of focus burned in</div>
            )}
            <div className="sd-actions">
              <button className="btn btn-primary" onClick={() => { onOpenProject(selected.id); onClose(); }}>Open <ArrowRight size={14} /></button>
              <button className="btn sd-ghost" onClick={() => api.openPath(selected.path)}><FolderOpen size={14} /> Folder</button>
            </div>
            <div className="sd-actions" style={{ marginTop: 7 }}>
              <button className="btn sd-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { onWarp(selected.id); onClose(); }}><Zap size={14} /> Warp in</button>
              {selected.status !== 'finished' && (
                <button className="btn sd-ghost" onClick={() => { onRevive(selected.id); onClose(); }}><Flame size={14} /> Revive</button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
