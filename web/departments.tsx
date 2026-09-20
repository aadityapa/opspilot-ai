import { useState } from 'react';
import { useRecord } from './operations';
import { labels, type CurrentUser, type Department, type OperationsSummary, type Profile } from '../shared/model';
import { Icon } from './ui/icons';
import { Avatar, EmptyState, ErrorState, fmtAgo, ticketKey } from './ui';
import { SegmentBar } from './ui/charts';
import { StatusMark } from './ui/marks';
import { rememberDeskReturn } from './nav-state';

/**
 * Departments: how the organisation is arranged, and — for the roles allowed to see it — where
 * service demand comes from. The operational figures are the Command Center's own endpoint scoped
 * to one department, so a department page and the dashboard can never tell different stories. An
 * employee's view stops at the organisational facts; the demand endpoint refuses them outright.
 */
export function DepartmentsPage({ user, refresh }: { user: CurrentUser; refresh: number }) {
  const [q, setQ] = useState('');
  const staff = user.role !== 'EMPLOYEE';
  const { data, error } = useRecord<Department[]>('/departments', refresh);
  const { data: ops } = useRecord<OperationsSummary>(staff ? '/operations/summary?days=30' : '/departments', refresh);
  if (error) return <ErrorState error={error} />;
  if (!data) return <div className="emp-surface kb-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk-row" />)}</div>;
  const demand = new Map(((ops as OperationsSummary | undefined)?.departments ?? []).map((d) => [d.id, d]));
  const lower = q.trim().toLowerCase();
  const visible = data.filter((d) => !lower || d.name.toLowerCase().includes(lower) || d.code.toLowerCase().includes(lower) || (d.costCentre ?? '').toLowerCase().includes(lower));
  const roots = visible.filter((d) => !d.parentId || !visible.some((p) => p.id === d.parentId));
  const children = (id: string) => visible.filter((d) => d.parentId === id);

  const Row = ({ d, depth }: { d: Department; depth: number }) => {
    const stat = demand.get(d.id);
    return (
      <>
        <tr>
          <td>
            <a className="dept-cell" href={`#/departments/${d.id}`} style={{ paddingLeft: depth * 18 }}>
              {depth > 0 && <span className="muted" aria-hidden="true">└ </span>}
              <strong>{d.name}</strong>
              <small className="mono-id">{d.code}</small>
            </a>
          </td>
          <td>{d.manager ? <a className="person" href={`#/people/${d.manager.id}`}><Avatar name={d.manager.name} size={22} />{d.manager.name}</a> : <span className="muted t-sm">No manager</span>}</td>
          <td className="num"><a href={`#/people?departmentId=${d.id}`}>{d.memberCount ?? 0}</a></td>
          <td className="t-sm">{d.costCentre ? <span className="mono-id">{d.costCentre}</span> : <span className="muted">—</span>}</td>
          {staff && <td className="num">{stat ? stat.active : 0}</td>}
          {staff && <td className="num">{stat && stat.atRisk + stat.breached > 0 ? <span className={stat.breached ? 'crit-text' : 'warn-text'}>{stat.atRisk + stat.breached}</span> : <span className="muted">0</span>}</td>}
        </tr>
        {children(d.id).map((c) => <Row key={c.id} d={c} depth={depth + 1} />)}
      </>
    );
  };

  return (
    <div className="emp departments">
      <header className="emp-head">
        <div>
          <p className="eyebrow">ORGANIZATION</p>
          <h1>Departments</h1>
          <p className="muted">Explore teams, managers and {staff ? 'service demand' : 'cost centres'}.</p>
        </div>
        {user.role === 'ADMIN' && <div className="page-actions"><a className="btn" href="#/admin/departments"><Icon name="edit" size={15} />Manage departments</a></div>}
      </header>

      <section className="querybar" aria-label="Filter departments">
        <div className="search"><Icon name="search" size={16} /><input aria-label="Search departments" placeholder="Search departments…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </section>

      {!visible.length ? (
        <EmptyState icon="building" title="No departments match" action={q ? <button onClick={() => setQ('')}>Clear search</button> : undefined}>
          {user.role === 'ADMIN' && !data.length ? 'Create the first one under Administration › Departments.' : 'Try another name or code.'}
        </EmptyState>
      ) : (
        <section className="emp-surface table-surface">
          <div className="table-scroll">
            <table className="dept-table">
              <thead><tr><th scope="col">Department</th><th scope="col">Manager</th><th scope="col" className="num">People</th><th scope="col">Cost centre</th>{staff && <th scope="col" className="num">Open requests</th>}{staff && <th scope="col" className="num">SLA risk</th>}</tr></thead>
              <tbody>{roots.map((d) => <Row key={d.id} d={d} depth={0} />)}</tbody>
            </table>
          </div>
        </section>
      )}
      {staff && <p className="muted fine">Open requests and SLA risk are counted from tickets raised by each department's members over the last 30 days.</p>}
    </div>
  );
}

/** What an event says in a sentence, rather than the stored action name. */
const ACTION_WORD: Record<string, string> = {
  CREATED: 'raised it', ASSIGNED: 'picked it up', UPDATED: 'updated it', REPLIED: 'replied', PUBLIC_REPLY: 'replied',
  NOTE_ADDED: 'added a note', RESOLVED: 'resolved it', REOPENED: 'reopened it', APPROVAL_GRANTED: 'approved it', APPROVAL_REJECTED: 'rejected it',
};

/* ── Department detail ────────────────────────────────────────────────── */

export function DepartmentPage({ id, user, refresh }: { id: string; user: CurrentUser; refresh: number }) {
  const staff = user.role !== 'EMPLOYEE';
  const { data: all, error } = useRecord<Department[]>('/departments', refresh);
  const { data: people } = useRecord<{ items: Profile[]; total: number }>(`/people?departmentId=${id}&pageSize=100`, refresh);
  const { data: ops, error: opsError } = useRecord<OperationsSummary>(staff ? `/operations/summary?days=30&departmentId=${id}` : '/departments', refresh);
  if (error) return <ErrorState error={error} back={{ href: '#/departments', label: 'All departments' }} />;
  if (!all) return <div className="emp-surface kb-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk-row" />)}</div>;
  const d = all.find((x) => x.id === id);
  if (!d) return <ErrorState error="Department not found" back={{ href: '#/departments', label: 'All departments' }} />;
  const parent = d.parentId ? all.find((x) => x.id === d.parentId) : null;
  const subs = all.filter((x) => x.parentId === d.id);
  const summary = staff ? (ops as OperationsSummary | undefined) : undefined;
  const manager = d.manager;
  const members = (people?.items ?? []).filter((p) => p.id !== manager?.id);
  const workTypes = summary ? Object.entries(summary.active.byType).filter(([, n]) => n > 0) : [];
  // Recent work is the department's own activity feed, one row per ticket, newest first.
  const recentWork: { id: string; number: number; title: string; status: string; at: string; who: string }[] = [];
  for (const e of summary?.activity ?? []) {
    if (!e.ticket || recentWork.some((r) => r.id === e.ticket!.id)) continue;
    const word = ACTION_WORD[e.action] ?? 'updated it';
    recentWork.push({ id: e.ticket.id, number: e.ticket.number, title: e.ticket.title, status: e.ticket.status, at: e.at, who: e.actor ? `${e.actor.name} ${word}` : word });
    if (recentWork.length === 6) break;
  }
  const slaPercent = summary && summary.sla.resolutionMeasured > 0 && summary.sla.resolutionCompliancePercent !== null ? Math.round(summary.sla.resolutionCompliancePercent) : null;

  return (
    <div className="emp department">
      <a className="back-link" href="#/departments"><Icon name="arrowLeft" size={14} />All departments</a>
      <header className="req-head">
        <div>
          <p className="eyebrow">DEPARTMENT · <span className="mono-id">{d.code}</span></p>
          <h1>{d.name}</h1>
          <p className="muted">
            {parent && <>Part of <a href={`#/departments/${parent.id}`}>{parent.name}</a> · </>}
            {manager ? <>Managed by <a href={`#/people/${manager.id}`}>{manager.name}</a> · </> : 'No manager · '}
            {d.costCentre ? <>Cost centre <span className="mono-id">{d.costCentre}</span> · </> : ''}
            {people ? `${people.total} ${people.total === 1 ? 'person' : 'people'}` : ''}
          </p>
        </div>
        <div className="page-actions">
          <a className="btn" href={`#/people?departmentId=${d.id}`}><Icon name="users" size={15} />Open in directory</a>
          {staff && <a className="btn" href={`#/dashboard?departmentId=${d.id}`}><Icon name="activity" size={15} />Command Center</a>}
        </div>
      </header>

      {staff && (
        opsError ? (
          <section className="emp-surface">
            <div className="section-title"><h2>Service demand</h2></div>
            <p className="alert error" role="alert">We couldn’t load service demand. {opsError}</p>
            <p className="muted fine">The rest of this page is unaffected.</p>
          </section>
        ) : (
          <>
            <section className="mywork-strip demand-strip" aria-label="Service demand">
              <p className="eyebrow strip-eyebrow">Service demand</p>
              <a className="strip-cell" href={`#/tickets?open=true&departmentId=${d.id}`}><strong>{summary ? summary.active.total : '…'}</strong><span>Active</span></a>
              <a className={`strip-cell ${summary?.active.unassigned ? 'warn' : ''}`} href="#/tickets?assigned=none&open=true"><strong>{summary ? summary.active.unassigned : '…'}</strong><span>Unassigned</span></a>
              <a className={`strip-cell ${summary?.sla.atRisk ? 'warn' : ''}`} href="#/tickets?sla=at-risk"><strong>{summary ? summary.sla.atRisk : '…'}</strong><span>At risk</span></a>
              <a className={`strip-cell ${summary?.sla.activeBreached ? 'crit' : ''}`} href="#/tickets?sla=breached"><strong>{summary ? summary.sla.activeBreached : '…'}</strong><span>Breached</span></a>
              <span className="strip-cell"><strong>{slaPercent !== null ? `${slaPercent}%` : '—'}</strong><span>{slaPercent !== null ? 'Resolved in SLA' : 'No SLA data'}</span></span>
            </section>
            <p className="muted fine">Counted from tickets raised by this department's members. The SLA figure is measured only over tickets that reached a resolution in the last 30 days{summary && summary.sla.resolutionMeasured > 0 ? ` (${summary.sla.resolutionMeasured})` : ''}.</p>
          </>
        )
      )}

      <div className="emp-grid">
        <div className="emp-main">
          <section className="emp-surface">
            <div className="section-title"><h2>People</h2><a href={`#/people?departmentId=${d.id}`}>View all people →</a></div>
            {!people ? <div className="kb-skeleton" aria-hidden="true"><div className="sk-row" /><div className="sk-row" /></div> : (
              <>
                {manager && (
                  <div className="dept-manager">
                    <small className="eyebrow">MANAGER</small>
                    <a href={`#/people/${manager.id}`}><Avatar name={manager.name} size={40} /><span><strong>{manager.name}</strong><small>{people.items.find((p) => p.id === manager.id)?.title ?? labels[manager.role]}</small></span><Icon name="arrow" size={14} /></a>
                  </div>
                )}
                {members.length ? (
                  <ul className="directory compact">
                    {members.slice(0, 8).map((p) => (
                      <li key={p.id}><a href={`#/people/${p.id}`}><Avatar name={p.name} size={32} /><span className="dir-who"><strong>{p.name}</strong><small>{p.title ?? labels[p.role]}</small></span><span className="grow" /><span className="dir-mail muted">{p.location ?? ''}</span></a></li>
                    ))}
                  </ul>
                ) : <p className="calm">Nobody else is placed in this department yet.</p>}
                {members.length > 8 && <a className="text-btn" href={`#/people?departmentId=${d.id}`}>All {people.total} people →</a>}
              </>
            )}
          </section>

          {staff && summary && (
            <section className="emp-surface">
              <div className="section-title"><h2>Recent work</h2><a href={`#/tickets?departmentId=${d.id}`}>Open in Service Desk →</a></div>
              {recentWork.length ? (
                <ul className="work-list">
                  {recentWork.map((t) => (
                    <li key={t.id}>
                      <a href={`#/tickets/${t.id}`} onClick={rememberDeskReturn}>
                        <span className="mono-id">{ticketKey(t)}</span>
                        <span className="work-main"><strong>{t.title}</strong><small>{t.who}</small></span>
                        <StatusMark value={t.status} />
                        <small className="muted work-when">{fmtAgo(t.at)}</small>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : <p className="calm">No activity from this department in the last 30 days.</p>}
            </section>
          )}

          {subs.length > 0 && (
            <section className="emp-surface">
              <div className="section-title"><h2>Sub-departments</h2></div>
              <ul className="directory compact">{subs.map((s) => <li key={s.id}><a href={`#/departments/${s.id}`}><span className="hr-icon"><Icon name="building" size={16} /></span><span className="dir-who"><strong>{s.name}</strong><small>{s.memberCount ?? 0} people</small></span><span className="grow" /><Icon name="chevron" size={16} /></a></li>)}</ul>
            </section>
          )}
        </div>

        <aside className="emp-side">
          <section className="emp-surface">
            <div className="section-title"><h2>Department details</h2></div>
            <dl className="ctx-list">
              <div><dt>Code</dt><dd className="mono-id">{d.code}</dd></div>
              <div><dt>Cost centre</dt><dd>{d.costCentre ?? <span className="muted">Not recorded</span>}</dd></div>
              <div><dt>Manager</dt><dd>{manager ? <a href={`#/people/${manager.id}`}>{manager.name}</a> : <span className="muted">Not set — approvals fall back to an administrator</span>}</dd></div>
              <div><dt>Parent</dt><dd>{parent ? <a href={`#/departments/${parent.id}`}>{parent.name}</a> : <span className="muted">None</span>}</dd></div>
              <div><dt>People</dt><dd>{people ? people.total : '—'}</dd></div>
            </dl>
          </section>

          {staff && summary && workTypes.length > 0 && (
            <section className="emp-surface">
              <div className="section-title"><h2>Work type</h2><span className="muted t-caption">Active</span></div>
              <SegmentBar ariaLabel="Active work by type" segments={workTypes.map(([k, n]) => ({ label: labels[k] ?? k, value: n, color: k === 'INCIDENT' ? 'var(--p2)' : k === 'REQUEST' ? 'var(--accent)' : k === 'PROBLEM' ? 'var(--p1)' : 'var(--cyan)' }))} />
            </section>
          )}

          {staff && summary && (
            <section className="emp-surface">
              <div className="section-title"><h2>30-day flow</h2></div>
              <dl className="ctx-list">
                <div><dt>Raised</dt><dd>{summary.flow.created}</dd></div>
                <div><dt>Resolved</dt><dd>{summary.flow.resolved}</dd></div>
                <div><dt>Approvals pending</dt><dd>{summary.approvals.pending}</dd></div>
                <div><dt>Satisfaction</dt><dd>{summary.csat.responses ? `${summary.csat.average} / 5 · ${summary.csat.responses} rating${summary.csat.responses === 1 ? '' : 's'}` : <span className="muted">No ratings yet</span>}</dd></div>
              </dl>
            </section>
          )}

          {!staff && (
            <section className="emp-surface">
              <div className="section-title"><h2>Need something from IT?</h2></div>
              <p className="muted t-sm">Requests are raised from the service catalog and routed by category, not by department.</p>
              <a className="btn" href="#/tickets/new"><Icon name="plus" size={15} />Request something</a>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
