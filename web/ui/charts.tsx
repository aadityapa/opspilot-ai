import { useId, useState } from 'react';

/**
 * Small, dependency-free SVG charts. Every chart takes real series from the API; none of them
 * smooth, extrapolate or invent points. Hover reveals exact values.
 */

const nice = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Number.isInteger(n) ? String(n) : n.toFixed(1));

export function AreaChart({ series, labels, height = 160, width = 600, colors = ['var(--accent)', 'var(--success)'], names = [], ariaLabel, format = (v: number) => nice(v), max: forcedMax, detail }: {
  /** A null is a gap — a day with nothing to measure — and is drawn as one, never as zero. */
  series: (number | null)[][]; labels: string[]; height?: number; width?: number; colors?: string[]; names?: string[]; ariaLabel: string; format?: (v: number) => string; max?: number;
  /** Extra facts for the hovered point, shown in the legend line. */
  detail?: (i: number) => React.ReactNode;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const w = width, padL = 34, padR = 8, padT = 10, padB = 22;
  const n = labels.length;
  const values = series.flat().filter((v): v is number => v !== null);
  const max = forcedMax ?? Math.max(1, ...values);
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (w - padL - padR));
  const y = (v: number) => padT + (1 - v / max) * (height - padT - padB);
  // Runs of consecutive measured points become separate segments, so gaps stay gaps.
  const runs = (s: (number | null)[]) => { const out: { i: number; v: number }[][] = []; let cur: { i: number; v: number }[] = []; s.forEach((v, i) => { if (v === null) { if (cur.length) out.push(cur); cur = []; } else cur.push({ i, v }); }); if (cur.length) out.push(cur); return out; };
  const path = (run: { i: number; v: number }[]) => run.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(n / Math.max(4, Math.round(w / 90))));
  return (
    <figure className="chart" aria-label={ariaLabel}>
      <svg viewBox={`0 0 ${w} ${height}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * w; const i = Math.round(((px - padL) / (w - padL - padR)) * (n - 1)); setHover(Math.max(0, Math.min(n - 1, i))); }}>
        <defs>{series.map((_, k) => <linearGradient key={k} id={`${id}-g${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors[k]} stopOpacity="0.22" /><stop offset="100%" stopColor={colors[k]} stopOpacity="0" /></linearGradient>)}</defs>
        {ticks.map((t) => <g key={t}><line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className="chart-grid" /><text x={padL - 6} y={y(t) + 3} className="chart-tick" textAnchor="end">{format(t)}</text></g>)}
        {series.map((s, k) => runs(s).filter((r) => r.length > 1).map((run, j) => <path key={`a${k}-${j}`} d={`${path(run)} L${x(run[run.length - 1].i)},${y(0)} L${x(run[0].i)},${y(0)} Z`} fill={`url(#${id}-g${k})`} />))}
        {series.map((s, k) => runs(s).map((run, j) => run.length > 1
          ? <path key={`l${k}-${j}`} d={path(run)} fill="none" stroke={colors[k]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          : <circle key={`p${k}-${j}`} cx={x(run[0].i)} cy={y(run[0].v)} r="2.5" fill={colors[k]} />))}
        {labels.map((l, i) => ((i % every === 0 && n - 1 - i >= every) || i === n - 1) && <text key={`${l}-${i}`} x={x(i)} y={height - 6} className="chart-tick" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{l}</text>)}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={height - padB} className="chart-cursor" />
            {series.map((s, k) => s[hover] !== null && <circle key={k} cx={x(hover)} cy={y(s[hover] as number)} r="4" fill={colors[k]} stroke="var(--surface)" strokeWidth="2" />)}
          </g>
        )}
      </svg>
      <figcaption className="chart-legend">
        {names.map((nm, k) => <span key={nm}><i style={{ background: colors[k] }} />{nm}{hover !== null && <strong> {series[k][hover] === null ? '—' : format(series[k][hover] as number)}</strong>}</span>)}
        {hover !== null && <span className="muted">{labels[hover]}</span>}
        {hover !== null && detail && <span className="chart-detail">{detail(hover)}</span>}
      </figcaption>
    </figure>
  );
}

/** One horizontal bar split into segments — the "operational health" and distribution strips. */
export function SegmentBar({ segments, height = 10, ariaLabel }: { segments: { label: string; value: number; color: string }[]; height?: number; ariaLabel: string }) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  return (
    <div className="segbar" role="img" aria-label={`${ariaLabel}: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
      <div className="segbar-track" style={{ height }}>
        {segments.filter((s) => s.value > 0).map((s) => <span key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`} />)}
      </div>
      <div className="segbar-legend">
        {segments.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}<strong>{Math.round((s.value / total) * 100)}%</strong><small>{s.value}</small></span>)}
      </div>
    </div>
  );
}

/** Ranked horizontal bars with the value at the end. */
export function RankBars({ rows, color = 'var(--accent)', max: forcedMax, format = (n: number) => String(n) }: { rows: { label: React.ReactNode; value: number; href?: string; color?: string }[]; color?: string; max?: number; format?: (n: number) => string }) {
  const max = Math.max(1, forcedMax ?? Math.max(...rows.map((r) => r.value)));
  return (
    <div className="rankbars">
      {rows.map((r, i) => (
        <div className="rankbar" key={i}>
          <span className="rankbar-label">{r.href ? <a href={r.href}>{r.label}</a> : r.label}</span>
          <span className="rankbar-track"><i style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} /></span>
          <strong className="rankbar-value">{format(r.value)}</strong>
        </div>
      ))}
    </div>
  );
}

/** A ring gauge for a single percentage. Sparing use only. */
export function Ring({ percent, size = 88, stroke = 8, color = 'var(--success)', label, sub }: { percent: number | null; size?: number; stroke?: number; color?: string; label: React.ReactNode; sub?: React.ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${percent === null ? 'no data' : `${percent}%`}`}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-label"><strong>{percent === null ? '—' : `${percent}%`}</strong>{sub && <small>{sub}</small>}</div>
    </div>
  );
}

export function Sparkline({ values, color = 'var(--accent)', width = 96, height = 28 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values), n = values.length;
  const pts = values.map((v, i) => `${(i / (n - 1)) * width},${height - 2 - (v / max) * (height - 4)}`).join(' ');
  return <svg className="sparkline-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
