import { useState } from 'react';
import { ChibiNinja } from './Marks';

/**
 * Drop-in image slots. Save a PNG into the app's `public/` folder and it is
 * used automatically; otherwise we fall back to the built-in vector art.
 *
 *   public/mascot.png      → the chibi mascot (empty state + background)
 *   public/astax-logo.png  → your Astax Labs logo (footer)
 *
 * Using a real file keeps copyrighted character art out of the source tree
 * while still letting you personalise your own copy.
 */

export function Mascot({ size = 190 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ChibiNinja size={size} />;
  return (
    <img
      src="mascot.png"
      alt="Trackix mascot"
      style={{ width: size, height: 'auto', objectFit: 'contain', display: 'block' }}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

export function AstaxLogo({ size = 19 }: { size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="astax-mark">A</span>;
  return (
    <img
      src="astax-logo.png"
      alt="Astax Labs"
      style={{ height: size, width: 'auto', display: 'block', borderRadius: 5 }}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
