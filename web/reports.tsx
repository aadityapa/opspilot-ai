import { useState } from 'react';
import { useRecord } from './operations';
import { labels, priorities, ticketTypes, type Department, type Report, type ReportKind } from '../shared/model';
import { Icon } from './ui/icons';
import { EmptyState, ErrorState, StatePage, fmtDate } from './ui';
import { RankBars, SegmentBar, Sparkline } from './ui/charts';
import { ReportGlyph } from './ui/art';
import { PRIORITY_CODE, PRIORITY_WORD } from './ui/marks';

/**
 * Reports: the rows behind the numbers. A report is precise, filterable, inspectable and
 * exportable; it does not repeat the analytics page. Every report kind is produced by the API under
 * the same filters, and the CSV a person downloads is exactly the table they are looking at.
 */
const LIBRARY: { group: string; blurb: string; kinds: { kind: ReportKind; title: string; blurb: string; icon: string }[] }[] = [
  { group: 'Service operations', blurb: 'Volume, targets and speed.', kinds: [
    { kind: 'tickets', title: 'Ticket volume', blurb: 'Every ticket raised in the period.', icon: 'ticket' },
    { kind: 'sla', title: 'SLA performance', blurb: 'Response and resolution targets, met or missed.', icon: 'clock' },
    { kind: 'resolution', title: 'Resolution performance', blurb: 'Time to first response and to resolve.', icon: 'checks' },
  ] },
  { group: 'Employee experience', blurb: 'What requesters asked for and how they rated it.', kinds: [
    { kind: 'csat', title: 'Satisfaction', blurb: 'Every rating, with the ticket and who handled it.', icon: 'star' },
    { kind: 'requests', title: 'Request demand', blurb: 'Catalog requests and their approval outcome.', icon: 'grid' },
  ] },
  { group: 'Organization', blurb: 'Where demand comes from and who carries it.', kinds: [
    { kind: 'departments', title: 'Department demand', blurb: 'Work raised and still open per department.', icon: 'building' },
    { kind: 'agents', title: 'Agent workload', blurb: 'Assigned and resolved per engineer. Alphabetical, not ranked.', icon: 'users' },
  ] },
  { group: 'Assets', blurb: 'Hardware in the service history.', kinds: [
    { kind: 'assets', title: 'Asset service history', blurb: 'Tickets that reference a hardware asset.', icon: 'laptop' },
  ] },
];
const KINDS = new Set(LIBRARY.flatMap((g) => g.kinds.map((k) => k.kind)));

export function ReportsPage({ refresh, route }: { refresh: number; route: string }) {
  const [path, query] = route.split('?');
  const kind = path.split('/')[2] as ReportKind | undefined;
  const q = new URLSearchParams(query ?? '');
  const days = Number(q.get('days') ?? '30');
  const departmentId = q.get('departmentId') ?? '';
  const type = q.get('type') ?? '';
  const priority = q.get('priority') ?? '';
  const params = new URLSearchParams({ days: String(days), ...(departmentId ? { departmentId } : {}), ...(type ? { type } : {}), ...(priority ? { priority } : {}) });
  if (kind && KINDS.has(kind)) return <ReportWorkspace kind={kind} params={params} refresh={refresh} />;
  // An unknown kind is a dead link, and says so; it never silently shows the library instead.
  if (kind) return (
    <StatePage code="404" title="There is no report by that name." actions={<><a className="primary" href="#/reports">Open the reports library</a><a className="btn" href="#/analytics">Service Intelligence</a></>}>
      “{kind}” is not one of the {KINDS.size} report kinds this workspace produces. Pick one from the library — every report there is generated from live rows under the same filters.
    </StatePage>
  );
  return <ReportLibrary params={params} refresh={refresh} query={q} />;
}

/* ── Library: one card per report, with a preview built from the report's own rows ─────── */
const GROUP_KEYS = ['All', ...LIBRARY.map((g) => g.group)];
function ReportLibrary({ params, refresh, query }: { params: URLSearchParams; refresh: number; query: URLSearchParams }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState(query.get('group') ?? 'All');
  const lower = q.trim().toLowerCase();
  const groups = LIBRARY.filter((g) => group === 'All' || g.group === group)
    .map((g) => ({ ...g, kinds: g.kinds.filter((k) => !lower || k.title.toLowerCase().includes(lower) || k.blurb.toLowerCase().includes(lower)) }))
    .filter((g) => g.kinds.length);
  return (
    <div className="emp reports">
      <header className="emp-head">
        <div><p className="eyebrow">REPORTING</p><h1>Service reports</h1><p className="muted">Precise, filterable evidence behind the analytics. Every report can be inspected here or exported as CSV under the same filters; the previews below are drawn from the same rows for the last {params.get('days') ?? '30'} days.</p></div>
        <div className="page-actions"><a className="btn" href={`#/analytics?${params}`}><Icon name="chart" size={15} />Service Intelligence</a></div>
      </header>
      <section className="querybar report-library-bar" aria-label="Find a report">
        <div className="q-search"><Icon name="search" size={16} /><input aria-label="Search reports" placeholder="Search reports…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="tabs report-groups" role="tablist" aria-label="Report groups">
          {GROUP_KEYS.map((g) => <button key={g} role="tab" aria-selected={group === g} className={group === g ? 'active' : ''} onClick={() => setGroup(g)}>{g}</button>)}
        </div>
      </section>
      {groups.length ? groups.map((g) => (
        <section key={g.group} className="report-group">
          <div className="section-title"><h2>{g.group}</h2><span className="muted t-caption">{g.blurb}</span></div>
          <ul className="report-cards">
            {g.kinds.map((k) => <ReportCard key={k.kind} meta={k} params={params} refresh={refresh} />)}
          </ul>
        </section>
      )) : <EmptyState icon="reports" title="No report matches" action={<button onClick={() => { setQ(''); setGroup('All'); }}>Clear</button>}>Try another word — report names and descriptions are searched.</EmptyState>}
    </div>
  );
}

const dayKey = (iso: string) => iso.slice(0, 10);
/** A preview derived from the report's own rows: never a picture, never a placeholder figure. */
function ReportCard({ meta, params, refresh }: { meta: { kind: ReportKind; title: string; blurb: string; icon: string }; params: URLSearchParams; refresh: number }) {
  const { data: r, error } = useRecord<Report>(`/reports/${meta.kind}?${params}`, refresh);
  const hue = meta.kind === 'sla' || meta.kind === 'resolution' ? 'green' : meta.kind === 'csat' ? 'amber' : meta.kind === 'departments' || meta.kind === 'agents' ? 'violet' : meta.kind === 'assets' ? 'cyan' : 'indigo';
  const preview = (() => {
    if (!r) return null;
    const rows = r.rows;
    if (['tickets', 'requests', 'assets', 'resolution'].includes(r.kind)) {
      const key = r.kind === 'resolution' ? 'resolvedAt' : 'createdAt';
      const days = Number(r.filters.days);
      const counts = new Map<string, number>();
      for (let i = days - 1; i >= 0; i--) counts.set(dayKey(new Date(Date.now() - i * 86400000).toISOString()), 0);
      rows.forEach((row) => { const d = row[key]; if (typeof d === 'string' && counts.has(dayKey(d))) counts.set(dayKey(d), (counts.get(dayKey(d)) ?? 0) + 1); });
      const values = [...counts.values()];
      return values.some((v) => v > 0) ? <Sparkline values={values} color={`var(--chart-${hue === 'green' ? 3 : hue === 'cyan' ? 6 : 1})`} width={220} height={44} /> : <span className="muted t-caption">No rows in the period</span>;
    }
    if (r.kind === 'sla') {
      const met = rows.filter((x) => x.resolutionOutcome === 'Met').length, breached = rows.filter((x) => String(x.resolutionOutcome).startsWith('Breached')).length, running = rows.length - met - breached;
      return <SegmentBar ariaLabel="Resolution outcomes" height={8} segments={[{ label: 'Met', value: met, color: 'var(--success)' }, { label: 'Breached', value: breached, color: 'var(--danger)' }, { label: 'Running', value: running, color: 'var(--neutral)' }]} />;
    }
    if (r.kind === 'csat') {
      const dist = [1, 2, 3, 4, 5].map((n) => ({ label: `${n}★`, value: rows.filter((x) => Number(x.score) === n).length }));
      return dist.some((d) => d.value) ? <RankBars rows={dist} color="var(--chart-4)" /> : <span className="muted t-caption">No ratings in the period</span>;
    }
    const numeric = r.kind === 'departments' ? 'raised' : 'assigned';
    const top = [...rows].sort((a, b) => Number(b[numeric] ?? 0) - Number(a[numeric] ?? 0)).slice(0, 4).map((x) => ({ label: String(x.name), value: Number(x[numeric] ?? 0) }));
    return top.some((t) => t.value) ? <RankBars rows={top} color="var(--chart-2)" /> : <span className="muted t-caption">Nothing to rank in the period</span>;
  })();
  return (
    <li className="report-card">
      <a href={`#/reports/${meta.kind}?${params}`} aria-label={`Open the ${meta.title} report`}>
        <div className="rc-head">
          <span className={`gloss-tile sm ${hue}`} aria-hidden="true"><ReportGlyph kind={meta.kind} /></span>
          <span className="rc-body"><strong>{meta.title}</strong><small>{meta.blurb}</small></span>
        </div>
        <div className="rc-preview" aria-hidden="true">{error ? <span className="muted t-caption">Preview unavailable</span> : !r ? <span className="skeleton rc-skeleton" /> : preview}</div>
        <div className="rc-foot">
          <span className="rc-summary">{r ? r.summary.slice(0, 2).map((x) => <span key={x.label}><strong>{x.value}</strong> {x.label.toLowerCase()}</span>) : <span className="muted">Loading…</span>}</span>
          <span className="rc-open">Open report<Icon name="arrow" size={14} /></span>
        </div>
      </a>
    </li>
  );
}

function ReportWorkspace({ kind, params, refresh }: { kind: ReportKind; params: URLSearchParams; refresh: number }) {
  const { data: r, error } = useRecord<Report>(`/reports/${kind}?${params}`, refresh);
  const { data: departments } = useRecord<Department[]>('/departments');
  const set = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); location.hash = `/reports/${kind}?${next}`; };
  const meta = LIBRARY.flatMap((g) => g.kinds).find((k) => k.kind === kind)!;
  const days = params.get('days') ?? '30';
  const dept = departments?.find((d) => d.id === params.get('departmentId'));
  return (
    <div className="emp report">
      <a className="back-link" href={`#/reports?${params}`}><Icon name="arrowLeft" size={14} />Service reports</a>
      <header className="emp-head">
        <div><p className="eyebrow">REPORT</p><h1>{meta.title}</h1><p className="muted">{r?.description ?? meta.blurb}</p></div>
        <div className="page-actions">
          <a className="btn" href={`#/analytics?${params}`}><Icon name="chart" size={15} />Analytics</a>
          <a className="primary" href={`/api/reports/${kind}?${params}&format=csv`} download><Icon name="download" size={15} />Export CSV</a>
        </div>
      </header>

      <section className="querybar report-filters" aria-label="Report filters">
        <label>Period<select aria-label="Period" value={days} onChange={(e) => set('days', e.target.value)}>{[7, 30, 90, 180, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select></label>
        <label>Department<select aria-label="Department" value={params.get('departmentId') ?? ''} onChange={(e) => set('departmentId', e.target.value)}><option value="">All departments</option>{departments?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Type<select aria-label="Ticket type" value={params.get('type') ?? ''} onChange={(e) => set('type', e.target.value)}><option value="">All types</option>{ticketTypes.map((t) => <option key={t} value={t}>{labels[t]}</option>)}</select></label>
        <label>Priority<select aria-label="Priority" value={params.get('priority') ?? ''} onChange={(e) => set('priority', e.target.value)}><option value="">All priorities</option>{priorities.map((p) => <option key={p} value={p}>{PRIORITY_CODE[p]} {PRIORITY_WORD[p]}</option>)}</select></label>
        <span className="grow" />
        {r && <span className="muted t-caption">Generated {fmtDate(r.generatedAt)}{dept ? ` · ${dept.name}` : ''}</span>}
      </section>

      {error ? <ErrorState error={`We couldn't load this report. ${error}`} back={{ href: '#/reports', label: 'Service reports' }} /> : !r ? (
        <div className="kb-skeleton" aria-hidden="true"><div className="sk-strip" /><div className="sk-row head" />{Array.from({ length: 8 }, (_, i) => <div key={i} className="sk-row" />)}</div>
      ) : (
        <>
          <section className="mywork-strip report-summary" aria-label="Summary">
            <p className="eyebrow strip-eyebrow">Summary</p>
            {r.summary.map((s) => <span key={s.label} className="strip-cell"><strong>{s.value}</strong><span>{s.label}</span></span>)}
          </section>
          {r.rows.length ? (
            <section className="emp-surface table-surface">
              <div className="table-scroll">
                <table className="report-table">
                  <thead><tr>{r.columns.map((c) => <th key={c.key} scope="col" className={c.kind === 'number' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {r.rows.map((row, i) => (
                      <tr key={i}>
                        {r.columns.map((c) => {
                          const v = row[c.key];
                          const href = c.kind === 'key' && c.key === 'key' && row.id ? `#/tickets/${row.id}` : undefined;
                          const text = v === null || v === undefined ? '' : c.kind === 'date' ? fmtDate(String(v)) : String(v);
                          return <td key={c.key} className={`${c.kind === 'number' ? 'num' : ''} ${c.kind === 'key' ? 'mono-id' : ''}`}>{href ? <a href={href}>{text}</a> : text || <span className="muted">—</span>}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-foot"><span className="muted t-caption">{r.truncated ? `Showing the first ${r.rows.length.toLocaleString()} of ${r.total.toLocaleString()} rows — narrow the filters, or export the CSV, which contains every row.` : `${r.total} row${r.total === 1 ? '' : 's'} · the CSV contains exactly these rows and filters.`}</span></div>
            </section>
          ) : <EmptyState icon="reports" title="No rows for these filters" action={<a className="btn" href={`#/reports/${kind}?days=365`}>Widen to a year</a>}>Nothing in the period matches. Widen the period or clear the department, type and priority filters.</EmptyState>}
        </>
      )}
    </div>
  );
}
