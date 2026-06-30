/*
 * Turn a licensed sticker JPG (which has a checkerboard "fake transparency"
 * background baked into the pixels) into a clean transparent PNG for the
 * mascot slot. Flood-fills the bright, low-saturation checkerboard inward
 * from the edges, stops at the character, then trims + centres.
 *
 * Usage: node scripts/cutout-mascot.mjs "C:/path/to/source.jpg"
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC) { console.error('Pass the source image path.'); process.exit(1); }

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'mascot.png');

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const N = W * H;

// "Background-like" = bright AND nearly grey (the white/grey checker squares
// and the white sticker outline). The character is darker or saturated.
function bgLike(i) {
  const o = i * C, r = data[o], g = data[o + 1], b = data[o + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mn > 165 && (mx - mn) < 36;
}

const isBg = new Uint8Array(N);
const seen = new Uint8Array(N);
const stack = [];
for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
for (let y = 0; y < H; y++) { stack.push(y * W, y * W + (W - 1)); }

while (stack.length) {
  const i = stack.pop();
  if (seen[i]) continue;
  seen[i] = 1;
  if (!bgLike(i)) continue;
  isBg[i] = 1;
  const x = i % W, y = (i / W) | 0;
  if (x > 0) stack.push(i - 1);
  if (x < W - 1) stack.push(i + 1);
  if (y > 0) stack.push(i - W);
  if (y < H - 1) stack.push(i + W);
}

let cleared = 0;
for (let i = 0; i < N; i++) if (isBg[i]) { data[i * C + 3] = 0; cleared++; }

await sharp(data, { raw: { width: W, height: H, channels: 4 } })
  .trim({ threshold: 8 })
  .resize(640, 640, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(OUT);

console.log(`Cut out ${(cleared / N * 100).toFixed(1)}% as transparent → ${OUT}`);
