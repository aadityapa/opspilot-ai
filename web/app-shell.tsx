import { useEffect, useState, type ReactNode } from 'react';
import type { CurrentUser } from '../shared/model';
import { Icon, Logo } from './ui/icons';
import { Crumbs } from './ui';

/* ── Navigation model ─────────────────────────────────────────────────── */

export type NavItem = { href: string; icon: string; text: string; match?: (route: string) => boolean };
export type NavGroup = { label: string; items: NavItem[] };

/**
 * The sidebar information architecture. Visibility follows the role the server reported; it is a
 * convenience only — every route and API call is authorised again on the server.
 */
export function buildNav(user: CurrentUser): NavGroup[] {
  const staff = user.role !== 'EMPLOYEE';
  const admin = user.role === 'ADMIN';
  if (!staff) {
    // Employees get a request-centred map: no queues, no board, no analytics.
    return [
      { label: 'Home', items: [{ href: '/', icon: 'home', text: 'My space', match: (r) => r === '/' }] },
      {
        label: 'Requests',
        items: [
          { href: '/tickets/new', icon: 'grid', text: 'Service Catalog', match: (r) => r === '/tickets/new' },
          { href: '/requests', icon: 'ticket', text: 'My requests', match: (r) => r === '/requests' || r.startsWith('/requests/') || r === '/tickets' || (r.startsWith('/tickets/') && r !== '/tickets/new') },
          { href: '/approvals', icon: 'checks', text: 'Approvals' },
        ],
      },
      { label: 'Resources', items: [{ href: '/knowledge', icon: 'book', text: 'Knowledge' }, { href: '/assets', icon: 'laptop', text: 'My assets' }] },
      { label: 'Organization', items: [{ href: '/people', icon: 'users', text: 'People' }, { href: '/departments', icon: 'building', text: 'Departments' }] },
      { label: 'Help', items: [{ href: '/ask', icon: 'spark', text: 'Ask OpsPilot' }, { href: '/notifications', icon: 'bell', text: 'Notifications' }] },
    ];
  }
  const groups: NavGroup[] = [
    { label: 'Home', items: [{ href: '/', icon: 'home', text: 'My space', match: (r) => r === '/' }, ...(staff ? [{ href: '/dashboard', icon: 'activity', text: 'Command Center' }] : [])] },
    {
      label: 'Operations',
      items: [
        { href: '/tickets', icon: 'ticket', text: 'Service Desk', match: (r) => r === '/tickets' || (r.startsWith('/tickets/') && r !== '/tickets/new') },
        { href: '/board', icon: 'board', text: 'Board' },
        { href: '/approvals', icon: 'checks', text: 'Approvals' },
      ],
    },
    {
      label: 'Services',
      items: [
        { href: '/tickets/new', icon: 'grid', text: 'Service Catalog', match: (r) => r === '/tickets/new' },
        { href: '/knowledge', icon: 'book', text: 'Knowledge' },
        { href: '/assets', icon: 'laptop', text: staff ? 'Assets' : 'My assets' },
      ],
    },
    { label: 'Organization', items: [{ href: '/people', icon: 'users', text: 'People' }, { href: '/departments', icon: 'building', text: 'Departments' }] },
    {
      label: 'Intelligence',
      items: [
        ...(staff ? [{ href: '/analytics', icon: 'chart', text: 'Analytics' }, { href: '/reports', icon: 'reports', text: 'Reports' }] : []),
        { href: '/ask', icon: 'spark', text: 'Ask OpsPilot' },
      ],
    },
    ...(admin ? [{ label: 'Platform', items: [{ href: '/admin', icon: 'sliders', text: 'Administration', match: (r: string) => r.startsWith('/admin') || r.startsWith('/settings') || r === '/users' }] }] : []),
  ];
  return groups.filter((g) => g.items.length);
}

const isActive = (item: NavItem, fullRoute: string) => {
  const route = fullRoute.split('?')[0];
  return item.match ? item.match(route) : route === item.href || route.startsWith(item.href + '/');
};

/** Breadcrumb for the header, derived from the route and the nav model. */
export function routeCrumbs(fullRoute: string, groups: NavGroup[]): { label: string; href?: string }[] {
  const [route, query] = fullRoute.split('?');
  for (const g of groups) for (const item of g.items) if (isActive(item, route)) {
    const crumbs: { label: string; href?: string }[] = [{ label: g.label }, { label: item.text, href: `#${item.href}` }];
    if (route === '/desk') crumbs.push({ label: 'List' });
    else if (route.startsWith('/reports/')) crumbs.push({ label: 'Report' });
    else if (route.startsWith('/tickets/') && route !== '/tickets/new') crumbs.push({ label: item.href === '/requests' ? 'Request' : 'Ticket' });
    else if (route.startsWith('/requests/')) crumbs.push({ label: 'Request' });
    else if (route === '/tickets/new' && new URLSearchParams(query ?? '').get('submitted')) crumbs.push({ label: 'Submitted' });
    else if (route === '/tickets/new' && new URLSearchParams(query ?? '').get('service')) crumbs.push({ label: new URLSearchParams(query ?? '').get('step') === 'review' ? 'Review' : new URLSearchParams(query ?? '').get('step') === 'form' ? 'Request' : 'Service' });
    else if (route.startsWith('/people/')) crumbs.push({ label: 'Profile' });
    else if (route.startsWith('/departments/')) crumbs.push({ label: 'Department' });
    else if (route.startsWith('/knowledge/')) crumbs.push({ label: 'Article' });
    else if (route.startsWith('/assets/')) crumbs.push({ label: 'Asset' });
    return crumbs;
  }
  if (route === '/notifications') return [{ label: 'You' }, { label: 'Notifications' }];
  if (route === '/account') return [{ label: 'You' }, { label: 'Account & security' }];
  if (route === '/board') return [{ label: 'Operations' }, { label: 'Board' }];
  if (route === '/requests' || route.startsWith('/requests/')) return [{ label: 'Requests' }, { label: 'My requests', href: '#/requests' }, ...(route.startsWith('/requests/') ? [{ label: 'Request' }] : [])];
  return [{ label: 'Workspace' }, { label: 'Not found' }];
}

/* ── Hooks ────────────────────────────────────────────────────────────── */

export function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/* ── Sidebar ──────────────────────────────────────────────────────────── */

export function Sidebar({ groups, route, collapsed, onNavigate }: { groups: NavGroup[]; route: string; collapsed: boolean; onNavigate: () => void }) {
  return (
    <aside className="sidebar" id="sidebar">
      <a href="#/" className="brand" aria-label="OpsPilot home" onClick={onNavigate}>
        <span className="brand-mark"><Logo size={30} /></span>
        <span className="nav-label brand-text"><strong>OpsPilot</strong><small>Enterprise Service Operations</small></span>
      </a>
      <nav aria-label="Main navigation">
        {groups.map((g) => (
          <div className="nav-group" key={g.label}>
            <p className="nav-section" aria-hidden={collapsed}>{g.label}</p>
            {g.items.map((item) => {
              const active = isActive(item, route);
              return (
                <a key={item.href} href={`#${item.href}`} aria-current={active ? 'page' : undefined} className={active ? 'active' : ''} aria-label={item.text} data-tip={collapsed ? item.text : undefined} onClick={onNavigate}>
                  <Icon name={item.icon} />
                  <span className="nav-label">{item.text}</span>
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span className="ws-dot" aria-hidden="true" />
        <span className="nav-label"><strong>Demo workspace</strong><p>Fictional data · reviewed AI</p></span>
      </div>
    </aside>
  );
}

/* ── Global create menu ───────────────────────────────────────────────── */

const CREATE = (user: CurrentUser) => [
  { href: '#/tickets/new', icon: 'ticket', title: 'Ticket or request', hint: 'Report an issue or pick a catalog item' },
  ...(user.role === 'ADMIN' ? [
    { href: '#/knowledge/new', icon: 'book', title: 'Knowledge article', hint: 'Write a runbook or how-to' },
    { href: '#/admin/users', icon: 'user', title: 'User', hint: 'Invite a person with a temporary password' },
    { href: '#/admin/announcements', icon: 'flag', title: 'Announcement', hint: 'Tell everyone about an outage or change' },
    { href: '#/admin/catalog', icon: 'grid', title: 'Catalog item', hint: 'Add a service people can request' },
  ] : []),
];

export function CreateMenu({ user }: { user: CurrentUser }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.create-wrap')) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="create-wrap">
      <button className="primary create-btn" aria-label="Create" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="plus" size={16} /><span className="nav-label">Create</span>
      </button>
      {open && (
        <div className="bell-menu create-menu" role="menu" aria-label="Create">
          {CREATE(user).map((c) => (
            <a key={c.href} role="menuitem" href={c.href} onClick={() => setOpen(false)}>
              <Icon name={c.icon} /><span><strong>{c.title}</strong><small>{c.hint}</small></span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Header ───────────────────────────────────────────────────────────── */

export function Header({ crumbs, mobile, collapsed, navOpen, onToggleNav, onSearch, dark, onTheme, children }: {
  crumbs: { label: string; href?: string }[]; mobile: boolean; collapsed: boolean; navOpen: boolean; onToggleNav: () => void; onSearch: () => void; dark: boolean; onTheme: () => void; children: ReactNode;
}) {
  const navLabel = mobile ? (navOpen ? 'Close navigation' : 'Open navigation') : collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn" aria-label={navLabel} aria-expanded={mobile ? navOpen : !collapsed} aria-controls="sidebar" onClick={onToggleNav}><Icon name="menu" /></button>
        <Crumbs items={crumbs} />
      </div>
      <div className="topbar-center">
        <button className="command-field" onClick={onSearch} aria-label="Open search (Ctrl+K)">
          <Icon name="search" size={16} /><span className="nav-label">Search OpsPilot or run a command…</span><kbd>Ctrl K</kbd>
        </button>
      </div>
      <div className="topbar-right">
        {children}
        <a className="icon-btn" href="#/knowledge" aria-label="Help and knowledge base" data-tip="Help"><Icon name="help" /></a>
        <button className="icon-btn" onClick={onTheme} aria-label={dark ? 'Use light theme' : 'Use dark theme'} data-tip={dark ? 'Light theme' : 'Dark theme'}><Icon name={dark ? 'sun' : 'moon'} /></button>
      </div>
    </header>
  );
}
