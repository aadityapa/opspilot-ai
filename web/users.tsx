import { useState } from 'react';
import { api } from './api';
import { useRecord, when, type Act } from './operations';
import { labels, type CurrentUser } from '../shared/model';
import { AdminLayout, SettingsSection } from './admin-nav';
import { Icon } from './ui/icons';
import { Avatar, EmptyState, Modal, fmtAgo } from './ui';

interface AdminUser extends CurrentUser {
  active: boolean;
  mfaEnabled: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  createdAt: string;
}

/**
 * Accounts & access: system access, not the employee directory. Who can sign in, as what, with
 * which protections, and the administrator actions that change that. Organisational identity —
 * title, department, manager — lives in People. Every action here is written to the audit log.
 */
export function UsersPage({ refresh, busy, act, currentId }: { refresh: number; busy: boolean; act: Act; currentId: string }) {
  const { data: users, error } = useRecord<AdminUser[]>('/admin/users', refresh);
  const [link, setLink] = useState<{ user: string; link: string } | null>(null);
  const [erasing, setErasing] = useState<AdminUser | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'disabled' | 'locked' | 'no-mfa'>('all');
  const locked = (u: AdminUser) => !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
  const lower = q.trim().toLowerCase();
  const rows = (users ?? []).filter((u) => (!lower || u.name.toLowerCase().includes(lower) || u.email.toLowerCase().includes(lower)) && (filter === 'all' || (filter === 'active' && u.active) || (filter === 'disabled' && !u.active) || (filter === 'locked' && locked(u)) || (filter === 'no-mfa' && !u.mfaEnabled)));
  const access = (u: AdminUser) => (!u.active ? { tone: 'neutral', word: 'Disabled' } : locked(u) ? { tone: 'crit', word: 'Locked' } : u.mustChangePassword ? { tone: 'warn', word: 'Must change password' } : { tone: 'ok', word: 'Active' });

  return (
    <AdminLayout current="users" actions={<a className="btn" href="#/people"><Icon name="users" size={15} />People directory</a>}>
      {link && (
        <div className="alert success" role="status">
          <strong>One-time reset link for {link.user}</strong> — valid for 24 hours, shown once. Hand it over through your approved secure channel.
          <pre className="recovery-codes">{link.link}</pre>
          <button onClick={() => setLink(null)}>Dismiss</button>
        </div>
      )}

      <SettingsSection id="acc-list" title="Accounts" description={users ? `${users.length} account${users.length === 1 ? '' : 's'} · ${users.filter((u) => u.active).length} active · ${users.filter((u) => u.mfaEnabled).length} with a second factor` : undefined}>
        <div className="querybar admin-filter" aria-label="Filter accounts">
          <div className="search"><Icon name="search" size={16} /><input aria-label="Search accounts" placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="seg" role="group" aria-label="Access state">
            {([['all', 'All'], ['active', 'Active'], ['disabled', 'Disabled'], ['locked', 'Locked'], ['no-mfa', 'No MFA']] as const).map(([k, l]) => <button key={k} aria-pressed={filter === k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
        </div>
        {error ? <div className="alert error" role="alert">We couldn’t load the accounts. {error}</div> : !users ? (
          <div className="kb-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk-row" />)}</div>
        ) : rows.length ? (
          <div className="table-scroll">
            <table className="si-table users-table">
              <thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Access</th><th scope="col">Second factor</th><th scope="col">Last sign-in</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((u) => {
                  const a = access(u);
                  return (
                    <tr key={u.id} className={!u.active ? 'is-disabled' : ''}>
                      <td><span className="person"><Avatar name={u.name} size={30} /><span className="stack-text"><strong>{u.name}{u.id === currentId && <span className="you-tag">you</span>}</strong><small>{u.email}</small></span></span></td>
                      <td>
                        <select aria-label={`Role for ${u.name}`} value={u.role} disabled={busy || u.id === currentId} onChange={(e) => void act(async () => { await api(`/admin/users/${u.id}`, 'PATCH', { role: e.target.value }); }, 'Role updated. Their sessions were signed out.')}>
                          <option value="EMPLOYEE">Employee</option>
                          <option value="ENGINEER">IT Engineer</option>
                          <option value="ADMIN">Administrator</option>
                        </select>
                      </td>
                      <td><span className={`req-status ${a.tone}`}><i />{a.word}</span>{locked(u) && <small className="muted"> until {when(u.lockedUntil)}</small>}</td>
                      <td className="t-sm">{u.mfaEnabled ? <span className="perm-yes"><Icon name="check" size={13} />Enrolled</span> : <span className="muted">Not enrolled</span>}</td>
                      <td className="t-sm muted" title={u.lastLoginAt ? when(u.lastLoginAt) : ''}>{u.lastLoginAt ? fmtAgo(u.lastLoginAt) : 'Never'}</td>
                      <td className="num">
                        <details className="actions">
                          <summary>Manage</summary>
                          <div className="stack">
                            <button disabled={busy || u.id === currentId} onClick={() => void act(async () => { await api(`/admin/users/${u.id}`, 'PATCH', { active: !u.active }); }, 'User access updated.')}>{u.active ? 'Disable account' : 'Enable account'}</button>
                            {locked(u) && <button disabled={busy} onClick={() => void act(async () => { await api(`/admin/users/${u.id}/unlock`, 'POST', {}); }, 'Account unlocked.')}>Unlock</button>}
                            <button disabled={busy} onClick={() => void act(async () => { const r = await api<{ link: string }>(`/admin/users/${u.id}/reset-link`, 'POST', {}); setLink({ user: u.name, link: r.link }); }, 'Reset link issued.')}>Issue password reset link</button>
                            <button disabled={busy} onClick={() => void act(async () => { await api(`/admin/users/${u.id}/revoke-sessions`, 'POST', {}); }, 'All sessions signed out.')}>Sign out everywhere</button>
                            {u.mfaEnabled && <button disabled={busy || u.id === currentId} onClick={() => void act(async () => { await api(`/admin/users/${u.id}/mfa-reset`, 'POST', {}); }, 'Second factor removed. They can enrol again at next sign-in.')}>Reset second factor</button>}
                            <a className="text-btn" href={`/api/admin/users/${u.id}/export`} download>Export their data</a>
                            <a className="text-btn" href={`#/people/${u.id}`}>Open profile</a>
                            <button disabled={busy || u.id === currentId} className="danger" onClick={() => setErasing(u)}>Erase account…</button>
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="users" title="No accounts match" action={<button onClick={() => { setQ(''); setFilter('all'); }}>Clear filters</button>} />}
      </SettingsSection>

      <SettingsSection id="acc-add" title="Add an account" description="Creates a sign-in with a temporary password. The person is asked to replace it at first sign-in. Title, department and manager are set afterwards in People.">
        <form className="admin-form" onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = Object.fromEntries(new FormData(form));
          void act(async () => { await api('/admin/users', 'POST', data); form.reset(); }, 'User created. They must change the password at first sign-in.');
        }}>
          <div className="two-grid">
            <div className="field"><label htmlFor="nu-name" className="required">Full name</label><input id="nu-name" name="name" required minLength={2} maxLength={100} /></div>
            <div className="field"><label htmlFor="nu-email" className="required">Email</label><input id="nu-email" name="email" type="email" required /></div>
            <div className="field"><label htmlFor="nu-role">Role</label>
              <select id="nu-role" aria-label="Role" name="role"><option value="EMPLOYEE">Employee</option><option value="ENGINEER">IT Engineer</option><option value="ADMIN">Administrator</option></select>
            </div>
            <div className="field"><label htmlFor="nu-pass" className="required">Temporary password</label><input id="nu-pass" type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby="nu-pass-help" /><small id="nu-pass-help" className="field-help">At least 12 characters and not a common password. It must not contain the person’s name.</small></div>
          </div>
          <div className="form-actions"><span className="grow" /><button disabled={busy} className="primary">Create user</button></div>
        </form>
      </SettingsSection>

      {erasing && (
        <Modal title={`Erase ${erasing.name}?`} onClose={() => setErasing(null)} footer={<><button onClick={() => setErasing(null)}>Cancel</button><span className="grow" /><button form="erase-form" disabled={busy} className="danger">Erase permanently</button></>}>
          <form id="erase-form" onSubmit={(e) => { e.preventDefault(); const confirmEmail = new FormData(e.currentTarget).get('confirmEmail'); void act(async () => { await api(`/admin/users/${erasing.id}/erase`, 'POST', { confirmEmail }); setErasing(null); }, 'Account erased. Records remain attributed to "Deleted user".'); }}>
            <p className="t-body">This removes their name, email, password, second factor, sessions and asset ownership, and disables the account permanently. Tickets, replies and audit events are kept, attributed to “Deleted user”. It cannot be undone.</p>
            <div className="field" style={{ marginTop: 'var(--s3)' }}><label htmlFor="erase-email" className="required">Type their email address to confirm</label><input id="erase-email" name="confirmEmail" type="email" required placeholder={erasing.email} /></div>
          </form>
        </Modal>
      )}
    </AdminLayout>
  );
}

export { labels };
