/* Generates build/icon.svg + build/icon.png (1024) for the app/desktop icon. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
mkdirSync(buildDir, { recursive: true });

function spiral(cx, cy, turns, maxR, steps) {
  let d = '';
  const total = turns * Math.PI * 2;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total;
    const r = (t / total) * maxR;
    const x = cx + r * Math.cos(t);
    const y = cy + r * Math.sin(t);
    d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
  }
  return d.trim();
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="g" cx="38%" cy="30%" r="85%">
      <stop offset="0%" stop-color="#ff5a48"/>
      <stop offset="55%" stop-color="#e0301e"/>
      <stop offset="100%" stop-color="#b01206"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="220" fill="url(#g)"/>
  <path d="${spiral(512, 512, 2.6, 330, 320)}" fill="none" stroke="#ffffff"
    stroke-width="74" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="512" cy="512" r="36" fill="#ffffff"/>
</svg>`;

writeFileSync(join(buildDir, 'icon.svg'), svg);

const sharp = (await import('sharp')).default;
await sharp(Buffer.from(svg)).png().resize(1024, 1024).toFile(join(buildDir, 'icon.png'));
console.log('Wrote build/icon.svg and build/icon.png (1024x1024)');
