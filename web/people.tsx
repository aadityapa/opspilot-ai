import { useState } from 'react';
import { api } from './api';
import { useRecord, when, type Act } from './operations';
import { labels, type CurrentUser, type Department, type Person, type Profile } from '../shared/model';
import { Icon } from './ui/icons';
import { Avatar, EmptyState, ErrorState, Pager, Tabs, fmtAgo, fmtDay, ticketKey } from './ui';
import { StatusMark } from './ui/marks';
import { HealthMark } from './assets';
import { rememberDeskReturn } from './nav-state';

type ProfileFull = Profile & {
  openTickets: { id: string; number: number; title: string; status: string; priority: string; createdAt: string }[];
  recentlyClosed?: { id: string; number: number; title: string; status: string; type?: string; resolvedAt: string | null }[];
  assigned?: { id: string; number: number; title: string; status: string; priority: string; createdAt: string }[];
  assets: { id: string; tag: string; model: string; type: string; status: string; warrantyExpiry?: string | null }[];
  reports: Person[];
};

/**
 * People is the company directory, not user administration: it explains who somebody is and where
 * they sit. Access management lives in Administration › Users. What a viewer may see *about* a
 * person — their tickets, their hardware — is decided by the API, not by this page.
 */
export function DirectoryPage({ user, refresh, route }: { user: CurrentUser; refresh: number; route: string }) {
  const params = new URLSearchParams(route.split('?')[1] ?? '');
  const dept = params.get('departmentId') ?? '';
  const managerId = params.get('managerId') ?? '';
  const urlQ = params.get('q') ?? '';
  const [q, setQ] = useState(urlQ);
  const [page, setPage] = useState(1);
  const go = (key: string, value: string) => {
    const next = new URLSearchParams(route.split('?')[1] ?? '');
    if (value) next.set(key, value); else next.delete(key);
    setPage(1);
    location.hash = `/people${next.toString() ? `?${next}` : ''}`;
  };
  const query = new URLSearchParams({ q, page: String(page), pageSize: '24', ...(dept ? { departmentId: dept } : {}), ...(managerId ? { managerId } : {}) });
  const { data, error } = useRecord<{ items: Profile[]; total: number; pageSize: number }>(`/people?${query}`, refresh);
  const { data: departments } = useRecord<Department[]>('/departments', refresh);
  const managers = (departments ?? []).map((d) => d.manager).filter(Boolean) as Person[];
  const seen = new Set<string>();
  const managerOptions = managers.filter((m) => !seen.has(m.id) && seen.add(m.id));
  const currentDept = departments?.find((d) => d.id === dept);

  return (
    <div className="emp people">
      <header className="emp-head">
        <div>
          <p className="eyebrow">PEOPLE</p>
          <h1>Find people across your organization</h1>
          <p className="muted">{data ? `${data.total} ${data.total === 1 ? 'person' : 'people'}${currentDept ? ` in ${currentDept.name}` : ''}. ` : ''}Names, roles, teams and who reports to whom.{user.role === 'ADMIN' ? ' Accounts and access are managed in Administration.' : ''}</p>
        </div>
        {user.role === 'ADMIN' && <div className="page-actions"><a className="btn" href="#/admin/users"><Icon name="shield" size={15} />Manage accounts</a></div>}
      </header>

      <section className="querybar" aria-label="Filter people">
        <div className="search">
          <Icon name="search" size={16} />
          <input aria-label="Search people" placeholder="Search by name, role or department…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <select aria-label="Department" value={dept} onChange={(e) => go('departmentId', e.target.value)}>
          <option value="">All departments</option>
          {departments?.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.memberCount ?? 0})</option>)}
        </select>
        <select aria-label="Manager" value={managerId} onChange={(e) => go('managerId', e.target.value)}>
          <option value="">Any manager</option>
          {managerOptions.map((m) => <option key={m.id} value={m.id}>Reports to {m.name}</option>)}
        </select>
        <span className="grow" />
        {(dept || managerId || q) && <a className="text-btn btn-sm" href="#/people" onClick={() => setQ('')}>Clear</a>}
      </section>

      {error ? <ErrorState error={error} /> : !data ? <DirectorySkeleton /> : data.items.length ? (
        <section className="emp-surface">
          <ul className="directory">
            {data.items.map((p) => (
              <li key={p.id}>
                <a href={`#/people/${p.id}`}>
                  <Avatar name={p.name} size={40} />
                  <span className="dir-who"><strong>{p.name}</strong><small>{p.title ?? labels[p.role]}</small></span>
                  <span className="dir-dept">{p.department ? p.department.name : <span className="muted">No department</span>}</span>
                  <span className="dir-mgr">{p.manager ? <><small>Manager</small>{p.manager.name}</> : <small className="muted">No manager</small>}</span>
                  <span className="dir-mail muted">{p.email}</span>
                  <span className="dir-go">View profile<Icon name="arrow" size={13} /></span>
                </a>
              </li>
            ))}
          </ul>
          {data.total > data.pageSize && <div className="table-foot"><Pager page={page} setPage={setPage} total={data.total} pageSize={data.pageSize} /></div>}
        </section>
      ) : <EmptyState icon="users" title="No people found" action={<a className="btn" href="#/people">Clear filters</a>}>Try another name, or clear the department and manager filters.</EmptyState>}
    </div>
  );
}

const DirectorySkeleton = () => (
  <div className="emp-surface kb-skeleton" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className="sk-row" />)}</div>
);

/* ── Profile ──────────────────────────────────────────────────────────── */

export function ProfilePage({ id, user, act, busy, refresh, route }: { id: string; user: CurrentUser; act: Act; busy: boolean; refresh: number; route: string }) {
  const tab = new URLSearchParams(route.split('?')[1] ?? '').get('tab') ?? 'overview';
  const { data: p, error } = useRecord<ProfileFull>(`/people/${id}`, refresh);
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorState error={error} back={{ href: '#/people', label: 'Directory' }} />;
  if (!p) return <ProfileSkeleton />;
  const self = p.id === user.id;
  const staff = user.role !== 'EMPLOYEE';
  const maySeeWork = staff || self;
  const tabs = [
    { key: 'overview', label: 'Overview', href: `#/people/${id}` },
    ...(maySeeWork ? [{ key: 'requests', label: self ? 'My requests' : 'Requests', href: `#/people/${id}?tab=requests`, count: p.openTickets.length }] : []),
    ...(maySeeWork ? [{ key: 'assets', label: 'Assets', href: `#/people/${id}?tab=assets`, count: p.assets.length }] : []),
    ...(p.reports?.length ? [{ key: 'team', label: 'Team', href: `#/people/${id}?tab=team`, count: p.reports.length }] : []),
  ];

  return (
    <div className="emp profile">
      <a className="back-link" href="#/people"><Icon name="arrowLeft" size={14} />Directory</a>
      <header className="profile-head">
        <Avatar name={p.name} size={72} />
        <div className="ph-body">
          <p className="eyebrow">{p.department ? p.department.name.toUpperCase() : 'PERSON'}</p>
          <h1>{p.name}</h1>
          <p className="muted">
            {p.title ?? labels[p.role]}
            {p.department && <> · <a href={`#/departments/${p.department.id}`}>{p.department.name}</a></>}
            {p.manager && <> · Manager <a href={`#/people/${p.manager.id}`}>{p.manager.name}</a></>}
          </p>
        </div>
        <div className="page-actions">
          <a className="btn" href={`mailto:${p.email}`}><Icon name="mail" size={15} />Email</a>
          {(self || user.role === 'ADMIN') && <button onClick={() => setEditing(!editing)}><Icon name="edit" size={15} />{editing ? 'Cancel' : 'Edit details'}</button>}
        </div>
      </header>

      {tabs.length > 1 && <Tabs items={tabs} current={tab} ariaLabel="Profile sections" />}

      {tab === 'overview' && (
        <div className="emp-grid">
          <div className="emp-main">
            <section className="emp-surface">
              <div className="section-title"><h2>Role and organization</h2></div>
              <dl className="asset-facts">
                <div><dt>Role</dt><dd>{p.title ?? labels[p.role]}</dd></div>
                <div><dt>Department</dt><dd>{p.department ? <a href={`#/departments/${p.department.id}`}>{p.department.name}</a> : <span className="muted">Not set</span>}</dd></div>
                <div><dt>Manager</dt><dd>{p.manager ? <a href={`#/people/${p.manager.id}`}>{p.manager.name}</a> : <span className="muted">None</span>}</dd></div>
                <div><dt>Cost centre</dt><dd>{p.department?.costCentre ? <span className="mono-id">{p.department.costCentre}</span> : <span className="muted">Not recorded</span>}</dd></div>
                <div><dt>Email</dt><dd><a href={`mailto:${p.email}`}>{p.email}</a></dd></div>
                <div><dt>Phone</dt><dd>{p.phone ?? <span className="muted">Not recorded</span>}</dd></div>
                <div><dt>Location</dt><dd>{p.location ?? <span className="muted">Not recorded</span>}</dd></div>
                <div><dt>Access level</dt><dd>{labels[p.role]}</dd></div>
              </dl>
            </section>
            {editing && (self || user.role === 'ADMIN') && <EditProfile p={p} user={user} act={act} busy={busy} />}
            {maySeeWork && (
              <section className="emp-surface">
                <div className="section-title"><h2>Open requests</h2>{p.openTickets.length > 0 && <a href={`#/people/${id}?tab=requests`}>All requests →</a>}</div>
                {p.openTickets.length ? <TicketList rows={p.openTickets.slice(0, 5)} staff={staff} /> : <p className="calm">{self ? 'You have nothing open with IT right now.' : 'Nothing open with IT right now.'}</p>}
              </section>
            )}
          </div>
          <aside className="emp-side">
            {maySeeWork && (
              <section className="emp-surface">
                <div className="section-title"><h2>Assigned hardware</h2>{p.assets.length > 0 && <a href={`#/people/${id}?tab=assets`}>All →</a>}</div>
                {p.assets.length ? (
                  <ul className="asset-mini">
                    {p.assets.slice(0, 4).map((a) => (
                      <li key={a.id}><a href={`#/assets/${a.id}`}><span className="mono-id">{a.tag}</span><span className="am-body"><strong>{a.model}</strong><small>{labels[a.type] ?? a.type}</small></span><HealthMark a={a} /></a></li>
                    ))}
                  </ul>
                ) : <p className="calm">No hardware is recorded against this person.</p>}
              </section>
            )}
            {(p.manager || p.reports?.length > 0) && (
              <section className="emp-surface">
                <div className="section-title"><h2>Reporting line</h2></div>
                {p.manager && <div className="report-line"><small className="eyebrow">MANAGER</small><a className="person" href={`#/people/${p.manager.id}`}><Avatar name={p.manager.name} size={28} />{p.manager.name}</a></div>}
                {p.reports?.length > 0 && (
                  <div className="report-line">
                    <small className="eyebrow">DIRECT REPORTS · {p.reports.length}</small>
                    <ul className="report-list">{p.reports.slice(0, 6).map((r) => <li key={r.id}><a className="person" href={`#/people/${r.id}`}><Avatar name={r.name} size={28} />{r.name}</a></li>)}</ul>
                    {p.reports.length > 6 && <a className="text-btn" href={`#/people?managerId=${p.id}`}>All {p.reports.length} reports →</a>}
                  </div>
                )}
              </section>
            )}
            {p.department && (
              <section className="emp-surface">
                <div className="section-title"><h2>Department</h2></div>
                <p className="t-sm"><a href={`#/departments/${p.department.id}`}>{p.department.name}</a> · <span className="mono-id">{p.department.code}</span></p>
                <a className="text-btn" href={`#/people?departmentId=${p.department.id}`}>Everyone in {p.department.name} →</a>
              </section>
            )}
          </aside>
        </div>
      )}

      {tab === 'requests' && maySeeWork && (
        <div className="emp-grid">
          <div className="emp-main">
            <section className="emp-surface">
              <div className="section-title"><h2>Open</h2><span className="muted t-caption">{p.openTickets.length} raised by {self ? 'you' : p.name.split(' ')[0]}</span></div>
              {p.openTickets.length ? <TicketList rows={p.openTickets} staff={staff} /> : <p className="calm">Nothing open.</p>}
            </section>
            {p.recentlyClosed && p.recentlyClosed.length > 0 && (
              <section className="emp-surface">
                <div className="section-title"><h2>Recently completed</h2></div>
                <TicketList rows={p.recentlyClosed.map((t) => ({ ...t, priority: '', createdAt: t.resolvedAt ?? '' }))} staff={staff} />
              </section>
            )}
            {staff && p.assigned && p.assigned.length > 0 && (
              <section className="emp-surface">
                <div className="section-title"><h2>Assigned to {p.name.split(' ')[0]}</h2><span className="muted t-caption">Support queue</span></div>
                <TicketList rows={p.assigned} staff={staff} />
              </section>
            )}
          </div>
          <aside className="emp-side">
            <section className="emp-surface">
              <div className="section-title"><h2>What is shown here</h2></div>
              <p className="muted t-sm">{self ? 'Everything you have raised with IT.' : 'Requests this person raised, and the work assigned to them. Employees can only see this on their own profile; the API enforces it, not this page.'}</p>
            </section>
          </aside>
        </div>
      )}

      {tab === 'assets' && maySeeWork && (
        <section className="emp-surface">
          <div className="section-title"><h2>Assigned hardware</h2><span className="muted t-caption">{p.assets.length} device{p.assets.length === 1 ? '' : 's'}</span></div>
          {p.assets.length ? (
            <ul className="asset-mini wide">
              {p.assets.map((a) => (
                <li key={a.id}><a href={`#/assets/${a.id}`}><span className="mono-id">{a.tag}</span><span className="am-body"><strong>{a.model}</strong><small>{labels[a.type] ?? a.type} · {labels[a.status] ?? a.status}</small></span><HealthMark a={a} /><small className="muted">{a.warrantyExpiry ? `Warranty ${fmtDay(a.warrantyExpiry)}` : 'Warranty not recorded'}</small></a></li>
              ))}
            </ul>
          ) : <EmptyState icon="laptop" title="No hardware recorded">Nothing is assigned to this person in the inventory.</EmptyState>}
        </section>
      )}

      {tab === 'team' && p.reports?.length > 0 && (
        <section className="emp-surface">
          <div className="section-title"><h2>Reports to {p.name}</h2><span className="muted t-caption">{p.reports.length} {p.reports.length === 1 ? 'person' : 'people'}</span></div>
          <ul className="directory">
            {p.reports.map((r) => (
              <li key={r.id}><a href={`#/people/${r.id}`}><Avatar name={r.name} size={36} /><span className="dir-who"><strong>{r.name}</strong><small>{labels[r.role]}</small></span><span className="grow" /><span className="dir-go">View profile<Icon name="arrow" size={13} /></span></a></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TicketList({ rows, staff }: { rows: { id: string; number: number; title: string; status: string; priority?: string; createdAt?: string; resolvedAt?: string | null }[]; staff: boolean }) {
  return (
    <ul className="work-list">
      {rows.map((t) => (
        <li key={t.id}>
          <a href={staff ? `#/tickets/${t.id}` : `#/requests/${t.id}`} onClick={rememberDeskReturn}>
            <span className="mono-id">{ticketKey(t)}</span>
            <span className="work-main"><strong>{t.title}</strong></span>
            <StatusMark value={t.status} />
            <small className="muted work-when">{t.createdAt ? fmtAgo(t.createdAt) : ''}</small>
          </a>
        </li>
      ))}
    </ul>
  );
}

const ProfileSkeleton = () => (
  <div className="emp kb-skeleton" aria-hidden="true"><div className="sk-title" /><div className="sk-line wide" /><div className="sk-grid">{Array.from({ length: 4 }, (_, i) => <div key={i} className="sk-tile" />)}</div></div>
);

function EditProfile({ p, user, act, busy }: { p: ProfileFull; user: CurrentUser; act: Act; busy: boolean }) {
  const admin = user.role === 'ADMIN';
  const { data: departments } = useRecord<Department[]>(admin ? '/departments' : '/categories');
  const { data: people } = useRecord<{ items: Profile[] }>(admin ? '/people?pageSize=100' : '/categories');
  return (
    <form className="emp-surface request-form" onSubmit={(e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
      void act(async () => {
        const body = { title: f.title || null, location: f.location || null, phone: f.phone || null, ...(admin ? { departmentId: f.departmentId || null, managerId: f.managerId || null } : {}) };
        await api(admin ? `/admin/users/${p.id}/profile` : '/auth/profile', 'PATCH', body);
      }, 'Profile updated.');
    }}>
      <div className="section-title"><h2>{p.id === user.id ? 'Edit my details' : `Edit ${p.name.split(' ')[0]}’s details`}</h2></div>
      <div className="two-grid">
        <div className="field"><label htmlFor="pr-title">Job title</label><input id="pr-title" name="title" defaultValue={p.title ?? ''} maxLength={80} /></div>
        <div className="field"><label htmlFor="pr-location">Location</label><input id="pr-location" name="location" defaultValue={p.location ?? ''} maxLength={80} placeholder="Office or city" /></div>
        <div className="field"><label htmlFor="pr-phone">Phone</label><input id="pr-phone" name="phone" defaultValue={p.phone ?? ''} maxLength={30} /></div>
        {admin && Array.isArray(departments) && (
          <>
            <div className="field"><label htmlFor="pr-dept">Department</label><select id="pr-dept" aria-label="Department" name="departmentId" defaultValue={p.department?.id ?? ''}><option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div className="field"><label htmlFor="pr-mgr">Manager</label><select id="pr-mgr" aria-label="Manager" name="managerId" defaultValue={p.manager?.id ?? ''}><option value="">None</option>{people?.items.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          </>
        )}
      </div>
      {admin && <p className="muted fine">Department and manager decide where approvals go. Changing them changes who signs off this person's future requests.</p>}
      <div className="form-actions"><span className="grow" /><button className="primary" disabled={busy}>Save</button></div>
    </form>
  );
}

/** Administration of departments, with cost centres and managers. */
export function DepartmentsAdmin({ act, busy, refresh }: { act: Act; busy: boolean; refresh: number }) {
  const { data: departments, error } = useRecord<Department[]>('/departments', refresh);
  const { data: people } = useRecord<{ items: Profile[] }>('/people?pageSize=100', refresh);
  const [editing, setEditing] = useState<Department | null>(null);
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const form = e.currentTarget;
    void act(async () => {
      const body = { name: f.name, code: f.code, costCentre: f.costCentre || null, managerId: f.managerId || null, parentId: f.parentId || null };
      if (editing) await api(`/admin/departments/${editing.id}`, 'PUT', body); else await api('/admin/departments', 'POST', body);
      form.reset(); setEditing(null);
    }, editing ? 'Department updated.' : 'Department created.');
  };
  return (
    <div className="detail-grid">
      <section className="panel">
        <div className="panel-head"><h2>Departments</h2></div>
        {!departments ? <div className="panel-body">{error && <div className="alert error" role="alert">{error}</div>}</div> : (
          <div className="table-scroll"><table><thead><tr><th>Name</th><th>Code</th><th>Cost centre</th><th>Manager</th><th>People</th><th></th></tr></thead>
            <tbody>{departments.map((d) => <tr key={d.id}><td>{d.name}</td><td><code>{d.code}</code></td><td>{d.costCentre ?? '—'}</td><td>{d.manager?.name ?? '—'}</td><td>{d.memberCount}</td><td className="flex"><button disabled={busy} onClick={() => setEditing(d)}>Edit</button><button className="danger" disabled={busy || (d.memberCount ?? 0) > 0} onClick={() => void act(async () => { await api(`/admin/departments/${d.id}`, 'DELETE'); }, 'Department deleted.')}>Delete</button></td></tr>)}</tbody></table></div>
        )}
      </section>
      <form className="panel properties" key={editing?.id ?? 'new'} onSubmit={submit}>
        <h2>{editing ? `Edit ${editing.name}` : 'Add a department'}</h2>
        <label>Name<input name="name" required minLength={2} maxLength={80} defaultValue={editing?.name ?? ''} /></label>
        <label>Code<input name="code" required minLength={2} maxLength={12} pattern="[A-Za-z0-9-]+" defaultValue={editing?.code ?? ''} placeholder="ENG" /></label>
        <label>Cost centre<input name="costCentre" maxLength={40} defaultValue={editing?.costCentre ?? ''} placeholder="CC-1040" /></label>
        <label>Manager<select aria-label="Department manager" name="managerId" defaultValue={editing?.managerId ?? ''}><option value="">None</option>{people?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Parent department<select aria-label="Parent department" name="parentId" defaultValue={editing?.parentId ?? ''}><option value="">None</option>{departments?.filter((d) => d.id !== editing?.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <div className="flex"><button className="primary" disabled={busy}>{editing ? 'Save' : 'Create'}</button>{editing && <button type="button" onClick={() => setEditing(null)}>Cancel</button>}</div>
      </form>
    </div>
  );
}

export { when };
