import { useState } from 'react';
import { api } from './api';
import { useRecord, when, type Act } from './operations';
import { labels, type ActivityItem, type Attachment, type CurrentUser, type Ticket } from '../shared/model';
import { Attachments, CsatPrompt, MentionText, MentionTextarea } from './ticket-extras';
import { Icon } from './ui/icons';
import { Avatar, EmptyState, Skeleton, Tabs, fmtAgo, fmtDay, ticketKey } from './ui';
import { nextStep, progressSteps, requestStatus } from './employee';

/**
 * The requester's view of their own work. Same data as the ticket, different vocabulary: requests,
 * progress, next step, who needs to act. Support staff can open the full workspace from here.
 */

export function RequestBadge({ t }: { t: Pick<Ticket, 'status' | 'assigneeId' | 'approvals'> }) {
  const s = requestStatus(t);
  return <span className={`req-status ${s.tone}`}><i />{s.word}</span>;
}

export function RequestRow({ t, href }: { t: Ticket; href: string }) {
  return (
    <li className="req-row">
      <a href={href}>
        <span className="req-main">
          <strong>{t.catalogItem?.name && t.catalogItem.name !== t.title ? `${t.catalogItem.name} · ${t.title}` : t.title}</strong>
          <small>{ticketKey(t)} · {t.type === 'REQUEST' ? 'Request' : 'Issue'} · {t.category.name} · submitted {fmtDay(t.createdAt)}</small>
        </span>
        <span className="req-next"><small>Next</small>{nextStep(t)}</span>
        <RequestBadge t={t} />
        <small className="req-when">{fmtAgo(t.updatedAt)}</small>
      </a>
    </li>
  );
}

export function MyRequestsPage({ user, route, refresh }: { user: CurrentUser; route: string; refresh: number }) {
  const tab = new URLSearchParams(route.split('?')[1] ?? '').get('tab') ?? 'open';
  const [page, setPage] = useState(1);
  const staff = user.role !== 'EMPLOYEE';
  const scope = staff ? `requesterId=${user.id}&` : '';
  const filter = tab === 'waiting' ? 'status=WAITING_FOR_USER' : tab === 'done' ? 'status=RESOLVED' : tab === 'all' ? '' : 'open=true';
  const { data, error } = useRecord<{ items: Ticket[]; total: number; pageSize: number }>(`/tickets?${scope}${filter}${filter ? '&' : ''}sort=updated&page=${page}&pageSize=20`, refresh);
  return (
    <div className="emp">
      <div className="emp-head">
        <div><p className="eyebrow">YOUR REQUESTS</p><h1>My requests</h1><p className="muted">Everything you have asked IT for, where it is, and what happens next.</p></div>
        <div className="page-actions"><a className="btn" href="#/ask"><Icon name="spark" size={15} />Ask OpsPilot</a><a className="primary" href="#/tickets/new"><Icon name="plus" size={15} />Request something</a></div>
      </div>
      <Tabs ariaLabel="Request filters" current={tab} items={[{ key: 'open', label: 'In progress', href: '#/requests' }, { key: 'waiting', label: 'Waiting for me', href: '#/requests?tab=waiting' }, { key: 'done', label: 'Completed', href: '#/requests?tab=done' }, { key: 'all', label: 'All', href: '#/requests?tab=all' }]} />
      {error ? <div className="alert error" role="alert">{error}</div> : !data ? <Skeleton rows={5} /> : data.items.length ? (
        <section className="emp-surface">
          <ul className="req-list">{data.items.map((t) => <RequestRow key={t.id} t={t} href={`#/requests/${t.id}`} />)}</ul>
          {data.total > data.pageSize && <div className="pagination"><span>{data.total} requests</span><div className="flex"><button className="btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn-sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</button></div></div>}
        </section>
      ) : <EmptyState icon="inbox" title={tab === 'open' ? 'Nothing in progress' : 'Nothing here'} action={<a className="primary" href="#/tickets/new">Request something</a>}>{tab === 'open' ? 'When you ask IT for something it shows up here with its progress.' : 'Try another tab.'}</EmptyState>}
    </div>
  );
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

export function RequestDetailPage({ id, user, act, busy, refresh }: { id: string; user: CurrentUser; act: Act; busy: boolean; refresh: number }) {
  const { data: t, error } = useRecord<Ticket>(`/tickets/${id}`, refresh);
  const { data: activity } = useRecord<ActivityItem[]>(`/tickets/${id}/activity`, refresh);
  const [reply, setReply] = useState('');
  if (error) return <div className="alert error" role="alert">{error} <a className="btn-sm btn" href="#/requests">My requests</a></div>;
  if (!t) return <Skeleton rows={8} />;
  const staff = user.role !== 'EMPLOYEE';
  const status = requestStatus(t);
  const steps = progressSteps(t);
  const finished = ['RESOLVED', 'CLOSED'].includes(t.status);
  const isRequest = t.type === 'REQUEST' || !!t.catalogItemId;
  const send = () => { if (!reply.trim()) return; void act(async () => { await api(`/tickets/${id}/replies`, 'POST', { body: reply }); setReply(''); }, 'Reply sent.'); };
  const updates = (activity ?? []).filter((a) => a.kind === 'reply' || a.kind === 'approval' || (a.kind === 'event' && /status|reopen|resolved|created|assigned/i.test(a.title)));
  return (
    <div className="emp req-detail">
      <a className="back-link" href="#/requests"><Icon name="arrowLeft" size={14} />My requests</a>
      <header className="req-head">
        <div>
          <p className="eyebrow"><span className="mono-id">{ticketKey(t)}</span> · {isRequest ? 'Request' : 'Issue'}{t.catalogItem ? ` · ${t.catalogItem.name}` : ''}</p>
          <h1>{t.title}</h1>
          <p className="muted">Submitted {when(t.createdAt)}{t.assignee && !finished ? ` · handled by ${t.assignee.name}` : ''}{t.resolvedAt ? ` · completed ${when(t.resolvedAt)}` : ''}</p>
        </div>
        <div className="page-actions">
          <RequestBadge t={t} />
          {finished && <button disabled={busy} onClick={() => void act(async () => { await api(`/tickets/${id}/reopen`, 'POST', {}); }, 'Request reopened.')}>Reopen</button>}
          {staff && <a className="btn" href={`#/tickets/${t.id}`}><Icon name="ticket" size={15} />Open in Service Desk</a>}
        </div>
      </header>

      <ol className="progress" aria-label="Request progress">
        {steps.map((s, i) => <li key={s.key} className={s.state}><span className="p-dot" aria-hidden="true">{s.state === 'done' ? <Icon name="check" size={12} /> : s.state === 'failed' ? <Icon name="x" size={12} /> : i + 1}</span><span className="p-label">{s.label}</span></li>)}
      </ol>
      <p className="req-nextline"><strong>Next:</strong> {nextStep(t)}{status.tone === 'warn' && t.status === 'WAITING_FOR_USER' ? ' — reply below to keep it moving.' : ''}</p>

      <div className="req-grid">
        <div className="req-main-col">
          <section className="emp-surface">
            <div className="section-title"><h2>Request details</h2><span className="muted t-caption">{t.category.name}</span></div>
            <p className="description">{t.description}</p>
            {t.formData && Object.keys(t.formData).length > 0 && (
              <dl className="properties compact form-answers">{Object.entries(t.formData).map(([k, v]) => <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</dd></div>)}</dl>
            )}
            <div className="attachments-inline"><Attachments ticket={t} user={user} act={act} busy={busy} /></div>
          </section>

          {t.approvals && t.approvals.length > 0 && (
            <section className="emp-surface">
              <div className="section-title"><h2>Approval</h2></div>
              {t.approvals.map((a) => (
                <div key={a.id} className="approval-line">
                  <Avatar name={a.approver.name} size={32} />
                  <div className="grow"><strong>{a.approver.name}</strong><small className="muted">{a.status === 'PENDING' ? `Asked ${fmtAgo(a.createdAt)} · waiting for a decision` : `${labels[a.status]} ${when(a.decidedAt)}`}</small>{a.note && <p className="approval-note">“{a.note}”</p>}</div>
                  <span className={`req-status ${a.status === 'APPROVED' ? 'ok' : a.status === 'REJECTED' ? 'crit' : 'warn'}`}><i />{labels[a.status]}</span>
                </div>
              ))}
            </section>
          )}

          <CsatPrompt ticket={t} user={user} act={act} busy={busy} />

          <section className="emp-surface conversation">
            <div className="section-title"><h2>Conversation</h2><span className="muted t-caption">{t.replies?.length ?? 0} message{(t.replies?.length ?? 0) === 1 ? '' : 's'}</span></div>
            {t.replies?.length ? (
              <ol className="thread">{t.replies.map((r) => (
                <li className="msg reply" key={r.id}><Avatar name={r.author.name} size={32} /><div className="msg-body"><div className="msg-head"><strong>{r.author.name}</strong><span className="muted">{r.author.id === user.id ? 'You' : labels[r.author.role]} · {clock(r.createdAt)} · {fmtDay(r.createdAt)}</span></div><div className="msg-text"><MentionText body={r.body} mentions={r.mentions} /></div>{r.attachments && r.attachments.length > 0 && <ul className="msg-files">{r.attachments.map((a: Attachment) => <li key={a.id}><a href={`/api/tickets/${t.id}/attachments/${a.id}`} download={a.filename}><Icon name="paperclip" size={12} />{a.filename}</a></li>)}</ul>}</div></li>
              ))}</ol>
            ) : <p className="thread-empty">No messages yet. IT will reply here, and you can add detail any time.</p>}
            {!finished ? (
              <form className="composer-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <label><span className="sr-only">Public reply</span><MentionTextarea ticketId={id} id="public-reply" aria-label="Public reply" required maxLength={10000} rows={3} value={reply} onChange={setReply} placeholder="Add a message for IT…" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); } }} /></label>
                <div className="composer-actions"><button type="button" className="btn-ghost btn-sm" onClick={() => document.querySelector<HTMLInputElement>('input[aria-label="Choose a file"]')?.click()}><Icon name="paperclip" size={14} />Attach</button><span className="grow" /><button className="primary" disabled={busy || !reply.trim()}>Send reply</button></div>
              </form>
            ) : <p className="muted t-sm">This request is {status.word.toLowerCase()}. Reopen it if you need more help.</p>}
          </section>
        </div>
        <aside className="req-side">
          <section className="emp-surface">
            <div className="section-title"><h2>Updates</h2></div>
            {!activity ? <Skeleton rows={3} /> : updates.length ? (
              <ol className="sys-timeline">{[...updates].reverse().slice(0, 12).map((a) => <li key={`${a.kind}-${a.id}`} className={a.kind}><time>{clock(a.at)}<small>{fmtDay(a.at)}</small></time><span className="tl-mark" aria-hidden="true" /><span className="tl-body"><strong>{a.actor?.id === user.id ? 'You' : a.actor?.name ?? 'IT'}</strong> <span>{a.kind === 'reply' ? 'replied' : a.title.toLowerCase()}</span></span></li>)}</ol>
            ) : <p className="muted t-sm">No updates yet.</p>}
          </section>
          {t.sla && (
            <section className="emp-surface">
              <div className="section-title"><h2>Service level</h2><span className="muted t-caption">{labels[t.sla.priority]} priority</span></div>
              <dl className="ctx-list">
                <div><dt>First reply</dt><dd>{t.sla.responseSatisfiedAt ? `Replied ${when(t.sla.responseSatisfiedAt)}` : t.sla.responseBreachAt ? `Expected by ${when(t.sla.responseDueAt)} — running late` : `Expected by ${when(t.sla.responseDueAt)}`}</dd></div>
                <div><dt>Completion</dt><dd>{finished ? (t.resolvedAt ? `Completed ${when(t.resolvedAt)}` : 'Completed') : t.sla.paused ? 'Paused while IT waits for your reply' : t.sla.resolutionBreachAt ? `Target was ${when(t.sla.resolutionDueAt)} — running late` : t.sla.resolutionDueAt ? `Target ${when(t.sla.resolutionDueAt)}` : 'No target set'}</dd></div>
              </dl>
              <p className="muted fine">Targets come from the support policy for this priority; the clock pauses while IT is waiting for you.</p>
            </section>
          )}
          <section className="emp-surface">
            <div className="section-title"><h2>Who is involved</h2></div>
            <dl className="ctx-list">
              <div><dt>Handled by</dt><dd>{t.assignee ? t.assignee.name : 'Not yet assigned'}</dd></div>
              {t.approvals?.map((a) => <div key={a.id}><dt>Approver</dt><dd>{a.approver.name}</dd></div>)}
              {t.watchers && t.watchers.length > 0 && <div><dt>Following</dt><dd>{t.watchers.map((w) => w.name).join(', ')}</dd></div>}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
