import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useRecord } from './operations';
import { labels, type Announcement, type Approval, type CatalogItem, type CurrentUser, type Notification, type OperationsSummary, type SearchResults, type Ticket } from '../shared/model';
import { icon as catalogIcon } from './catalog';
import { Icon } from './ui/icons';
import { EmptyState, Skeleton, fmtAgo, fmtDay, ticketKey } from './ui';
import { SlaMark, StatusMark } from './ui/marks';
import { nextStep } from './employee';
import { RequestBadge } from './requests';
import { rememberDeskReturn } from './nav-state';
import { notificationLine } from './shell';

type Category = { id: string; name: string };
type ApprovalRow = Approval & { ticket: { id: string; number: number; title: string; requester: { id: string; name: string }; catalogItem: { name: string; icon: string } | null } };

/**
 * My Space: the employee home. It answers what needs my attention, what I am waiting for, what I
 * can request, whether I can solve it myself, and what changed. Everything shown is the person's
 * own data from the ordinary scoped endpoints; support staff additionally see their assigned work.
 */
export function HomePage({ user, refresh }: { user: CurrentUser; refresh: number }) {
  const staff = user.role !== 'EMPLOYEE';
  const { data: announcements } = useRecord<Announcement[]>('/announcements', refresh);
  const { data: catalog } = useRecord<CatalogItem[]>('/catalog');
  const { data: categories } = useRecord<Category[]>('/categories');
  const { data: requested } = useRecord<{ items: Ticket[]; total: number }>(`/tickets?${staff ? `requesterId=${user.id}&` : ''}open=true&sort=updated&pageSize=6`, refresh);
  const { data: assigned } = useRecord<{ items: Ticket[]; total: number }>(staff ? '/tickets?assigned=mine&open=true&sort=updated&pageSize=8' : '/categories', refresh);
  const { data: following } = useRecord<{ items: Ticket[]; total: number }>('/tickets?watching=true&open=true&sort=updated&pageSize=8', refresh);
  const { data: approvals } = useRecord<ApprovalRow[]>('/approvals?status=PENDING', refresh);
  const { data: inbox } = useRecord<{ items: Notification[]; unread: number; total: number }>('/notifications?pageSize=25', refresh);
  const { data: ops } = useRecord<OperationsSummary>(staff ? '/operations/summary?days=7' : '/categories', refresh);
  const me = staff ? (ops as OperationsSummary | undefined)?.engineers.find((e) => e.id === user.id) : undefined;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // "For you": decisions, replies, mentions, deadlines — personal and actionable. Derived from the
  // person's own notifications and pending approvals; nothing operational leaks to employees.
  const forYou: { kind: string; title: string; sub: string; href: string; action: string; tone: 'warn' | 'info' | 'crit' | 'ok' }[] = [];
  for (const a of (approvals ?? []).slice(0, 3)) forYou.push({ kind: 'Approval', tone: 'warn', title: `${a.ticket.catalogItem?.name ?? a.ticket.title} from ${a.ticket.requester.name}`, sub: `Waiting ${fmtAgo(a.createdAt).replace(' ago', '')}`, href: '#/approvals', action: 'Review' });
  for (const n of (inbox?.items ?? []).filter((n) => !n.readAt && n.kind !== 'APPROVAL_REQUESTED').slice(0, 5)) {
    const key = `OPS-${String(n.ticket.number).padStart(4, '0')}`;
    const target = staff && n.kind !== 'APPROVAL_DECIDED' && n.kind !== 'SURVEY_REQUEST' ? `#/tickets/${n.ticketId}` : `#/requests/${n.ticketId}`;
    const map: Record<string, [string, string, 'warn' | 'info' | 'crit' | 'ok']> = {
      MENTION: ['Mention', 'Open conversation', 'info'], PUBLIC_REPLY: ['Reply', 'View request', 'info'], APPROVAL_DECIDED: ['Request', 'View request', 'ok'],
      ASSIGNMENT: ['Assigned', 'Open ticket', 'info'], SLA_RESPONSE: ['SLA', 'Open ticket', 'crit'], SLA_RESOLUTION: ['SLA', 'Open ticket', 'crit'], WATCHED_UPDATE: ['Update', 'View', 'info'], SURVEY_REQUEST: ['Completed', 'Rate it', 'ok'],
    };
    // Employees never see SLA vocabulary: a missed deadline on their own request reads as "running late".
    const fallback: [string, string, 'warn' | 'info' | 'crit' | 'ok'] = ['Update', 'View', 'info'];
    const late: [string, string, 'warn' | 'info' | 'crit' | 'ok'] = ['Running late', 'View request', 'warn'];
    const [kind, action, tone] = staff ? (map[n.kind] ?? fallback) : n.kind.startsWith('SLA') ? late : (map[n.kind] ?? fallback);
    const line = !staff && n.kind.startsWith('SLA') ? (n.kind === 'SLA_RESPONSE' ? 'IT has not replied within the expected time' : 'IT has not completed this within the expected time') : n.text.split('\n')[0].replace(/\.$/, '');
    forYou.push({ kind, tone, title: `${line} · ${key}`, sub: `${n.ticket.title ?? ''} · ${fmtAgo(n.createdAt)}`, href: target, action });
  }
  const attentionCount = (approvals?.length ?? 0) + (inbox?.unread ?? 0) + (me ? me.atRisk + me.breached : 0);
  const openRequests = requested?.total ?? 0;
  const byCategory = (categories ?? []).map((c) => ({ c, items: (catalog ?? []).filter((i) => i.categoryId === c.id) })).filter((g) => g.items.length);
  // Personal activity: the person's notification history, newest first, grouped by day.
  const activity = (inbox?.items ?? []).slice(0, 8);

  return (
    <div className="emp myspace">
      <header className="emp-head">
        <div>
          <p className="eyebrow">{greeting.toUpperCase()}</p>
          <h1>{greeting}, {user.name.split(' ')[0]}.</h1>
          <p className="muted">{attentionCount ? `You have ${attentionCount} item${attentionCount === 1 ? '' : 's'} that need${attentionCount === 1 ? 's' : ''} your attention.` : 'Nothing needs your attention right now.'}</p>
        </div>
        <div className="page-actions">
          <a className="btn" href="#/ask"><Icon name="spark" size={15} />Ask OpsPilot</a>
          <a className="primary" href="#/tickets/new"><Icon name="plus" size={15} />Request something</a>
        </div>
      </header>

      <HelpSearch catalog={catalog ?? []} staff={staff} />

      <section className="mywork-strip" aria-label="My work">
        <p className="eyebrow strip-eyebrow">My work</p>
        {staff && <a className="strip-cell" href="#/tickets?assigned=mine&open=true"><strong>{assigned ? assigned.total : '…'}</strong><span>Assigned to me</span></a>}
        <a className={`strip-cell ${approvals?.length ? 'warn' : ''}`} href="#/approvals"><strong>{approvals ? approvals.length : '…'}</strong><span>Needs approval</span></a>
        <a className="strip-cell" href="#/requests"><strong>{requested ? openRequests : '…'}</strong><span>My requests</span></a>
        <a className={`strip-cell ${inbox?.unread ? 'info' : ''}`} href="#/notifications"><strong>{inbox ? inbox.unread : '…'}</strong><span>Unread</span></a>
        {staff && <a className={`strip-cell ${me && me.atRisk + me.breached ? 'crit' : ''}`} href="#/tickets?assigned=mine&sla=at-risk"><strong>{ops ? (me ? me.atRisk + me.breached : 0) : '…'}</strong><span>SLA attention</span></a>}
      </section>

      <div className="emp-grid">
        <div className="emp-main">
          <section className="emp-surface">
            <div className="section-title"><h2>For you</h2><span className="muted t-caption">{forYou.length ? `${forYou.length} item${forYou.length === 1 ? '' : 's'}` : 'Nothing waiting on you'}</span></div>
            {forYou.length ? (
              <ul className="foryou">
                {forYou.map((f, i) => (
                  <li key={i} className={f.tone}>
                    <span className="fy-kind">{f.kind}</span>
                    <span className="fy-body"><strong>{f.title}</strong><small>{f.sub}</small></span>
                    <a className="fy-action" href={f.href}>{f.action}<Icon name="arrow" size={13} /></a>
                  </li>
                ))}
              </ul>
            ) : <p className="calm">You are up to date. New approvals, replies and mentions will appear here.</p>}
          </section>

          {staff ? <MyWork assigned={assigned?.items ?? []} following={following?.items ?? []} requested={requested?.items ?? []} loading={!assigned} /> : (
            <section className="emp-surface">
              <div className="section-title"><h2>My requests</h2><a href="#/requests">All requests →</a></div>
              {!requested ? <Skeleton rows={3} /> : requested.items.length ? (
                <ul className="req-list compact">{requested.items.map((t) => (
                  <li className="req-row" key={t.id}><a href={`#/requests/${t.id}`}><span className="req-main"><strong>{t.catalogItem?.name ?? t.title}</strong><small>{ticketKey(t)} · submitted {fmtDay(t.createdAt)}</small></span><span className="req-next"><small>Next</small>{nextStep(t)}</span><RequestBadge t={t} /></a></li>
                ))}</ul>
              ) : <EmptyState icon="inbox" title="No open requests" action={<a className="btn" href="#/tickets/new">Request something</a>}>Everything you ask IT for will be tracked here, step by step.</EmptyState>}
            </section>
          )}

          {announcements && announcements.length > 0 && (
            <section className="emp-surface">
              <div className="section-title"><h2>Announcements</h2><span className="muted t-caption">From IT operations</span></div>
              <ul className="ann-list">{announcements.slice(0, 4).map((a) => (
                <li key={a.id}><strong>{a.title}</strong><p>{a.body}</p><small>{fmtDay(a.publishedAt)} · {a.author.name}{a.pinned ? ' · pinned' : ''}</small></li>
              ))}</ul>
            </section>
          )}
        </div>

        <aside className="emp-side">
          <section className="emp-surface">
            <div className="section-title"><h2>Quick requests</h2><a href="#/tickets/new">All services →</a></div>
            {!catalog ? <Skeleton rows={3} /> : byCategory.length ? (
              <ul className="launcher">
                {byCategory.slice(0, 6).map(({ c, items }) => (
                  <li key={c.id}><a href={`#/tickets/new?category=${c.id}`}><span className="launch-icon" aria-hidden="true">{catalogIcon(items[0].icon)}</span><span className="launch-body"><strong>{c.name}</strong><small>{items.length === 1 ? items[0].name : `${items.length} services · ${items.slice(0, 2).map((i) => i.name).join(', ')}`}</small></span><Icon name="chevron" size={16} /></a></li>
                ))}
                <li><a href="#/tickets/new?service=issue"><span className="launch-icon" aria-hidden="true"><Icon name="alert" /></span><span className="launch-body"><strong>Report an IT issue</strong><small>Something is broken or not working</small></span><Icon name="chevron" size={16} /></a></li>
              </ul>
            ) : <p className="muted t-sm">No services have been published yet. <a href="#/tickets/new">Report an issue</a> instead.</p>}
          </section>

          <section className="emp-surface">
            <div className="section-title"><h2>Recent activity</h2><a href="#/notifications">Inbox →</a></div>
            {!inbox ? <Skeleton rows={3} /> : activity.length ? (
              <ol className="personal-activity">
                {groupByDay(activity).map(([day, items]) => (
                  <li key={day}><span className="day">{day}</span>
                    <ul>{items.map((n) => <li key={n.id} className={n.readAt ? '' : 'unread'}><time>{new Date(n.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</time><a href={staff && !['APPROVAL_DECIDED', 'SURVEY_REQUEST'].includes(n.kind) ? `#/tickets/${n.ticketId}` : `#/requests/${n.ticketId}`} onClick={rememberDeskReturn}>{notificationLine(n, staff)}</a><small>{n.ticket.title ?? `OPS-${String(n.ticket.number).padStart(4, '0')}`}</small></li>)}</ul>
                  </li>
                ))}
              </ol>
            ) : <p className="muted t-sm">Nothing yet. Replies, approvals and updates on your requests will show here.</p>}
          </section>

          <section className="emp-surface ask-strip">
            <div className="section-title"><h2><span className="ai-mark"><Icon name="spark" size={14} /></span>Ask OpsPilot</h2></div>
            <div className="ask-chips">
              {(staff ? ['What needs my attention?', 'Show my approvals', 'How do I request VPN access?'] : ['Where is my laptop request?', 'How do I request VPN access?', 'Show my approvals']).map((p) => <a key={p} className="chip-btn" href={`#/ask?q=${encodeURIComponent(p)}`}>{p}</a>)}
            </div>
            <p className="muted t-caption">Answers cite the knowledge base and are labelled as AI.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function groupByDay(items: Notification[]): [string, Notification[]][] {
  const today = new Date().toDateString(), yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const out = new Map<string, Notification[]>();
  for (const n of items) {
    const d = new Date(n.createdAt).toDateString();
    const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : fmtDay(n.createdAt);
    out.set(label, [...(out.get(label) ?? []), n]);
  }
  return [...out.entries()];
}

/* ── My work (support staff) ──────────────────────────────────────────── */
function MyWork({ assigned, following, requested, loading }: { assigned: Ticket[]; following: Ticket[]; requested: Ticket[]; loading: boolean }) {
  const [tab, setTab] = useState<'assigned' | 'following' | 'requested'>('assigned');
  const items = tab === 'assigned' ? assigned : tab === 'following' ? following : requested;
  return (
    <section className="emp-surface">
      <div className="section-title"><h2>My work</h2><a href={tab === 'requested' ? '#/requests' : tab === 'following' ? '#/tickets?watching=true' : '#/tickets?assigned=mine&open=true'}>View all →</a></div>
      <div className="tabs mini-tabs" role="tablist" aria-label="My work">
        {([['assigned', 'Assigned', assigned.length], ['following', 'Following', following.length], ['requested', 'Requested', requested.length]] as const).map(([k, l, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}<span className="count">{n}</span></button>)}
      </div>
      {loading ? <Skeleton rows={4} /> : items.length ? (
        <ul className="work-list">
          {items.map((t) => (
            <li key={t.id}><a href={`#/tickets/${t.id}`} onClick={rememberDeskReturn}>
              <span className="mono-id">{ticketKey(t)}</span>
              <span className="work-main"><strong>{t.title}</strong><small>{labels[t.type]} · {t.category.name}</small></span>
              <StatusMark value={t.status} />
              <SlaMark sla={t.sla} status={t.status} bar={false} />
              <small className="muted work-when">{fmtAgo(t.updatedAt)}</small>
            </a></li>
          ))}
        </ul>
      ) : <p className="calm">{tab === 'assigned' ? 'Nothing assigned to you right now.' : tab === 'following' ? 'You are not following any open tickets.' : 'You have no open requests.'}</p>}
    </section>
  );
}

/* ── Universal help search ────────────────────────────────────────────── */
function HelpSearch({ catalog, staff }: { catalog: CatalogItem[]; staff: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    let live = true;
    const t = setTimeout(() => void api<SearchResults>(`/search?q=${encodeURIComponent(q.trim())}`).then((r) => { if (live) setResults(r); }).catch(() => {}), 160);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const lower = q.trim().toLowerCase();
  const services = lower.length >= 2 ? catalog.filter((c) => c.name.toLowerCase().includes(lower) || c.description.toLowerCase().includes(lower)).slice(0, 4) : [];
  const has = services.length || (results && (results.articles.length || results.tickets.length || results.people.length || results.assets.length));
  return (
    <section className="help" aria-label="Get help">
      <h2>What can we help you with?</h2>
      <div className="help-box" ref={box}>
        <div className="help-field">
          <Icon name="search" size={18} />
          <input aria-label="Search services, knowledge, requests or ask OpsPilot" placeholder="Search services, knowledge, requests or ask OpsPilot…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && q.trim()) location.hash = `/tickets/new?q=${encodeURIComponent(q.trim())}`; }} />
          {q && <a className="help-ask" href={`#/ask?q=${encodeURIComponent(q)}`}><Icon name="spark" size={14} />Ask OpsPilot</a>}
        </div>
        {open && lower.length >= 2 && (
          <div className="help-results" role="listbox" aria-label="Help results">
            {services.length > 0 && <div className="hr-group"><span className="hr-label">Services</span>{services.map((c) => <a key={c.id} role="option" href={`#/tickets/new?service=${c.id}`}><span className="hr-icon">{catalogIcon(c.icon)}</span><span><strong>{c.name}</strong><small>{c.description}</small></span></a>)}</div>}
            {results && results.articles.length > 0 && <div className="hr-group"><span className="hr-label">Knowledge</span>{results.articles.slice(0, 4).map((a) => <a key={a.id} role="option" href={`#/knowledge/${a.id}`}><span className="hr-icon"><Icon name="book" size={16} /></span><span><strong>{a.title}</strong><small>{a.category?.name ?? 'Read before raising a request'}</small></span></a>)}</div>}
            {results && results.tickets.length > 0 && <div className="hr-group"><span className="hr-label">{staff ? 'Tickets' : 'My requests'}</span>{results.tickets.slice(0, 4).map((t) => <a key={t.id} role="option" href={staff ? `#/tickets/${t.id}` : `#/requests/${t.id}`}><span className="hr-icon"><Icon name="ticket" size={16} /></span><span><strong>{t.title}</strong><small>OPS-{String(t.number).padStart(4, '0')} · {labels[t.status]}</small></span></a>)}</div>}
            {results && results.people.length > 0 && <div className="hr-group"><span className="hr-label">People</span>{results.people.slice(0, 3).map((p) => <a key={p.id} role="option" href={`#/people/${p.id}`}><span className="hr-icon"><Icon name="user" size={16} /></span><span><strong>{p.name}</strong><small>{labels[p.role]}</small></span></a>)}</div>}
            {results && results.assets.length > 0 && <div className="hr-group"><span className="hr-label">Assets</span>{results.assets.slice(0, 3).map((a) => <a key={a.id} role="option" href={`#/assets/${a.id}`}><span className="hr-icon"><Icon name="laptop" size={16} /></span><span><strong>{a.tag} · {a.model}</strong><small>{a.owner ? a.owner.name : 'Unassigned'}</small></span></a>)}</div>}
            {results && (results.departments ?? []).length > 0 && <div className="hr-group"><span className="hr-label">Departments</span>{(results.departments ?? []).slice(0, 3).map((d) => <a key={d.id} role="option" href={`#/departments/${d.id}`}><span className="hr-icon"><Icon name="building" size={16} /></span><span><strong>{d.name}</strong><small>{d.code} · {d.memberCount} {d.memberCount === 1 ? 'person' : 'people'}</small></span></a>)}</div>}
            {!has && results && <p className="hr-none">Nothing matched yet. <a href={`#/tickets/new?service=issue&q=${encodeURIComponent(q)}`}>Report it as an issue</a> or <a href={`#/ask?q=${encodeURIComponent(q)}`}>ask OpsPilot</a>.</p>}
          </div>
        )}
      </div>
      {catalog.length > 0 && (
        <div className="help-suggest">
          {catalog.slice(0, 5).map((c) => <a key={c.id} className="chip-btn" href={`#/tickets/new?service=${c.id}`}>{c.name}</a>)}
          <a className="chip-btn" href="#/tickets/new?service=issue">Report an IT issue</a>
        </div>
      )}
    </section>
  );
}

