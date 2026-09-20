import { useEffect, useRef, useState } from 'react';
import { api, csrfToken } from './api';
import { Pending, useRecord, when, type Act } from './operations';
import { impacts, labels, ticketTypes, priorityFor, type ActivityItem, type Attachment, type CurrentUser, type Person, type Ticket } from '../shared/model';

/* ── Small pieces reused across the ticket page and the board ─────────── */

export const typeBadge = (type: string) => <span className={`type-pill ${type.toLowerCase()}`}>{labels[type] ?? type}</span>;
export const initials = (name: string) => name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return <span className="avatar" title={name} style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 55% 88%)`, color: `hsl(${hue} 45% 30%)` }}>{initials(name)}</span>;
}
export const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const dueLabel = (dueAt: string | null) => {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - Date.now();
  const days = Math.round(ms / 86400000);
  return { text: ms < 0 ? `Overdue by ${Math.abs(days)}d` : days === 0 ? 'Due today' : `Due in ${days}d`, overdue: ms < 0, soon: ms >= 0 && days <= 1 };
};

/* ── Type, impact, urgency, labels, due date (support staff) ──────────── */

export function TicketClassification({ ticket, act, busy, editable }: { ticket: Ticket; act: Act; busy: boolean; editable: boolean }) {
  const [impact, setImpact] = useState(ticket.impact);
  const [urgency, setUrgency] = useState(ticket.urgency);
  const [labelInput, setLabelInput] = useState('');
  useEffect(() => { setImpact(ticket.impact); setUrgency(ticket.urgency); }, [ticket.id, ticket.version, ticket.impact, ticket.urgency]);
  const save = (patch: Record<string, unknown>, msg: string) => void act(async () => { await api(`/tickets/${ticket.id}`, 'PATCH', { version: ticket.version, ...patch }); }, msg);
  const due = dueLabel(ticket.dueAt);
  if (!editable)
    return (
      <dl className="properties">
        <dt>Type</dt><dd>{typeBadge(ticket.type)}</dd>
        <dt>Impact / urgency</dt><dd>{labels[ticket.impact]} / {labels[ticket.urgency]}</dd>
        {ticket.labels.length > 0 && <><dt>Labels</dt><dd className="label-row">{ticket.labels.map((l) => <span key={l} className="label-chip">{l}</span>)}</dd></>}
        {due && <><dt>Due</dt><dd className={due.overdue ? 'text-danger' : ''}>{when(ticket.dueAt)} · {due.text}</dd></>}
      </dl>
    );
  return (
    <div className="classification">
      <label>Type
        <select aria-label="Ticket type" value={ticket.type} disabled={busy} onChange={(e) => save({ type: e.target.value }, 'Type updated.')}>
          {ticketTypes.map((t) => <option key={t} value={t}>{labels[t]}</option>)}
        </select>
      </label>
      <div className="two-grid">
        <label>Impact
          <select aria-label="Impact" value={impact} disabled={busy} onChange={(e) => { setImpact(e.target.value as typeof impact); save({ impact: e.target.value }, `Impact updated; priority is now ${labels[priorityFor(e.target.value as typeof impact, urgency)]}.`); }}>
            {impacts.map((i) => <option key={i} value={i}>{labels[i]}</option>)}
          </select>
        </label>
        <label>Urgency
          <select aria-label="Urgency" value={urgency} disabled={busy} onChange={(e) => { setUrgency(e.target.value as typeof urgency); save({ urgency: e.target.value }, `Urgency updated; priority is now ${labels[priorityFor(impact, e.target.value as typeof urgency)]}.`); }}>
            {impacts.map((i) => <option key={i} value={i}>{labels[i]}</option>)}
          </select>
        </label>
      </div>
      <p className="muted fine">Matrix suggests <strong>{labels[priorityFor(impact, urgency)]}</strong>; the priority field can still override it.</p>
      <label>Due date
        <input type="datetime-local" aria-label="Due date" disabled={busy} defaultValue={ticket.dueAt ? new Date(ticket.dueAt).toISOString().slice(0, 16) : ''} onBlur={(e) => { const v = e.target.value; const iso = v ? new Date(v).toISOString() : null; if (iso !== ticket.dueAt) save({ dueAt: iso }, iso ? 'Due date set.' : 'Due date cleared.'); }} />
      </label>
      {due && <p className={`muted fine ${due.overdue ? 'text-danger' : ''}`}>{due.text}</p>}
      <label>Labels
        <div className="label-row">
          {ticket.labels.map((l) => <span key={l} className="label-chip">{l}<button type="button" aria-label={`Remove label ${l}`} disabled={busy} onClick={() => save({ labels: ticket.labels.filter((x) => x !== l) }, 'Label removed.')}>×</button></span>)}
          <input aria-label="Add label" placeholder="add label ↵" value={labelInput} maxLength={30} disabled={busy || ticket.labels.length >= 10} onChange={(e) => setLabelInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && labelInput.trim()) { e.preventDefault(); const l = labelInput.trim().toLowerCase(); if (!ticket.labels.includes(l)) save({ labels: [...ticket.labels, l] }, 'Label added.'); setLabelInput(''); } }} />
        </div>
      </label>
    </div>
  );
}

/* ── Watchers ─────────────────────────────────────────────────────────── */

export function Watchers({ ticket, user, act, busy }: { ticket: Ticket; user: CurrentUser; act: Act; busy: boolean }) {
  const [adding, setAdding] = useState('');
  const staff = user.role !== 'EMPLOYEE';
  const { data: candidates } = useRecord<Person[]>(adding.length >= 2 ? `/tickets/${ticket.id}/mentionable?q=${encodeURIComponent(adding)}` : '/categories');
  return (
    <section className="panel">
      <div className="panel-head"><h2>Followers</h2><span className="muted">{ticket.watchers?.length ?? 0}</span></div>
      <div className="avatar-row">{ticket.watchers?.map((w) => <Avatar key={w.id} name={w.name} />)}</div>
      <button disabled={busy} onClick={() => void act(async () => { await api(`/tickets/${ticket.id}/watch`, ticket.watching ? 'DELETE' : 'POST', ticket.watching ? undefined : {}); }, ticket.watching ? 'You stopped following this ticket.' : 'You are following this ticket.')}>{ticket.watching ? 'Unfollow' : 'Follow'}</button>
      {staff && (
        <div className="picker">
          <input aria-label="Add a follower" placeholder="Add a colleague…" value={adding} onChange={(e) => setAdding(e.target.value)} />
          {adding.length >= 2 && Array.isArray(candidates) && candidates.length > 0 && 'role' in candidates[0] && (
            <ul className="picker-list">{(candidates as Person[]).filter((c) => !ticket.watchers?.some((w) => w.id === c.id)).map((c) => <li key={c.id}><button type="button" disabled={busy} onClick={() => { setAdding(''); void act(async () => { await api(`/tickets/${ticket.id}/watchers`, 'POST', { userId: c.id }); }, `${c.name} now follows this ticket.`); }}><Avatar name={c.name} size={22} /> {c.name}</button></li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Attachments ──────────────────────────────────────────────────────── */

export function Attachments({ ticket, user, act, busy }: { ticket: Ticket; user: CurrentUser; act: Act; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const closed = ticket.status === 'CLOSED';
  const send = (file: File) => void act(async () => {
    const body = new FormData();
    body.append('file', file);
    const r = await fetch(`/api/tickets/${ticket.id}/attachments`, { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken }, body });
    if (!r.ok) throw new Error((await r.json()).error ?? 'Upload failed');
  }, `${file.name} attached.`);
  return (
    <section className={`panel attachments ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f && !closed) send(f); }}>
      <div className="panel-head"><h2>Attachments</h2><span className="muted">{ticket.attachments?.length ?? 0}</span></div>
      {ticket.attachments?.length ? (
        <ul className="attachment-list">{ticket.attachments.map((a: Attachment) => (
          <li key={a.id}>
            <a href={`/api/tickets/${ticket.id}/attachments/${a.id}`} download={a.filename}>{a.filename}</a>
            <small>{fileSize(a.size)} · {a.uploader.name} · {when(a.createdAt)}</small>
            {(a.uploader.id === user.id || user.role === 'ADMIN') && <button aria-label={`Remove ${a.filename}`} disabled={busy} onClick={() => void act(async () => { await api(`/tickets/${ticket.id}/attachments/${a.id}`, 'DELETE'); }, 'Attachment removed.')}>×</button>}
          </li>))}</ul>
      ) : <p className="muted fine">No files yet.</p>}
      {!closed && (
        <>
          <input ref={input} type="file" hidden aria-label="Choose a file" onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ''; }} />
          <button disabled={busy} onClick={() => input.current?.click()}>Attach a file</button>
          <p className="muted fine">Drop a file here or choose one. Images, PDF, text, CSV, docx, xlsx, zip — up to 10 MB. Files always download; nothing runs in the browser.</p>
        </>
      )}
    </section>
  );
}

/* ── Approvals ────────────────────────────────────────────────────────── */

export function ApprovalsPanel({ ticket, user, act, busy }: { ticket: Ticket; user: CurrentUser; act: Act; busy: boolean }) {
  if (!ticket.approvals?.length) return null;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Approval</h2></div>
      {ticket.approvals.map((a) => (
        <div key={a.id} className="approval-row">
          <div className="flex"><Avatar name={a.approver.name} /><div><strong>{a.approver.name}</strong><small>{a.status === 'PENDING' ? `Requested ${when(a.createdAt)}` : `${labels[a.status]} ${when(a.decidedAt)}`}</small></div></div>
          <span className={`badge ${a.status === 'APPROVED' ? 'resolved' : a.status === 'REJECTED' ? 'high' : 'waiting_for_user'}`}>{labels[a.status]}</span>
          {a.note && <p className="muted">{a.note}</p>}
          {a.status === 'PENDING' && (a.approver.id === user.id || user.role === 'ADMIN') && (
            <form className="inline-form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const decision = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value'); void act(async () => { await api(`/tickets/${ticket.id}/approvals/${a.id}/decide`, 'POST', { decision, note: f.get('note') || undefined }); }, decision === 'APPROVED' ? 'Request approved.' : 'Request rejected.'); }}>
              <input name="note" aria-label="Approval note" placeholder="Optional note" maxLength={500} />
              <button className="primary" disabled={busy} value="APPROVED">Approve</button>
              <button className="danger" disabled={busy} value="REJECTED">Reject</button>
            </form>
          )}
        </div>
      ))}
    </section>
  );
}

/* ── Satisfaction ─────────────────────────────────────────────────────── */

export function CsatPrompt({ ticket, user, act, busy }: { ticket: Ticket; user: CurrentUser; act: Act; busy: boolean }) {
  const [score, setScore] = useState(0);
  if (ticket.requesterId !== user.id || !['RESOLVED', 'CLOSED'].includes(ticket.status)) return null;
  if (ticket.survey) return <section className="panel csat"><div className="panel-head"><h2>Your rating</h2></div><p><span className="stars">{'★'.repeat(ticket.survey.score)}{'☆'.repeat(5 - ticket.survey.score)}</span> {ticket.survey.comment && <span className="muted">— {ticket.survey.comment}</span>}</p><p className="muted fine">Thank you. Ratings feed the support team's reports.</p></section>;
  return (
    <section className="panel csat">
      <div className="panel-head"><h2>How did we do?</h2></div>
      <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void act(async () => { await api(`/tickets/${ticket.id}/survey`, 'POST', { score, comment: (f.get('comment') as string) || undefined }); }, 'Thanks for the feedback.'); }}>
        <div className="stars" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} role="radio" aria-checked={score === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= score ? 'on' : ''} onClick={() => setScore(n)}>★</button>)}</div>
        <textarea name="comment" aria-label="Comment" rows={2} maxLength={1000} placeholder="Anything we should know? (optional)" />
        <button className="primary" disabled={busy || !score}>Send rating</button>
      </form>
    </section>
  );
}

/* ── Requester card ───────────────────────────────────────────────────── */

export function RequesterCard({ ticket }: { ticket: Ticket }) {
  const p = ticket.requesterProfile;
  if (!p) return null;
  return (
    <section className="panel requester-card">
      <div className="flex"><Avatar name={p.name} size={40} /><div><strong><a href={`#/people/${p.id}`}>{p.name}</a></strong><small>{p.title ?? labels[p.role]}{p.department ? ` · ${p.department.name}` : ''}</small></div></div>
      <dl className="properties compact">
        <dt>Email</dt><dd><a href={`mailto:${p.email}`}>{p.email}</a></dd>
        {p.phone && <><dt>Phone</dt><dd>{p.phone}</dd></>}
        {p.location && <><dt>Location</dt><dd>{p.location}</dd></>}
        {p.manager && <><dt>Manager</dt><dd><a href={`#/people/${p.manager.id}`}>{p.manager.name}</a></dd></>}
      </dl>
    </section>
  );
}

/* ── Activity stream ──────────────────────────────────────────────────── */

export function ActivityStream({ ticketId, refresh }: { ticketId: string; refresh: number }) {
  const { data, error } = useRecord<ActivityItem[]>(`/tickets/${ticketId}/activity`, refresh);
  const [open, setOpen] = useState(false);
  return (
    <section className="panel activity">
      <div className="panel-head"><h2>Activity</h2><button className="text-btn" onClick={() => setOpen(!open)}>{open ? 'Hide' : `Show ${data?.length ?? ''}`}</button></div>
      {open && (!data ? <Pending error={error} /> : (
        <ol className="activity-list">{data.map((a) => (
          <li key={`${a.kind}-${a.id}`} className={a.kind}>
            <span className="dot" />
            <div><strong>{a.actor?.name ?? 'System'}</strong> <span className="muted">{a.title}</span>{a.internal && a.kind !== 'note' ? <small className="internal-tag">internal</small> : null}<small>{when(a.at)}</small>{a.body && a.kind === 'note' && <p className="activity-body">{a.body}</p>}</div>
          </li>))}</ol>
      ))}
    </section>
  );
}

/* ── Mentions ─────────────────────────────────────────────────────────── */

/** A textarea that offers colleagues when the person types "@". Inserts "@Full Name". */
export function MentionTextarea({ ticketId, value, onChange, ...rest }: { ticketId: string; value: string; onChange: (v: string) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const [query, setQuery] = useState<string | null>(null);
  const [options, setOptions] = useState<Person[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (query === null) { setOptions([]); return; }
    let live = true;
    void api<Person[]>(`/tickets/${ticketId}/mentionable?q=${encodeURIComponent(query)}`).then((o) => { if (live) setOptions(o); }).catch(() => {});
    return () => { live = false; };
  }, [query, ticketId]);
  const detect = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}\p{N} .'-]{0,40})$/u);
    setQuery(m ? m[1] : null);
  };
  const insert = (p: Person) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@[\p{L}\p{N} .'-]{0,40}$/u, `@${p.name} `);
    onChange(before + value.slice(caret));
    setQuery(null);
    el?.focus();
  };
  return (
    <div className="mention-wrap">
      <textarea ref={ref} {...rest} value={value} onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }} onKeyDown={(e) => { if (e.key === 'Escape') setQuery(null); if (e.key === 'Enter' && query !== null && options[0]) { e.preventDefault(); insert(options[0]); return; } rest.onKeyDown?.(e); }} />
      {query !== null && options.length > 0 && <ul className="picker-list mention-list" role="listbox">{options.map((p) => <li key={p.id}><button type="button" onClick={() => insert(p)}><Avatar name={p.name} size={22} /> {p.name} <small>{labels[p.role]}</small></button></li>)}</ul>}
    </div>
  );
}

/** Renders a reply body with @mentions highlighted. */
export function MentionText({ body, mentions }: { body: string; mentions?: Person[] }) {
  if (!mentions?.length) return <p>{body}</p>;
  const names = mentions.map((m) => m.name).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const parts = body.split(pattern);
  return <p>{parts.map((part, i) => (i % 2 === 1 ? <span key={i} className="mention">@{part}</span> : part))}</p>;
}
