import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Pending, useRecord, type Act } from './operations';
import { labels, type CurrentUser, type Notification, type SearchResults } from '../shared/model';
import { Avatar } from './ticket-extras';
import { EmptyState, fmtAgo, ticketKey, toast } from './ui';
import { Icon } from './ui/icons';

/* ── Live updates ─────────────────────────────────────────────────────── */

/**
 * One EventSource per signed-in tab. Every event is a hint, never content: the callback bumps a
 * refresh counter and the page refetches through the ordinary, authorised endpoints.
 */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting';
export function useLive(enabled: boolean, onEvent: (type: string) => void): LiveStatus {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [status, setStatus] = useState<LiveStatus>('connecting');
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events/stream', { withCredentials: true });
    const listen = (type: string) => source.addEventListener(type, () => handler.current(type));
    for (const type of ['notification', 'ticket', 'approval', 'announcement']) listen(type);
    // The browser reconnects on its own; the page only says so, quietly, and refetches once the
    // stream is back so nothing missed in between stays missed.
    let dropped = false;
    source.onopen = () => { setStatus('live'); if (dropped) { dropped = false; handler.current('reconnected'); toast('info', 'Live updates restored.'); } };
    source.onerror = () => { dropped = true; setStatus('reconnecting'); };
    return () => source.close();
  }, [enabled]);
  return status;
}

/* ── Command palette (Ctrl+K) ─────────────────────────────────────────── */

type Cmd = { label: string; hint: string; href: string; icon: string; keys?: string };
const ACTIONS = (user: CurrentUser): Cmd[] => [
  { label: 'Report an issue', hint: 'Something is broken or not working', href: '#/tickets/new?service=issue', icon: 'alert', keys: 'N' },
  { label: 'Request a service', hint: 'Pick from the service catalog', href: '#/tickets/new', icon: 'grid' },
  { label: 'Board', hint: 'Drag tickets between stages', href: '#/board', icon: 'board', keys: 'B' },
  { label: user.role === 'EMPLOYEE' ? 'My tickets' : 'Service Desk', hint: user.role === 'EMPLOYEE' ? 'Your open and closed tickets' : 'The queue', href: '#/tickets', icon: 'ticket', keys: 'T' },
  { label: 'My space', hint: 'Home', href: '#/', icon: 'home' },
  { label: 'Ask OpsPilot', hint: 'Answers from the knowledge base, with citations', href: '#/ask', icon: 'spark' },
  { label: 'Knowledge', hint: 'Guides, troubleshooting and runbooks', href: '#/knowledge', icon: 'book' },
  { label: 'My requests', hint: 'Everything you have asked IT for', href: '#/requests', icon: 'inbox' },
  { label: 'People', hint: 'Directory', href: '#/people', icon: 'users' },
  { label: 'Departments', hint: 'Teams, cost centres, managers', href: '#/departments', icon: 'building' },
  { label: 'Approvals', hint: 'Requests waiting for you', href: '#/approvals', icon: 'checks' },
  { label: 'Assets', hint: 'Devices and licences', href: '#/assets', icon: 'laptop' },
  { label: 'Notifications', hint: 'Everything addressed to you', href: '#/notifications', icon: 'bell' },
  { label: 'Account & security', hint: 'Password, two-factor, sessions', href: '#/account', icon: 'shield' },
  ...(user.role !== 'EMPLOYEE' ? [{ label: 'Command Center', hint: 'What needs action now', href: '#/dashboard', icon: 'activity' }, { label: 'Service Intelligence', hint: 'Performance over time', href: '#/analytics', icon: 'chart' }, { label: 'Reports', hint: 'Filterable evidence, CSV export', href: '#/reports', icon: 'reports' }] : []),
  ...(user.role === 'ADMIN' ? [{ label: 'Administration', hint: 'Configuration and governance', href: '#/admin', icon: 'sliders' }, { label: 'Accounts & access', hint: 'Users, roles, second factor', href: '#/admin/users', icon: 'user' }, { label: 'Service catalog admin', hint: 'What people can request', href: '#/admin/catalog', icon: 'grid' }, { label: 'Audit log', hint: 'Who did what, when', href: '#/admin/audit', icon: 'activity' }] : []),
];

const RECENT_KEY = 'opspilot:recent';
function readRecent(): Cmd[] { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } }
function pushRecent(cmd: Cmd) {
  try {
    const next = [cmd, ...readRecent().filter((r) => r.href !== cmd.href)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage unavailable: recents are a convenience only */ }
}

export function CommandPalette({ user, open, onClose }: { user: CurrentUser; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<Cmd[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => { if (open) { setQ(''); setResults(null); setCursor(0); setRecent(readRecent()); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setResults(null); return; }
    let live = true;
    const t = setTimeout(() => void api<SearchResults>(`/search?q=${encodeURIComponent(q.trim())}`).then((r) => { if (live) { setResults(r); setCursor(0); } }).catch(() => {}), 150);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  if (!open) return null;
  const lower = q.trim().toLowerCase();
  const actions = ACTIONS(user).filter((a) => !lower || a.label.toLowerCase().includes(lower) || a.hint.toLowerCase().includes(lower));
  // Pages and actions first: a typed page name must always win over a ticket that mentions the word.
  const rows: (Cmd & { group: string })[] = [
    ...(!lower ? recent.map((r) => ({ group: 'Recent', ...r })) : []),
    ...actions.map((a) => ({ group: lower ? 'Go to' : 'Actions and pages', ...a })),
    // Resources carry the context that makes them identifiable: a person's role and team, an
    // asset's model and holder, an article's category. Everything here came back from the search
    // endpoint, which applies the caller's own scope — the palette never widens what they can see.
    ...(results?.tickets.map((t) => ({ group: t.catalogItemId || t.type === 'REQUEST' ? 'Requests' : 'Tickets', label: `OPS-${String(t.number).padStart(4, '0')} ${t.title}`, hint: labels[t.status], href: `#/tickets/${t.id}`, icon: t.catalogItemId || t.type === 'REQUEST' ? 'box' : 'ticket' })) ?? []),
    ...(results?.people.map((p) => ({ group: 'People', label: p.name, hint: [p.title ?? labels[p.role], p.department?.name].filter(Boolean).join(' · '), href: `#/people/${p.id}`, icon: 'user' })) ?? []),
    ...(results?.articles.map((a) => ({ group: 'Knowledge', label: a.title, hint: a.category?.name ?? 'Article', href: `#/knowledge/${a.id}`, icon: 'book' })) ?? []),
    ...(results?.assets.map((a) => ({ group: 'Assets', label: `${a.tag} · ${a.model}`, hint: a.owner ? a.owner.name : 'Unassigned', href: `#/assets/${a.id}`, icon: 'laptop' })) ?? []),
    ...(results?.departments?.map((d) => ({ group: 'Departments', label: d.name, hint: `${d.code} · ${d.memberCount} ${d.memberCount === 1 ? 'person' : 'people'}`, href: `#/departments/${d.id}`, icon: 'building' })) ?? []),
    ...(results?.services?.map((c) => ({ group: 'Services', label: c.name, hint: c.requiresApproval ? 'Needs approval' : 'Service catalog', href: `#/tickets/new?service=${c.id}`, icon: 'grid' })) ?? []),
  ];
  const go = (row: Cmd) => { pushRecent({ label: row.label, hint: row.hint, href: row.href, icon: row.icon }); onClose(); location.hash = row.href.replace(/^#/, ''); };
  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input ref={input} aria-label="Search or jump to" placeholder="Search people, assets, knowledge, departments, tickets… or type a page name" value={q} onChange={(e) => setQ(e.target.value)}
            role="combobox" aria-expanded="true" aria-controls="palette-results" aria-autocomplete="list"
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); } if (e.key === 'Enter' && rows[cursor]) go(rows[cursor]); }} />
          <kbd>esc</kbd>
        </div>
        <ul role="listbox" id="palette-results" aria-label="Results" ref={list}>
          {rows.length ? rows.map((r, i) => (
            <li key={`${r.group}-${r.href}`} role="option" aria-selected={i === cursor} className={i === cursor ? 'active' : ''} onMouseEnter={() => setCursor(i)} onClick={() => go(r)}>
              {(i === 0 || rows[i - 1].group !== r.group) && <span className="group">{r.group}</span>}
              <span className="p-icon"><Icon name={r.icon} size={15} /></span>
              <span className="label truncate">{r.label}</span><span className="hint">{r.hint}</span>
            </li>
          )) : <li className="muted">{lower.length < 2 ? 'Type to search' : 'No matches'}</li>}
        </ul>
        <footer><span><kbd>↑↓</kbd> navigate</span> <span><kbd>↵</kbd> open</span> <span><kbd>esc</kbd> close</span></footer>
      </div>
    </div>
  );
}

/* ── Notification inbox ───────────────────────────────────────────────── */

const BELL_TABS = [
  { key: 'all', label: 'All', staffOnly: false, match: () => true },
  { key: 'mentions', label: 'Mentions', staffOnly: false, match: (n: Notification) => n.kind === 'MENTION' },
  { key: 'approvals', label: 'Approvals', staffOnly: false, match: (n: Notification) => n.kind.startsWith('APPROVAL') },
  { key: 'requests', label: 'Requests', staffOnly: false, match: (n: Notification) => ['PUBLIC_REPLY', 'WATCHED_UPDATE', 'SURVEY_REQUEST', 'ASSIGNMENT', 'SLA_RESPONSE', 'SLA_RESOLUTION'].includes(n.kind) },
  { key: 'sla', label: 'SLA', staffOnly: true, match: (n: Notification) => n.kind.startsWith('SLA') },
] as const;

/** Day bucket for grouping: today, yesterday, earlier. */
export function dayBucket(iso: string, now = new Date()): 'Today' | 'Yesterday' | 'Earlier' {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : 'Earlier';
}
export const NOTIFICATION_WORD: Record<string, string> = {
  ASSIGNMENT: 'Assigned to you', PUBLIC_REPLY: 'New reply', SLA_RESPONSE: 'Response due', SLA_RESOLUTION: 'Resolution due', MENTION: 'Mentioned you',
  WATCHED_UPDATE: 'Update', APPROVAL_REQUESTED: 'Approval needed', APPROVAL_DECIDED: 'Decision made', SURVEY_REQUEST: 'Rate your request',
};
/** Where a notification should take this person: staff open the ticket workspace, employees their request view. */
/** Employee wording for a notification line; staff see the stored text as-is. */
export const notificationLine = (n: Notification, staff: boolean) => !staff && n.kind === 'SLA_RESPONSE' ? 'IT has not replied within the expected time.' : !staff && n.kind === 'SLA_RESOLUTION' ? 'IT has not completed this within the expected time.' : n.text.split('\n')[0];
export const notificationWord = (kind: string, staff: boolean) => !staff && kind.startsWith('SLA') ? 'Running late' : NOTIFICATION_WORD[kind] ?? 'Update';
export const notificationHref = (n: Notification, staff: boolean) => staff && !['APPROVAL_DECIDED', 'SURVEY_REQUEST'].includes(n.kind) ? (n.kind === 'APPROVAL_REQUESTED' ? '#/approvals' : `#/tickets/${n.ticketId}`) : n.kind === 'APPROVAL_REQUESTED' ? '#/approvals' : `#/requests/${n.ticketId}`;

export function NotificationBell({ user, refresh, act }: { user: CurrentUser; refresh: number; act: Act }) {
  const staff = user.role !== 'EMPLOYEE';
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<(typeof BELL_TABS)[number]['key']>('all');
  const { data } = useRecord<{ items: Notification[]; unread: number }>('/notifications?pageSize=40', refresh);
  const unread = data?.unread ?? 0;
  useEffect(() => { document.title = unread ? `(${unread}) OpsPilot AI` : 'OpsPilot AI · IT support'; }, [unread]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.bell-wrap')) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    // The inbox is a light modal: the page underneath is inert while it is open, so nothing behind
    // it can be reached by pointer, keyboard or assistive tech until it closes.
    const main = document.getElementById('main');
    main?.setAttribute('inert', '');
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); main?.removeAttribute('inert'); };
  }, [open]);
  const tabs = BELL_TABS.filter((t) => staff || !t.staffOnly);
  const current = tabs.find((t) => t.key === tab) ?? tabs[0];
  const items = (data?.items ?? []).filter(current.match).slice(0, 20);
  const groups = (['Today', 'Yesterday', 'Earlier'] as const).map((g) => ({ g, rows: items.filter((n) => dayBucket(n.createdAt) === g) })).filter((x) => x.rows.length);
  const markRead = (n: Notification) => { if (!n.readAt) void api('/notifications/read', 'POST', { ids: [n.id] }).catch(() => {}); };
  return (
    <div className="bell-wrap">
      <button className="icon-btn" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} data-tip="Notifications">
        <Icon name="bell" />
        {unread > 0 && <span className="unread-dot" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && <div className="bell-backdrop" aria-hidden="true" onMouseDown={() => setOpen(false)} />}
      {open && (
        <div className="bell-menu inbox" role="dialog" aria-modal="true" aria-label="Recent notifications" ref={(el) => { if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus(); }}
          onKeyDown={(e) => { if (e.key !== 'Tab') return; const f = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled])')); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }}>
          <div className="inbox-head"><strong>Notifications</strong><span className="muted fine">{unread ? `${unread} unread` : 'All caught up'}</span>{unread > 0 && <button className="text-btn btn-sm" onClick={() => void act(async () => { await api('/notifications/read', 'POST', {}); }, '')}>Mark all read</button>}</div>
          <div className="tabs bell-tabs" role="tablist" aria-label="Notification filters">
            {tabs.map((t) => { const n = t.key === 'all' ? 0 : (data?.items ?? []).filter((x) => !x.readAt && t.match(x)).length; return <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}{n ? <span className="count">{n}</span> : null}</button>; })}
          </div>
          <div className="inbox-body">
            {!data ? <Pending error="" /> : groups.length ? groups.map(({ g, rows }) => (
              <section key={g} className="inbox-group" aria-label={g}>
                <p className="eyebrow">{g.toUpperCase()}</p>
                <ul>{rows.map((n) => (
                  <li key={n.id} className={n.readAt ? '' : 'unread'}>
                    <a href={notificationHref(n, staff)} onClick={() => { setOpen(false); markRead(n); }}>
                      <span className={`kind ${n.kind.toLowerCase()}`} aria-hidden="true">{kindIcon(n.kind)}</span>
                      <span className="inbox-text">
                        <span className="inbox-title"><strong>{notificationWord(n.kind, staff)}</strong><small className="muted">{fmtAgo(n.createdAt)}</small></span>
                        <span className="inbox-line">{notificationLine(n, staff)}</span>
                        <small className="muted">{ticketKey(n.ticket)}{n.ticket.title ? ` · ${n.ticket.title}` : ''}</small>
                      </span>
                      {!n.readAt && <i className="unread-mark" aria-label="Unread" />}
                    </a>
                  </li>))}</ul>
              </section>
            )) : <EmptyState icon="bell" title={tab === 'all' ? 'Nothing yet' : `No ${current.label.toLowerCase()} notifications`}>{tab === 'all' ? 'Replies, decisions and mentions land here.' : undefined}</EmptyState>}
          </div>
          <a href="#/notifications" className="text-btn inbox-foot" onClick={() => setOpen(false)}>All notifications and preferences →</a>
        </div>
      )}
    </div>
  );
}
export const kindIcon = (kind: string) => ({ ASSIGNMENT: 'A', PUBLIC_REPLY: 'R', SLA_RESPONSE: 'S', SLA_RESOLUTION: 'S', MENTION: '@', WATCHED_UPDATE: 'W', APPROVAL_REQUESTED: '✓', APPROVAL_DECIDED: '✓', SURVEY_REQUEST: '★' }[kind] ?? '•');

/* ── Profile menu ─────────────────────────────────────────────────────── */

export function ProfileMenu({ user, dark, onTheme, onSignOut, busy }: { user: CurrentUser; dark: boolean; onTheme: () => void; onSignOut: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.profile-wrap')) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="profile-wrap">
      <button className="profile-btn" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Avatar name={user.name} size={32} />
        <span className="user-info"><strong>{user.name}</strong><small>{labels[user.role]}</small></span>
      </button>
      {open && (
        <div className="bell-menu profile-menu" role="menu" aria-label="Account">
          <div className="menu-head"><strong>{user.name}</strong><small>{user.email} · {labels[user.role]}</small></div>
          <a role="menuitem" href={`#/people/${user.id}`} onClick={() => setOpen(false)}><Icon name="user" size={16} />My profile</a>
          <a role="menuitem" href="#/account" onClick={() => setOpen(false)}><Icon name="shield" size={16} />Account &amp; security</a>
          <a role="menuitem" href="#/notifications" onClick={() => setOpen(false)}><Icon name="bell" size={16} />Notification preferences</a>
          <button role="menuitem" onClick={() => { onTheme(); }}><Icon name={dark ? 'sun' : 'moon'} size={16} />{dark ? 'Switch to light theme' : 'Switch to dark theme'}</button>
          <button role="menuitem" disabled={busy} onClick={() => { setOpen(false); onSignOut(); }}><Icon name="logout" size={16} />Sign out</button>
        </div>
      )}
    </div>
  );
}
