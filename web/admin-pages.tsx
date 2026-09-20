import { api } from './api';
import { useRecord, type Act } from './operations';
import { labels, priorities, priorityFor, statuses, ticketTypes, transitions, type CatalogItem, type Department, type SlaPolicy } from '../shared/model';
import { Icon } from './ui/icons';
import { ADMIN_AREAS, AdminLayout, SettingsSection } from './admin-nav';
import { PRIORITY_CODE, PRIORITY_WORD, PriorityMark, StatusMark } from './ui/marks';

/* ── Overview ──────────────────────────────────────────────────────────── */

export function AdminOverview({ refresh }: { refresh: number }) {
  const { data: departments } = useRecord<Department[]>('/departments', refresh);
  const { data: catalog } = useRecord<CatalogItem[]>('/catalog', refresh);
  const { data: sla } = useRecord<SlaPolicy[]>('/admin/sla', refresh);
  const { data: security } = useRecord<SecurityPosture>('/admin/security', refresh);
  const facts: { label: string; value: string; href: string }[] = [
    { label: 'Departments', value: departments ? String(departments.length) : '…', href: '#/admin/departments' },
    { label: 'Catalog services', value: catalog ? `${catalog.length} active` : '…', href: '#/admin/catalog' },
    { label: 'Service levels', value: sla ? `${sla.length} priorities` : '…', href: '#/admin/sla' },
    { label: 'Accounts', value: security ? `${security.accounts.total} · ${security.accounts.mfaEnabled} with MFA` : '…', href: '#/admin/users' },
    { label: 'Active sessions', value: security ? String(security.accounts.activeSessions) : '…', href: '#/admin/security' },
    { label: 'Locked accounts', value: security ? String(security.accounts.locked) : '…', href: '#/admin/users' },
  ];
  return (
    <AdminLayout current="overview">
      <section className="mywork-strip admin-strip" aria-label="Configuration at a glance">
        <p className="eyebrow strip-eyebrow">At a glance</p>
        {facts.map((f) => <a key={f.label} className="strip-cell" href={f.href}><strong>{f.value}</strong><span>{f.label}</span></a>)}
      </section>
      <div className="admin-areas">
        {ADMIN_AREAS.map((g) => (
          <section key={g.group} className="emp-surface">
            <div className="section-title"><h2>{g.group}</h2></div>
            <ul className="admin-links">
              {g.items.filter((i) => i.key !== 'overview').map((i) => <li key={i.key}><a href={i.href}><span className="hr-icon" aria-hidden="true"><Icon name={i.icon} size={16} /></span><span><strong>{i.label}</strong><small>{i.blurb}</small></span><Icon name="chevron" size={16} /></a></li>)}
            </ul>
          </section>
        ))}
      </div>
    </AdminLayout>
  );
}

/* ── Workflow ──────────────────────────────────────────────────────────── */

/**
 * The workflow is fixed in this release: one status model shared by every ticket type, a fixed
 * transition table, and a fixed impact × urgency matrix for priority. This page shows exactly
 * what the API enforces, and says plainly that it is read-only.
 */
export function WorkflowPage() {
  const impacts = ['LOW', 'MEDIUM', 'HIGH'] as const;
  return (
    <AdminLayout current="workflow">
      <SettingsSection id="wf-types" title="Ticket types" description="Every ticket is one of these. Service catalog items create Service requests; everything else starts as an Incident unless changed by support.">
        <ul className="fact-list">
          {ticketTypes.map((t) => <li key={t}><strong>{labels[t]}</strong><small>{t === 'INCIDENT' ? 'Something is broken or degraded.' : t === 'REQUEST' ? 'Something is wanted, usually from the catalog; may need approval.' : t === 'PROBLEM' ? 'The underlying cause behind repeated incidents.' : 'A planned change to a service or its configuration.'}</small></li>)}
        </ul>
      </SettingsSection>
      <SettingsSection id="wf-status" title="Statuses and transitions" description="What a ticket can move to from each status. Support roles change status from the ticket workspace; requesters can reopen resolved work. The clock pauses while a ticket waits on its requester.">
        <div className="table-scroll">
          <table className="si-table workflow-table">
            <thead><tr><th scope="col">From</th><th scope="col">Can move to</th><th scope="col">SLA clock</th></tr></thead>
            <tbody>
              {statuses.map((s) => (
                <tr key={s}>
                  <td><StatusMark value={s} /></td>
                  <td><span className="flex wrap">{transitions[s].map((t) => <StatusMark key={t} value={t} />)}</span></td>
                  <td className="t-sm muted">{s === 'WAITING_FOR_USER' ? 'Paused' : ['RESOLVED', 'CLOSED'].includes(s) ? 'Stopped' : 'Running'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>
      <SettingsSection id="wf-priority" title="Priority matrix" description="Priority is derived from impact (how many people are affected) and urgency (how quickly it is needed). Support can override it on any ticket.">
        <div className="table-scroll"><table className="heat matrix" aria-label="Priority by impact and urgency">
          <thead><tr><th scope="col"><span className="sr-only">Impact \\ Urgency</span></th>{impacts.map((u) => <th key={u} scope="col">Urgency {labels[u]}</th>)}</tr></thead>
          <tbody>{impacts.map((i) => <tr key={i}><th scope="row">Impact {labels[i]}</th>{impacts.map((u) => { const p = priorityFor(i, u); return <td key={u}><span className={`matrix-cell p-${p.toLowerCase()}`}><PriorityMark value={p} /></span></td>; })}</tr>)}</tbody>
        </table></div>
      </SettingsSection>
      <p className="muted fine"><Icon name="info" size={13} /> The workflow is not editable in this release. Custom statuses, per-type transitions and automation rules are on the roadmap, not behind a hidden switch.</p>
    </AdminLayout>
  );
}

/* ── Roles & permissions ───────────────────────────────────────────────── */

/**
 * Three fixed roles. This table is a plain-language rendering of what the API enforces (see
 * docs/PERMISSIONS.md and the permission matrix test); it is documentation of the server's rules,
 * not a control over them.
 */
const ROLES = [
  { key: 'EMPLOYEE', name: 'Employee', description: 'Raises and follows their own requests, decides approvals addressed to them, reads employee-visible knowledge.' },
  { key: 'ENGINEER', name: 'IT Engineer', description: 'Everything an employee can, plus the whole queue and board, ticket updates, internal notes, support runbooks, analytics and reports.' },
  { key: 'ADMIN', name: 'Administrator', description: 'Everything an engineer can, plus accounts, departments, the catalog, service levels, knowledge authoring, assets, AI settings, audit and retention.' },
] as const;
const CAPABILITIES: { area: string; rows: { capability: string; employee: string; engineer: string; admin: string }[] }[] = [
  { area: 'Tickets', rows: [
    { capability: 'See tickets', employee: 'Own', engineer: 'All', admin: 'All' },
    { capability: 'Update status, assignee, priority', employee: '—', engineer: 'Yes', admin: 'Yes' },
    { capability: 'Internal notes and audit timeline', employee: '—', engineer: 'Yes', admin: 'Yes' },
    { capability: 'Bulk actions and shared views', employee: '—', engineer: 'Yes', admin: 'Yes' },
  ] },
  { area: 'Catalog and approvals', rows: [
    { capability: 'Request from the catalog', employee: 'Yes', engineer: 'Yes', admin: 'Yes' },
    { capability: 'Decide an approval', employee: 'When named', engineer: 'When named', admin: 'Any' },
    { capability: 'Configure the catalog', employee: '—', engineer: '—', admin: 'Yes' },
  ] },
  { area: 'Knowledge', rows: [
    { capability: 'Read articles', employee: 'Employee-visible', engineer: 'Plus support runbooks', admin: 'Plus drafts' },
    { capability: 'Rate an article', employee: 'Yes', engineer: 'Yes', admin: 'Yes' },
    { capability: 'Write, edit, archive', employee: '—', engineer: '—', admin: 'Yes' },
  ] },
  { area: 'Assets', rows: [
    { capability: 'See assets', employee: 'Own', engineer: 'Own, unassigned, in reachable tickets', admin: 'All' },
    { capability: 'Add and edit assets', employee: '—', engineer: '—', admin: 'Yes' },
  ] },
  { area: 'People and departments', rows: [
    { capability: 'Directory and profiles', employee: 'Yes', engineer: 'Yes', admin: 'Yes' },
    { capability: 'A person’s tickets and hardware', employee: 'Own profile', engineer: 'Any profile', admin: 'Any profile' },
    { capability: 'Department service demand', employee: '—', engineer: 'Yes', admin: 'Yes' },
    { capability: 'Edit departments and placements', employee: '—', engineer: '—', admin: 'Yes' },
  ] },
  { area: 'Intelligence', rows: [
    { capability: 'Command Center, Service Intelligence, reports', employee: '—', engineer: 'Yes', admin: 'Yes' },
    { capability: 'AI ticket assistance', employee: '—', engineer: 'Yes', admin: 'Yes' },
    { capability: 'Ask OpsPilot (knowledge answers)', employee: 'Yes', engineer: 'Yes', admin: 'Yes' },
  ] },
  { area: 'Administration', rows: [
    { capability: 'Accounts, roles, lockouts, reset links', employee: '—', engineer: '—', admin: 'Yes' },
    { capability: 'Service levels, announcements, outbox', employee: '—', engineer: '—', admin: 'Yes' },
    { capability: 'Audit log, retention, personal-data export and erasure', employee: '—', engineer: '—', admin: 'Yes' },
  ] },
];
export function RolesPage() {
  return (
    <AdminLayout current="roles">
      <div className="role-cards">
        {ROLES.map((r) => <section key={r.key} className="emp-surface role-card"><p className="eyebrow">{r.key}</p><h2>{r.name}</h2><p className="muted t-sm">{r.description}</p></section>)}
      </div>
      {CAPABILITIES.map((g) => (
        <SettingsSection key={g.area} id={`perm-${g.area}`} title={g.area}>
          <div className="table-scroll">
            <table className="si-table perm-table">
              <thead><tr><th scope="col">Capability</th>{ROLES.map((r) => <th key={r.key} scope="col">{r.name}</th>)}</tr></thead>
              <tbody>{g.rows.map((row) => <tr key={row.capability}><td>{row.capability}</td>{(['employee', 'engineer', 'admin'] as const).map((k) => <td key={k} className={row[k] === '—' ? 'muted' : ''}>{row[k] === 'Yes' ? <span className="perm-yes"><Icon name="check" size={13} />Yes</span> : row[k]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </SettingsSection>
      ))}
      <p className="muted fine"><Icon name="info" size={13} /> Roles are fixed in this release and enforced by the API on every request; an approver is not a role but anyone named on a pending approval. Custom roles and per-permission grants are roadmap items.</p>
    </AdminLayout>
  );
}

/* ── Security ──────────────────────────────────────────────────────────── */

interface SecurityPosture {
  policy: { sessionHours: number; lockoutThreshold: number; lockoutMinutes: number; loginRateLimitPer15Min: number; mfaRequiredRoles: string[]; passwordMinLength: number; secureCookies: boolean; environment: string };
  accounts: { total: number; mfaEnabled: number; locked: number; mustChangePassword: number; disabled: number; activeSessions: number };
}
export function SecurityPage({ refresh }: { refresh: number }) {
  const { data: s, error } = useRecord<SecurityPosture>('/admin/security', refresh);
  return (
    <AdminLayout current="security" actions={<a className="btn" href="#/admin/users"><Icon name="user" size={15} />Accounts & access</a>}>
      {error && <div className="alert error" role="alert">We couldn’t load the security posture. {error}</div>}
      <SettingsSection id="sec-accounts" title="Account posture" description="What the accounts look like right now.">
        <dl className="asset-facts">
          <div><dt>Accounts</dt><dd>{s ? s.accounts.total : '…'}</dd></div>
          <div><dt>Second factor enrolled</dt><dd>{s ? `${s.accounts.mfaEnabled} of ${s.accounts.total}` : '…'}</dd></div>
          <div><dt>Locked out now</dt><dd className={s?.accounts.locked ? 'warn-text' : ''}>{s ? s.accounts.locked : '…'}</dd></div>
          <div><dt>Must change password</dt><dd>{s ? s.accounts.mustChangePassword : '…'}</dd></div>
          <div><dt>Disabled</dt><dd>{s ? s.accounts.disabled : '…'}</dd></div>
          <div><dt>Active sessions</dt><dd>{s ? s.accounts.activeSessions : '…'}</dd></div>
        </dl>
      </SettingsSection>
      <SettingsSection id="sec-policy" title="Protections in force" description="Read from the server’s configuration. Changing one means changing the environment and restarting the service; there is no switch here, on purpose.">
        <dl className="policy-list">
          <div><dt>Session lifetime</dt><dd>{s ? `${s.policy.sessionHours} hours` : '…'}<small>Idle or not, a session ends after this long. Anyone can end their other sessions from Account & security.</small></dd></div>
          <div><dt>Account lockout</dt><dd>{s ? `${s.policy.lockoutThreshold} failures → ${s.policy.lockoutMinutes} minutes` : '…'}<small>Consecutive failed sign-ins lock the account; an administrator can unlock it early.</small></dd></div>
          <div><dt>Sign-in rate limit</dt><dd>{s ? `${s.policy.loginRateLimitPer15Min} attempts per 15 minutes` : '…'}<small>Per source address, successful or not.</small></dd></div>
          <div><dt>Second factor</dt><dd>{s ? (s.policy.mfaRequiredRoles.length ? `Required for ${s.policy.mfaRequiredRoles.map((r) => labels[r] ?? r).join(', ')}` : 'Optional for every role') : '…'}<small>Time-based one-time codes with recovery codes. Secrets are encrypted at rest.</small></dd></div>
          <div><dt>Password floor</dt><dd>{s ? `${s.policy.passwordMinLength} characters minimum` : '…'}<small>Common passwords and passwords containing the person’s own name are refused. New accounts must change their temporary password at first sign-in.</small></dd></div>
          <div><dt>Cookies and origin</dt><dd>{s ? (s.policy.secureCookies ? 'Secure, HTTPS-only' : `Development (${s.policy.environment})`) : '…'}<small>Every mutation requires an exact Origin match and a CSRF token.</small></dd></div>
        </dl>
      </SettingsSection>
      <SettingsSection id="sec-not" title="Not in this release">
        <p className="muted t-sm">Single sign-on (SAML/OIDC), SCIM provisioning, IP allow-lists and per-role session policies are not implemented. They are listed in the roadmap rather than shown here as settings that do nothing.</p>
      </SettingsSection>
    </AdminLayout>
  );
}

/* ── Data & retention ──────────────────────────────────────────────────── */

interface Retention { policy: { auditDays: number; aiUsageDays: number; outboxDays: number }; eligible: { auditEvents: number; aiUsage: number; outbox: number; expiredSessions: number; staleResets: number }; note: string }
export function DataPage({ act, busy, refresh }: { act: Act; busy: boolean; refresh: number }) {
  const { data: r, error } = useRecord<Retention>('/admin/retention', refresh);
  const period = (d: number) => (d ? `${d} days` : 'kept indefinitely');
  return (
    <AdminLayout current="data" actions={<a className="btn" href="/api/admin/audit/export?format=csv" download><Icon name="download" size={15} />Export audit log (CSV)</a>}>
      {error && <div className="alert error" role="alert">We couldn’t load the retention preview. {error}</div>}
      <SettingsSection id="data-retention" title="Retention" description={r?.note ?? 'How long operational records are kept before they are pruned. Runs automatically once a day.'} actions={<button disabled={busy || !r} onClick={() => void act(async () => { await api('/admin/retention/run', 'POST', {}); }, 'Retention applied.')}>Apply retention now</button>}>
        <div className="table-scroll">
          <table className="si-table">
            <thead><tr><th scope="col">Record class</th><th scope="col">Kept for</th><th scope="col" className="num">Eligible for pruning now</th></tr></thead>
            <tbody>
              <tr><td>Standalone audit events<small className="muted"> — events not attached to a ticket</small></td><td>{r ? period(r.policy.auditDays) : '…'}</td><td className="num">{r ? r.eligible.auditEvents : '…'}</td></tr>
              <tr><td>AI usage records</td><td>{r ? period(r.policy.aiUsageDays) : '…'}</td><td className="num">{r ? r.eligible.aiUsage : '…'}</td></tr>
              <tr><td>Delivered notifications</td><td>{r ? period(r.policy.outboxDays) : '…'}</td><td className="num">{r ? r.eligible.outbox : '…'}</td></tr>
              <tr><td>Expired sessions and reset tokens</td><td>On expiry</td><td className="num">{r ? r.eligible.expiredSessions + r.eligible.staleResets : '…'}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted fine">Periods are set with the RETENTION_* environment settings. Tickets, replies and knowledge are never pruned by retention.</p>
      </SettingsSection>
      <SettingsSection id="data-personal" title="Personal data" description="Every person can export their own data from Account & security. Administrators can export or erase any account from Accounts & access.">
        <ul className="fact-list">
          <li><strong>Export</strong><small>A JSON file of the account, its tickets, replies, approvals and notifications.</small></li>
          <li><strong>Erasure</strong><small>Removes name, e-mail, password, second factor, sessions and asset ownership and disables the account. Tickets, replies and audit events are kept, attributed to “Deleted user”. It cannot be undone and is written to the audit log.</small></li>
        </ul>
        <a className="btn" href="#/admin/users"><Icon name="user" size={15} />Open Accounts & access</a>
      </SettingsSection>
    </AdminLayout>
  );
}

export { PRIORITY_CODE, PRIORITY_WORD, priorities };
