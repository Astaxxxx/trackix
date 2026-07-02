import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Copy, Download, Check, Megaphone } from 'lucide-react';
import type { Project } from '../types';

/**
 * Ship Card — a shareable, Wrapped-style stats image of your build board.
 * Rendered entirely on a canvas (1200x630, the X/Twitter card ratio) so it can
 * be copied to the clipboard or saved as a PNG in one click. Every card carries
 * the Trackix + Astax Labs mark — social shares advertise the app.
 */

interface Props {
  projects: Project[];
  onClose: () => void;
}

const W = 1200, H = 630;

/** Fun title based on the shape of someone's board. */
function builderTitle(total: number, done: number, wip: number, dropped: number): string {
  if (total === 0) return 'The Fresh Start';
  if (done / total >= 0.5 && total >= 4) return 'The Serial Shipper';
  if (dropped > done && dropped >= 3) return 'The Graveyard Keeper';
  if (wip >= 5) return 'The Chaos Builder';
  if (total >= 10) return 'The Project Hoarder';
  if (done >= 1 && wip >= 1) return 'The Momentum Maker';
  return 'The Vibe Coder';
}

function drawSpiral(ctx: CanvasRenderingContext2D, cx: number, cy: number, maxR: number, color: string, lw: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const turns = 2.6, steps = 140, total = turns * Math.PI * 2;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total;
    const r = (t / total) * maxR;
    const x = cx + r * Math.cos(t), y = cy + r * Math.sin(t);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function orb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgba: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export default function ShareCard({ projects, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [captionCopied, setCaptionCopied] = useState(false);

  const total = projects.length;
  const done = projects.filter((p) => p.status === 'finished').length;
  const wip = projects.filter((p) => p.status === 'unfinished').length;
  const dropped = projects.filter((p) => p.status === 'dropped').length;
  const title = builderTitle(total, done, wip, dropped);

  const toolCounts = new Map<string, number>();
  for (const p of projects) for (const t of p.tools) toolCounts.set(t, (toolCounts.get(t) || 0) + 1);
  const topTools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

  const caption =
    `My build board: ${total} project${total === 1 ? '' : 's'} — ${done} shipped, ${wip} in progress, ${dropped} dropped. ` +
    `Apparently I'm ${title}. 🥷 Tracked with Trackix (free + 100% local) → github.com/Astaxxxx/trackix`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const F = (w: number, s: number) => `${w} ${s}px Inter, "Segoe UI", system-ui, sans-serif`;

    function render(mascot: HTMLImageElement | null) {
      /* ---- backdrop ---- */
      ctx.fillStyle = '#f4f1ec';
      ctx.fillRect(0, 0, W, H);
      orb(ctx, 1080, 40, 340, 'rgba(255,90,72,0.28)');
      orb(ctx, 80, 600, 300, 'rgba(255,172,64,0.20)');
      orb(ctx, 640, 320, 420, 'rgba(224,48,30,0.07)');
      // faint big spiral top-right
      drawSpiral(ctx, 1100, 90, 150, 'rgba(22,17,15,0.05)', 8);

      /* ---- header ---- */
      ctx.fillStyle = '#b01206';
      ctx.font = F(800, 22);
      ctx.fillText('MY BUILD BOARD', 64, 78);
      ctx.fillStyle = '#16110f';
      ctx.font = F(900, 64);
      ctx.fillText(`${total} project${total === 1 ? '' : 's'} tracked`, 60, 148);
      // builder title
      ctx.fillStyle = '#e0301e';
      ctx.font = `italic ${F(900, 40)}`;
      ctx.fillText(title, 62, 206);

      /* ---- stat tiles ---- */
      const tiles = [
        { label: 'IN PROGRESS', n: wip, color: '#e0301e' },
        { label: 'SHIPPED', n: done, color: '#16110f' },
        { label: 'DROPPED', n: dropped, color: '#b3a99d' },
      ];
      tiles.forEach((t, i) => {
        const x = 60 + i * 230, y = 250, w = 208, h = 128;
        ctx.save();
        ctx.shadowColor = 'rgba(22,17,15,0.12)';
        ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath(); ctx.roundRect(x, y, w, h, 18); ctx.fill();
        ctx.restore();
        ctx.fillStyle = t.color;
        ctx.beginPath(); ctx.roundRect(x, y, 7, h, { tl: 18, bl: 18, tr: 0, br: 0 } as never); ctx.fill();
        ctx.fillStyle = '#16110f';
        ctx.font = F(900, 52);
        ctx.fillText(String(t.n), x + 28, y + 72);
        ctx.fillStyle = '#6c625b';
        ctx.font = F(800, 15);
        ctx.fillText(t.label, x + 28, y + 102);
      });

      /* ---- top tools ---- */
      if (topTools.length) {
        ctx.fillStyle = '#a99e95';
        ctx.font = F(800, 16);
        ctx.fillText('POWERED BY', 62, 438);
        let cx = 60;
        ctx.font = F(700, 20);
        for (const tool of topTools) {
          const tw = ctx.measureText(tool).width + 36;
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.strokeStyle = '#e7e1d7';
          ctx.beginPath(); ctx.roundRect(cx, 456, tw, 44, 12); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#3b3330';
          ctx.fillText(tool, cx + 18, 485);
          cx += tw + 12;
          if (cx > 700) break;
        }
      }

      /* ---- mascot (right side) ---- */
      if (mascot) {
        const mh = 360, mw = (mascot.width / mascot.height) * mh;
        const mx = W - mw - 78, my = H - mh - 84;
        orb(ctx, mx + mw / 2, my + mh / 2, 230, 'rgba(224,48,30,0.30)');
        ctx.drawImage(mascot, mx, my, mw, mh);
      }

      /* ---- footer brand bar ---- */
      ctx.fillStyle = 'rgba(22,17,15,0.9)';
      ctx.beginPath(); ctx.roundRect(0, H - 66, W, 66, 0); ctx.fill();
      // spiral mark
      ctx.fillStyle = '#e0301e';
      ctx.beginPath(); ctx.arc(88, H - 33, 20, 0, Math.PI * 2); ctx.fill();
      drawSpiral(ctx, 88, H - 33, 13, '#ffffff', 3);
      ctx.fillStyle = '#ffffff';
      ctx.font = F(900, 22);
      ctx.fillText('TRACKIX', 122, H - 25);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = F(600, 16);
      ctx.fillText('track everything you build  ·  free & 100% local  ·  by Astax Labs', 246, H - 25);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('github.com/Astaxxxx/trackix', W - 40, H - 25);
      ctx.textAlign = 'left';
    }

    render(null);
    const img = new Image();
    img.onload = () => render(img);
    img.src = 'mascot.png';
  }, [total, done, wip, dropped, title, topTools.join(',')]);

  async function copyImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* clipboard may be unavailable */ }
    }, 'image/png');
  }

  function savePng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'trackix-ship-card.png';
    a.click();
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
      setCaptionCopied(true);
      setTimeout(() => setCaptionCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div className="modal" onClick={onClose}>
      <motion.div
        className="modal-card share-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Megaphone size={22} style={{ color: 'var(--red)' }} /> Ship Card
            </div>
            <div className="modal-sub">Your build board as a shareable image — flex it on X, LinkedIn or Discord.</div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <canvas ref={canvasRef} width={W} height={H} className="share-canvas" />

        <div className="share-actions">
          <button className="btn btn-primary" onClick={copyImage}>
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied!' : 'Copy image'}
          </button>
          <button className="btn" onClick={savePng}><Download size={15} /> Save PNG</button>
          <button className="btn" onClick={copyCaption}>
            {captionCopied ? <Check size={15} /> : <Copy size={15} />} {captionCopied ? 'Caption copied!' : 'Copy caption'}
          </button>
        </div>
        <div className="share-caption">{caption}</div>
      </motion.div>
    </div>
  );
}
