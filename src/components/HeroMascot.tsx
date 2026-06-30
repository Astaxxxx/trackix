import { useRef, useState, type CSSProperties } from 'react';
import { Mascot } from './Assets';

/**
 * Innovative empty-state hero. All effects are original:
 *  - layered pulsing "chakra" aura
 *  - two counter-rotating energy rings (conic-gradient + radial mask)
 *  - rising ember particles
 *  - cursor-reactive 3D parallax tilt on the mascot
 * The art in the centre is whatever sits in the Mascot slot (their own image
 * via public/mascot.png, otherwise the clean spiral mark).
 */
export default function HeroMascot() {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5; // -0.5 .. 0.5
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ rx: -py * 16, ry: px * 18 });
  }
  function reset() { setTilt({ rx: 0, ry: 0 }); }

  return (
    <div className="hero-stage" ref={ref} onMouseMove={onMove} onMouseLeave={reset}>
      <div className="hero-aura" />
      <div className="hero-ring" />
      <div className="hero-ring r2" />
      <div className="embers">
        {Array.from({ length: 8 }).map((_, i) => (
          <span
            key={i}
            className="ember"
            style={{ '--x': `${8 + i * 11}%`, '--d': `${3 + (i % 4) * 0.8}s`, '--delay': `${i * 0.5}s` } as CSSProperties}
          />
        ))}
      </div>
      <div
        className="hero-art"
        style={{ transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)` }}
      >
        <Mascot size={210} />
      </div>
      <div className="hero-pedestal" />
    </div>
  );
}
