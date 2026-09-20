import { useState } from 'react';
import { api } from './api';
import { Pager, Pending, useRecord, type Act } from './operations';
import type { CurrentUser, Notification, NotifyPrefs, Page } from '../shared/model';
import { dayBucket, kindIcon, notificationHref, notificationLine, notificationWord } from './shell';
import { EmptyState, fmtAgo, ticketKey } from './ui';
import { Icon } from './ui/icons';

/**
 * Preference groups mirror how people think about interruptions, not how the server stores them.
 * Each switch maps to one stored flag; a flag gates delivery on every channel (in-app and email),
 * because the server has one decision per kind — there is no per-channel routing to pretend at.
 */
const PREF_GROUPS: { group: string; items: [keyof NotifyPrefs, string, string, 'everyone' | 'staff'][] }[] = [
  { group: 'Requests', items: [['reply', 'Replies', 'Someone replies on a request you raised or a ticket you own', 'everyone'], ['watched', 'Followed items', 'A request or ticket you follow changes status or gets a reply', 'everyone'], ['survey', 'Rating requests', 'A request you raised is completed and we ask how it went', 'everyone']] },
  { group: 'Mentions', items: [['mention', 'Mentions', 'Someone writes @your name in a reply', 'everyone']] },
  { group: 'Approvals', items: [['approval', 'Approval decisions', 'A request you made is approved or rejected', 'everyone']] },
  { group: 'Tickets', items: [['assignment', 'Assignments', 'A ticket is assigned to you', 'staff'], ['sla', 'Running late', 'IT misses the expected reply or completion time on a ticket or request of yours', 'everyone']] },
];

const TABS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'unread', label: 'Unread', match: (n: Notification) => !n.readAt },
  { key: 'mentions', label: 'Mentions', match: (n: Notification) => n.kind === 'MENTION' },
  { key: 'approvals', label: 'Approvals', match: (n: Notification) => n.kind.startsWith('APPROVAL') },
  { key: 'requests', label: 'Requests', match: (n: Notification) => ['PUBLIC_REPLY', 'WATCHED_UPDATE', 'SURVEY_REQUEST', 'ASSIGNMENT', 'SLA_RESPONSE', 'SLA_RESOLUTION'].includes(n.kind) },
] as const;

/** The notification centre: everything addressed to you, read state, and what you want to hear about. */
export function NotificationsCenterPage({ user, act, busy, refresh }: { user: CurrentUser; act: Act; busy: boolean; refresh: number }) {
  const staff = user.role !== 'EMPLOYEE';
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all');
  const { data, error } = useRecord<Page<Notification> & { unread: number }>(`/notifications?page=${page}&pageSize=30`, refresh);
  const { data: prefs } = useRecord<NotifyPrefs>('/notifications/preferences', refresh);
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];
  const items = (data?.items ?? []).filter(current.match);
  const groups = (['Today', 'Yesterday', 'Earlier'] as const).map((g) => ({ g, rows: items.filter((n) => dayBucket(n.createdAt) === g) })).filter((x) => x.rows.length);
  return (
    <div className="emp notif-center">
      <header className="emp-head">
        <div><p className="eyebrow">NOTIFICATIONS</p><h1>Your inbox</h1><p className="muted">{data ? (data.unread ? `${data.unread} unread.` : 'All caught up.') : ''} Replies, decisions, mentions and updates addressed to you. Internal notes never appear here.</p></div>
        <div className="page-actions">{data && data.unread > 0 && <button disabled={busy} onClick={() => void act(async () => { await api('/notifications/read', 'POST', {}); }, 'All marked as read.')}><Icon name="check" size={15} />Mark all read ({data.unread})</button>}</div>
      </header>
      <div className="emp-grid">
        <section className="emp-main">
          <div className="tabs bell-tabs page-tabs" role="tablist" aria-label="Notification filters">
            {TABS.map((t) => { const n = t.key === 'all' ? 0 : (data?.items ?? []).filter((x) => !x.readAt && t.match(x)).length; return <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}{n ? <span className="count">{n}</span> : null}</button>; })}
          </div>
          <div className="emp-surface inbox-page">
            {!data ? <Pending error={error} /> : groups.length ? groups.map(({ g, rows }) => (
              <section key={g} className="inbox-group" aria-label={g}>
                <p className="eyebrow">{g.toUpperCase()}</p>
                <ul>{rows.map((n) => (
                  <li key={n.id} className={n.readAt ? '' : 'unread'}>
                    <a href={notificationHref(n, staff)} onClick={() => { if (!n.readAt) void api('/notifications/read', 'POST', { ids: [n.id] }).catch(() => {}); }}>
                      <span className={`kind ${n.kind.toLowerCase()}`} aria-hidden="true">{kindIcon(n.kind)}</span>
                      <span className="inbox-text">
                        <span className="inbox-title"><strong>{notificationWord(n.kind, staff)}</strong><small className="muted">{fmtAgo(n.createdAt)}</small></span>
                        <span className="inbox-line">{notificationLine(n, staff)}</span>
                        <small className="muted">{ticketKey(n.ticket)}{n.ticket.title ? ` · ${n.ticket.title}` : ''}</small>
                      </span>
                    </a>
                    {!n.readAt && <button className="text-btn btn-sm" disabled={busy} onClick={() => void act(async () => { await api('/notifications/read', 'POST', { ids: [n.id] }); }, '')}>Mark read</button>}
                  </li>))}</ul>
              </section>
            )) : <EmptyState icon="bell" title={tab === 'all' ? 'Nothing to catch up on' : `No ${current.label.toLowerCase()} notifications`}>{tab === 'all' ? 'When someone replies, decides or mentions you, it lands here.' : undefined}</EmptyState>}
            {data && data.total > 30 && <Pager page={page} setPage={setPage} total={data.total} />}
          </div>
        </section>
        <aside className="emp-side">
          <section className="emp-surface prefs-surface">
            <div className="panel-head"><div><h2>What you want to hear about</h2><p className="muted">Approval requests addressed to you are always delivered.</p></div></div>
            {!prefs ? <Pending error="" /> : PREF_GROUPS.map((g) => {
              const rows = g.items.filter(([, , , who]) => staff || who === 'everyone');
              if (!rows.length) return null;
              return (
                <div key={g.group} className="pref-group">
                  <p className="eyebrow">{g.group.toUpperCase()}</p>
                  <ul className="prefs">{rows.map(([key, name, hint]) => (
                    <li key={key}><label className="check"><input type="checkbox" checked={prefs[key]} disabled={busy} onChange={(e) => void act(async () => { await api('/notifications/preferences', 'PUT', { ...prefs, [key]: e.target.checked }); }, 'Preferences saved.')} /> <span><strong>{name}</strong><small>{hint}</small></span></label><span className="pref-channel" title="Delivered in this inbox and by email">{prefs[key] ? 'In-app + email' : 'Off'}</span></li>
                  ))}</ul>
                </div>
              );
            })}
            <p className="muted fine">Each switch controls both channels together. Locally, email goes to Mailpit when it is running; nothing is ever sent to a real mailbox from a development setup.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
