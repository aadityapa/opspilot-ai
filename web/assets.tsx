import { useState } from 'react';
import { api } from './api';
import { useRecord, when, type Act } from './operations';
import { assetStatuses, assetTypes } from '../shared/model';
import { labels, type Asset, type AssetSummary, type CurrentUser, type Department, type Person, type Profile } from '../shared/model';
import { Icon } from './ui/icons';
import { Avatar, EmptyState, ErrorState, Pager, fmtAgo, fmtCalendarDay, fmtDay, ticketKey } from './ui';
import { StatusMark } from './ui/marks';
import { rememberDeskReturn } from './nav-state';

const label = (v: string) => labels[v] ?? v;

/* ── Health ───────────────────────────────────────────────────────────────
 * There is no hardware telemetry in this system and none is invented. "Health" is a reading of
 * three recorded facts — the status somebody set, the warranty date, and whether the device has an
 * owner — and the detail page says which of them produced the state.
 */
export type Health = { tone: 'ok' | 'warn' | 'crit' | 'neutral'; word: string; why: string };
export function assetHealth(a: { status: string; warrantyExpiry?: string | null; ownerId?: string | null }, now = Date.now()): Health {
  if (a.status === 'RETIRED') return { tone: 'neutral', word: 'Retired', why: 'Withdrawn from service' };
  if (a.status === 'REPAIR') return { tone: 'crit', word: 'Repair', why: 'Marked as being repaired' };
  const expiry = a.warrantyExpiry ? new Date(a.warrantyExpiry).getTime() : null;
  if (expiry !== null && expiry < now) return { tone: 'warn', word: 'Attention', why: 'Warranty has expired' };
  if (expiry !== null && expiry <= now + 90 * 86_400_000) return { tone: 'warn', word: 'Attention', why: 'Warranty expires within 90 days' };
  if (a.status === 'AVAILABLE') return { tone: 'ok', word: 'Available', why: 'In stock, not assigned' };
  return { tone: 'ok', word: 'Healthy', why: 'In use, inside warranty' };
}
export const HealthMark = ({ a }: { a: { status: string; warrantyExpiry?: string | null } }) => {
  const h = assetHealth(a);
  return <span className={`health-mark ${h.tone}`} title={h.why}><i aria-hidden="true" />{h.word}</span>;
};

/* ── Inventory ────────────────────────────────────────────────────────── */

export function AssetsPage({ route, user, act, busy, refresh }: { route: string; user: CurrentUser; act: Act; busy: boolean; refresh: number }) {
  const [path, query] = route.split('?');
  const id = path.split('/')[2];
  if (id === 'new') return user.role === 'ADMIN' ? <AssetForm act={act} busy={busy} /> : <ErrorState error="Administrator role required" back={{ href: '#/assets', label: 'Assets' }} />;
  if (id) return <AssetDetail id={id} user={user} act={act} busy={busy} refresh={refresh} />;
  return <Inventory user={user} refresh={refresh} query={query ?? ''} />;
}

const setParam = (query: string, key: string, value: string) => {
  const p = new URLSearchParams(query);
  if (value) p.set(key, value); else p.delete(key);
  if (key !== 'page') p.delete('page');
  location.hash = `/assets${p.toString() ? `?${p}` : ''}`;
};

function Inventory({ user, refresh, query }: { user: CurrentUser; refresh: number; query: string }) {
  const p = new URLSearchParams(query);
  const q = p.get('q') ?? '', type = p.get('type') ?? '', status = p.get('status') ?? '', departmentId = p.get('departmentId') ?? '', ownerId = p.get('ownerId') ?? '', warranty = p.get('warranty') ?? '', sort = p.get('sort') ?? 'tag';
  const page = Number(p.get('page') ?? '1');
  const [draft, setDraft] = useState(q);
  const staff = user.role !== 'EMPLOYEE';
  const filters = new URLSearchParams({ ...(q ? { q } : {}), ...(type ? { type } : {}), ...(status ? { status } : {}), ...(departmentId ? { departmentId } : {}), ...(ownerId ? { ownerId } : {}), ...(warranty ? { warranty } : {}), sort });
  const { data, error } = useRecord<{ items: Asset[]; total: number; pageSize: number }>(`/assets?${filters}&page=${page}&pageSize=20`, refresh);
  const { data: summary } = useRecord<AssetSummary>(`/assets/summary?${filters}`, refresh);
  const { data: departments } = useRecord<Department[]>(staff ? '/departments' : '/categories', refresh);

  const chips = [
    q && ['Search', q, 'q'], type && ['Type', label(type), 'type'], status && ['Status', label(status), 'status'],
    departmentId && ['Department', (Array.isArray(departments) ? departments : []).find((d) => d.id === departmentId)?.name ?? 'Selected', 'departmentId'],
    ownerId && ['Owner', ownerId === 'none' ? 'Unassigned' : 'Selected person', 'ownerId'],
    warranty && ['Warranty', warranty === 'expiring' ? 'Expiring in 90 days' : 'Expired', 'warranty'],
  ].filter(Boolean) as [string, string, string][];

  return (
    <div className="emp assets">
      <header className="emp-head">
        <div>
          <p className="eyebrow">{staff ? 'ASSET MANAGEMENT' : 'MY HARDWARE'}</p>
          <h1>{staff ? 'Technology inventory' : 'My assets'}</h1>
          <p className="muted">
            {summary
              ? staff
                ? `${summary.total} asset${summary.total === 1 ? '' : 's'}${summary.attention ? ` · ${summary.attention} need${summary.attention === 1 ? 's' : ''} attention` : ' · nothing needs attention'}`
                : `${summary.total} device${summary.total === 1 ? '' : 's'} assigned to you.`
              : ' '}
          </p>
        </div>
        {user.role === 'ADMIN' && <div className="page-actions"><a className="btn" href="#/assets/new"><Icon name="plus" size={15} />Add asset</a></div>}
      </header>

      {staff && (
        <section className="mywork-strip asset-strip" aria-label="Inventory">
          <p className="eyebrow strip-eyebrow">Inventory</p>
          <a className="strip-cell" href="#/assets"><strong>{summary ? summary.total : '…'}</strong><span>Total</span></a>
          <a className="strip-cell" href="#/assets?status=IN_USE"><strong>{summary ? summary.assigned : '…'}</strong><span>Assigned</span></a>
          <a className="strip-cell" href="#/assets?ownerId=none"><strong>{summary ? summary.unassigned : '…'}</strong><span>Unassigned</span></a>
          <a className={`strip-cell ${summary?.attention ? 'warn' : ''}`} href="#/assets?warranty=expiring"><strong>{summary ? summary.attention : '…'}</strong><span>Attention</span></a>
          <a className="strip-cell" href="#/assets?status=RETIRED"><strong>{summary ? summary.retired : '…'}</strong><span>Retired</span></a>
        </section>
      )}

      <section className="querybar" aria-label="Filter assets">
        <div className="search">
          <Icon name="search" size={16} />
          <input id="asset-search" aria-label="Search assets" placeholder="Search asset, serial, model or owner…" value={draft}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setParam(query, 'q', draft.trim()); }} />
        </div>
        <select aria-label="Type" value={type} onChange={(e) => setParam(query, 'type', e.target.value)}>
          <option value="">All types</option>
          {assetTypes.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setParam(query, 'status', e.target.value)}>
          <option value="">All statuses</option>
          {assetStatuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        {staff && (
          <select aria-label="Department" value={departmentId} onChange={(e) => setParam(query, 'departmentId', e.target.value)}>
            <option value="">All departments</option>
            {(Array.isArray(departments) ? departments : []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {staff && (
          <select aria-label="Assignment" value={ownerId === 'none' ? 'none' : ''} onChange={(e) => setParam(query, 'ownerId', e.target.value)}>
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
          </select>
        )}
        <select aria-label="Warranty" value={warranty} onChange={(e) => setParam(query, 'warranty', e.target.value)}>
          <option value="">Any warranty</option>
          <option value="expiring">Expiring in 90 days</option>
          <option value="expired">Expired</option>
        </select>
        <span className="grow" />
        <select aria-label="Sort assets" value={sort} onChange={(e) => setParam(query, 'sort', e.target.value)}>
          <option value="tag">Asset tag</option>
          <option value="updated">Recently updated</option>
          <option value="warranty">Warranty date</option>
        </select>
      </section>

      {chips.length > 0 && (
        <div className="chips" role="group" aria-label="Active filters">
          {chips.map(([k, v, key]) => <button key={key} className="chip" onClick={() => setParam(query, key, '')}>{k}: <strong>{v}</strong><Icon name="x" size={12} /></button>)}
          <a className="text-btn btn-sm" href="#/assets">Clear all</a>
        </div>
      )}

      {error ? <ErrorState error={error} /> : !data ? <TableSkeleton /> : data.items.length ? (
        <section className="emp-surface table-surface">
          <div className="table-scroll">
            <table className="assets-table">
              <thead><tr><th scope="col">Asset</th><th scope="col">Type</th><th scope="col">Owner</th>{staff && <th scope="col">Department</th>}<th scope="col">Status</th><th scope="col">Health</th><th scope="col">Warranty</th><th scope="col">Updated</th></tr></thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <a className="asset-cell" href={`#/assets/${a.id}`}>
                        <span className="mono-id">{a.tag}</span>
                        <strong>{a.model}</strong>
                        <small>{label(a.type)} · {a.manufacturer}</small>
                      </a>
                    </td>
                    <td className="t-sm">{label(a.type)}</td>
                    <td>{a.owner ? <a className="person" href={`#/people/${a.owner.id}`}><Avatar name={a.owner.name} size={22} />{a.owner.name}</a> : <span className="muted t-sm">Unassigned</span>}</td>
                    {staff && <td className="t-sm">{a.owner?.department ? <a href={`#/departments/${a.owner.department.id}`}>{a.owner.department.name}</a> : <span className="muted">—</span>}</td>}
                    <td className="t-sm">{label(a.status)}</td>
                    <td><HealthMark a={a} /></td>
                    <td className="t-sm">{a.warrantyExpiry ? fmtCalendarDay(a.warrantyExpiry) : <span className="muted">Not recorded</span>}</td>
                    <td className="t-sm muted">{fmtAgo(a.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > data.pageSize && <div className="table-foot"><Pager page={page} setPage={(n) => setParam(query, 'page', String(n))} total={data.total} pageSize={data.pageSize} /></div>}
        </section>
      ) : (
        <EmptyState icon="laptop" title="No assets match these filters" action={chips.length ? <a className="btn" href="#/assets">Clear filters</a> : undefined}>
          {staff ? 'Try a different type, status or department.' : 'Nothing is assigned to you right now. Hardware appears here once IT records it against your name.'}
        </EmptyState>
      )}
    </div>
  );
}

const TableSkeleton = () => (
  <div className="emp-surface table-surface kb-skeleton" aria-hidden="true">
    <div className="sk-row head" />{Array.from({ length: 8 }, (_, i) => <div key={i} className="sk-row" />)}
  </div>
);

/* ── Asset workspace ──────────────────────────────────────────────────── */

type AssetFull = Asset & {
  owner: (Person & { title?: string | null; email?: string; location?: string | null; department?: { id: string; name: string; code: string } | null }) | null;
  tickets?: { id: string; number: number; title: string; status: string; type?: string; priority?: string; createdAt: string; resolvedAt?: string | null; requester?: Person }[];
};

function AssetDetail({ id, user, act, busy, refresh }: { id: string; user: CurrentUser; act: Act; busy: boolean; refresh: number }) {
  const { data: a, error } = useRecord<AssetFull>(`/assets/${id}`, refresh);
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorState error={error} back={{ href: '#/assets', label: 'Asset inventory' }} />;
  if (!a) return <DetailSkeleton />;
  const health = assetHealth(a);
  const history = a.tickets ?? [];
  const open = history.filter((t) => !['RESOLVED', 'CLOSED'].includes(t.status));

  // Lifecycle is read from recorded facts only. A stage with no date says so rather than guessing.
  const stages: { label: string; at: string | null; note?: string; done: boolean }[] = [
    { label: 'Purchased', at: a.purchaseDate ?? null, done: !!a.purchaseDate },
    { label: 'Assigned', at: null, note: a.owner ? `To ${a.owner.name}` : 'Not assigned', done: !!a.owner },
    { label: 'In service', at: null, note: a.status === 'IN_USE' ? 'Currently in use' : a.status === 'AVAILABLE' ? 'In stock' : '', done: a.status === 'IN_USE' },
    { label: 'Repair', at: null, note: a.status === 'REPAIR' ? 'Currently with repair' : 'No repair recorded', done: a.status === 'REPAIR' },
    { label: 'Retired', at: null, note: a.status === 'RETIRED' ? 'Withdrawn from service' : '', done: a.status === 'RETIRED' },
  ];

  return (
    <div className="emp asset-detail">
      <a className="back-link" href="#/assets"><Icon name="arrowLeft" size={14} />Asset inventory</a>
      <header className="req-head">
        <div>
          <p className="eyebrow"><span className="mono-id">{a.tag}</span> · {label(a.type)}</p>
          <h1>{a.model}</h1>
          <p className="muted">{a.manufacturer}{a.owner ? <> · assigned to <a href={`#/people/${a.owner.id}`}>{a.owner.name}</a></> : ' · not assigned'}</p>
        </div>
        <div className="page-actions">
          <HealthMark a={a} />
          <span className="asset-state">{label(a.status)}</span>
          {user.role === 'ADMIN' && <button onClick={() => setEditing(!editing)}><Icon name="edit" size={15} />{editing ? 'Stop editing' : 'Edit asset'}</button>}
        </div>
      </header>

      <div className="req-grid">
        <div className="req-main-col">
          <section className="emp-surface">
            <div className="section-title"><h2>Overview</h2><span className="muted t-caption">{health.why}</span></div>
            <dl className="asset-facts">
              <div><dt>Asset ID</dt><dd className="mono-id">{a.tag}</dd></div>
              <div><dt>Type</dt><dd>{label(a.type)}</dd></div>
              <div><dt>Model</dt><dd>{a.model}</dd></div>
              <div><dt>Manufacturer</dt><dd>{a.manufacturer}</dd></div>
              <div><dt>Serial number</dt><dd className="mono-id">{a.serialNumber}</dd></div>
              <div><dt>Status</dt><dd>{label(a.status)}</dd></div>
              <div><dt>Purchased</dt><dd>{a.purchaseDate ? fmtCalendarDay(a.purchaseDate) : <span className="muted">Not recorded</span>}</dd></div>
              <div><dt>Warranty</dt><dd>{a.warrantyExpiry ? `${fmtCalendarDay(a.warrantyExpiry)}${new Date(a.warrantyExpiry).getTime() < Date.now() ? ' · expired' : ''}` : <span className="muted">Not recorded</span>}</dd></div>
              <div><dt>Location</dt><dd>{a.owner?.location ? `${a.owner.location} · with the owner` : <span className="muted">Not recorded</span>}</dd></div>
            </dl>
          </section>

          <section className="emp-surface">
            <div className="section-title"><h2>Service history</h2><span className="muted t-caption">{history.length ? `${history.length} ticket${history.length === 1 ? '' : 's'}${open.length ? ` · ${open.length} open` : ''}` : ''}</span></div>
            {history.length ? (
              <ul className="svc-history">
                {history.map((t) => (
                  <li key={t.id}>
                    <a href={`#/tickets/${t.id}`} onClick={rememberDeskReturn}>
                      <span className="mono-id">{ticketKey(t)}</span>
                      <span className="sh-main"><strong>{t.title}</strong><small>{t.type ? label(t.type) : 'Incident'}{t.requester && user.role !== 'EMPLOYEE' ? ` · ${t.requester.name}` : ''}</small></span>
                      <StatusMark value={t.status} />
                      <small className="muted sh-when">{t.resolvedAt ? `Resolved ${fmtDay(t.resolvedAt)}` : fmtDay(t.createdAt)}</small>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="ticket" title="No tickets reference this asset">
                {user.role === 'EMPLOYEE' ? 'Tickets you raise about this device will be listed here.' : 'Nothing has been raised against this device. Tickets link to an asset from the ticket workspace.'}
              </EmptyState>
            )}
          </section>

          {editing && user.role === 'ADMIN' && <AssetForm key={`${a.id}-${a.version}`} asset={a} act={act} busy={busy} />}
        </div>

        <aside className="req-side">
          <section className="emp-surface">
            <div className="section-title"><h2>Assigned to</h2></div>
            {a.owner ? (
              <div className="owner-card">
                <Avatar name={a.owner.name} size={44} />
                <div>
                  <strong>{a.owner.name}</strong>
                  <small>{a.owner.title ?? labels[a.owner.role]}</small>
                  {a.owner.department && <small className="muted"><a href={`#/departments/${a.owner.department.id}`}>{a.owner.department.name}</a></small>}
                </div>
                <a className="btn btn-sm" href={`#/people/${a.owner.id}`}>View profile</a>
              </div>
            ) : <p className="calm">Not assigned to anyone. Unassigned hardware is either in stock or withdrawn.</p>}
          </section>

          <section className="emp-surface">
            <div className="section-title"><h2>Lifecycle</h2></div>
            <ol className="lifecycle">
              {stages.map((s) => (
                <li key={s.label} className={s.done ? 'done' : 'todo'}>
                  <span className="lc-dot" aria-hidden="true">{s.done ? <Icon name="check" size={11} /> : null}</span>
                  <span className="lc-body"><strong>{s.label}</strong><small>{s.at ? fmtCalendarDay(s.at) : s.note || <span className="muted">Not recorded</span>}</small></span>
                </li>
              ))}
            </ol>
            <p className="muted fine">Stages are read from the recorded purchase date, owner and status. This system stores no per-stage event history, so anything it does not know says so.</p>
          </section>

          {user.role === 'ADMIN' && (
            <section className="emp-surface">
              <div className="section-title"><h2>Record</h2></div>
              <dl className="ctx-list">
                <div><dt>Added</dt><dd>{when(a.createdAt)}</dd></div>
                <div><dt>Last change</dt><dd>{when(a.updatedAt)}</dd></div>
              </dl>
              <a className="text-btn" href={`#/admin/audit?q=${a.id}`}>Audit history for this asset →</a>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

const DetailSkeleton = () => (
  <div className="emp kb-skeleton" aria-hidden="true">
    <div className="sk-title" /><div className="sk-line wide" />
    <div className="sk-grid">{Array.from({ length: 4 }, (_, i) => <div key={i} className="sk-tile" />)}</div>
  </div>
);

/* ── Authoring (administrators) ───────────────────────────────────────── */

function AssetForm({ asset, act, busy }: { asset?: Asset; act: Act; busy: boolean }) {
  const { data: people, error } = useRecord<{ items: Profile[] }>('/people?pageSize=100');
  return (
    <form className="emp-surface request-form" onSubmit={(e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
      const data = { ...f, ownerId: f.ownerId || null, purchaseDate: f.purchaseDate || null, warrantyExpiry: f.warrantyExpiry || null };
      void act(async () => {
        const saved = await api<Asset>(asset ? `/assets/${asset.id}` : '/assets', asset ? 'PATCH' : 'POST', asset ? { version: asset.version, asset: data } : data);
        location.hash = `/assets/${saved.id}`;
      }, 'Asset saved.');
    }}>
      <div className="section-title"><h2>{asset ? 'Edit asset' : 'Add an asset'}</h2></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="two-grid">
        <div className="field"><label htmlFor="as-tag" className="required">Asset tag</label><input id="as-tag" name="tag" defaultValue={asset?.tag} required maxLength={40} /></div>
        <div className="field"><label htmlFor="as-type">Type</label><select id="as-type" aria-label="Type" name="type" defaultValue={asset?.type ?? 'LAPTOP'}>{assetTypes.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
        <div className="field"><label htmlFor="as-man" className="required">Manufacturer</label><input id="as-man" name="manufacturer" defaultValue={asset?.manufacturer} required maxLength={100} /></div>
        <div className="field"><label htmlFor="as-model" className="required">Model</label><input id="as-model" name="model" defaultValue={asset?.model} required maxLength={100} /></div>
        <div className="field"><label htmlFor="as-serial" className="required">Serial number</label><input id="as-serial" name="serialNumber" defaultValue={asset?.serialNumber} required maxLength={100} /></div>
        <div className="field"><label htmlFor="as-owner">Owner</label>
          <select id="as-owner" aria-label="Owner" name="ownerId" defaultValue={asset?.ownerId ?? ''}>
            <option value="">Shared / unassigned</option>
            {people?.items.filter((u) => u.role === 'EMPLOYEE').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="as-status">Status</label><select id="as-status" aria-label="Asset status" name="status" defaultValue={asset?.status ?? 'AVAILABLE'}>{assetStatuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div className="field"><label htmlFor="as-purchase">Purchase date</label><input id="as-purchase" type="date" name="purchaseDate" defaultValue={asset?.purchaseDate?.slice(0, 10)} /></div>
        <div className="field"><label htmlFor="as-warranty">Warranty expiry</label><input id="as-warranty" type="date" name="warrantyExpiry" defaultValue={asset?.warrantyExpiry?.slice(0, 10)} /></div>
      </div>
      <div className="form-actions"><a className="btn" href="#/assets">Cancel</a><span className="grow" /><button className="primary" disabled={busy || !people}>Save asset</button></div>
    </form>
  );
}
