import { useRecord } from './operations';
import { labels, priorities, ticketTypes, type Department, type Report, type ReportKind } from '../shared/model';
import { Icon } from './ui/icons';
import { EmptyState, ErrorState, fmtDate } from './ui';
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
  return (
    <div className="emp reports">
      <header className="emp-head">
        <div><p className="eyebrow">REPORTING</p><h1>Service reports</h1><p className="muted">Precise, filterable evidence behind the analytics. Every report can be inspected here or exported as CSV under the same filters.</p></div>
        <div className="page-actions"><a className="btn" href={`#/analytics?${params}`}><Icon name="chart" size={15} />Service Intelligence</a></div>
      </header>
      {LIBRARY.map((g) => (
        <section key={g.group} className="report-group">
          <div className="section-title"><h2>{g.group}</h2><span className="muted t-caption">{g.blurb}</span></div>
          <ul className="report-cards">
            {g.kinds.map((k) => (
              <li key={k.kind}><a href={`#/reports/${k.kind}?${params}`}><span className="hr-icon" aria-hidden="true"><Icon name={k.icon} size={18} /></span><span className="rc-body"><strong>{k.title}</strong><small>{k.blurb}</small></span><Icon name="chevron" size={16} /></a></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
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
