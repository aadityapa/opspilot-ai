import { useState } from 'react';
import { api } from './api';
import { useRecord, when, type Act } from './operations';
import { labels, priorities, type Page, type SlaPolicy, type TicketEvent } from '../shared/model';
import { AdminLayout, SettingsSection } from './admin-nav';
import { AiSettings } from './ai';
import { Icon } from './ui/icons';
import { Avatar, EmptyState, Pager, fmtAgo } from './ui';
import { PRIORITY_CODE, PRIORITY_WORD } from './ui/marks';

export function SettingsPage({ section, act, busy, refresh }: { section: 'sla' | 'audit' | 'outbox' | 'ai'; act: Act; busy: boolean; refresh: number }) {
  return (
    <AdminLayout current={section}>
      {section === 'audit' ? <AuditLog refresh={refresh} /> : section === 'outbox' ? <Outbox act={act} busy={busy} refresh={refresh} /> : section === 'ai' ? <AiSettings act={act} busy={busy} refresh={refresh} /> : <SlaSettings act={act} busy={busy} refresh={refresh} />}
    </AdminLayout>
  );
}

/* ── Service levels ────────────────────────────────────────────────────── */

function SlaSettings({ act, busy, refresh }: { act: Act; busy: boolean; refresh: number }) {
  const { data, error } = useRecord<SlaPolicy[]>('/admin/sla', refresh);
  const order = data ? [...data].sort((a, b) => priorities.indexOf(a.priority) - priorities.indexOf(b.priority)) : [];
  const human = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${m / 60 % 1 === 0 ? m / 60 : (m / 60).toFixed(1)} h` : `${(m / 1440) % 1 === 0 ? m / 1440 : (m / 1440).toFixed(1)} d`);
  return (
    <>
      <SettingsSection id="sla-targets" title="First-response and resolution targets" description="Minutes on a continuous 24/7 clock. A change applies to tickets created afterwards; existing tickets keep the policy snapshot taken when they started, so historic deadlines never move.">
        {error && <div className="alert error" role="alert">We couldn’t load the service levels. {error}</div>}
        {!data ? <div className="kb-skeleton" aria-hidden="true">{[1, 2, 3, 4].map((i) => <div key={i} className="sk-row" />)}</div> : (
          <div className="table-scroll">
            <table className="si-table sla-table">
              <thead><tr><th scope="col">Priority</th><th scope="col">First response</th><th scope="col">Resolution</th><th scope="col">Last changed</th><th scope="col"><span className="sr-only">Save</span></th></tr></thead>
              <tbody>
                {order.map((p) => (
                  <tr key={p.priority}>
                    <td><span className="sla-priority"><i className={`dot p-${p.priority.toLowerCase()}`} aria-hidden="true" />{labels[p.priority] ?? p.priority}<small className="muted">{PRIORITY_CODE[p.priority]} · {PRIORITY_WORD[p.priority]}</small></span></td>
                    <td colSpan={4}>
                      <form className="sla-form" key={`${p.priority}-${p.updatedAt}`} onSubmit={(e) => {
                        e.preventDefault();
                        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
                        void act(async () => { await api(`/admin/sla/${p.priority}`, 'PUT', { responseMinutes: Number(f.responseMinutes), resolutionMinutes: Number(f.resolutionMinutes) }); }, `${labels[p.priority] ?? p.priority} targets saved.`);
                      }}>
                        <span className="sla-cell"><input name="responseMinutes" type="number" min={1} max={43200} required defaultValue={p.responseMinutes} aria-label={`${labels[p.priority]} first response minutes`} /><small className="muted">min · {human(p.responseMinutes)}</small></span>
                        <span className="sla-cell"><input name="resolutionMinutes" type="number" min={1} max={525600} required defaultValue={p.resolutionMinutes} aria-label={`${labels[p.priority]} resolution minutes`} /><small className="muted">min · {human(p.resolutionMinutes)}</small></span>
                        <span className="sla-cell t-sm muted" title={when(p.updatedAt)}>{fmtAgo(p.updatedAt)}</span>
                        <span className="sla-cell num"><button disabled={busy} className="btn-sm">Save</button></span>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>
      <SettingsSection id="sla-how" title="How the clock runs">
        <ul className="fact-list">
          <li><strong>First response</strong><small>Stops at the first public reply from a support role. A reply from the requester does not count.</small></li>
          <li><strong>Resolution</strong><small>Runs while a ticket is Open or In progress, pauses while it is Waiting for the requester, and stops at Resolved. Reopening starts a clearly marked fresh clock.</small></li>
          <li><strong>At risk</strong><small>A quarter or less of the tightest remaining budget. The same rule feeds the Service Desk filter, the Command Center and Service Intelligence.</small></li>
        </ul>
        <p className="muted fine">Business-hours calendars and per-department policies are roadmap items, not hidden settings.</p>
      </SettingsSection>
    </>
  );
}

/* ── Audit log ─────────────────────────────────────────────────────────── */

const ACTION_GROUPS: [string, RegExp][] = [
  ['Access', /LOGIN|LOGOUT|SESSION|LOCK|PASSWORD|MFA|RESET|USER_/],
  ['Tickets', /TICKET|CREATED|UPDATED|ASSIGN|RESOLVED|REOPEN|REPLY|NOTE|APPROVAL|BULK/],
  ['Configuration', /SLA|CATALOG|TEMPLATE|DEPARTMENT|ANNOUNCEMENT|ARTICLE|ASSET|POLICY|RETENTION/],
  ['Data', /EXPORT|ERAS|ANONYM/],
  ['AI', /AI_|INDEX|REINDEX/],
];
const actionGroup = (a: string) => ACTION_GROUPS.find(([, re]) => re.test(a))?.[0] ?? 'Other';
const actionWord = (a: string) => a.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function AuditLog({ refresh }: { refresh: number }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [group, setGroup] = useState('');
  const { data, error } = useRecord<Page<TicketEvent>>(`/admin/audit?q=${encodeURIComponent(q)}&page=${page}&pageSize=30`, refresh);
  const rows = (data?.items ?? []).filter((e) => !group || actionGroup(e.action) === group);
  return (
    <>
      <section className="querybar admin-filter" aria-label="Filter audit records">
        <div className="search"><Icon name="search" size={16} /><input aria-label="Search audit records" placeholder="Search by action, resource id or detail…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <select aria-label="Action group" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All actions</option>
          {ACTION_GROUPS.map(([g]) => <option key={g} value={g}>{g}</option>)}
          <option value="Other">Other</option>
        </select>
        <span className="grow" />
        <a className="btn btn-sm" href={`/api/admin/audit/export?format=csv${q ? `&q=${encodeURIComponent(q)}` : ''}`} download><Icon name="download" size={14} />Export CSV</a>
      </section>
      <SettingsSection id="audit-rows" title="Audit records" description="Written inside the same transaction as the change they describe. There is no endpoint to edit or delete one.">
        {error && <div className="alert error" role="alert">We couldn’t load the audit log. {error}</div>}
        {!data ? <div className="kb-skeleton" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className="sk-row" />)}</div> : rows.length ? (
          <div className="table-scroll">
            <table className="si-table audit-table">
              <thead><tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Resource</th><th scope="col">Context</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="t-sm nowrap" title={when(e.createdAt)}>{fmtAgo(e.createdAt)}<small className="muted block">{when(e.createdAt)}</small></td>
                    <td>{e.actor ? <span className="person"><Avatar name={e.actor.name} size={22} />{e.actor.name}</span> : <span className="muted t-sm">System</span>}</td>
                    <td><span className="audit-action"><small className="eyebrow">{actionGroup(e.action)}</small>{actionWord(e.action)}<code className="mono-id">{e.action}</code></span></td>
                    <td className="t-sm">{e.ticketId ? <a className="mono-id" href={`#/tickets/${e.ticketId}`}>ticket {e.ticketId.slice(0, 8)}</a> : <span className="muted">—</span>}</td>
                    <td className="t-sm audit-detail">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="activity" title="No audit records match" action={(q || group) ? <button onClick={() => { setQ(''); setGroup(''); setPage(1); }}>Clear filters</button> : undefined}>{q || group ? 'Try another term or action group.' : 'Administrative and security actions will appear here as they happen.'}</EmptyState>}
        {data && data.total > 30 && <div className="table-foot"><Pager page={page} setPage={setPage} total={data.total} pageSize={30} /></div>}
      </SettingsSection>
    </>
  );
}

/* ── Notification outbox ───────────────────────────────────────────────── */

interface OutboxRow { id: string; kind: string; status: string; attempts: number; createdAt: string; sentAt: string | null; lastError: string | null; recipient: { name: string } }
function Outbox({ act, busy, refresh }: { act: Act; busy: boolean; refresh: number }) {
  const [page, setPage] = useState(1);
  const { data, error } = useRecord<Page<OutboxRow>>(`/admin/outbox?page=${page}`, refresh);
  const tone: Record<string, string> = { SENT: 'ok', PENDING: 'info', PROCESSING: 'info', FAILED: 'crit', CANCELLED: 'neutral' };
  return (
    <SettingsSection id="outbox-rows" title="Deliveries" description="A persistent queue with leases, exponential retry and one unique key per recipient and event. Retrying a failed job reuses its row, so a retry can never produce a duplicate message.">
      {error && <div className="alert error" role="alert">We couldn’t load the outbox. {error}</div>}
      {!data ? <div className="kb-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk-row" />)}</div> : data.items.length ? (
        <div className="table-scroll">
          <table className="si-table">
            <thead><tr><th scope="col">Created</th><th scope="col">Recipient</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col" className="num">Attempts</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td className="t-sm" title={when(o.createdAt)}>{fmtAgo(o.createdAt)}</td>
                  <td>{o.recipient.name}</td>
                  <td className="t-sm">{o.kind.toLowerCase().replaceAll('_', ' ')}</td>
                  <td><span className={`req-status ${tone[o.status] ?? 'neutral'}`}><i />{o.status.charAt(0) + o.status.slice(1).toLowerCase()}</span>{o.lastError && <small className="muted block">{o.lastError}</small>}</td>
                  <td className="num">{o.attempts}</td>
                  <td className="num">{o.status === 'FAILED' && <button className="btn-sm" disabled={busy} onClick={() => void act(async () => { await api(`/admin/outbox/${o.id}/retry`, 'POST', {}); }, 'Notification queued for retry.')}>Retry</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState icon="mail" title="The outbox is empty">Assignments, public replies, approvals and SLA breaches queue messages here as they happen.</EmptyState>}
      {data && data.total > 15 && <div className="table-foot"><Pager page={page} setPage={setPage} total={data.total} /></div>}
    </SettingsSection>
  );
}
