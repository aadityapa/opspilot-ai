import type { ReactNode } from 'react';
import { Icon } from './ui/icons';

/**
 * Administration is one control plane: a secondary navigation grouped by what an administrator is
 * doing (organisation, service management, access, experience, intelligence, platform) and a
 * settings workspace beside it. Every entry here is a capability the API actually has; nothing is
 * listed for decoration.
 */
export type AdminKey = 'overview' | 'departments' | 'catalog' | 'templates' | 'workflow' | 'sla' | 'users' | 'roles' | 'announcements' | 'outbox' | 'ai' | 'audit' | 'security' | 'data';
type AdminItem = { key: AdminKey; label: string; href: string; icon: string; blurb: string };
export const ADMIN_AREAS: { group: string; items: AdminItem[] }[] = [
  { group: 'Organization', items: [
    { key: 'overview', label: 'Overview', href: '#/admin', icon: 'sliders', blurb: 'What this workspace is configured to do, and where to change it.' },
    { key: 'departments', label: 'Departments', href: '#/admin/departments', icon: 'building', blurb: 'Teams, cost centres and managers. A department manager approves its members’ requests.' },
  ] },
  { group: 'Service management', items: [
    { key: 'catalog', label: 'Service catalog', href: '#/admin/catalog', icon: 'grid', blurb: 'What people can request, the form each request asks for, and who approves it.' },
    { key: 'templates', label: 'Templates', href: '#/admin/templates', icon: 'copy', blurb: 'Pre-filled tickets support staff start from.' },
    { key: 'workflow', label: 'Workflow', href: '#/admin/workflow', icon: 'board', blurb: 'Ticket types, statuses, the transitions between them, and how priority is derived.' },
    { key: 'sla', label: 'Service levels', href: '#/admin/sla', icon: 'clock', blurb: 'First-response and resolution targets per priority.' },
  ] },
  { group: 'Access', items: [
    { key: 'users', label: 'Accounts & access', href: '#/admin/users', icon: 'user', blurb: 'Accounts, roles, second factor, lockouts and reset links.' },
    { key: 'roles', label: 'Roles & permissions', href: '#/admin/roles', icon: 'shield', blurb: 'What each role may do, as the API enforces it.' },
  ] },
  { group: 'Experience', items: [
    { key: 'announcements', label: 'Announcements', href: '#/admin/announcements', icon: 'flag', blurb: 'What everyone sees on My Space.' },
    { key: 'outbox', label: 'Notification outbox', href: '#/admin/outbox', icon: 'mail', blurb: 'Delivery of e-mail notifications, with retries.' },
  ] },
  { group: 'Intelligence', items: [
    { key: 'ai', label: 'AI & retrieval', href: '#/admin/ai', icon: 'spark', blurb: 'Provider, index status and usage. Credentials never leave the server.' },
  ] },
  { group: 'Platform', items: [
    { key: 'audit', label: 'Audit log', href: '#/admin/audit', icon: 'activity', blurb: 'Every administrative and security-relevant action, who took it and when.' },
    { key: 'security', label: 'Security', href: '#/admin/security', icon: 'lock', blurb: 'The protections that are in force, as facts rather than switches.' },
    { key: 'data', label: 'Data & retention', href: '#/admin/data', icon: 'layers', blurb: 'Retention periods, personal-data export and erasure, audit export.' },
  ] },
];
export const adminItem = (key: AdminKey) => ADMIN_AREAS.flatMap((g) => g.items).find((i) => i.key === key)!;

export function AdminLayout({ current, actions, children }: { current: AdminKey; actions?: ReactNode; children: ReactNode }) {
  const item = adminItem(current);
  const group = ADMIN_AREAS.find((g) => g.items.some((i) => i.key === current));
  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Administration sections">
        <p className="admin-title"><Icon name="sliders" size={16} />Administration</p>
        {ADMIN_AREAS.map((g) => (
          <div key={g.group} className="admin-group">
            <p className="eyebrow">{g.group.toUpperCase()}</p>
            {g.items.map((i) => <a key={i.key} href={i.href} aria-current={i.key === current ? 'page' : undefined} className={i.key === current ? 'active' : ''}><Icon name={i.icon} size={16} />{i.label}</a>)}
          </div>
        ))}
      </nav>
      <div className="admin-content">
        <header className="admin-head">
          <div>
            <p className="eyebrow">{group ? group.group.toUpperCase() : 'ADMINISTRATION'}</p>
            <h1>{item.label}</h1>
            <p className="muted">{item.blurb}</p>
          </div>
          {actions && <div className="page-actions">{actions}</div>}
        </header>
        <div className="admin-body">{children}</div>
      </div>
    </div>
  );
}

/** A settings page is a stack of sections, each with its own title, explanation and controls. */
export function SettingsSection({ title, description, actions, children, id }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="settings-section emp-surface" aria-labelledby={id}>
      <div className="section-title"><div><h2 id={id}>{title}</h2>{description && <p className="muted t-sm">{description}</p>}</div>{actions}</div>
      {children}
    </section>
  );
}
