/** Hand-rolled Uzumaki-style spiral marks (no external assets). */

function spiralPath(cx: number, cy: number, turns: number, maxR: number, steps = 220): string {
  let d = '';
  const total = turns * Math.PI * 2;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total;
    const r = (t / total) * maxR;
    const x = cx + r * Math.cos(t);
    const y = cy + r * Math.sin(t);
    d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
  }
  return d.trim();
}

/** The Trackix logo: a vermilion seal with a white swirl. */
export function TrackixMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Trackix">
      <defs>
        <radialGradient id="tx-red" cx="38%" cy="32%" r="80%">
          <stop offset="0%" stopColor="#ff5a48" />
          <stop offset="55%" stopColor="#e0301e" />
          <stop offset="100%" stopColor="#b01206" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#tx-red)" />
      <path
        d={spiralPath(50, 50, 2.6, 36)}
        fill="none" stroke="#fff" strokeWidth="6"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.96"
      />
      <circle cx="50" cy="50" r="3.4" fill="#fff" />
    </svg>
  );
}

/**
 * Trackix mascot — an ORIGINAL masked chibi ninja. Deliberately NOT any existing
 * character: the headband bears the Trackix spiral (our own mark), there are no
 * franchise symbols, and the face is masked. Safe to ship.
 */
export function ChibiNinja({ size = 180, faded = false }: { size?: number; faded?: boolean }) {
  const skin = faded ? '#d7cec5' : '#f4d6b6';
  const ink = faded ? '#cdc4bb' : '#191310';
  const ink2 = faded ? '#c4bbb2' : '#241d18';
  const red = faded ? '#d2c9c0' : '#e0301e';
  const redDeep = faded ? '#c8bfb6' : '#b01206';
  const metal = faded ? '#d7cec5' : '#d3d7da';
  const metalEdge = faded ? '#c4bbb2' : '#9aa0a3';
  const eyeW = faded ? '#efe9e2' : '#f8f1e9';

  return (
    <svg width={size} height={size} viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" aria-label="Trackix ninja">
      {/* ---- shoulders / cloak ---- */}
      <path d="M64 172 C42 182 33 210 31 240 L209 240 C207 210 198 182 176 172 C164 184 144 190 120 190 C96 190 76 184 64 172 Z" fill={ink} />
      {/* red scarf + flowing tail */}
      <path d="M148 166 C172 170 186 188 179 212 C173 197 160 185 143 179 Z" fill={redDeep} />
      <path d="M88 170 C100 184 140 184 152 170 C150 160 146 154 142 150 C132 158 108 158 98 150 C94 154 90 160 88 170 Z" fill={red} />

      {/* ---- head ---- */}
      <ellipse cx="120" cy="100" rx="52" ry="50" fill={skin} />
      {/* cheek blush */}
      {!faded && <>
        <ellipse cx="88" cy="104" rx="8" ry="4.4" fill="#e0301e" opacity="0.18" />
        <ellipse cx="152" cy="104" rx="8" ry="4.4" fill="#e0301e" opacity="0.18" />
      </>}

      {/* ---- ninja mask (covers lower face) ---- */}
      <path d="M74 98 C86 112 100 116 120 116 C140 116 154 112 166 98 C166 132 150 152 120 152 C90 152 74 132 74 98 Z" fill={ink} />
      <path d="M120 116 L120 152" stroke="#000" strokeOpacity={faded ? 0 : 0.18} strokeWidth="2" />

      {/* ---- eyes (calm, half-lidded) ---- */}
      {[100, 140].map((cx) => (
        <g key={cx}>
          <path d={`M${cx - 12} 96 Q${cx} 90 ${cx + 12} 96 Q${cx} 103 ${cx - 12} 96 Z`} fill={eyeW} />
          <ellipse cx={cx} cy="98" rx="5.4" ry="6.2" fill={faded ? '#b7aea5' : '#241c1a'} />
          {!faded && <circle cx={cx - 2} cy="95.5" r="1.7" fill="#fff" />}
          <path d={`M${cx - 13} 93 Q${cx} 99 ${cx + 13} 92`} stroke={ink} strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      ))}
      {/* eyebrows */}
      <path d="M86 81 Q97 78 107 83" stroke={ink} strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M154 81 Q143 78 133 83" stroke={ink} strokeWidth="3" fill="none" strokeLinecap="round" />

      {/* ---- hair ---- */}
      <path d="M60 112 C50 44 190 44 180 112 C180 80 154 58 120 58 C86 58 60 80 60 112 Z" fill={ink} />
      {/* spikes */}
      <path d="M92 58 L100 30 L114 60 Z" fill={ink} />
      <path d="M116 60 L128 26 L140 58 Z" fill={ink} />
      <path d="M138 60 L150 31 L160 62 Z" fill={ink} />
      {/* long side locks */}
      <path d="M60 94 C49 132 56 168 75 184 C72 156 64 120 79 100 Z" fill={ink} />
      <path d="M180 94 C191 132 184 168 165 184 C168 156 176 120 161 100 Z" fill={ink} />

      {/* ---- headband ---- */}
      <path d="M58 62 Q120 53 182 62 L182 81 Q120 73 58 81 Z" fill={ink2} />
      {/* knot tails */}
      <path d="M178 67 C201 71 211 89 204 108 C198 93 188 85 176 83 Z" fill={ink2} />
      <path d="M181 76 C199 85 205 100 198 115 C195 102 187 93 179 88 Z" fill={ink} />
      {/* metal plate */}
      <path d="M98 60 Q120 56 142 60 L142 81 Q120 76 98 81 Z" fill={metal} stroke={metalEdge} strokeWidth="1.4" />
      <path d="M98 60 Q120 56 142 60 L142 66 Q120 62 98 66 Z" fill="#ffffff" opacity={faded ? 0 : 0.4} />
      {/* the Trackix spiral insignia (our own mark) */}
      <path d={spiralPath(120, 70, 2.2, 7.5, 90)} fill="none" stroke={red} strokeWidth="2.3" strokeLinecap="round" />
    </svg>
  );
}

/** Faint ink spiral for the ambient background. */
export function BgSpiral() {
  return (
    <svg className="bg-spiral" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path
        d={spiralPath(50, 50, 4, 46, 360)}
        fill="none" stroke="#16110f" strokeWidth="2.2" strokeLinecap="round"
      />
    </svg>
  );
}
