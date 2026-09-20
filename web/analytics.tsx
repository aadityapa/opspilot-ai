import { useState } from 'react';
import { useRecord } from './operations';
import { labels, priorities, ticketTypes, type Analytics, type Comparison, type CurrentUser, type Department } from '../shared/model';
import { Icon } from './ui/icons';
import { Avatar, EmptyState, ErrorState, ticketKey } from './ui';
import { AreaChart, RankBars, SegmentBar } from './ui/charts';
import { PRIORITY_CODE, PRIORITY_WORD, PriorityMark, StatusMark } from './ui/marks';

/**
 * Service Intelligence: how the service is performing over time.
 *
 * The Command Center is for what needs action now; this page is for direction. Every figure comes
 * from `/api/analytics`, counted on the server for the window and filters in the URL, with the
 * previous period alongside. A comparison appears only when both periods have a value; a metric
 * with too little behind it says so instead of pretending to be a statistic; every chart leads to
 * the rows behind it in the Service Desk or a report.
 */
const RANGES = [[7, '7D'], [30, '30D'], [90, '90D'], [180, '180D'], [365, '1Y']] as const;
const SMALL_SAMPLE = 5;
const dayLabel = (day: string) => { const d = new Date(`${day}T00:00:00`); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
const hm = (mins: number | null) => (mins === null ? '—' : mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`);
const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
const ageWord = (ms: number) => { const h = ms / 3600000; return h < 1 ? `${Math.round(ms / 60000)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`; };

export function AnalyticsPage({ user, refresh, route }: { user: CurrentUser; refresh: number; route: string }) {
  const q = new URLSearchParams(route.split('?')[1] ?? '');
  const days = Number(q.get('days') ?? '30');
  const departmentId = q.get('departmentId') ?? '';
  const type = q.get('type') ?? '';
  const priority = q.get('priority') ?? '';
  const [metric, setMetric] = useState<'volume' | 'resolution' | 'sla' | 'csat' | 'backlog'>('volume');
  const params = new URLSearchParams({ days: String(days), ...(departmentId ? { departmentId } : {}), ...(type ? { type } : {}), ...(priority ? { priority } : {}) });
  const { data: a, error } = useRecord<Analytics>(`/analytics?${params}`, refresh);
  const { data: departments } = useRecord<Department[]>('/departments');
  const set = (key: string, value: string) => { const next = new URLSearchParams(q); if (value) next.set(key, value); else next.delete(key); location.hash = `/analytics${next.toString() ? `?${next}` : ''}`; };
  // Drill-downs carry the same scope into the Service Desk.
  const deskScope = `${departmentId ? `&departmentId=${departmentId}` : ''}${type ? `&type=${type}` : ''}${priority ? `&priority=${priority}` : ''}`;
  const dept = departments?.find((d) => d.id === departmentId);
  void user;

  if (error) return <ErrorState error={`We couldn't load Service Intelligence. ${error}`} retry={() => location.reload()} />;

  return (
    <div className="si">
      <header className="emp-head">
        <div>
          <p className="eyebrow">SERVICE INTELLIGENCE</p>
          <h1>Operational performance</h1>
          <p className="muted">Understand service demand, SLA performance, resolution efficiency and employee experience{dept ? ` for ${dept.name}` : ''}.</p>
        </div>
        <div className="page-actions"><a className="btn" href={`#/reports?${params}`}><Icon name="reports" size={15} />Open reports</a></div>
      </header>

      <section className="si-controls" aria-label="Scope">
        <div className="seg" role="group" aria-label="Date range">
          {RANGES.map(([d, l]) => <button key={d} aria-pressed={days === d} className={days === d ? 'active' : ''} onClick={() => set('days', String(d))}>{l}</button>)}
        </div>
        <select aria-label="Department" value={departmentId} onChange={(e) => set('departmentId', e.target.value)}>
          <option value="">All departments</option>
          {departments?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select aria-label="Ticket type" value={type} onChange={(e) => set('type', e.target.value)}>
          <option value="">All types</option>
          {ticketTypes.map((t) => <option key={t} value={t}>{labels[t]}</option>)}
        </select>
        <select aria-label="Priority" value={priority} onChange={(e) => set('priority', e.target.value)}>
          <option value="">All priorities</option>
          {priorities.map((p) => <option key={p} value={p}>{PRIORITY_CODE[p]} {PRIORITY_WORD[p]}</option>)}
        </select>
        {(departmentId || type || priority) && <a className="text-btn btn-sm" href={`#/analytics?days=${days}`}>Clear filters</a>}
        <span className="grow" />
        {a && <span className="muted t-caption">{new Date(a.window.from).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – {new Date(a.window.to).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · compared with the {days} days before</span>}
      </section>

      {!a ? <AnalyticsSkeleton /> : (
        <>
          {/* ── Executive strip ─────────────────────────────────────── */}
          <section className="si-strip" aria-label="Headline performance">
            <Kpi label="SLA compliance" c={a.headline.slaCompliance} fmt={pct} unit="pts" good="up" href={`#/reports/sla?${params}`} note={a.headline.slaCompliance.measured ? `${a.headline.slaCompliance.measured} resolved` : 'nothing resolved yet'} />
            <Kpi label="Time to resolve" c={a.headline.mttrMinutes} fmt={hm} unit="min" good="down" href={`#/reports/resolution?${params}`} note={a.headline.mttrMinutes.measured ? `mean of ${a.headline.mttrMinutes.measured}` : 'nothing resolved yet'} />
            <Kpi label="Satisfaction" c={a.headline.csat} fmt={(v) => (v === null ? '—' : v.toFixed(2))} unit="" good="up" href={`#/reports/csat?${params}`} note={a.headline.csat.measured ? `${a.headline.csat.measured} rating${a.headline.csat.measured === 1 ? '' : 's'}${a.headline.csat.measured < SMALL_SAMPLE ? ' · limited data' : ''}` : 'no ratings yet'} limited={a.headline.csat.measured > 0 && a.headline.csat.measured < SMALL_SAMPLE} />
            <Kpi label="Resolution rate" c={a.headline.resolutionRate} fmt={pct} unit="pts" good="up" href={`#/tickets?open=true${deskScope}`} note={`resolved ÷ raised (${a.headline.resolutionRate.measured})`} />
            <Kpi label="Backlog" c={a.headline.backlog} fmt={(v) => (v === null ? '—' : String(v))} unit="" good="down" href={`#/tickets?open=true${deskScope}`} note="open at period end" />
            <Kpi label="First response" c={a.headline.firstResponseMinutes} fmt={hm} unit="min" good="down" href={`#/reports/sla?${params}`} note={a.headline.firstResponseMinutes.measured ? `mean of ${a.headline.firstResponseMinutes.measured}` : 'no first replies yet'} />
          </section>

          {/* ── Trend ───────────────────────────────────────────────── */}
          <section className="emp-surface si-trend">
            <div className="section-title">
              <div><h2>Service performance</h2><p className="muted t-sm">Day by day across the period. Hover for the figures behind each point.</p></div>
              <div className="seg" role="group" aria-label="Metric">
                {([['volume', 'Ticket volume'], ['resolution', 'Resolution'], ['sla', 'SLA'], ['csat', 'CSAT'], ['backlog', 'Backlog']] as const).map(([k, l]) => <button key={k} aria-pressed={metric === k} className={metric === k ? 'active' : ''} onClick={() => setMetric(k)}>{l}</button>)}
              </div>
            </div>
            <Trend a={a} metric={metric} />
            <p className="muted fine">
              {metric === 'sla' && 'SLA is the share of tickets resolved that day inside their resolution target; days with nothing resolved are gaps, not zeros.'}
              {metric === 'csat' && 'Average of the ratings left that day; days with no ratings are gaps. Small daily samples move a lot — read the trend, not a single point.'}
              {metric === 'resolution' && 'Mean time to resolve for tickets resolved that day, in minutes.'}
              {metric === 'backlog' && 'Open tickets at the end of each day: raised by then and not yet resolved.'}
              {metric === 'volume' && 'Tickets raised and resolved each day.'}
            </p>
          </section>

          <div className="si-grid">
            {/* ── Demand ────────────────────────────────────────────── */}
            <section className="emp-surface">
              <div className="section-title"><div><h2>Service demand</h2><p className="muted t-sm">What was raised in the period, and by whom.</p></div><a href={`#/reports/tickets?${params}`}>Report →</a></div>
              {a.demand.byDepartment.length ? (
                <>
                  <p className="eyebrow">BY DEPARTMENT</p>
                  <div className="stack-bars">
                    {a.demand.byDepartment.map((d) => (
                      <div className="stack-row" key={d.id ?? 'none'}>
                        <span className="stack-label">{d.id ? <a href={`#/analytics?${new URLSearchParams({ ...Object.fromEntries(params), departmentId: d.id })}`}>{d.name}</a> : d.name}</span>
                        <span className="stack-track">{ticketTypes.map((t) => d.byType[t] > 0 && <i key={t} className={`type-${t.toLowerCase()}`} style={{ width: `${(d.byType[t] / Math.max(1, a.demand.byDepartment[0].created)) * 100}%` }} title={`${labels[t]}: ${d.byType[t]}`} />)}</span>
                        <strong className="stack-value">{d.created}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="type-legend">{ticketTypes.filter((t) => a.demand.byType[t] > 0).map((t) => <span key={t}><i className={`type-${t.toLowerCase()}`} />{labels[t]} <strong>{a.demand.byType[t]}</strong></span>)}</div>
                </>
              ) : <EmptyState icon="inbox" title="Nothing raised in this period">Widen the date range or clear the filters.</EmptyState>}
              {a.demand.byCategory.length > 0 && (
                <div className="si-sub">
                  <p className="eyebrow">BY CATEGORY</p>
                  <RankBars rows={a.demand.byCategory.slice(0, 6).map((c) => ({ label: c.name, value: c.created, href: `#/tickets?categoryId=${c.id}${deskScope}` }))} />
                </div>
              )}
              {a.demand.byService.length > 0 && (
                <div className="si-sub">
                  <p className="eyebrow">BY SERVICE</p>
                  <RankBars rows={a.demand.byService.slice(0, 5).map((c) => ({ label: c.name, value: c.created, href: `#/reports/requests?${params}` }))} color="var(--violet)" />
                </div>
              )}
              {a.demand.heat.length > 0 && (
                <div className="si-sub">
                  <p className="eyebrow">DEPARTMENT × PRIORITY</p>
                  <div className="table-scroll"><table className="heat" aria-label="Tickets raised by department and priority">
                    <thead><tr><th scope="col"><span className="sr-only">Department</span></th>{priorities.map((p) => <th key={p} scope="col">{PRIORITY_CODE[p]}</th>)}</tr></thead>
                    <tbody>{a.demand.heat.map((r) => { const rowMax = Math.max(1, ...a.demand.heat.flatMap((x) => Object.values(x.cells))); return <tr key={r.id}><th scope="row"><a href={`#/analytics?${new URLSearchParams({ ...Object.fromEntries(params), departmentId: r.id })}`}>{r.name}</a></th>{priorities.map((p) => <td key={p}>{r.cells[p] ? <a href={`#/tickets?priority=${p}&departmentId=${r.id}`} className="heat-cell" aria-label={`${r.cells[p]} ${labels[p]} priority ticket${r.cells[p] === 1 ? '' : 's'} from ${r.name}`} style={{ ['--heat' as string]: r.cells[p] / rowMax }}>{r.cells[p]}</a> : <span className="heat-cell" aria-hidden="true" style={{ ['--heat' as string]: 0 }} />}</td>)}</tr>; })}</tbody>
                  </table></div>
                </div>
              )}
            </section>

            {/* ── SLA ───────────────────────────────────────────────── */}
            <section className="emp-surface">
              <div className="section-title"><div><h2>SLA analysis</h2><p className="muted t-sm">Where the misses are, not just how green the average is.</p></div><a href={`#/reports/sla?${params}`}>Report →</a></div>
              <dl className="si-facts">
                <div><dt>Resolution</dt><dd>{pct(a.sla.resolutionCompliancePercent)}<small>{a.sla.resolutionMeasured} measured</small></dd></div>
                <div><dt>Response</dt><dd>{pct(a.sla.responseCompliancePercent)}<small>{a.sla.responseMeasured} measured</small></dd></div>
                <div><dt>Breaches</dt><dd className={a.sla.breaches ? 'crit-text' : ''}>{a.sla.breaches}<small>{a.sla.responseBreaches} response · {a.sla.resolutionBreaches} resolution</small></dd></div>
                <div><dt>Right now</dt><dd className={a.sla.activeBreached ? 'crit-text' : a.sla.activeAtRisk ? 'warn-text' : ''}><a href={`#/tickets?sla=breached${deskScope}`}>{a.sla.activeBreached} breached</a><small><a href={`#/tickets?sla=at-risk${deskScope}`}>{a.sla.activeAtRisk} at risk</a></small></dd></div>
              </dl>
              {a.sla.byPriority.some((p) => p.breaches || p.measured) && (
                <div className="si-sub">
                  <p className="eyebrow">BY PRIORITY</p>
                  <table className="si-table">
                    <thead><tr><th scope="col">Priority</th><th scope="col" className="num">Breaches</th><th scope="col" className="num">Compliance</th><th scope="col" className="num">At risk now</th></tr></thead>
                    <tbody>{a.sla.byPriority.map((p) => <tr key={p.priority}><td><a href={`#/tickets?priority=${p.priority}&sla=breached${deskScope}`}><PriorityMark value={p.priority} /></a></td><td className={`num ${p.breaches ? 'crit-text' : ''}`}>{p.breaches}</td><td className="num">{pct(p.compliancePercent)}{p.measured ? <small className="muted"> / {p.measured}</small> : null}</td><td className={`num ${p.activeAtRisk ? 'warn-text' : ''}`}>{p.activeAtRisk}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
              {a.sla.byDepartment.length > 0 && (
                <div className="si-sub">
                  <p className="eyebrow">BY DEPARTMENT</p>
                  <table className="si-table">
                    <thead><tr><th scope="col">Department</th><th scope="col" className="num">Breaches</th><th scope="col" className="num">Compliance</th><th scope="col" className="num">At risk now</th></tr></thead>
                    <tbody>{a.sla.byDepartment.map((d) => <tr key={d.id}><td><a href={`#/analytics?${new URLSearchParams({ ...Object.fromEntries(params), departmentId: d.id })}`}>{d.name}</a></td><td className={`num ${d.breaches ? 'crit-text' : ''}`}>{d.breaches}</td><td className="num">{pct(d.compliancePercent)}{d.measured ? <small className="muted"> / {d.measured}</small> : null}</td><td className={`num ${d.activeAtRisk ? 'warn-text' : ''}`}>{d.activeAtRisk}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
              {a.sla.recentBreaches.length > 0 ? (
                <div className="si-sub">
                  <p className="eyebrow">RECENT BREACHES</p>
                  <ul className="work-list">{a.sla.recentBreaches.map((t) => <li key={t.id}><a href={`#/tickets/${t.id}`}><span className="mono-id">{ticketKey(t)}</span><span className="work-main"><strong>{t.title}</strong><small>{t.kind === 'RESPONSE' ? 'First response missed' : 'Resolution missed'}{t.department ? ` · ${t.department}` : ''}</small></span><PriorityMark value={t.priority} /><small className="muted work-when">{dayLabel(t.breachedAt.slice(0, 10))}</small></a></li>)}</ul>
                </div>
              ) : <p className="calm">No SLA breaches in this period.</p>}
            </section>

            {/* ── Resolution ────────────────────────────────────────── */}
            <section className="emp-surface">
              <div className="section-title"><div><h2>Resolution performance</h2><p className="muted t-sm">How long work takes, and how old what is left is.</p></div><a href={`#/reports/resolution?${params}`}>Report →</a></div>
              <dl className="si-facts">
                <div><dt>Time to resolve</dt><dd>{hm(a.resolution.mttrMinutes)}<small>{a.resolution.previousMttrMinutes !== null ? `was ${hm(a.resolution.previousMttrMinutes)}` : 'no previous period'}</small></dd></div>
                <div><dt>Resolved</dt><dd>{a.resolution.resolvedInWindow}<small>in the period</small></dd></div>
                <div><dt>Backlog</dt><dd>{a.resolution.backlog}<small>{a.resolution.previousBacklog !== a.resolution.backlog ? `was ${a.resolution.previousBacklog}` : 'unchanged'}</small></dd></div>
              </dl>
              <div className="si-sub">
                <p className="eyebrow">AGE OF OPEN WORK</p>
                {a.resolution.ageDistribution.some((b) => b.count) ? <RankBars rows={a.resolution.ageDistribution.map((b) => ({ label: b.label, value: b.count, color: b.label === '3d+' ? 'var(--danger)' : b.label === '1–3d' ? 'var(--warning)' : 'var(--accent)' }))} /> : <p className="calm">Nothing is open.</p>}
              </div>
              {a.resolution.byPriority.some((p) => p.resolved) && (
                <div className="si-sub">
                  <p className="eyebrow">TIME TO RESOLVE BY PRIORITY</p>
                  <table className="si-table"><tbody>{a.resolution.byPriority.filter((p) => p.resolved).map((p) => <tr key={p.priority}><td><PriorityMark value={p.priority} /></td><td className="num">{p.resolved} resolved</td><td className="num">{hm(p.mttrMinutes)}</td></tr>)}</tbody></table>
                </div>
              )}
              {a.resolution.oldestOpen.length > 0 && (
                <div className="si-sub">
                  <p className="eyebrow">OLDEST UNRESOLVED</p>
                  <ul className="work-list">{a.resolution.oldestOpen.map((t) => <li key={t.id}><a href={`#/tickets/${t.id}`}><span className="mono-id">{ticketKey(t)}</span><span className="work-main"><strong>{t.title}</strong><small>{t.assignee ? t.assignee.name : 'Unassigned'}{t.department ? ` · ${t.department}` : ''}</small></span><StatusMark value={t.status} /><small className="muted work-when">{ageWord(t.ageMs)}</small></a></li>)}</ul>
                </div>
              )}
            </section>

            {/* ── Experience ───────────────────────────────────────── */}
            <section className="emp-surface">
              <div className="section-title"><div><h2>Employee experience</h2><p className="muted t-sm">Ratings left by requesters when their work was completed.</p></div><a href={`#/reports/csat?${params}`}>Report →</a></div>
              {a.csat.responses ? (
                <>
                  <dl className="si-facts">
                    <div><dt>Average</dt><dd>{a.csat.average?.toFixed(2)}<small>of 5 · {a.csat.responses} rating{a.csat.responses === 1 ? '' : 's'}</small></dd></div>
                    <div><dt>Previous</dt><dd>{a.csat.previousAverage !== null ? a.csat.previousAverage.toFixed(2) : '—'}<small>{a.csat.previousResponses} rating{a.csat.previousResponses === 1 ? '' : 's'}</small></dd></div>
                    <div><dt>Rated 1–2</dt><dd className={a.csat.lowRated ? 'warn-text' : ''}>{a.csat.lowRated}<small><a href={`#/reports/csat?${params}`}>see which</a></small></dd></div>
                  </dl>
                  {a.csat.responses < SMALL_SAMPLE && <p className="limited"><Icon name="info" size={14} />Limited data — {a.csat.responses} rating{a.csat.responses === 1 ? '' : 's'} is too few to read as a trend.</p>}
                  <div className="si-sub">
                    <p className="eyebrow">DISTRIBUTION</p>
                    <SegmentBar ariaLabel="Rating distribution" height={12} segments={[5, 4, 3, 2, 1].map((s) => ({ label: `${s}★`, value: a.csat.distribution[String(s)] ?? 0, color: s >= 4 ? 'var(--success)' : s === 3 ? 'var(--warning)' : 'var(--danger)' }))} />
                  </div>
                  {a.csat.byDepartment.length > 0 && (
                    <div className="si-sub">
                      <p className="eyebrow">BY DEPARTMENT</p>
                      <table className="si-table"><tbody>{a.csat.byDepartment.map((d) => <tr key={d.id}><td>{d.name}</td><td className="num">{d.average !== null ? d.average.toFixed(2) : '—'}</td><td className="num muted">{d.responses} rating{d.responses === 1 ? '' : 's'}{d.responses < SMALL_SAMPLE ? ' · limited' : ''}</td></tr>)}</tbody></table>
                    </div>
                  )}
                </>
              ) : <EmptyState icon="star" title="No ratings in this period">Requesters are asked to rate when their work is completed.</EmptyState>}
            </section>
          </div>

          {/* ── Team ─────────────────────────────────────────────────── */}
          <section className="emp-surface">
            <div className="section-title"><div><h2>Team workload</h2><p className="muted t-sm">Operational context per engineer for the period. Listed alphabetically — this is not a ranking.</p></div><a href={`#/reports/agents?${params}`}>Report →</a></div>
            {a.team.length ? (
              <div className="table-scroll">
                <table className="si-table team-table">
                  <thead><tr><th scope="col">Engineer</th><th scope="col" className="num">Assigned now</th><th scope="col" className="num">At risk</th><th scope="col" className="num">Breached</th><th scope="col" className="num">Resolved</th><th scope="col" className="num">SLA</th><th scope="col" className="num">Time to resolve</th><th scope="col" className="num">CSAT</th></tr></thead>
                  <tbody>{a.team.map((e) => (
                    <tr key={e.id}>
                      <td><a className="person" href={`#/people/${e.id}`}><Avatar name={e.name} size={24} />{e.name}</a></td>
                      <td className="num"><a href={`#/tickets?assigneeId=${e.id}&open=true`}>{e.assigned}</a></td>
                      <td className={`num ${e.atRisk ? 'warn-text' : ''}`}>{e.atRisk}</td>
                      <td className={`num ${e.breached ? 'crit-text' : ''}`}>{e.breached}</td>
                      <td className="num">{e.resolved}</td>
                      <td className="num">{pct(e.slaCompliancePercent)}{e.slaMeasured ? <small className="muted"> / {e.slaMeasured}</small> : null}</td>
                      <td className="num">{hm(e.mttrMinutes)}</td>
                      <td className="num">{e.csat !== null ? e.csat.toFixed(2) : '—'}{e.csatResponses ? <small className="muted"> / {e.csatResponses}</small> : null}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="calm">No assignments in this period.</p>}
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, c, fmt, unit, good, href, note, limited }: { label: string; c: Comparison; fmt: (v: number | null) => string; unit: string; good: 'up' | 'down'; href: string; note: string; limited?: boolean }) {
  const dir = c.delta === null || c.delta === 0 ? 'flat' : c.delta > 0 ? 'up' : 'down';
  const tone = dir === 'flat' || c.delta === null ? 'neutral' : (dir === good ? 'ok' : 'crit');
  const deltaText = c.delta === null ? 'no previous period to compare' : c.delta === 0 ? 'unchanged vs previous period' : `${dir === 'up' ? '↑' : '↓'} ${unit === 'min' ? hm(Math.abs(Math.round(c.delta))) : `${Math.abs(c.delta)}${unit ? ` ${unit}` : ''}`} vs previous period`;
  return (
    <a className={`kpi ${limited ? 'limited' : ''}`} href={href}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{fmt(c.value)}</strong>
      <span className={`kpi-delta ${tone}`}>{deltaText}</span>
      <small className="kpi-note">{note}</small>
    </a>
  );
}

function Trend({ a, metric }: { a: Analytics; metric: 'volume' | 'resolution' | 'sla' | 'csat' | 'backlog' }) {
  const labelsX = a.series.map((d) => dayLabel(d.day));
  const detail = (i: number) => { const d = a.series[i]; return <>created {d.created} · resolved {d.resolved} · backlog {d.backlog}{d.slaPercent !== null ? ` · SLA ${d.slaPercent}%` : ''}</>; };
  if (metric === 'volume') return <AreaChart ariaLabel="Tickets created and resolved per day" height={300} width={1400} labels={labelsX} series={[a.series.map((d) => d.created), a.series.map((d) => d.resolved)]} names={['Created', 'Resolved']} detail={detail} />;
  if (metric === 'backlog') return <AreaChart ariaLabel="Open tickets at the end of each day" height={300} width={1400} labels={labelsX} series={[a.series.map((d) => d.backlog)]} names={['Backlog']} colors={['var(--p2)']} detail={detail} />;
  if (metric === 'sla') return <AreaChart ariaLabel="Share of resolutions inside SLA per day" height={300} width={1400} labels={labelsX} series={[a.series.map((d) => d.slaPercent)]} names={['Resolved in SLA']} colors={['var(--success)']} max={100} format={(v) => `${Math.round(v)}%`} detail={(i) => <>{a.series[i].slaMeasured} resolved that day{a.series[i].breaches ? ` · ${a.series[i].breaches} breach${a.series[i].breaches === 1 ? '' : 'es'}` : ''}</>} />;
  if (metric === 'csat') return <AreaChart ariaLabel="Average rating per day" height={300} width={1400} labels={labelsX} series={[a.series.map((d) => d.csat)]} names={['Average rating']} colors={['var(--violet)']} max={5} format={(v) => v.toFixed(1)} detail={(i) => <>{a.series[i].csatResponses} rating{a.series[i].csatResponses === 1 ? '' : 's'} that day</>} />;
  return <AreaChart ariaLabel="Mean time to resolve per day" height={300} width={1400} labels={labelsX} series={[a.series.map((d) => d.mttrMinutes)]} names={['Time to resolve']} colors={['var(--cyan)']} format={(v) => hm(Math.round(v))} detail={(i) => <>{a.series[i].resolved} resolved that day</>} />;
}

const AnalyticsSkeleton = () => (
  <div className="kb-skeleton" aria-hidden="true" role="status" aria-label="Loading">
    <div className="sk-strip" /><div className="sk-chart" /><div className="sk-grid"><div className="sk-tile tall" /><div className="sk-tile tall" /><div className="sk-tile tall" /><div className="sk-tile tall" /></div>
  </div>
);
