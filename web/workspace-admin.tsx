import { AdminLayout } from './admin-nav';
import { useState } from 'react';
import { Icon } from './ui/icons';
import { api } from './api';
import { Pending, useRecord, when, type Act } from './operations';
import { labels, priorities, ticketTypes, type Announcement, type CatalogItem, type Department, type FormField, type TicketTemplate } from '../shared/model';
import { DepartmentsAdmin } from './people';
import { ICONS, icon } from './catalog';

type Category = { id: string; name: string };

/** Workspace settings: everything an administrator shapes the workspace with, in tabs. */
export function WorkspaceAdminPage({ section: key, act, busy, refresh }: { section: 'catalog' | 'templates' | 'departments' | 'announcements'; act: Act; busy: boolean; refresh: number }) {
  return (
    <AdminLayout current={key}>
      {key === 'catalog' && <CatalogAdmin act={act} busy={busy} refresh={refresh} />}
      {key === 'templates' && <TemplatesAdmin act={act} busy={busy} refresh={refresh} />}
      {key === 'departments' && <DepartmentsAdmin act={act} busy={busy} refresh={refresh} />}
      {key === 'announcements' && <AnnouncementsAdmin act={act} busy={busy} refresh={refresh} />}
    </AdminLayout>
  );
}

const emptyField = (): FormField => ({ key: '', label: '', kind: 'text', required: false });

function CatalogAdmin({ act, busy, refresh }: { act: Act; busy: boolean; refresh: number }) {
  const { data: items, error } = useRecord<(CatalogItem & { _count?: { tickets: number } })[]>('/admin/catalog', refresh);
  const { data: categories } = useRecord<Category[]>('/categories');
  const { data: departments } = useRecord<Department[]>('/departments');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const start = (item: CatalogItem | null) => { setEditing(item); setFields(item ? item.fields : []); };
  const setField = (i: number, patch: Partial<FormField>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const form = e.currentTarget;
    void act(async () => {
      const body = { name: f.name, description: f.description, icon: f.icon, type: f.type, categoryId: f.categoryId, priority: f.priority, requiresApproval: f.requiresApproval === 'on', approverKind: f.approverKind, approverDepartmentId: f.approverDepartmentId || null, active: f.active === 'on', sortOrder: Number(f.sortOrder || 0), fields: fields.map((x) => ({ ...x, key: x.key.trim().toLowerCase(), options: x.kind === 'select' ? (x.options ?? []).filter(Boolean) : undefined, placeholder: x.placeholder || undefined, help: x.help || undefined })) };
      if (editing) await api(`/admin/catalog/${editing.id}`, 'PUT', body); else await api('/admin/catalog', 'POST', body);
      form.reset(); start(null);
    }, editing ? 'Catalog item updated.' : 'Catalog item created.');
  };
  return (
    <div className="detail-grid">
      <section className="panel">
        <div className="panel-head"><h2>Catalog items</h2><span className="muted">{items?.length ?? 0}</span></div>
        {!items ? <Pending error={error} /> : (
          <div className="table-scroll"><table className="si-table catalog-table"><thead><tr><th scope="col">Service</th><th scope="col">Category</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col" className="num">Form fields</th><th scope="col">Approval</th><th scope="col" className="num">Requests</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{items.map((c) => <tr key={c.id} className={c.active ? '' : 'is-disabled'}><td><span className="asset-cell"><strong>{c.name}</strong><small>{c.description}</small></span></td><td className="t-sm">{c.category?.name ?? categories?.find((x) => x.id === c.categoryId)?.name ?? '—'}</td><td className="t-sm">{labels[c.type]}</td><td><span className={`req-status ${c.active ? 'ok' : 'neutral'}`}><i />{c.active ? 'Published' : 'Disabled'}</span></td><td className="num">{c.fields.length}</td><td className="t-sm">{c.requiresApproval ? (c.approverKind === 'MANAGER' ? 'Requester’s manager' : c.approverKind === 'ADMIN' ? 'Any administrator' : 'Department manager') : <span className="muted">None</span>}</td><td className="num">{c._count?.tickets ?? 0}</td><td className="num"><span className="flex"><a className="btn-sm btn" href={`#/tickets/new?service=${c.id}`} title="Preview as an employee"><Icon name="eye" size={13} />Preview</a><button className="btn-sm" disabled={busy} onClick={() => start(c)}>Edit</button></span></td></tr>)}</tbody></table></div>
        )}
      </section>
      <form className="panel properties catalog-form" key={editing?.id ?? 'new'} onSubmit={submit}>
        <h2>{editing ? `Edit ${editing.name}` : 'Add a catalog item'}</h2>
        <label>Name<input name="name" required minLength={2} maxLength={80} defaultValue={editing?.name ?? ''} /></label>
        <label>Description<textarea name="description" required minLength={5} maxLength={500} rows={2} defaultValue={editing?.description ?? ''} /></label>
        <div className="two-grid">
          <label>Icon<select aria-label="Icon" name="icon" defaultValue={editing?.icon ?? 'box'}>{Object.keys(ICONS).map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
          <label>Type<select aria-label="Type" name="type" defaultValue={editing?.type ?? 'REQUEST'}>{ticketTypes.map((t) => <option key={t} value={t}>{labels[t]}</option>)}</select></label>
          <label>Category<select aria-label="Category" name="categoryId" required defaultValue={editing?.categoryId ?? ''}><option value="">Choose…</option>{categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Priority<select aria-label="Priority" name="priority" defaultValue={editing?.priority ?? 'MEDIUM'}>{priorities.map((p) => <option key={p} value={p}>{labels[p]}</option>)}</select></label>
          <label>Sort order<input name="sortOrder" type="number" min={0} max={1000} defaultValue={editing?.sortOrder ?? 0} /></label>
          <label className="check"><input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> Active</label>
        </div>
        <fieldset className="approval-box">
          <legend>Approval</legend>
          <label className="check"><input type="checkbox" name="requiresApproval" defaultChecked={editing?.requiresApproval ?? false} /> Needs approval before the support team acts</label>
          <div className="two-grid">
            <label>Approver<select aria-label="Approver" name="approverKind" defaultValue={editing?.approverKind ?? 'MANAGER'}><option value="MANAGER">Requester's manager</option><option value="ADMIN">An administrator</option><option value="DEPARTMENT_MANAGER">A department's manager</option></select></label>
            <label>Department<select aria-label="Approver department" name="approverDepartmentId" defaultValue={editing?.approverDepartmentId ?? ''}><option value="">—</option>{departments?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          </div>
          <p className="muted fine">If no manager can be found, the request goes to an administrator rather than getting stuck.</p>
        </fieldset>
        <fieldset>
          <legend>Form fields ({fields.length})</legend>
          {fields.map((f, i) => (
            <div key={i} className="field-row">
              <input aria-label="Field key" placeholder="key" value={f.key} pattern="[a-z][a-z0-9_]*" onChange={(e) => setField(i, { key: e.target.value })} />
              <input aria-label="Field label" placeholder="Label" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
              <select aria-label="Field kind" value={f.kind} onChange={(e) => setField(i, { kind: e.target.value as FormField['kind'] })}>{['text', 'textarea', 'select', 'number', 'date', 'checkbox'].map((k) => <option key={k}>{k}</option>)}</select>
              {f.kind === 'select' && <input aria-label="Options" placeholder="option a, option b" value={(f.options ?? []).join(', ')} onChange={(e) => setField(i, { options: e.target.value.split(',').map((s) => s.trim()) })} />}
              <label className="check"><input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> req.</label>
              <button type="button" aria-label="Remove field" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button type="button" disabled={fields.length >= 20} onClick={() => setFields((fs) => [...fs, emptyField()])}>Add field</button>
        </fieldset>
        <div className="flex"><button className="primary" disabled={busy}>{editing ? 'Save' : 'Create'}</button>{editing && <button type="button" onClick={() => start(null)}>Cancel</button>}</div>
      </form>
    </div>
  );
}

function TemplatesAdmin({ act, busy, refresh }: { act: Act; busy: boolean; refresh: number }) {
  const { data: items, error } = useRecord<TicketTemplate[]>('/admin/templates', refresh);
  const { data: categories } = useRecord<Category[]>('/categories');
  const [editing, setEditing] = useState<TicketTemplate | null>(null);
  return (
    <div className="detail-grid">
      <section className="panel"><div className="panel-head"><h2>Ticket templates</h2></div>
        {!items ? <Pending error={error} /> : <div className="table-scroll"><table><thead><tr><th>Template</th><th>Type</th><th>Priority</th><th>Active</th><th></th></tr></thead><tbody>{items.map((t) => <tr key={t.id}><td><strong>{t.name}</strong><small>{t.title}</small></td><td>{labels[t.type]}</td><td>{labels[t.priority]}</td><td>{t.active ? 'Yes' : 'No'}</td><td><button disabled={busy} onClick={() => setEditing(t)}>Edit</button></td></tr>)}</tbody></table></div>}
      </section>
      <form className="panel properties" key={editing?.id ?? 'new'} onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; const form = e.currentTarget; void act(async () => { const body = { name: f.name, title: f.title, description: f.description, categoryId: f.categoryId, priority: f.priority, type: f.type, active: f.active === 'on' }; if (editing) await api(`/admin/templates/${editing.id}`, 'PUT', body); else await api('/admin/templates', 'POST', body); form.reset(); setEditing(null); }, editing ? 'Template updated.' : 'Template created.'); }}>
        <h2>{editing ? `Edit ${editing.name}` : 'Add a template'}</h2>
        <label>Name<input name="name" required minLength={2} maxLength={80} defaultValue={editing?.name ?? ''} /></label>
        <label>Ticket title<input name="title" required minLength={5} maxLength={160} defaultValue={editing?.title ?? ''} /></label>
        <label>Description<textarea name="description" required minLength={10} maxLength={10000} rows={5} defaultValue={editing?.description ?? ''} placeholder="Prompts the reporter will fill in, e.g. 'Which application? Since when? Error message?'" /></label>
        <div className="two-grid">
          <label>Category<select aria-label="Category" name="categoryId" required defaultValue={editing?.categoryId ?? ''}><option value="">Choose…</option>{categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Type<select aria-label="Type" name="type" defaultValue={editing?.type ?? 'INCIDENT'}>{ticketTypes.map((t) => <option key={t} value={t}>{labels[t]}</option>)}</select></label>
          <label>Priority<select aria-label="Priority" name="priority" defaultValue={editing?.priority ?? 'MEDIUM'}>{priorities.map((p) => <option key={p} value={p}>{labels[p]}</option>)}</select></label>
          <label className="check"><input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> Active</label>
        </div>
        <div className="flex"><button className="primary" disabled={busy}>{editing ? 'Save' : 'Create'}</button>{editing && <button type="button" onClick={() => setEditing(null)}>Cancel</button>}</div>
      </form>
    </div>
  );
}

function AnnouncementsAdmin({ act, busy, refresh }: { act: Act; busy: boolean; refresh: number }) {
  const { data: items, error } = useRecord<Announcement[]>('/admin/announcements', refresh);
  const [editing, setEditing] = useState<Announcement | null>(null);
  return (
    <div className="detail-grid">
      <section className="panel"><div className="panel-head"><h2>Announcements</h2></div>
        {!items ? <Pending error={error} /> : items.length ? <ul className="plain-list">{items.map((a) => <li key={a.id} className="flex between"><span>{a.pinned && <span className="badge waiting_for_user">Pinned</span>} <strong>{a.title}</strong> <small className="muted">{a.audience === 'STAFF' ? 'support team' : 'everyone'} · {when(a.publishedAt)}{a.expiresAt ? ` · until ${when(a.expiresAt)}` : ''}</small></span><span className="flex"><button disabled={busy} onClick={() => setEditing(a)}>Edit</button><button className="danger" disabled={busy} onClick={() => void act(async () => { await api(`/admin/announcements/${a.id}`, 'DELETE'); }, 'Announcement removed.')}>Remove</button></span></li>)}</ul> : <p className="muted fine">Nothing published.</p>}
      </section>
      <form className="panel properties" key={editing?.id ?? 'new'} onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; const form = e.currentTarget; void act(async () => { const body = { title: f.title, body: f.body, audience: f.audience, pinned: f.pinned === 'on', expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null }; if (editing) await api(`/admin/announcements/${editing.id}`, 'PUT', body); else await api('/admin/announcements', 'POST', body); form.reset(); setEditing(null); }, editing ? 'Announcement updated.' : 'Announcement published.'); }}>
        <h2>{editing ? 'Edit announcement' : 'Publish an announcement'}</h2>
        <label>Title<input name="title" required minLength={3} maxLength={120} defaultValue={editing?.title ?? ''} /></label>
        <label>Message<textarea name="body" required minLength={3} maxLength={4000} rows={5} defaultValue={editing?.body ?? ''} /></label>
        <div className="two-grid">
          <label>Audience<select aria-label="Audience" name="audience" defaultValue={editing?.audience ?? 'ALL'}><option value="ALL">Everyone</option><option value="STAFF">Support team only</option></select></label>
          <label>Expires<input type="datetime-local" name="expiresAt" defaultValue={editing?.expiresAt ? new Date(editing.expiresAt).toISOString().slice(0, 16) : ''} /></label>
          <label className="check"><input type="checkbox" name="pinned" defaultChecked={editing?.pinned ?? false} /> Pin to the top</label>
        </div>
        <div className="flex"><button className="primary" disabled={busy}>{editing ? 'Save' : 'Publish'}</button>{editing && <button type="button" onClick={() => setEditing(null)}>Cancel</button>}</div>
      </form>
    </div>
  );
}
