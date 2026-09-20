import { useEffect, useState } from 'react';
import { api } from './api';
import { labels, priorities, type CurrentUser, type Department, type OperationsSummary } from '../shared/model';
import { Icon } from './ui/icons';
import { Avatar, EmptyState, ticketKey } from './ui';
import { AreaChart, SegmentBar } from './ui/charts';

/**
 * Operations Command Center.
 *
 * One request (`/api/operations/summary`) feeds every region; each figure is counted on the server
 * from stored tickets, SLA rows, events, surveys and assets for the chosen window and department.
 * The page never estimates: when a figure cannot be computed it says so. Operational regions
 * (queue, owners, countdowns, activity) and executive regions (health, SLA, flow, demand, CSAT) are
 * separate components so a role-based executive view can be assembled later without a rewrite.
 */

const RANGES: { days: number; label: string; long: string }[] = [
  { days: 1, label: '24H', long: 'Last 24 hours' },
  { days: 7, label: '7D', long: 'Last 7 days' },
  { days: 14, label: '14D', long: 'Last 14 days' },
  { days: 30, label: '30D', long: 'Last 30 days' },
];
const STATUS_WORD: Record<string, string> = { OPEN: 'Open', IN_PROGRESS: 'In Progress', WAITING_FOR_USER: 'Pending', RESOLVED: 'Resolved', CLOSED: 'Closed' };
const PRIORITY_CODE: Record<string, string> = { URGENT: 'P1', HIGH: 'P2', MEDIUM: 'P3', LOW: 'P4' };
const PRIORITY_WORD: Record<string, string> = { URGENT: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const PRIORITY_VAR: Record<string, string> = { URGENT: 'p1', HIGH: 'p2', MEDIUM: 'p3', LOW: 'p4' };

const hm = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '—';
  const total = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
const countdown = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(total / 60), m = total % 60;
  return h >= 100 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const mins = (n: number | null) => (n === null ? '—' : n < 1 ? '< 1m' : n >= 60 ? `${Math.floor(n / 60)}h ${String(Math.round(n % 60)).padStart(2, '0')}m` : `${Math.round(n)}m`);
const pctDelta = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

function Delta({ value, unit = '%', goodWhen = 'down', hint }: { value: number | null; unit?: string; goodWhen?: 'up' | 'down'; hint: string }) {
  if (value === null) return <small className="pulse-sub">{hint}</small>;
  const tone = value === 0 ? 'flat' : (value > 0) === (goodWhen === 'up') ? 'good' : 'bad';
  return <small className={`pulse-sub delta ${tone}`} title={hint}>{value > 0 ? '▲' : value < 0 ? '▼' : '•'} {Math.abs(value)}{unit} <span>{hint}</span></small>;
}

function useHashParams(route: string) {
  const q = new URLSearchParams(route.split('?')[1] ?? '');
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(route.split('?')[1] ?? '');
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    const qs = next.toString();
    location.hash = `/dashboard${qs ? `?${qs}` : ''}`;
  };
  return { days: Math.min(30, Math.max(1, Number(q.get('days')) || 7)), departmentId: q.get('departmentId') ?? '', set };
}

export function OverviewPage({ user, refresh, route }: { user: CurrentUser; refresh: number; route: string }) {
  const { days, departmentId, set } = useHashParams(route);
  const [data, setData] = useState<OperationsSummary | null>(null);
  const [error, setError] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tick, setTick] = useState(0);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  useEffect(() => { api<Department[]>('/departments').then(setDepartments).catch(() => {}); }, []);
  useEffect(() => {
    let live = true;
    setError('');
    api<OperationsSummary>(`/operations/summary?days=${days}${departmentId ? `&departmentId=${departmentId}` : ''}`)
      .then((s) => { if (live) { setData(s); setLoadedAt(new Date()); } })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [days, departmentId, refresh, tick]);

  const s = data;
  const dept = departments.find((d) => d.id === departmentId);
  return (
    <div className="cc">
      <header className="cc-head">
        <div className="cc-title">
          <p className="eyebrow">ENTERPRISE IT OPERATIONS</p>
          <h1>Operations Command Center</h1>
          <p className="cc-lead">Live operational health across incidents, requests, SLAs, services and support teams.</p>
          <p className="cc-meta">
            {loadedAt ? <>Last refreshed {loadedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</> : 'Loading…'}
            <span className="dot" aria-hidden="true">·</span><span className="live"><i />Live updates enabled</span>
            {dept && <><span className="dot" aria-hidden="true">·</span>Scoped to {dept.name}</>}
          </p>
        </div>
        <div className="cc-controls" role="group" aria-label="Dashboard filters">
          <label className="cc-select"><span className="sr-only">Time range</span>
            <select aria-label="Time range" value={days} onChange={(e) => set({ days: e.target.value === '7' ? '' : e.target.value })}>{RANGES.map((r) => <option key={r.days} value={r.days}>{r.long}</option>)}</select>
          </label>
          <label className="cc-select"><span className="sr-only">Department</span>
            <select aria-label="Department" value={departmentId} onChange={(e) => set({ departmentId: e.target.value })}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </label>
          <button onClick={() => setTick((t) => t + 1)} aria-label="Refresh dashboard"><Icon name="refresh" size={16} /><span className="refresh-word">Refresh</span></button>
          <a className="primary" href="#/tickets/new"><Icon name="plus" size={16} />Create incident</a>
        </div>
      </header>

      {error && !s && <div className="alert error" role="alert">{error} <button className="btn-sm" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
      {!s ? <DashboardSkeleton /> : (
        <>
          {error && <div className="alert warning" role="status">The last refresh failed ({error}); showing figures from {loadedAt?.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}. <button className="btn-sm" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
          <Pulse s={s} days={days} />
          <div className="cc-row health-row">
            <GlobalHealth s={s} />
            <ServicePressure s={s} />
          </div>
          <Attention s={s} user={user} />
          <div className="cc-grid">
            <div className="cc-col">
              <TicketFlow s={s} days={days} setDays={(d) => set({ days: d === 7 ? '' : String(d) })} />
              <CriticalWork s={s} />
              <TeamLoad s={s} />
              <LiveOperations s={s} />
            </div>
            <div className="cc-col">
              <SlaPerformance s={s} />
              <PriorityMix s={s} />
              <WorkType s={s} />
              <AssetSignals s={s} />
              <AskStrip />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Skeleton that mirrors the final layout ──────────────────────────── */
function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the command center">
      <div className="pulse skeleton-surface" style={{ height: 96 }} />
      <div className="cc-row health-row"><div className="skeleton-surface" style={{ height: 150 }} /><div className="skeleton-surface" style={{ height: 150 }} /></div>
      <div className="skeleton-surface" style={{ height: 120, marginBottom: 'var(--s5)' }} />
      <div className="cc-grid"><div className="cc-col"><div className="skeleton-surface" style={{ height: 320 }} /><div className="skeleton-surface" style={{ height: 260 }} /></div><div className="cc-col"><div className="skeleton-surface" style={{ height: 260 }} /><div className="skeleton-surface" style={{ height: 180 }} /></div></div>
    </div>
  );
}

/* ── Service operations pulse ─────────────────────────────────────────── */
function Pulse({ s, days }: { s: OperationsSummary; days: number }) {
  const p1 = s.active.unassignedByPriority.URGENT ?? 0, p2 = s.active.unassignedByPriority.HIGH ?? 0;
  const priorityUnowned = [p1 ? `${p1} P1` : '', p2 ? `${p2} P2` : ''].filter(Boolean).join(' · ');
  const compliance = s.sla.resolutionCompliancePercent;
  return (
    <section className="pulse" aria-label="Service operations pulse">
      <p className="eyebrow pulse-eyebrow">Service operations pulse</p>
      <a className="pulse-cell" href="#/tickets">
        <span className="pulse-label">Active</span>
        <strong className="pulse-value">{s.active.total.toLocaleString()}</strong>
        <Delta value={pctDelta(s.flow.created, s.flow.previousCreated)} goodWhen="down" hint={`${s.flow.created} new · ${RANGES.find((r) => r.days === days)?.long.toLowerCase() ?? ''}`} />
      </a>
      <a className={`pulse-cell ${s.active.unassigned ? 'warn' : ''}`} href="#/tickets?assigned=unassigned">
        <span className="pulse-label">Unassigned</span>
        <strong className="pulse-value">{s.active.unassigned}</strong>
        <small className="pulse-sub">{priorityUnowned ? <><b className={p1 ? 'crit-text' : 'warn-text'}>{priorityUnowned}</b> · oldest {hm(s.active.oldestUnassignedAgeMs)}</> : s.active.unassigned ? `oldest ${hm(s.active.oldestUnassignedAgeMs)}` : 'Every ticket has an owner'}</small>
      </a>
      <a className={`pulse-cell ${s.sla.atRisk ? 'warn' : ''}`} href="#/board">
        <span className="pulse-label">SLA at risk</span>
        <strong className="pulse-value">{s.sla.atRisk}</strong>
        <small className="pulse-sub">{s.sla.atRisk ? `${s.sla.atRiskUnder30Min} under 30 min` : 'No ticket near a deadline'}</small>
      </a>
      <a className={`pulse-cell ${s.sla.activeBreached ? 'crit' : 'ok'}`} href="#/tickets">
        <span className="pulse-label">SLA breached</span>
        <strong className="pulse-value">{s.sla.activeBreached}</strong>
        <small className="pulse-sub">{s.sla.activeBreached ? `oldest breach ${hm(s.sla.oldestBreachAgeMs)}` : 'All active work inside SLA'}</small>
      </a>
      <div className="pulse-cell">
        <span className="pulse-label">MTTR</span>
        <strong className="pulse-value">{mins(s.mttrMinutes)}</strong>
        <Delta value={s.mttrMinutes !== null && s.previousMttrMinutes !== null ? Math.round(s.mttrMinutes - s.previousMttrMinutes) : null} unit="m" goodWhen="down" hint={s.mttrMinutes === null ? 'Nothing resolved in this window' : s.previousMttrMinutes === null ? 'No previous window to compare' : 'vs previous window'} />
      </div>
      <a className="pulse-cell" href="#/desk?view=analytics">
        <span className="pulse-label">SLA compliance</span>
        <strong className="pulse-value">{compliance === null ? '—' : `${compliance.toFixed(1)}%`}</strong>
        <small className="pulse-sub">{compliance === null ? 'No resolved tickets measured yet' : `response ${s.sla.responseCompliancePercent === null ? '—' : `${s.sla.responseCompliancePercent.toFixed(1)}%`} · ${s.sla.resolutionMeasured} measured`}</small>
      </a>
      <a className="pulse-cell" href="#/reports">
        <span className="pulse-label">CSAT</span>
        <strong className="pulse-value">{s.csat.average === null ? '—' : <>{s.csat.average.toFixed(2)}<span className="pulse-unit"> / 5</span></>}</strong>
        <Delta value={s.csat.average !== null && s.csat.previousAverage !== null ? Math.round((s.csat.average - s.csat.previousAverage) * 100) / 100 : null} unit="" goodWhen="up" hint={s.csat.responses ? `${s.csat.responses} response${s.csat.responses === 1 ? '' : 's'}` : 'No ratings in this window'} />
      </a>
    </section>
  );
}

/* ── Global operational health ─────────────────────────────────────────── */
function GlobalHealth({ s }: { s: OperationsSummary }) {
  const breached = s.sla.activeBreached, atRisk = s.sla.atRisk;
  const healthy = Math.max(0, s.active.total - breached - atRisk);
  const pct = s.active.total ? Math.round((healthy / s.active.total) * 1000) / 10 : null;
  return (
    <section className="health" aria-labelledby="health-h">
      <div className="health-main">
        <p className="eyebrow" id="health-h">Global operational health</p>
        <div className="health-figure">
          <strong className={pct === null ? '' : pct >= 95 ? 'ok' : pct >= 85 ? 'warn' : 'crit'}>{pct === null ? '—' : `${pct}%`}</strong>
          <span>of active work is inside its service targets<small>Derived from the SLA position of every active ticket · {s.active.total} active</small></span>
        </div>
        <SegmentBar ariaLabel="Operational health of active tickets" height={14} segments={[{ label: 'Healthy', value: healthy, color: 'var(--success)' }, { label: 'At risk', value: atRisk, color: 'var(--warning)' }, { label: 'Breached', value: breached, color: 'var(--danger)' }]} />
        <dl className="health-facts">
          <div><dt>Owned</dt><dd className={s.active.total && s.active.unassigned / s.active.total > 0.25 ? 'warn-text' : ''}>{s.active.total ? Math.round(((s.active.total - s.active.unassigned) / s.active.total) * 100) : 0}%<small>{s.active.total - s.active.unassigned} of {s.active.total} have an owner</small></dd></div>
          <div><dt>In progress</dt><dd>{s.active.byStatus.IN_PROGRESS ?? 0}<small>{s.active.byStatus.OPEN ?? 0} open · {s.active.byStatus.WAITING_FOR_USER ?? 0} pending user</small></dd></div>
          <div><dt>Oldest unowned</dt><dd className={s.active.oldestUnassignedAgeMs && s.active.oldestUnassignedAgeMs > 4 * 3600000 ? 'warn-text' : ''}>{hm(s.active.oldestUnassignedAgeMs)}<small>{s.active.unassigned ? 'waiting for an owner' : 'nothing unowned'}</small></dd></div>
          <div><dt>Net backlog</dt><dd className={s.flow.backlogChange > 0 ? 'crit-text' : s.flow.backlogChange < 0 ? 'ok-text' : ''}>{s.flow.backlogChange > 0 ? '+' : ''}{s.flow.backlogChange}<small>created minus resolved in window</small></dd></div>
        </dl>
      </div>
    </section>
  );
}

/* ── Services under pressure (categories = service areas) ─────────────── */
function ServicePressure({ s }: { s: OperationsSummary }) {
  const rows = s.categories.slice(0, 5);
  const state = (c: OperationsSummary['categories'][number]) => (c.breached ? 'Critical' : c.atRisk ? 'Degraded' : 'Healthy');
  const under = rows.filter((c) => c.breached || c.atRisk);
  return (
    <section className="pressure" aria-labelledby="pressure-h">
      <div className="section-title"><p className="eyebrow" id="pressure-h">Service areas</p><span className="muted t-caption">By ticket category · SLA-derived</span></div>
      {rows.length ? (
        <ul className="pressure-list">
          {rows.map((c) => (
            <li key={c.id} className={state(c).toLowerCase()}>
              <a href={`#/tickets?q=${encodeURIComponent(c.name)}`}>
                <span className="pressure-name">{c.name}</span>
                <span className="pressure-meta">{c.active} active{c.unassigned ? ` · ${c.unassigned} unowned` : ''}{c.atRisk ? ` · ${c.atRisk} at risk` : ''}{c.breached ? ` · ${c.breached} breached` : ''}</span>
                <span className="pressure-state"><i />{state(c)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : <p className="muted t-sm">No active tickets in any service area.</p>}
      {rows.length > 0 && !under.length && <p className="muted t-caption pressure-foot"><Icon name="check" size={12} /> No service area is degraded or critical.</p>}
    </section>
  );
}

/* ── Needs your attention ─────────────────────────────────────────────── */
function Attention({ s, user }: { s: OperationsSummary; user: CurrentUser }) {
  type Item = { rank: number; level: string; tone: 'critical' | 'high' | 'warning' | 'info'; title: string; detail: string; href: string; action: string; icon: string };
  const items: Item[] = [];
  const priorityUnassigned = (s.active.unassignedByPriority.URGENT ?? 0) + (s.active.unassignedByPriority.HIGH ?? 0);
  if (s.sla.activeBreached) items.push({ rank: 0, level: 'Critical', tone: 'critical', icon: 'alert', title: `${s.sla.activeBreached} SLA breach${s.sla.activeBreached === 1 ? '' : 'es'} require${s.sla.activeBreached === 1 ? 's' : ''} intervention`, detail: `Oldest breach: ${hm(s.sla.oldestBreachAgeMs)}`, href: '#/tickets', action: 'Review breaches' });
  if (priorityUnassigned) items.push({ rank: 1, level: 'High', tone: 'high', icon: 'zap', title: `${priorityUnassigned} priority incident${priorityUnassigned === 1 ? '' : 's'} remain${priorityUnassigned === 1 ? 's' : ''} unassigned`, detail: `${s.active.unassignedByPriority.URGENT ?? 0} P1 · ${s.active.unassignedByPriority.HIGH ?? 0} P2 · oldest unassigned: ${hm(s.active.oldestUnassignedAgeMs)}`, href: '#/tickets?assigned=unassigned&priority=URGENT', action: 'Assign incidents' });
  if (s.sla.atRisk) items.push({ rank: 2, level: 'SLA', tone: 'warning', icon: 'clock', title: `${s.sla.atRisk} ticket${s.sla.atRisk === 1 ? '' : 's'} approaching breach`, detail: `${s.sla.atRiskUnder30Min} with less than 30 minutes left`, href: '#/board', action: 'Review SLA' });
  if (s.active.unassigned - priorityUnassigned > 0) items.push({ rank: 3, level: 'Ownership', tone: 'warning', icon: 'users', title: `${s.active.unassigned} active ticket${s.active.unassigned === 1 ? '' : 's'} ha${s.active.unassigned === 1 ? 's' : 've'} no owner`, detail: `${s.active.total ? Math.round((s.active.unassigned / s.active.total) * 100) : 0}% of the active queue · oldest ${hm(s.active.oldestUnassignedAgeMs)}`, href: '#/tickets?assigned=unassigned', action: 'Assign owners' });
  const eng = s.engineers;
  if (eng.length > 1) {
    const median = [...eng].sort((a, b) => a.active - b.active)[Math.floor(eng.length / 2)].active;
    const top = eng[0];
    if (top.active >= 8 && top.active >= median * 2) items.push({ rank: 4, level: 'Capacity', tone: 'info', icon: 'user', title: `${top.name} carries ${Math.round((top.active / Math.max(1, median)) * 100)}% of the median workload`, detail: `${top.active} active · ${top.atRisk} at risk · ${top.breached} breached`, href: '#/desk?view=analytics', action: 'View workload' });
  }
  const dept = s.departments.find((d) => d.breached || d.atRisk >= 3);
  if (dept) items.push({ rank: 5, level: 'Demand', tone: 'warning', icon: 'building', title: `${dept.name} has ${dept.breached ? `${dept.breached} breached` : `${dept.atRisk} at-risk`} ticket${(dept.breached || dept.atRisk) === 1 ? '' : 's'}`, detail: `${dept.active} active · ${dept.unassigned} unowned · ${dept.created} raised in window`, href: `#/departments/${dept.id}`, action: 'View department' });
  if (s.approvals.pending) items.push({ rank: 6, level: 'Approval', tone: 'info', icon: 'checks', title: `${s.approvals.pending} request${s.approvals.pending === 1 ? '' : 's'} ${s.approvals.pending === 1 ? 'is' : 'are'} waiting for approval`, detail: `Oldest waiting: ${hm(s.approvals.oldestPendingAgeMs)}${user.role === 'ADMIN' ? '' : ' · shown to the named approver'}`, href: '#/approvals', action: 'Review approvals' });
  if (s.csat.responses >= 3 && s.csat.average !== null && s.csat.average < 3.5) items.push({ rank: 7, level: 'CSAT', tone: 'warning', icon: 'star', title: `Satisfaction is ${s.csat.average.toFixed(2)} / 5 in this window`, detail: `${s.csat.responses} responses`, href: '#/reports', action: 'Open reports' });
  items.sort((a, b) => a.rank - b.rank);
  return (
    <section className="attention" aria-labelledby="attention-h">
      <div className="section-title"><h2 id="attention-h">Needs your attention</h2><span className="muted t-caption">{items.length ? `${items.length} item${items.length === 1 ? '' : 's'} · sorted by operational severity` : 'Derived from live queue figures'}</span></div>
      {items.length ? (
        <ol className="attention-feed">
          {items.map((e) => (
            <li key={e.title} className={e.tone}>
              <span className="att-level"><Icon name={e.icon} size={14} />{e.level}</span>
              <span className="att-body"><strong>{e.title}</strong><small>{e.detail}</small></span>
              <a className="att-action" href={e.href}>{e.action}<Icon name="arrow" size={14} /></a>
            </li>
          ))}
        </ol>
      ) : (
        <div className="attention-clear"><Icon name="check" size={18} /><div><strong>Nothing requires intervention</strong><small>Every active ticket is owned and inside its service targets.</small></div></div>
      )}
    </section>
  );
}

/* ── Ticket flow ──────────────────────────────────────────────────────── */
function TicketFlow({ s, days, setDays }: { s: OperationsSummary; days: number; setDays: (d: number) => void }) {
  const perDay = s.flow.perDay;
  const label = (d: string) => (days <= 1 ? 'Today' : new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  const ratePct = s.flow.resolutionRatePercent;
  return (
    <section className="region flow" aria-labelledby="flow-h">
      <div className="section-title">
        <div><h2 id="flow-h">Ticket flow</h2><p className="muted t-sm">Created vs resolved · {RANGES.find((r) => r.days === days)?.long.toLowerCase()}</p></div>
        <div className="range-switch" role="group" aria-label="Ticket flow range">{RANGES.map((r) => <button key={r.days} className={r.days === days ? 'active' : ''} aria-pressed={r.days === days} onClick={() => setDays(r.days)}>{r.label}</button>)}</div>
      </div>
      {perDay.length > 1 ? (
        <AreaChart ariaLabel="Tickets created and resolved per day" height={190} labels={perDay.map((d) => label(d.day))} series={[perDay.map((d) => d.created), perDay.map((d) => d.resolved)]} names={['Created', 'Resolved']} />
      ) : (
        <div className="flow-day"><span><i style={{ background: 'var(--accent)' }} />Created today <strong>{s.flow.created}</strong></span><span><i style={{ background: 'var(--success)' }} />Resolved today <strong>{s.flow.resolved}</strong></span><small className="muted">A one-day window has no trend line; pick 7D or longer for the curve.</small></div>
      )}
      <dl className="stat-row">
        <div><dt>Created</dt><dd>{s.flow.created}<Delta value={pctDelta(s.flow.created, s.flow.previousCreated)} goodWhen="down" hint="vs previous window" /></dd></div>
        <div><dt>Resolved</dt><dd>{s.flow.resolved}<Delta value={pctDelta(s.flow.resolved, s.flow.previousResolved)} goodWhen="up" hint="vs previous window" /></dd></div>
        <div><dt>Net backlog</dt><dd className={s.flow.backlogChange > 0 ? 'crit-text' : s.flow.backlogChange < 0 ? 'ok-text' : ''}>{s.flow.backlogChange > 0 ? '+' : ''}{s.flow.backlogChange}<small className="pulse-sub">created minus resolved</small></dd></div>
        <div><dt>Resolution rate</dt><dd>{ratePct === null ? '—' : `${ratePct}%`}<small className="pulse-sub">{s.flow.created ? `${s.flow.resolved} of ${s.flow.created} created` : 'nothing created in window'}</small></dd></div>
      </dl>
    </section>
  );
}

/* ── SLA performance ──────────────────────────────────────────────────── */
function SlaPerformance({ s }: { s: OperationsSummary }) {
  const overall = s.sla.resolutionCompliancePercent ?? s.sla.responseCompliancePercent;
  const bar = (label: string, pct: number | null, measured: number, breached: number) => (
    <div className="sla-line">
      <div className="flex between"><span>{label}</span><strong>{pct === null ? '—' : `${pct.toFixed(1)}%`}</strong></div>
      <div className="sla-track"><i style={{ width: `${pct ?? 0}%`, background: pct !== null && pct < 90 ? 'var(--warning)' : 'var(--success)' }} /></div>
      <small className="muted">{measured ? `${measured - breached} of ${measured} measured within target` : 'No completed measurements yet'}</small>
    </div>
  );
  return (
    <section className="region sla-module" aria-labelledby="sla-h">
      <div className="section-title"><h2 id="sla-h">SLA performance</h2><span className="muted t-caption">24/7 clock · policy snapshot per ticket</span></div>
      <div className="sla-overall">
        <strong className={overall === null ? '' : overall >= 95 ? 'ok-text' : overall >= 85 ? 'warn-text' : 'crit-text'}>{overall === null ? '—' : `${overall.toFixed(1)}%`}</strong>
        <span>Overall<small>{s.sla.tracked} tickets carry an SLA · unfinished work is never counted as met</small></span>
      </div>
      {bar('Response SLA', s.sla.responseCompliancePercent, s.sla.responseMeasured, s.sla.responseBreached)}
      {bar('Resolution SLA', s.sla.resolutionCompliancePercent, s.sla.resolutionMeasured, s.sla.resolutionBreached)}
      <div className="sla-now">
        <a href="#/board" className={s.sla.atRisk ? 'warn' : ''}><span>At risk</span><strong>{s.sla.atRisk}</strong><small>{s.sla.atRiskUnder30Min} under 30 min</small></a>
        <a href="#/tickets" className={s.sla.activeBreached ? 'crit' : ''}><span>Breached</span><strong>{s.sla.activeBreached}</strong><small>{s.sla.activeBreached ? `oldest ${hm(s.sla.oldestBreachAgeMs)}` : 'none active'}</small></a>
      </div>
    </section>
  );
}

/* ── Priority and work type ───────────────────────────────────────────── */
function PriorityMix({ s }: { s: OperationsSummary }) {
  const max = Math.max(1, ...priorities.map((p) => s.active.byPriority[p] ?? 0));
  return (
    <section className="region" aria-labelledby="prio-h">
      <div className="section-title"><h2 id="prio-h">Incident priority</h2><span className="muted t-caption">Active tickets</span></div>
      <div className="prio-rows">
        {[...priorities].reverse().map((p) => (
          <a key={p} href={`#/tickets?priority=${p}`} className="prio-row">
            <span className="prio-code"><i style={{ background: `var(--${PRIORITY_VAR[p]})` }} />{PRIORITY_CODE[p]} <em>{PRIORITY_WORD[p]}</em></span>
            <span className="prio-track"><i style={{ width: `${((s.active.byPriority[p] ?? 0) / max) * 100}%`, background: `var(--${PRIORITY_VAR[p]})` }} /></span>
            <strong>{s.active.byPriority[p] ?? 0}</strong>
          </a>
        ))}
      </div>
    </section>
  );
}
function WorkType({ s }: { s: OperationsSummary }) {
  const colors: Record<string, string> = { INCIDENT: 'var(--danger)', REQUEST: 'var(--accent)', PROBLEM: 'var(--warning)', CHANGE: 'var(--violet)' };
  const names: Record<string, string> = { INCIDENT: 'Incidents', REQUEST: 'Service requests', PROBLEM: 'Problems', CHANGE: 'Changes' };
  return (
    <section className="region" aria-labelledby="type-h">
      <div className="section-title"><h2 id="type-h">Work type</h2><span className="muted t-caption">Active composition</span></div>
      <SegmentBar ariaLabel="Active tickets by type" height={12} segments={Object.entries(names).map(([k, n]) => ({ label: n, value: s.active.byType[k] ?? 0, color: colors[k] }))} />
    </section>
  );
}

/* ── Critical & at-risk work ──────────────────────────────────────────── */
const breachAge = (t: OperationsSummary['critical'][number], asOf: string) => {
  const at = t.sla?.responseBreachAt ?? t.sla?.resolutionBreachAt;
  return at ? new Date(asOf).getTime() - new Date(at).getTime() : 0;
};
function CriticalWork({ s }: { s: OperationsSummary }) {
  return (
    <section className="region table-region" aria-labelledby="crit-h">
      <div className="section-title"><div><h2 id="crit-h">Critical &amp; at-risk work</h2><p className="muted t-sm">P1 and P2 incidents plus anything at risk or past its deadline, most urgent first</p></div><a href="#/tickets?priority=URGENT">All P1 →</a></div>
      {s.critical.length ? (
        <div className="table-scroll">
          <table className="ops-table">
            <thead><tr><th>ID</th><th>Incident</th><th>Service</th><th>Priority</th><th>Status</th><th>Owner</th><th>SLA</th><th className="num">Age</th></tr></thead>
            <tbody>
              {s.critical.map((t) => {
                const p = t.position;
                const slaCls = p.breached ? 'breach' : p.atRisk ? 'risk' : 'ok';
                return (
                  <tr key={t.id} className={p.breached ? 'row-breach' : p.atRisk ? 'row-risk' : ''} onClick={() => { location.hash = `/tickets/${t.id}`; }}>
                    <td><a className="mono-id" href={`#/tickets/${t.id}`}>{ticketKey(t)}</a></td>
                    <td className="cell-incident"><a href={`#/tickets/${t.id}`}>{t.title}</a><small>{labels[t.type]}</small></td>
                    <td>{t.category}</td>
                    <td><span className="prio-dot"><i style={{ background: `var(--${PRIORITY_VAR[t.priority]})` }} />{PRIORITY_CODE[t.priority]} {PRIORITY_WORD[t.priority]}</span></td>
                    <td>{STATUS_WORD[t.status]}</td>
                    <td>{t.assignee ? <span className="person"><Avatar name={t.assignee.name} size={20} />{t.assignee.name}</span> : <span className="unowned">Unassigned</span>}</td>
                    <td><span className={`sla-cd ${slaCls}`}>{p.breached ? `Breached ${hm(breachAge(t, s.generatedAt))}` : p.remainingMs === null ? (t.status === 'WAITING_FOR_USER' ? 'Paused' : 'No SLA') : `${countdown(p.remainingMs)} left`}</span></td>
                    <td className="num">{hm(t.ageMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon="check" title="No critical or at-risk work">No P1/P2 incident is open and every active ticket is inside its SLA.</EmptyState>}
    </section>
  );
}

/* ── Team and department load ─────────────────────────────────────────── */
function TeamLoad({ s }: { s: OperationsSummary }) {
  const maxEng = Math.max(1, ...s.engineers.map((e) => e.active));
  const maxDept = Math.max(1, ...s.departments.map((d) => d.active));
  return (
    <section className="region" aria-labelledby="load-h">
      <div className="section-title"><div><h2 id="load-h">Team capacity &amp; demand</h2><p className="muted t-sm">Active workload per engineer and demand by department · capacity targets are not recorded, so no percentage is shown</p></div></div>
      <div className="load-grid">
        <div>
          <p className="eyebrow">Engineers</p>
          {s.engineers.length ? (
            <ul className="load-list">
              {s.engineers.slice(0, 6).map((e) => (
                <li key={e.id}>
                  <span className="load-name"><Avatar name={e.name} size={22} />{e.name}</span>
                  <span className="load-track"><i style={{ width: `${(e.active / maxEng) * 100}%` }} />{e.atRisk + e.breached > 0 && <b style={{ width: `${((e.atRisk + e.breached) / maxEng) * 100}%` }} />}</span>
                  <span className="load-nums"><strong>{e.active}</strong> active{e.atRisk ? <em className="warn-text"> · {e.atRisk} at risk</em> : null}{e.breached ? <em className="crit-text"> · {e.breached} breached</em> : null}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted t-sm">No active tickets are assigned.</p>}
          {s.active.unassigned > 0 && <p className="load-foot"><a href="#/tickets?assigned=unassigned">{s.active.unassigned} unowned</a> not shown above</p>}
        </div>
        <div>
          <p className="eyebrow">Departments</p>
          {s.departments.length ? (
            <ul className="load-list">
              {s.departments.slice(0, 6).map((d) => (
                <li key={d.id}>
                  <span className="load-name"><a href={`#/departments/${d.id}`}>{d.name}</a></span>
                  <span className="load-track"><i style={{ width: `${(d.active / maxDept) * 100}%`, background: 'var(--violet)' }} />{d.atRisk + d.breached > 0 && <b style={{ width: `${((d.atRisk + d.breached) / maxDept) * 100}%` }} />}</span>
                  <span className="load-nums"><strong>{d.active}</strong> active · {d.created} new{d.atRisk ? <em className="warn-text"> · {d.atRisk} at risk</em> : null}{d.breached ? <em className="crit-text"> · {d.breached} breached</em> : null}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted t-sm">No department has active tickets.</p>}
          {s.unplaced.active > 0 && <p className="load-foot">{s.unplaced.active} active ticket{s.unplaced.active === 1 ? '' : 's'} from people without a department</p>}
        </div>
      </div>
    </section>
  );
}

/* ── Live operations ──────────────────────────────────────────────────── */
const ACTION_WORD: Record<string, string> = { CREATED: 'Ticket raised', UPDATED: 'Updated', PUBLIC_REPLY: 'Public reply', REOPENED: 'Reopened', ATTACHMENT_ADDED: 'Attachment added', ATTACHMENT_REMOVED: 'Attachment removed', WATCHER_ADDED: 'Follower added', SURVEY_SUBMITTED: 'Rated', APPROVAL_SKIPPED: 'Approval skipped', APPROVAL_REQUESTED: 'Approval requested', APPROVAL_GRANTED: 'Approved', APPROVAL_REJECTED: 'Rejected', INTERNAL_NOTE: 'Internal note', REPLY_EDITED: 'Reply edited', BULK_UPDATE: 'Bulk update', AI_SUGGESTION_APPLIED: 'AI suggestion applied' };
/** Audit details are written for the log; here they read as operations language. */
const humanize = (detail: string) => detail
  .replace(/\b(OPEN|IN_PROGRESS|WAITING_FOR_USER|RESOLVED|CLOSED)\b/g, (m) => STATUS_WORD[m] ?? m)
  .replace(/\b(URGENT|HIGH|MEDIUM|LOW)\b/g, (m) => `${PRIORITY_CODE[m]} ${PRIORITY_WORD[m]}`)
  .replace(/assigneeId: null → [0-9a-f-]{36}/g, 'owner assigned')
  .replace(/assigneeId: [0-9a-f-]{36} → null/g, 'owner removed')
  .replace(/assigneeId: [0-9a-f-]{36} → [0-9a-f-]{36}/g, 'owner changed')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '…')
  .replace(/^status: /, '');
function LiveOperations({ s }: { s: OperationsSummary }) {
  const tone = (a: string) => (/RESOLVED|Rated|SURVEY/.test(a) ? 'ok' : /BREACH|REOPENED/.test(a) ? 'crit' : /CREATED/.test(a) ? 'new' : '');
  return (
    <section className="region" aria-labelledby="live-h">
      <div className="section-title"><div><h2 id="live-h">Live operations</h2><p className="muted t-sm">The latest recorded events across the queue · times in your local zone</p></div></div>
      {s.activity.length ? (
        <ol className="ops-timeline">
          {s.activity.slice(0, 12).map((e) => (
            <li key={e.id} className={tone(`${e.action} ${e.detail}`)}>
              <time dateTime={e.at}>{clock(e.at)}</time>
              <span className="tl-mark" aria-hidden="true" />
              <span className="tl-body">
                {e.ticket ? <a className="mono-id" href={`#/tickets/${e.ticket.id}`}>{ticketKey(e.ticket)}</a> : null}
                <strong>{ACTION_WORD[e.action] ?? e.action.toLowerCase().replace(/_/g, ' ')}</strong>
                <span className="tl-detail">{humanize(e.detail)}</span>
                <small>{e.actor ? `by ${e.actor.name}` : 'system'}{e.ticket ? ` · ${e.ticket.title}` : ''}</small>
              </span>
            </li>
          ))}
        </ol>
      ) : <p className="muted t-sm">No recorded events yet.</p>}
    </section>
  );
}

/* ── Asset signals ────────────────────────────────────────────────────── */
function AssetSignals({ s }: { s: OperationsSummary }) {
  const a = s.assets;
  return (
    <section className="region" aria-labelledby="assets-h">
      <div className="section-title"><h2 id="assets-h">Asset signals</h2><a href="#/assets">Asset management →</a></div>
      <dl className="signal-grid">
        <div><dt>Managed assets</dt><dd><a href="#/assets">{a.total.toLocaleString()}</a></dd></div>
        <div><dt>Unassigned</dt><dd><a href="#/assets">{a.unassigned}</a><small>excluding retired</small></dd></div>
        <div><dt>Warranty expiring</dt><dd className={a.warrantyExpiring90Days ? 'warn-text' : ''}>{a.warrantyExpiring90Days}<small>within 90 days</small></dd></div>
        <div><dt>Linked to active tickets</dt><dd>{a.linkedToActiveTickets}</dd></div>
        <div><dt>In repair</dt><dd>{a.byStatus.REPAIR ?? 0}</dd></div>
        <div><dt>Retired</dt><dd>{a.byStatus.RETIRED ?? 0}</dd></div>
      </dl>
    </section>
  );
}

/* ── Ask OpsPilot ─────────────────────────────────────────────────────── */
function AskStrip() {
  const prompts = ['What needs attention?', 'Summarize today’s operations', 'Show SLA risks', 'Where is backlog growing?', 'Which team needs help?'];
  return (
    <section className="region ask-strip" aria-labelledby="ask-h">
      <div className="section-title"><h2 id="ask-h"><span className="ai-mark"><Icon name="spark" size={14} /></span>Ask OpsPilot</h2><span className="muted t-caption">Answers cite the knowledge base and are labelled AI</span></div>
      <div className="ask-chips">{prompts.map((p) => <a key={p} className="chip-btn" href={`#/ask?q=${encodeURIComponent(p)}`}>{p}</a>)}</div>
    </section>
  );
}
