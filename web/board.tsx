import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { api } from './api';
import { Pending, useRecord, type Act } from './operations';
import { labels, priorities, statuses, transitions, type BoardColumn, type CurrentUser, type Person, type Status, type Ticket } from '../shared/model';
import { Avatar } from './ticket-extras';
import { rememberDeskReturn } from './nav-state';
import { Icon } from './ui/icons';
import { toast } from './ui';
import { PriorityMark, SlaMark, STATUS_WORD } from './ui/marks';

const number = (t: { number: number }) => `OPS-${String(t.number).padStart(4, '0')}`;

/** Filters live in the URL hash so a board state is a link. */
function useHashFilters(base: string) {
  const read = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] ?? ''));
  const [filters, setFilters] = useState<Record<string, string>>(read);
  useEffect(() => {
    const on = () => setFilters(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const update = (next: Record<string, string>) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v));
    const qs = new URLSearchParams(clean).toString();
    location.hash = `${base}${qs ? `?${qs}` : ''}`;
  };
  return [filters, update] as const;
}

/**
 * The kanban view of the service desk. Filters, saved views and the page heading belong to the
 * Service Desk page (desk.tsx); this component only renders columns and handles drag, drop and
 * bulk selection. Status rules still apply: a card only lands where the workflow allows.
 */
export function BoardView({ user, act, busy, refresh, filters, selecting, engineers, onLabels }: { user: CurrentUser; act: Act; busy: boolean; refresh: number; filters: Record<string, string>; selecting: boolean; engineers: Person[]; onLabels?: (labels: string[]) => void }) {
  const qs = new URLSearchParams(filters).toString();
  const { data, error } = useRecord<{ columns: BoardColumn[]; labels: string[] }>(`/board${qs ? `?${qs}` : ''}`, refresh);
  const [dragging, setDragging] = useState<{ id: string; from: Status } | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => { if (!selecting) setSelected(new Set()); }, [selecting]);
  useEffect(() => { if (data?.labels) onLabels?.(data.labels); }, [data?.labels]); // eslint-disable-line react-hooks/exhaustive-deps
  const staff = user.role !== 'EMPLOYEE';
  const columns = data?.columns ?? [];
  const allowedTargets = useMemo(() => (dragging ? new Set([dragging.from, ...transitions[dragging.from]]) : new Set<Status>()), [dragging]);

  const onDrop = (status: Status, afterId: string | null) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    if (!dragging || !staff) return;
    const id = dragging.id;
    const from = dragging.from;
    setDragging(null);
    if (!allowedTargets.has(status)) { toast('info', `Cannot move directly from ${labels[from]} to ${labels[status]}.`); return; }
    void act(async () => { await api('/board/move', 'POST', { id, status, afterId }); }, status === dragging.from ? 'Card reordered.' : `Moved to ${labels[status]}.`);
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      {selecting && selected.size > 0 && staff && (
        <BulkBar ids={[...selected]} engineers={engineers} act={act} busy={busy} onDone={() => setSelected(new Set())} />
      )}
      {!data ? <Pending error={error} /> : (
        <div className="board">
          {columns.map((col) => (
            <section key={col.status} className={`column ${over === col.status ? (allowedTargets.has(col.status) ? 'can-drop' : 'no-drop') : ''}`} aria-label={`${labels[col.status]} column`}
              onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(col.status); } }} onDragLeave={() => setOver(null)} onDrop={onDrop(col.status, col.tickets.at(-1)?.id ?? null)}>
              <header><span className="col-name"><i className={`col-dot ${col.status.toLowerCase()}`} />{STATUS_WORD[col.status] ?? labels[col.status]}</span><span className="count">{col.total}</span></header>
              <div className="cards">
                {col.tickets.map((t) => <Card key={t.id} t={t} staff={staff} selecting={selecting} selected={selected.has(t.id)} onToggle={() => toggle(t.id)} onDragStart={() => setDragging({ id: t.id, from: t.status })} onDragEnd={() => { setDragging(null); setOver(null); }} onDropBefore={onDrop(col.status, indexBefore(col.tickets, t.id))} />)}
                {!col.tickets.length && <div className="empty-col">Nothing here</div>}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

const indexBefore = (tickets: Ticket[], id: string) => { const i = tickets.findIndex((t) => t.id === id); return i > 0 ? tickets[i - 1].id : null; };

function Card({ t, staff, selecting, selected, onToggle, onDragStart, onDragEnd, onDropBefore }: { t: Ticket & { attachmentCount?: number; replyCount?: number }; staff: boolean; selecting: boolean; selected: boolean; onToggle: () => void; onDragStart: () => void; onDragEnd: () => void; onDropBefore: (e: DragEvent) => void }) {
  const [over, setOver] = useState(false);
  const [lifting, setLifting] = useState(false);
  const open = () => { rememberDeskReturn(); location.hash = `/tickets/${t.id}`; };
  return (
    <article className={`card priority-${t.priority.toLowerCase()} ${selected ? 'selected' : ''} ${over ? 'insert-before' : ''} ${lifting ? 'lifting' : ''}`} draggable={staff && !selecting} tabIndex={0}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setLifting(true); onDragStart(); }} onDragEnd={() => { setLifting(false); setOver(false); onDragEnd(); }}
      onDrop={(e) => { e.stopPropagation(); setOver(false); onDropBefore(e); }} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); }} aria-label={`${number(t)} ${t.title}`}>
      <div className="card-top">
        {selecting && <input type="checkbox" aria-label={`Select ${number(t)}`} checked={selected} onChange={onToggle} />}
        <a href={`#/tickets/${t.id}`} className="card-key" onClick={rememberDeskReturn}>{number(t)}</a>
        <PriorityMark value={t.priority} />
      </div>
      <a href={`#/tickets/${t.id}`} className="card-title" onClick={rememberDeskReturn}>{t.title}</a>
      <small className="card-meta">{labels[t.type]} · {t.category.name}{t.labels.length ? ` · ${t.labels.slice(0, 2).join(', ')}` : ''}</small>
      <div className="card-foot">
        <SlaMark sla={t.sla} status={t.status} bar={false} />
        <span className="spacer" />
        {(t.attachmentCount ?? 0) > 0 && <small className="card-count" title={`${t.attachmentCount} attachment(s)`}><Icon name="paperclip" size={12} />{t.attachmentCount}</small>}
        {(t.replyCount ?? 0) > 0 && <small className="card-count" title={`${t.replyCount} repl${t.replyCount === 1 ? 'y' : 'ies'}`}><Icon name="message" size={12} />{t.replyCount}</small>}
        {t.assignee ? <span className="card-owner"><Avatar name={t.assignee.name} size={20} /><span>{t.assignee.name.split(' ')[0]}</span></span> : <span className="card-unowned" title="Unassigned">Unassigned</span>}
      </div>
    </article>
  );
}

export function BulkBar({ ids, engineers, act, busy, onDone }: { ids: string[]; engineers: Person[]; act: Act; busy: boolean; onDone: () => void }) {
  const [label, setLabel] = useState('');
  const run = (patch: Record<string, unknown>, msg: string) => void act(async () => {
    const r = await api<{ updated: number; skipped: { id: string; reason: string }[] }>('/tickets/bulk', 'POST', { ids, ...patch });
    if (r.skipped.length) throw new Error(`${r.updated} updated; ${r.skipped.length} skipped: ${r.skipped.map((s) => s.reason).join(', ')}`);
    onDone();
  }, msg);
  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions">
      <strong>{ids.length} selected</strong>
      <select aria-label="Bulk status" disabled={busy} value="" onChange={(e) => e.target.value && run({ status: e.target.value }, `${ids.length} ticket(s) moved.`)}><option value="">Set status…</option>{statuses.map((s) => <option key={s} value={s}>{labels[s]}</option>)}</select>
      <select aria-label="Bulk priority" disabled={busy} value="" onChange={(e) => e.target.value && run({ priority: e.target.value }, 'Priority updated.')}><option value="">Set priority…</option>{priorities.map((p) => <option key={p} value={p}>{labels[p]}</option>)}</select>
      <select aria-label="Bulk assignee" disabled={busy} value="" onChange={(e) => e.target.value && run({ assigneeId: e.target.value === 'none' ? null : e.target.value }, 'Assignee updated.')}><option value="">Assign to…</option><option value="none">Unassigned</option>{engineers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (label.trim()) { run({ addLabels: [label.trim().toLowerCase()] }, 'Label added.'); setLabel(''); } }}><input aria-label="Bulk label" placeholder="Add label…" value={label} maxLength={30} onChange={(e) => setLabel(e.target.value)} /><button disabled={busy || !label.trim()}>Add</button></form>
      <button className="text-btn" onClick={onDone}>Cancel</button>
    </div>
  );
}
