import { useEffect, useRef, useState, type ReactNode } from 'react';
import { labels, type Person } from '../../shared/model';
import { Icon } from './icons';

/* ── Formatting helpers ───────────────────────────────────────────────── */

export const ticketKey = (t: { number: number }) => `OPS-${String(t.number).padStart(4, '0')}`;
export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtDay = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
/**
 * A calendar date with no time of day (purchase and warranty dates, date answers on a request form).
 * Stored as UTC midnight or as YYYY-MM-DD; formatted in UTC so the day never shifts for a viewer
 * west of Greenwich. Timestamps (created, resolved, due) keep using fmtDay/fmtDate, which show them
 * in the viewer's own zone.
 */
export const fmtCalendarDay = (s: string | null | undefined) => (s ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' }) : '—');
export function fmtAgo(s: string | null | undefined) {
  if (!s) return '—';
  const ms = Date.now() - new Date(s).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d ago`;
  return fmtDay(s);
}
export const initials = (name: string) => name.split(' ').filter(Boolean).map((n) => n[0]).slice(0, 2).join('').toUpperCase();

/* ── Priority, status, type ───────────────────────────────────────────── */

export const PRIORITY_CODE: Record<string, string> = { URGENT: 'P1', HIGH: 'P2', MEDIUM: 'P3', LOW: 'P4' };
export function PriorityBadge({ value, short }: { value: string; short?: boolean }) {
  return <span className={`badge priority-badge ${value.toLowerCase()}`} title={`${PRIORITY_CODE[value] ?? ''} ${labels[value] ?? value}`}>{PRIORITY_CODE[value] ?? '·'}{!short && <span className="pb-text"> {labels[value] ?? value}</span>}</span>;
}
export const StatusBadge = ({ value }: { value: string }) => <span className={`badge ${value.toLowerCase()}`}>{labels[value] ?? value}</span>;
export const TypeBadge = ({ value }: { value: string }) => <span className={`type-pill ${value.toLowerCase()}`}>{labels[value] ?? value}</span>;

/* ── SLA ──────────────────────────────────────────────────────────────── */

// SLA presentation lives in ui/marks.tsx (slaSummary / SlaMark), the one client-side reading of the
// server's slaView. There is deliberately no second implementation here.

/* ── Avatar ───────────────────────────────────────────────────────────── */

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return <span className="avatar" title={name} style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 60% 92%)`, color: `hsl(${hue} 45% 32%)` }}>{initials(name)}</span>;
}
export function AvatarGroup({ people, max = 4, size = 24 }: { people: Person[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  return <span className="avatar-group">{shown.map((p) => <Avatar key={p.id} name={p.name} size={size} />)}{people.length > max && <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>+{people.length - max}</span>}</span>;
}
export function PersonChip({ person, sub }: { person: Person | null | undefined; sub?: string }) {
  if (!person) return <span className="muted">Unassigned</span>;
  return <span className="person"><Avatar name={person.name} size={24} /><div><span className="truncate">{person.name}</span>{sub && <small>{sub}</small>}</div></span>;
}

/* ── Page furniture ───────────────────────────────────────────────────── */

export function PageHeader({ eyebrow, title, description, actions, children }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-heading">
      <div className="grow">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="muted">{description}</p>}{children}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
export function MetricCard({ label, value, hint, tone, trend, icon, href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'attention' | 'good'; trend?: { dir: 'up' | 'down' | 'flat'; text: string }; icon?: string; href?: string }) {
  const body = (
    <>
      <div className="flex between"><span>{label}</span>{icon && <span className="metric-icon"><Icon name={icon} size={16} /></span>}</div>
      <strong>{value}</strong>
      <small>{trend && <span className={`trend ${trend.dir}`}>{trend.dir === 'up' ? '▲' : trend.dir === 'down' ? '▼' : '•'} {trend.text} </span>}{hint}</small>
    </>
  );
  return href ? <a className={`metric ${tone ?? ''}`} href={href} style={{ color: 'inherit', textDecoration: 'none' }}>{body}</a> : <section className={`metric ${tone ?? ''}`}>{body}</section>;
}
export function EmptyState({ icon = 'inbox', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} /></span><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return <div className="skeleton-rows" role="status" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton" />)}</div>;
}
export function ErrorState({ error, retry, back }: { error: string; retry?: () => void; back?: { href: string; label: string } }) {
  return (
    <div className="empty" role="alert">
      <span className="empty-icon"><Icon name="alert" /></span>
      <h3>Something did not load</h3>
      <p>{error}</p>
      <div className="flex">{retry && <button onClick={retry}><Icon name="refresh" size={14} />Retry</button>}{back && <a className="btn" href={back.href}>{back.label}</a>}</div>
    </div>
  );
}
/** Loading, error or content — the three states every data view has. */
export function Loaded<T>({ data, error, skeletonRows = 5, children }: { data: T | undefined; error: string; skeletonRows?: number; children: (d: T) => ReactNode }) {
  if (error) return <ErrorState error={error} />;
  if (data === undefined) return <Skeleton rows={skeletonRows} />;
  return <>{children(data)}</>;
}
export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={i} className="flex" style={{ gap: 6, minWidth: 0 }}>
          {i > 0 && <span className="sep" aria-hidden="true">/</span>}
          {c.href && i < items.length - 1 ? <a href={c.href}>{c.label}</a> : <strong aria-current={i === items.length - 1 ? 'page' : undefined}>{c.label}</strong>}
        </span>
      ))}
    </nav>
  );
}
export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="key">{children}</kbd>;

/* ── Tabs ─────────────────────────────────────────────────────────────── */

export function Tabs({ items, current, ariaLabel }: { items: { key: string; label: string; href: string; count?: number }[]; current: string; ariaLabel: string }) {
  return <nav className="tabs" aria-label={ariaLabel}>{items.map((t) => <a key={t.key} href={t.href} aria-current={current === t.key ? 'page' : undefined} className={current === t.key ? 'active' : ''}>{t.label}{t.count !== undefined && <span className="count">{t.count}</span>}</a>)}</nav>;
}

/* ── Chips ────────────────────────────────────────────────────────────── */

export function FilterChip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return <span className="chip">{label}: <strong>{value}</strong><button type="button" aria-label={`Remove filter ${label}`} onClick={onRemove}><Icon name="x" size={12} /></button></span>;
}

/* ── Menu (dropdown) ──────────────────────────────────────────────────── */

export function Menu({ trigger, children, align = 'left', label }: { trigger: (open: boolean) => ReactNode; children: ReactNode; align?: 'left' | 'right'; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <span onClick={() => setOpen(!open)} style={{ display: 'inline-flex' }}>{trigger(open)}</span>
      {open && <div className="menu" role="menu" aria-label={label} data-align={align} style={{ top: 'calc(100% + 6px)' }} onClick={(e) => { if ((e.target as HTMLElement).closest('a,button')) setOpen(false); }}>{children}</div>}
    </div>
  );
}

/* ── Modal, drawer, confirm ───────────────────────────────────────────── */

function useEscape(onClose: () => void) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    const prev = document.activeElement as HTMLElement | null;
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [onClose]);
}
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => { first.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.icon-btn)')?.focus(); }, []);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={first}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
export function Drawer({ title, onClose, children, footer, eyebrow }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; eyebrow?: string }) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.icon-btn)')?.focus(); }, []);
  return (
    <div className="overlay drawer-host" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
      <div className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Panel'} ref={ref}>
        <div className="drawer-head"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div><button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}
export function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger, onConfirm, onCancel, busy }: { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  return (
    <Modal title={title} onClose={onCancel} footer={<><button onClick={onCancel}>Cancel</button><button className={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>{confirmLabel}</button></>}>
      <div className="t-body">{body}</div>
    </Modal>
  );
}

/* ── Toasts ───────────────────────────────────────────────────────────── */

type Toast = { id: number; kind: 'success' | 'error' | 'info' | 'warning'; text: string };
const listeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];
let seq = 0;
export function toast(kind: Toast['kind'], text: string) {
  const t = { id: ++seq, kind, text };
  toasts = [...toasts, t];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => dismiss(t.id), kind === 'error' ? 7000 : 3500);
}
function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  listeners.forEach((l) => l(toasts));
}
export function ToastHost() {
  const [items, setItems] = useState<Toast[]>(toasts);
  useEffect(() => { listeners.add(setItems); return () => { listeners.delete(setItems); }; }, []);
  if (!items.length) return null;
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {items.map((t) => <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}><Icon name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'info'} size={16} /><span className="grow">{t.text}</span><button className="icon-btn btn-sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}><Icon name="x" size={14} /></button></div>)}
    </div>
  );
}

/* ── Data table ───────────────────────────────────────────────────────── */

export interface Column<T> { key: string; label: string; render: (row: T) => ReactNode; sortable?: boolean; width?: number | string; align?: 'left' | 'right'; optional?: boolean }
export function DataTable<T extends { id: string }>({ columns, rows, sort, onSort, selectable, selected, onToggle, onToggleAll, dense, rowHref, emptyState, hiddenColumns }: {
  columns: Column<T>[]; rows: T[]; sort?: { key: string; dir: 'asc' | 'desc' }; onSort?: (key: string) => void;
  selectable?: boolean; selected?: Set<string>; onToggle?: (id: string) => void; onToggleAll?: (ids: string[]) => void;
  dense?: boolean; rowHref?: (row: T) => string; emptyState?: ReactNode; hiddenColumns?: Set<string>;
}) {
  const cols = columns.filter((c) => !hiddenColumns?.has(c.key));
  const allSelected = rows.length > 0 && rows.every((r) => selected?.has(r.id));
  return (
    <div className="table-scroll">
      <table className={dense ? 'dt-dense' : ''}>
        <thead>
          <tr>
            {selectable && <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all rows" checked={allSelected} onChange={() => onToggleAll?.(rows.map((r) => r.id))} /></th>}
            {cols.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align }} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                {c.sortable && onSort ? <button type="button" className="sort" onClick={() => onSort(c.key)}>{c.label}{sort?.key === c.key && <span aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>}</button> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={selected?.has(r.id) ? 'selected' : ''} onClick={(e) => { if (rowHref && !(e.target as HTMLElement).closest('a,button,input,select')) location.hash = rowHref(r).replace(/^#/, ''); }} style={rowHref ? { cursor: 'pointer' } : undefined}>
              {selectable && <td><input type="checkbox" aria-label={`Select ${r.id.slice(0, 8)}`} checked={selected?.has(r.id) ?? false} onChange={() => onToggle?.(r.id)} /></td>}
              {cols.map((c) => <td key={c.key} style={{ textAlign: c.align }}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (emptyState ?? <EmptyState title="Nothing to show" />)}
    </div>
  );
}

/* ── Pager ────────────────────────────────────────────────────────────── */
export function Pager({ page, total, pageSize = 15, setPage }: { page: number; total: number; pageSize?: number; setPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>{total.toLocaleString()} record{total === 1 ? '' : 's'} · page {page} of {pages}</span>
      <div className="flex"><button className="btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </div>
  );
}

/** Persisted per-viewer preference (column set, density). Never for anything shared. */
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const raw = localStorage.getItem(`opspilot:${key}`); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; } });
  const set = (next: T) => { setV(next); try { localStorage.setItem(`opspilot:${key}`, JSON.stringify(next)); } catch { /* ignore */ } };
  return [v, set];
}
