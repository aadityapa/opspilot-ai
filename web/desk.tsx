import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api } from './api';
import { useRecord, type Act } from './operations';
import { labels, priorities, statuses, ticketTypes, transitions, type CurrentUser, type OperationsSummary, type Person, type SavedView, type Ticket } from '../shared/model';
import { BoardView, BulkBar } from './board';
import { dueLabel } from './ticket-extras';
import { Icon } from './ui/icons';
import { Avatar, EmptyState, FilterChip, Menu, Pager, fmtAgo, fmtDate, ticketKey, usePref, toast } from './ui';
import { PriorityMark, SlaMark, StatusMark } from './ui/marks';
import { rememberDeskReturn, deskReturnScroll } from './nav-state';

/* ── URL state ────────────────────────────────────────────────────────── */

export type DeskView = 'list' | 'board' | 'analytics';
type Category = { id: string; name: string };

/** Which view a hash route shows. `/tickets` and `/board` keep working as the list and the board. */
export function deskView(route: string): DeskView {
  const [path, query] = route.split('?');
  if (path === '/board') return 'board';
  if (path === '/desk') {
    const v = new URLSearchParams(query ?? '').get('view');
    return v === 'board' || v === 'analytics' ? v : 'list';
  }
  return 'list';
}

/** Filters, sort and page live in the URL hash so a desk state is a link that can be shared, saved and returned to. */
function useHashFilters() {
  const read = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] ?? ''));
  const [filters, setFilters] = useState<Record<string, string>>(read);
  useEffect(() => {
    const on = () => setFilters(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const update = (next: Record<string, string>) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v));
    const base = location.hash.slice(1).split('?')[0] || '/tickets';
    const qs = new URLSearchParams(clean).toString();
    location.hash = `${base}${qs ? `?${qs}` : ''}`;
  };
  return [filters, update] as const;
}

const FILTER_KEYS = ['q', 'status', 'priority', 'type', 'categoryId', 'assigned', 'assigneeId', 'sla', 'label', 'open', 'includeClosed'] as const;
const FILTER_LABEL: Record<string, string> = { q: 'Search', status: 'Status', priority: 'Priority', type: 'Type', categoryId: 'Category', assigned: 'Assignee', assigneeId: 'Assignee', sla: 'SLA', label: 'Label', open: 'Scope', includeClosed: 'Closed' };
const PRIORITY_NAME: Record<string, string> = { URGENT: 'P1 Critical', HIGH: 'P2 High', MEDIUM: 'P3 Medium', LOW: 'P4 Low' };
const SLA_NAME: Record<string, string> = { 'at-risk': 'At risk', breached: 'Breached', healthy: 'Healthy' };
const sameFilters = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => (FILTER_KEYS as readonly string[]).includes(k)));
  for (const k of keys) if ((a[k] ?? '') !== (b[k] ?? '')) return false;
  return true;
};

/* ── Page ─────────────────────────────────────────────────────────────── */

export function DeskPage({ route, user, act, busy, refresh }: { route: string; user: CurrentUser; act: Act; busy: boolean; refresh: number }) {
  const view = deskView(route);
  const staff = user.role !== 'EMPLOYEE';
  const [filters, setFilters] = useHashFilters();
  const { data: categories } = useRecord<Category[]>('/categories');
  const { data: views } = useRecord<SavedView[]>('/views', refresh);
  const { data: engineers } = useRecord<Person[]>(staff ? '/engineers' : '/categories');
  const { data: labelList } = useRecord<{ label: string; count: number }[]>('/labels', refresh);
  const { data: summary } = useRecord<OperationsSummary>(staff ? '/operations/summary?days=7' : '/categories', refresh);
  const ops = staff ? (summary as OperationsSummary | undefined) : undefined;
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => { setSelected(new Set()); }, [route]);
  // Returning from a ticket: put the queue back where it was.
  useEffect(() => { const y = deskReturnScroll(); if (y) setTimeout(() => window.scrollTo({ top: y }), 80); }, []);

  const activeFilters = Object.entries(filters).filter(([k, v]) => v && (FILTER_KEYS as readonly string[]).includes(k) && k !== 'open');
  const filterOnly = Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && (FILTER_KEYS as readonly string[]).includes(k)));
  const patch = (p: Record<string, string>) => setFilters({ ...filters, ...p, page: '' });
  const viewHref = (v: DeskView) => {
    const qs = new URLSearchParams(filterOnly).toString();
    const base = v === 'list' ? '/tickets' : v === 'board' ? '/board' : '/analytics';
    return `#${base}${qs ? `${base.includes('?') ? '&' : '?'}${qs}` : ''}`;
  };
  const saveView = () => {
    const name = prompt('Name this view');
    if (!name) return;
    void act(async () => { await api('/views', 'POST', { name, filters: filterOnly, shared: false }); }, `View "${name}" saved.`);
  };
  const shareView = (v: SavedView) => void act(async () => { await api('/views', 'POST', { name: v.name, filters: v.filters, shared: !v.shared }); }, v.shared ? `View "${v.name}" is private again.` : `View "${v.name}" shared with the workspace.`);
  const deleteView = (v: SavedView) => { if (confirm(`Delete the view "${v.name}"?`)) void act(async () => { await api(`/views/${v.id}`, 'DELETE'); }, 'View deleted.'); };
  const currentView = views?.find((v) => sameFilters(v.filters, filterOnly) && Object.keys(v.filters).length > 0);

  // Queue shortcuts: real filters with real counts (counts come from the operations summary).
  const me = ops?.engineers.find((e) => e.id === user.id);
  const queues: { key: string; label: string; count?: number; filters: Record<string, string> }[] = staff ? [
    { key: 'all', label: 'All', filters: {} },
    { key: 'mine', label: 'My work', count: me?.active ?? 0, filters: { assigned: 'mine', open: 'true' } },
    { key: 'unassigned', label: 'Unassigned', count: ops?.active.unassigned, filters: { assigned: 'unassigned', open: 'true' } },
    { key: 'risk', label: 'At risk', count: ops?.sla.atRisk, filters: { sla: 'at-risk' } },
    { key: 'breached', label: 'Breached', count: ops?.sla.activeBreached, filters: { sla: 'breached' } },
    { key: 'critical', label: 'Critical', count: ops?.active.byPriority.URGENT, filters: { priority: 'URGENT', open: 'true' } },
    { key: 'recent', label: 'Recently updated', filters: { sort: 'updated' } },
  ] : [
    { key: 'all', label: 'All', filters: {} },
    { key: 'open', label: 'Open', filters: { open: 'true' } },
    { key: 'waiting', label: 'Waiting on me', filters: { status: 'WAITING_FOR_USER' } },
    { key: 'resolved', label: 'Resolved', filters: { status: 'RESOLVED' } },
  ];
  const queueActive = (q: (typeof queues)[number]) => sameFilters(q.filters, filterOnly) && (q.key !== 'recent' || filters.sort === 'updated') && (q.key !== 'all' || !filters.sort);
  const title = staff ? 'Service Desk' : 'My tickets';
  const summaryLine = ops
    ? `${ops.active.total} active ticket${ops.active.total === 1 ? '' : 's'} · ${ops.sla.atRisk + ops.sla.activeBreached} at risk · ${ops.active.unassigned} unassigned`
    : staff ? '' : 'Your support requests, from first report to resolution.';

  return (
    <div className="desk">
      <div className="desk-head">
        <div>
          <p className="eyebrow">{staff ? 'SERVICE OPERATIONS' : 'YOUR REQUESTS'}</p>
          <h1>{title}</h1>
          {summaryLine && <p className="desk-summary">{summaryLine}</p>}
        </div>
        <div className="page-actions">
          <nav className="view-switch" aria-label="Desk view">
            <a href={viewHref('list')} aria-current={view === 'list' ? 'page' : undefined}><Icon name="menu" size={14} />List</a>
            <a href={viewHref('board')} aria-current={view === 'board' ? 'page' : undefined}><Icon name="board" size={14} />Board</a>
            {staff && <a href={viewHref('analytics')} aria-current={view === 'analytics' ? 'page' : undefined}><Icon name="chart" size={14} />Analytics</a>}
          </nav>
          <a className="primary" href="#/tickets/new"><Icon name="plus" size={16} />New ticket</a>
        </div>
      </div>

      {view !== 'analytics' && (
        <nav className="queue-tabs" aria-label="Work queues">
          {queues.map((q) => (
            <a key={q.key} href={`#${view === 'board' ? '/board' : '/tickets'}${Object.keys(q.filters).length ? `?${new URLSearchParams(q.filters)}` : ''}`} aria-current={queueActive(q) ? 'page' : undefined} className={queueActive(q) ? 'active' : ''}>
              {q.label}{q.count !== undefined && <span className={`count ${q.key === 'risk' && q.count ? 'warn' : (q.key === 'critical' || q.key === 'breached') && q.count ? 'crit' : ''}`}>{q.count}</span>}
            </a>
          ))}
        </nav>
      )}

      {view !== 'analytics' && (selecting && selected.size > 0 && staff ? (
        <BulkBar ids={[...selected]} engineers={engineers ?? []} act={act} busy={busy} onDone={() => { setSelected(new Set()); setSelecting(false); }} />
      ) : (
        <>
          <div className="querybar" role="search" aria-label="Ticket filters">
            <label className="q-search">
              <Icon name="search" size={16} />
              <input id="desk-search" aria-label="Search tickets" placeholder="Search ticket ID, summary, requester…" value={filters.q ?? ''} onChange={(e) => patch({ q: e.target.value })} />
              <kbd>/</kbd>
            </label>
            <div className="q-filters">
              {view === 'list' && (
                <select aria-label="Status" className={filters.status ? 'set' : ''} value={filters.status ?? ''} onChange={(e) => patch({ status: e.target.value })}>
                  <option value="">Status</option>
                  {statuses.map((s) => <option key={s} value={s}>{labels[s]}</option>)}
                </select>
              )}
              <select aria-label="Priority" className={filters.priority ? 'set' : ''} value={filters.priority ?? ''} onChange={(e) => patch({ priority: e.target.value })}>
                <option value="">Priority</option>
                {[...priorities].reverse().map((p) => <option key={p} value={p}>{PRIORITY_NAME[p]}</option>)}
              </select>
              <select aria-label="Type filter" className={filters.type ? 'set' : ''} value={filters.type ?? ''} onChange={(e) => patch({ type: e.target.value })}>
                <option value="">Type</option>
                {ticketTypes.map((t) => <option key={t} value={t}>{labels[t]}</option>)}
              </select>
              {staff && (
                <select aria-label="Assignment filter" className={filters.assigned || filters.assigneeId ? 'set' : ''} value={filters.assigneeId ? `id:${filters.assigneeId}` : filters.assigned ?? ''} onChange={(e) => { const v = e.target.value; patch(v.startsWith('id:') ? { assigneeId: v.slice(3), assigned: '' } : { assigned: v, assigneeId: '' }); }}>
                  <option value="">Assignee</option>
                  <option value="mine">Assigned to me</option>
                  <option value="unassigned">Unassigned</option>
                  {engineers?.map((p) => <option key={p.id} value={`id:${p.id}`}>{p.name}</option>)}
                </select>
              )}
              <select aria-label="SLA filter" className={filters.sla ? 'set' : ''} value={filters.sla ?? ''} onChange={(e) => patch({ sla: e.target.value })}>
                <option value="">SLA</option>
                <option value="at-risk">At risk</option>
                <option value="breached">Breached</option>
                <option value="healthy">Healthy</option>
              </select>
              <Menu label="More filters" trigger={(open) => <button className="btn-ghost" aria-haspopup="menu" aria-expanded={open}><Icon name="plus" size={14} />Filter</button>}>
                <span className="menu-label">Category</span>
                {categories?.map((c) => <button key={c.id} data-active={filters.categoryId === c.id} onClick={() => patch({ categoryId: filters.categoryId === c.id ? '' : c.id })}>{c.name}</button>)}
                {labelList && labelList.length > 0 && <><hr /><span className="menu-label">Label</span>{labelList.slice(0, 12).map((l) => <button key={l.label} data-active={filters.label === l.label} onClick={() => patch({ label: filters.label === l.label ? '' : l.label })}>{l.label} <small>{l.count}</small></button>)}</>}
                {view === 'board' && <><hr /><button data-active={filters.includeClosed === 'true'} onClick={() => patch({ includeClosed: filters.includeClosed === 'true' ? '' : 'true' })}>Show closed</button></>}
              </Menu>
            </div>
            <div className="q-right">
              {currentView && <span className="view-name" title={currentView.shared ? `Shared by ${currentView.owner?.name ?? 'someone'}` : 'Private view'}><Icon name="star" size={13} />{currentView.name}</span>}
              <select aria-label="Saved views" value="" onChange={(e) => { const v = views?.find((x) => x.id === e.target.value); if (v) setFilters({ ...v.filters }); }}>
                <option value="">Saved views…</option>
                {views?.map((v) => <option key={v.id} value={v.id}>{v.name}{v.shared ? ` (shared by ${v.owner?.name ?? 'someone'})` : ''}</option>)}
              </select>
              <button onClick={saveView} disabled={busy || !activeFilters.length} title="Save the current filters as a view">Save view</button>
              {view === 'list' && <ColumnsMenu />}
              {view === 'list' && <DensityToggle />}
              <Menu label="More" align="right" trigger={(open) => <button className="icon-btn" aria-label="More desk options" aria-haspopup="menu" aria-expanded={open}><Icon name="more" /></button>}>
                {staff && <button onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? 'Hide selection' : 'Select tickets'}</button>}
                {views && views.some((v) => v.userId === user.id) && <>
                  <hr /><span className="menu-label">Your views</span>
                  {views.filter((v) => v.userId === user.id).map((v) => (
                    <div key={v.id} className="flex between" style={{ padding: '2px 4px', gap: 6 }}>
                      <a href={viewHref(view)} onClick={(e) => { e.preventDefault(); setFilters({ ...v.filters }); }} style={{ flex: 1 }}>{v.name}</a>
                      {staff && <button className="btn-sm" onClick={() => shareView(v)}>{v.shared ? 'Unshare' : 'Share'}</button>}
                      <button className="btn-sm danger" onClick={() => deleteView(v)} aria-label={`Delete view ${v.name}`}><Icon name="trash" size={13} /></button>
                    </div>
                  ))}
                </>}
              </Menu>
            </div>
          </div>
          {activeFilters.length > 0 && (
            <div className="chips desk-chips">
              {activeFilters.map(([k, v]) => (
                <FilterChip key={k} label={FILTER_LABEL[k] ?? k}
                  value={k === 'categoryId' ? (categories?.find((c) => c.id === v)?.name ?? v) : k === 'assigneeId' ? (engineers?.find((e) => e.id === v)?.name ?? v) : k === 'assigned' ? (v === 'mine' ? 'Me' : 'Unassigned') : k === 'priority' ? PRIORITY_NAME[v] : k === 'sla' ? SLA_NAME[v] : k === 'includeClosed' ? 'shown' : (labels[v] ?? v)}
                  onRemove={() => patch({ [k]: '' })} />
              ))}
              <button className="text-btn btn-sm" onClick={() => setFilters(filters.sort ? { sort: filters.sort } : {})}>Clear all</button>
              {!currentView && <button className="text-btn btn-sm" onClick={saveView} disabled={busy}>Save as view</button>}
            </div>
          )}
        </>
      ))}

      {view === 'list' && <ListView user={user} act={act} busy={busy} refresh={refresh} filters={filters} setFilters={setFilters} selecting={selecting} selected={selected} setSelected={setSelected} engineers={engineers ?? []} />}
      {view === 'board' && <BoardView user={user} act={act} busy={busy} refresh={refresh} filters={Object.fromEntries(Object.entries(filterOnly).filter(([k]) => k !== 'open' && k !== 'sla'))} selecting={selecting} engineers={engineers ?? []} />}
    </div>
  );
}

/* ── Column and density preferences (per browser) ─────────────────────── */

const OPTIONAL_COLUMNS: { key: string; label: string }[] = [
  { key: 'requester', label: 'Requester' }, { key: 'type', label: 'Type' }, { key: 'category', label: 'Service / category' }, { key: 'due', label: 'Due date' }, { key: 'created', label: 'Created' },
];
const DEFAULT_HIDDEN = ['type', 'category', 'due', 'created'];
function useColumns() { return usePref<string[]>('desk.hiddenColumns.v2', DEFAULT_HIDDEN); }
function useDensity() { return usePref<'comfortable' | 'compact'>('desk.density', 'comfortable'); }
function ColumnsMenu() {
  const [hidden, setHidden] = useColumns();
  return (
    <Menu label="Columns" align="right" trigger={(open) => <button className="btn-ghost" aria-haspopup="menu" aria-expanded={open}><Icon name="columns" size={15} />Columns</button>}>
      <span className="menu-label">Optional columns</span>
      {OPTIONAL_COLUMNS.map((c) => (
        <label key={c.key} className="check" style={{ padding: '4px 10px' }} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => setHidden(hidden.includes(c.key) ? hidden.filter((h) => h !== c.key) : [...hidden, c.key])} /> {c.label}
        </label>
      ))}
    </Menu>
  );
}
function DensityToggle() {
  const [density, setDensity] = useDensity();
  return <button className="btn-ghost" aria-pressed={density === 'compact'} onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')} title="Toggle row density"><Icon name="layers" size={15} />{density === 'compact' ? 'Compact' : 'Comfortable'}</button>;
}

/* ── List view ────────────────────────────────────────────────────────── */

function ListView({ user, act, busy, refresh, filters, setFilters, selecting, selected, setSelected, engineers }: {
  user: CurrentUser; act: Act; busy: boolean; refresh: number; filters: Record<string, string>; setFilters: (f: Record<string, string>) => void;
  selecting: boolean; selected: Set<string>; setSelected: (s: Set<string>) => void; engineers: Person[];
}) {
  const staff = user.role !== 'EMPLOYEE';
  const page = Math.max(1, Number(filters.page) || 1);
  const sort = ['newest', 'oldest', 'updated'].includes(filters.sort) ? filters.sort : 'newest';
  const params = new URLSearchParams(Object.entries(filters).filter(([k, v]) => v && k !== 'page' && k !== 'sort' && k !== 'includeClosed' && k !== 'view'));
  params.set('page', String(page));
  params.set('sort', sort);
  params.set('pageSize', '25');
  const [tick, setTick] = useState(0);
  const { data, error } = useRecord<{ items: Ticket[]; total: number; pageSize: number }>(`/tickets?${params}`, refresh + tick);
  const [hidden] = useColumns();
  const [density] = useDensity();
  const [cursor, setCursor] = useState<number>(-1);
  const rowsRef = useRef<HTMLTableSectionElement>(null);
  const show = (key: string) => !hidden.includes(key);
  const toggle = (id: string) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n); };
  const open = (t: Ticket) => { rememberDeskReturn(); location.hash = `/tickets/${t.id}`; };
  const quick = (t: Ticket, patchBody: Record<string, unknown>, message: string) => void act(async () => { await api(`/tickets/${t.id}`, 'PATCH', { ...patchBody, version: t.version }); }, message);

  // Keyboard: "/" focuses search, J/K move, Enter opens, Space selects (never while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
      if (e.key === '/' && !typing) { e.preventDefault(); document.getElementById('desk-search')?.focus(); return; }
      if (typing || !data?.items.length || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.max(0, Math.min(data.items.length - 1, cursor + (e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1)));
        setCursor(next);
        rowsRef.current?.querySelectorAll<HTMLTableRowElement>('tr')[next]?.focus();
      } else if (e.key === 'Enter' && cursor >= 0 && el.tagName === 'TR') { open(data.items[cursor]); }
      else if (e.key === ' ' && cursor >= 0 && staff && el.tagName === 'TR') { e.preventDefault(); toggle(data.items[cursor].id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sortBtn = (key: 'updated' | 'created', label: string) => {
    const active = key === 'updated' ? sort === 'updated' : sort !== 'updated';
    const dir = key === 'updated' ? 'desc' : sort === 'oldest' ? 'asc' : 'desc';
    return (
      <button type="button" className={`sort ${active ? 'active' : ''}`} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
        onClick={() => setFilters({ ...filters, sort: key === 'updated' ? 'updated' : sort === 'newest' ? 'oldest' : 'newest', page: '' })}>
        {label}{active && <span aria-hidden="true">{dir === 'asc' ? ' ↑' : ' ↓'}</span>}
      </button>
    );
  };

  if (error) return <div className="desk-error" role="alert"><Icon name="alert" size={20} /><div><strong>We couldn't load the Service Desk.</strong><small>The request did not complete. Nothing has been changed.</small></div><button onClick={() => setTick((t) => t + 1)}>Retry</button></div>;
  if (!data) return <TableSkeleton />;
  const items = data.items;
  const allSelected = items.length > 0 && items.every((t) => selected.has(t.id));
  const clearFilters = () => setFilters(filters.sort ? { sort: filters.sort } : {});

  return (
    <section className={`desk-table ${density}`}>
      {items.length ? (
        <div className="table-scroll">
          <table className="tickets">
            <thead>
              <tr>
                {selecting && staff && <th className="col-select"><input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((t) => t.id)))} /></th>}
                <th className="col-key">Key</th>
                <th>Summary</th>
                <th className="col-status">Status</th>
                <th className="col-priority">Priority</th>
                <th className="col-sla">SLA</th>
                {staff && <th className="col-person">Assignee</th>}
                {show('requester') && <th className="col-person">Requester</th>}
                {show('type') && <th>Type</th>}
                {show('category') && <th>Service</th>}
                {show('due') && <th>Due</th>}
                {show('created') && <th className="col-date">{sortBtn('created', 'Created')}</th>}
                <th className="col-date">{sortBtn('updated', 'Updated')}</th>
                {staff && <th className="col-actions"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody ref={rowsRef}>
              {items.map((t, i) => {
                const due = dueLabel(t.dueAt);
                const risk = t.sla && !['RESOLVED', 'CLOSED'].includes(t.status) ? (t.sla.responseBreachAt || t.sla.resolutionBreachAt ? 'breach' : '') : '';
                return (
                  <tr key={t.id} tabIndex={0} className={`${selected.has(t.id) ? 'selected' : ''} ${risk} ${t.priority === 'URGENT' ? 'p1' : ''}`} aria-selected={selecting ? selected.has(t.id) : undefined}
                    onFocus={() => setCursor(i)} onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button,input,select,[role=menu]')) open(t); }}
                    onKeyDown={(e: ReactKeyboardEvent<HTMLTableRowElement>) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(t); }}>
                    {selecting && staff && <td className="col-select"><input type="checkbox" aria-label={`Select ${ticketKey(t)}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></td>}
                    <td className="col-key"><a className="mono-id" href={`#/tickets/${t.id}`} onClick={rememberDeskReturn}>{ticketKey(t)}</a></td>
                    <td className="col-summary">
                      <a className="summary-title" href={`#/tickets/${t.id}`} onClick={rememberDeskReturn}>{t.title}</a>
                      <small className="summary-meta">{labels[t.type]} · {t.category.name}{t.labels.length ? ` · ${t.labels.slice(0, 2).join(', ')}${t.labels.length > 2 ? ` +${t.labels.length - 2}` : ''}` : ''}</small>
                    </td>
                    <td className="col-status"><StatusMark value={t.status} /></td>
                    <td className="col-priority"><PriorityMark value={t.priority} /></td>
                    <td className="col-sla"><SlaMark sla={t.sla} status={t.status} /></td>
                    {staff && <td className="col-person">{t.assignee ? <span className="person"><Avatar name={t.assignee.name} size={22} /><span className="truncate">{t.assignee.name}</span></span> : <span className="unowned">Unassigned</span>}</td>}
                    {show('requester') && <td className="col-person"><span className="person"><Avatar name={t.requester.name} size={22} /><span className="truncate">{t.requester.name}</span></span></td>}
                    {show('type') && <td>{labels[t.type]}</td>}
                    {show('category') && <td>{t.category.name}</td>}
                    {show('due') && <td>{due ? <span className={`due ${due.overdue ? 'overdue' : due.soon ? 'soon' : ''}`}>{due.text}</span> : <span className="muted">—</span>}</td>}
                    {show('created') && <td className="col-date" title={fmtDate(t.createdAt)}>{fmtAgo(t.createdAt)}</td>}
                    <td className="col-date" title={fmtDate(t.updatedAt)}>{fmtAgo(t.updatedAt)}</td>
                    {staff && (
                      <td className="col-actions">
                        <div className="row-tools" aria-label={`Actions for ${ticketKey(t)}`}>
                          <Menu label={`Assign ${ticketKey(t)}`} align="right" trigger={(open) => <button className="btn-sm btn-ghost" aria-haspopup="menu" aria-expanded={open}>Assign</button>}>
                            <button data-active={!t.assigneeId} onClick={() => quick(t, { assigneeId: null }, `${ticketKey(t)} unassigned.`)}>Unassigned</button>
                            {engineers.map((p) => <button key={p.id} data-active={t.assigneeId === p.id} onClick={() => quick(t, { assigneeId: p.id }, `${ticketKey(t)} assigned to ${p.name}.`)}>{p.name}{p.id === user.id ? ' (me)' : ''}</button>)}
                          </Menu>
                          <Menu label={`Change status of ${ticketKey(t)}`} align="right" trigger={(open) => <button className="btn-sm btn-ghost" aria-haspopup="menu" aria-expanded={open}>Status</button>}>
                            {transitions[t.status].length ? transitions[t.status].map((s) => <button key={s} onClick={() => quick(t, { status: s }, `${ticketKey(t)} moved to ${labels[s]}.`)}>{labels[s]}</button>) : <span className="menu-label">No further transition</span>}
                          </Menu>
                          <a className="btn-sm btn-ghost" href={`#/tickets/${t.id}?compose=note`} onClick={rememberDeskReturn}>Add note</a>
                          <Menu label={`More for ${ticketKey(t)}`} align="right" trigger={(open) => <button className="icon-btn btn-sm" aria-label={`More actions for ${ticketKey(t)}`} aria-haspopup="menu" aria-expanded={open}><Icon name="more" size={16} /></button>}>
                            <button onClick={() => open(t)}>Open ticket</button>
                            <button onClick={() => { void navigator.clipboard?.writeText(ticketKey(t)); toast('info', `${ticketKey(t)} copied.`); }}>Copy key</button>
                            {!selecting && <button onClick={() => { setSelected(new Set([t.id])); toast('info', 'Selection started — pick more rows or use the toolbar.'); }}>Select</button>}
                          </Menu>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="ticket" title="No tickets match this view" action={<div className="flex"><button onClick={clearFilters}>Clear filters</button><a className="btn" href="#/tickets/new">New ticket</a></div>}>
          Try a different queue, widen the filters, or create the ticket you were looking for.
        </EmptyState>
      )}
      <div className="desk-foot">
        <span className="muted t-caption">{data.total.toLocaleString()} ticket{data.total === 1 ? '' : 's'}{selecting && selected.size ? ` · ${selected.size} selected` : ''} · <kbd className="key">J</kbd><kbd className="key">K</kbd> move · <kbd className="key">↵</kbd> open · <kbd className="key">/</kbd> search</span>
        {data.total > data.pageSize && <Pager page={page} total={data.total} pageSize={data.pageSize} setPage={(p) => setFilters({ ...filters, page: String(p) })} />}
      </div>
    </section>
  );
}

function TableSkeleton() {
  return (
    <section className="desk-table" aria-busy="true" aria-label="Loading tickets">
      <div className="skel-table">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skel-row"><span style={{ width: 72 }} /><span style={{ width: `${45 + (i % 3) * 12}%` }} /><span style={{ width: 90 }} /><span style={{ width: 80 }} /><span style={{ width: 96 }} /><span style={{ width: 120 }} /></div>)}
      </div>
    </section>
  );
}

