import { useEffect, useId, useState } from 'react';

/**
 * Original illustration components. Everything here is drawn in SVG from primitives: no product
 * renders, no stock photos, no external files. The pieces share one material vocabulary with the
 * rest of the interface — matte navy bodies, a glossy upper sheen, indigo/violet light — so an
 * illustration reads as part of the product rather than a sticker on top of it.
 *
 * Every component is decorative (aria-hidden) unless it is the only content, in which case the
 * caller supplies a label.
 */

const useGradients = (id: string) => ({
  body: `url(#${id}-body)`, screen: `url(#${id}-screen)`, sheen: `url(#${id}-sheen)`, accent: `url(#${id}-accent)`, glow: `url(#${id}-glow)`,
});
function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a3550" /><stop offset="1" stopColor="#121a2c" /></linearGradient>
      <linearGradient id={`${id}-screen`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3f4dff" /><stop offset="0.55" stopColor="#5a3ff0" /><stop offset="1" stopColor="#1b1f5e" /></linearGradient>
      <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity="0.28" /><stop offset="0.5" stopColor="#ffffff" stopOpacity="0.02" /><stop offset="0.52" stopColor="#ffffff" stopOpacity="0" /></linearGradient>
      <linearGradient id={`${id}-accent`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7a84ff" /><stop offset="1" stopColor="#7756f6" /></linearGradient>
      <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#5965ff" stopOpacity="0.45" /><stop offset="1" stopColor="#5965ff" stopOpacity="0" /></radialGradient>
    </defs>
  );
}

/* ── Device silhouettes — generic, never a specific product ──────────── */
export type DeviceKind = 'LAPTOP' | 'DESKTOP' | 'MONITOR' | 'PHONE' | 'TABLET' | 'PRINTER' | 'NETWORK' | 'OTHER';
export const deviceKind = (type: string | null | undefined): DeviceKind => {
  const t = (type ?? '').toUpperCase();
  if (/LAPTOP|NOTEBOOK/.test(t)) return 'LAPTOP';
  if (/DESKTOP|WORKSTATION|TOWER/.test(t)) return 'DESKTOP';
  if (/MONITOR|DISPLAY|SCREEN/.test(t)) return 'MONITOR';
  if (/PHONE|MOBILE/.test(t)) return 'PHONE';
  if (/TABLET|PAD/.test(t)) return 'TABLET';
  if (/PRINT/.test(t)) return 'PRINTER';
  if (/NETWORK|ROUTER|SWITCH|ACCESS/.test(t)) return 'NETWORK';
  return 'OTHER';
};

/** A generic device drawn from primitives. `size` is the box width; the height follows the 4:3 canvas. */
export function DeviceArt({ type, size = 120, className }: { type: string | null | undefined; size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const g = useGradients(id);
  const kind = deviceKind(type);
  const h = Math.round(size * 0.75);
  return (
    <svg className={`device-art ${className ?? ''}`} width={size} height={h} viewBox="0 0 160 120" aria-hidden="true">
      <Defs id={id} />
      <ellipse cx="80" cy="104" rx="62" ry="9" fill={g.glow} />
      {kind === 'LAPTOP' && (
        <g>
          <rect x="30" y="24" width="100" height="62" rx="6" fill={g.body} stroke="#3a4763" />
          <rect x="36" y="30" width="88" height="50" rx="3" fill={g.screen} />
          <rect x="36" y="30" width="88" height="50" rx="3" fill={g.sheen} />
          <path d="M18 88h124l6 8H12z" fill="#1c2740" stroke="#3a4763" />
          <rect x="66" y="88" width="28" height="3" rx="1.5" fill="#3a4763" />
          <circle cx="80" cy="27" r="1.4" fill="#8795b1" />
        </g>
      )}
      {kind === 'DESKTOP' && (
        <g>
          <rect x="16" y="26" width="90" height="56" rx="5" fill={g.body} stroke="#3a4763" />
          <rect x="22" y="32" width="78" height="44" rx="3" fill={g.screen} />
          <rect x="22" y="32" width="78" height="44" rx="3" fill={g.sheen} />
          <rect x="52" y="82" width="18" height="10" fill="#1c2740" /><rect x="40" y="92" width="42" height="4" rx="2" fill="#3a4763" />
          <rect x="112" y="20" width="32" height="74" rx="4" fill={g.body} stroke="#3a4763" />
          <rect x="118" y="26" width="20" height="3" rx="1.5" fill="#3a4763" /><rect x="118" y="32" width="20" height="3" rx="1.5" fill="#3a4763" />
          <circle cx="128" cy="86" r="2.5" fill={g.accent} />
        </g>
      )}
      {kind === 'MONITOR' && (
        <g>
          <rect x="24" y="20" width="112" height="66" rx="5" fill={g.body} stroke="#3a4763" />
          <rect x="30" y="26" width="100" height="54" rx="3" fill={g.screen} />
          <rect x="30" y="26" width="100" height="54" rx="3" fill={g.sheen} />
          <rect x="72" y="86" width="16" height="8" fill="#1c2740" /><rect x="56" y="94" width="48" height="4" rx="2" fill="#3a4763" />
        </g>
      )}
      {kind === 'PHONE' && (
        <g>
          <rect x="56" y="12" width="48" height="92" rx="9" fill={g.body} stroke="#3a4763" />
          <rect x="61" y="20" width="38" height="70" rx="5" fill={g.screen} />
          <rect x="61" y="20" width="38" height="70" rx="5" fill={g.sheen} />
          <rect x="73" y="96" width="14" height="2.5" rx="1.25" fill="#8795b1" />
        </g>
      )}
      {kind === 'TABLET' && (
        <g>
          <rect x="40" y="14" width="80" height="90" rx="8" fill={g.body} stroke="#3a4763" />
          <rect x="46" y="21" width="68" height="76" rx="4" fill={g.screen} />
          <rect x="46" y="21" width="68" height="76" rx="4" fill={g.sheen} />
        </g>
      )}
      {kind === 'PRINTER' && (
        <g>
          <rect x="44" y="20" width="72" height="26" rx="3" fill="#1c2740" stroke="#3a4763" />
          <rect x="26" y="44" width="108" height="42" rx="6" fill={g.body} stroke="#3a4763" />
          <rect x="40" y="52" width="80" height="6" rx="3" fill={g.accent} opacity="0.85" />
          <rect x="44" y="86" width="72" height="12" rx="2" fill="#1c2740" stroke="#3a4763" />
        </g>
      )}
      {kind === 'NETWORK' && (
        <g>
          <rect x="24" y="52" width="112" height="30" rx="6" fill={g.body} stroke="#3a4763" />
          {[40, 52, 64, 76].map((x) => <circle key={x} cx={x} cy="67" r="3" fill={g.accent} />)}
          <path d="M100 52V30M118 52V38" stroke="#8795b1" strokeWidth="3" strokeLinecap="round" />
        </g>
      )}
      {kind === 'OTHER' && (
        <g>
          <path d="M80 18l48 22v40l-48 22-48-22V40z" fill={g.body} stroke="#3a4763" />
          <path d="M80 18l48 22-48 22-48-22z" fill={g.screen} /><path d="M80 18l48 22-48 22-48-22z" fill={g.sheen} />
        </g>
      )}
    </svg>
  );
}

/* ── Knowledge: laptop, shield and a small network ────────────────────── */
export function KnowledgeArt({ width = 260, className }: { width?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const g = useGradients(id);
  return (
    <svg className={`knowledge-art ${className ?? ''}`} width={width} height={Math.round(width * 0.62)} viewBox="0 0 260 160" aria-hidden="true">
      <Defs id={id} />
      <ellipse cx="130" cy="128" rx="110" ry="22" fill={g.glow} />
      {/* network behind */}
      <g stroke="#5965ff" strokeOpacity="0.55" strokeWidth="1.5">
        <path d="M40 40L88 24L132 46L176 22L224 44" fill="none" />
        <path d="M88 24L96 62M176 22L164 60M132 46L130 80" fill="none" />
      </g>
      {[[40, 40], [88, 24], [132, 46], [176, 22], [224, 44], [96, 62], [164, 60]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.5" fill="#9aa3ff" />)}
      {/* laptop */}
      <rect x="58" y="56" width="128" height="72" rx="7" fill={g.body} stroke="#3a4763" />
      <rect x="66" y="64" width="112" height="56" rx="4" fill={g.screen} />
      <rect x="66" y="64" width="112" height="56" rx="4" fill={g.sheen} />
      <g stroke="#dfe4ff" strokeOpacity="0.8" strokeWidth="3" strokeLinecap="round"><path d="M84 82h40M84 94h64M84 106h52" /></g>
      <path d="M44 130h156l8 10H36z" fill="#1c2740" stroke="#3a4763" />
      {/* shield */}
      <path d="M204 74l30 11v22c0 20-13 32-30 40-17-8-30-20-30-40V85z" fill={g.accent} stroke="#c9b8ff" strokeOpacity="0.6" />
      <path d="M204 74l30 11v22c0 20-13 32-30 40z" fill="#ffffff" fillOpacity="0.12" />
      <path d="M192 108l9 9 18-20" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Sign-in orbit: a lit world with two rings, specular highlights and slow ambient drift ── */
export function OrbitArt({ size = 420 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  // Ambient motion runs only while the page is visible; the mark is complete when still.
  const [paused, setPaused] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const on = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return (
    <svg className={`orbit-art ${paused ? 'paused' : ''}`} width={size} height={size} viewBox="0 0 400 400" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-world`} cx="36%" cy="30%" r="72%"><stop offset="0" stopColor="#c8d2ff" /><stop offset="0.18" stopColor="#7b8bff" /><stop offset="0.5" stopColor="#4a55f0" /><stop offset="0.8" stopColor="#2a2a9a" /><stop offset="1" stopColor="#12123c" /></radialGradient>
        <radialGradient id={`${id}-spec`} cx="34%" cy="26%" r="30%"><stop offset="0" stopColor="#ffffff" stopOpacity="0.85" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}-rim`} cx="72%" cy="78%" r="55%"><stop offset="0" stopColor="#a78bfa" stopOpacity="0.5" /><stop offset="1" stopColor="#a78bfa" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%"><stop offset="0.45" stopColor="#5965ff" stopOpacity="0.32" /><stop offset="1" stopColor="#5965ff" stopOpacity="0" /></radialGradient>
        <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity="0.9" /><stop offset="0.5" stopColor="#c9d4ff" stopOpacity="0.55" /><stop offset="1" stopColor="#a78bfa" stopOpacity="0.35" /></linearGradient>
      </defs>
      <circle cx="200" cy="200" r="190" fill={`url(#${id}-halo)`} />
      {/* back half of the rings */}
      <g className="orbit-rings back">
        <ellipse cx="200" cy="200" rx="176" ry="62" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="2.5" transform="rotate(-24 200 200)" strokeDasharray="280 300" />
        <ellipse cx="200" cy="200" rx="140" ry="48" fill="none" stroke="#a78bfa" strokeOpacity="0.45" strokeWidth="1.5" transform="rotate(-24 200 200)" strokeDasharray="340 240" />
      </g>
      <circle cx="200" cy="200" r="92" fill={`url(#${id}-world)`} />
      <circle cx="200" cy="200" r="92" fill={`url(#${id}-rim)`} />
      <ellipse cx="172" cy="164" rx="34" ry="20" fill={`url(#${id}-spec)`} transform="rotate(-28 172 164)" />
      <circle cx="200" cy="200" r="92" fill="none" stroke="#ffffff" strokeOpacity="0.12" />
      {/* front half of the rings, drawn over the world */}
      <g className="orbit-rings front">
        <ellipse cx="200" cy="200" rx="176" ry="62" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="2.5" transform="rotate(-24 200 200)" strokeDasharray="250 330" />
        <circle cx="356" cy="132" r="9" fill="#f2f5ff" />
        <circle cx="356" cy="132" r="14" fill="#9aa3ff" fillOpacity="0.25" />
        <circle cx="52" cy="256" r="5" fill="#c9d4ff" />
      </g>
    </svg>
  );
}

/* ── Small report preview mark for the library cards ─────────────────── */
export function ReportGlyph({ kind, size = 20 }: { kind: string; size?: number }) {
  const bars = kind === 'departments' || kind === 'agents' ? [6, 12, 9, 14] : kind === 'csat' ? [4, 7, 10, 13, 15] : [8, 10, 7, 12, 9, 14];
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      {bars.map((b, i) => <rect key={i} x={1 + i * (18 / bars.length)} y={18 - b} width={Math.max(2, 18 / bars.length - 1.5)} height={b} rx="1" fill="currentColor" opacity={0.55 + (i / bars.length) * 0.45} />)}
    </svg>
  );
}
