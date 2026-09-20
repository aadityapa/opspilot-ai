import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { AssetPicker, EventsTimeline, InternalNoteForm, InternalNotes, Pending, useRecord, when, type Act } from './operations';
import { labels, priorities, transitions, type ActivityItem, type Attachment, type CurrentUser, type Person, type Ticket } from '../shared/model';
import { AiTicketPanel } from './ai';
import { SuggestedArticles } from './catalog';
import { searchTerms } from '../shared/search';
import { ApprovalsPanel, Attachments, CsatPrompt, MentionText, MentionTextarea, TicketClassification, Watchers } from './ticket-extras';
import { Icon } from './ui/icons';
import { Avatar, Menu, Modal, fmtAgo, ticketKey, toast } from './ui';
import { PRIORITY_CODE, PRIORITY_WORD, PriorityMark, STATUS_WORD, SlaMark, StatusMark, slaSummary } from './ui/marks';
import { deskReturnHref } from './nav-state';

type Category = { id: string; name: string };
const hm = (ms: number) => { const t = Math.max(0, Math.round(ms / 60000)); const d = Math.floor(t / 1440), h = Math.floor((t % 1440) / 60), m = t % 60; return d ? `${d}d ${h}h` : h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; };
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * The ticket workspace: CONTEXT (left) · WORKSPACE (centre) · INTELLIGENCE (right). Every control
 * that changes data goes through the same endpoints as before; the layout only decides where the
 * existing capabilities live and how quickly an engineer can reach them.
 */
export function TicketWorkspace({ id, user, refresh, busy, act, route }: { id: string; user: CurrentUser; refresh: number; busy: boolean; act: Act; route: string }) {
  const { data: t, error } = useRecord<Ticket>(`/tickets/${id}`, refresh);
  const { data: categories } = useRecord<Category[]>('/categories');
  const staff = user.role !== 'EMPLOYEE';
  const { data: engineers } = useRecord<Person[]>(staff ? '/engineers' : '/categories');
  const [tab, setTab] = useState<'conversation' | 'activity'>('conversation');
  const [composer, setComposer] = useState<'reply' | 'note'>(() => (new URLSearchParams(route.split('?')[1] ?? '').get('compose') === 'note' ? 'note' : 'reply'));
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [resolving, setResolving] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [intelOpen, setIntelOpen] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (composer === 'note') setTimeout(() => document.getElementById('internal-note')?.focus(), 50); }, [composer]);

  if (error) return <div className="alert error" role="alert">{error} <a className="btn-sm btn" href={deskReturnHref()}>Back to queue</a></div>;
  if (!t) return <WorkspaceSkeleton />;
  const closed = ['RESOLVED', 'CLOSED'].includes(t.status);
  const sla = slaSummary(t.sla, t.status);
  const change = (patch: Record<string, unknown>, message: string) => void act(async () => { await api(`/tickets/${id}`, 'PATCH', { ...patch, version: t.version }); }, message);
  const sendReply = () => { if (!reply.trim()) return; void act(async () => { await api(`/tickets/${id}/replies`, 'POST', { body: reply }); setReply(''); }, 'Reply sent.'); };
  const canResolve = staff && !closed && transitions[t.status].includes('RESOLVED');
  const replies = t.replies ?? [];

  return (
    <div className="tw">
      <div className="tw-return"><a className="back-link" href={deskReturnHref()}><Icon name="arrowLeft" size={14} />Back to queue</a><span className="muted t-caption">Your filters, sort and page are preserved</span></div>

      <header className="tw-head">
        <div className="tw-head-main">
          <p className="tw-eyebrow"><span className={`type-word ${t.type.toLowerCase()}`}>{labels[t.type]}</span><span className="sep">·</span><span className="mono-id">{ticketKey(t)}</span>{t.catalogItem && <><span className="sep">·</span><span>{t.catalogItem.name}</span></>}</p>
          <h1>{t.title}</h1>
          <p className="tw-sub"><a href={`#/tickets?categoryId=${t.categoryId}`}>{t.category.name}</a><span className="sep">·</span>{t.requesterProfile ? <a href={`#/people/${t.requester.id}`}>{t.requester.name}</a> : <span>{t.requester.name}</span>}{t.requesterProfile?.department && <span className="muted"> · {t.requesterProfile.department.name}</span>}<span className="sep">·</span><span className="muted">opened {fmtAgo(t.createdAt)}</span></p>
          <div className="tw-marks">
            <PriorityMark value={t.priority} />
            <StatusMark value={t.status} />
            <SlaMark sla={t.sla} status={t.status} />
            {t.assignee ? <span className="person"><Avatar name={t.assignee.name} size={20} />{t.assignee.name}</span> : <span className="unowned">Unassigned</span>}
          </div>
        </div>
        <div className="tw-actions">
          {staff && !closed && (
            <>
              <Menu label="Assign" align="right" trigger={(open) => <button aria-haspopup="menu" aria-expanded={open}><Icon name="user" size={15} />Assign</button>}>
                <button data-active={!t.assigneeId} onClick={() => change({ assigneeId: null }, 'Ticket unassigned.')}>Unassigned</button>
                {engineers?.map((p) => <button key={p.id} data-active={t.assigneeId === p.id} onClick={() => change({ assigneeId: p.id }, `Assigned to ${p.name}.`)}>{p.name}{p.id === user.id ? ' (me)' : ''}</button>)}
              </Menu>
              <Menu label="Change status" align="right" trigger={(open) => <button aria-haspopup="menu" aria-expanded={open}><Icon name="refresh" size={15} />Change status</button>}>
                {transitions[t.status].filter((s) => s !== 'RESOLVED').map((s) => <button key={s} onClick={() => change({ status: s }, `Moved to ${labels[s]}.`)}>{STATUS_WORD[s]}</button>)}
                {transitions[t.status].includes('RESOLVED') && <button onClick={() => setResolving(true)}>Resolve…</button>}
              </Menu>
              <button className="primary" disabled={!canResolve} title={canResolve ? 'Resolve with a summary for the requester' : `Cannot resolve from ${STATUS_WORD[t.status]}`} onClick={() => setResolving(true)}><Icon name="check" size={15} />Resolve</button>
            </>
          )}
          {closed && <button disabled={busy} onClick={() => void act(async () => { await api(`/tickets/${id}/reopen`, 'POST', {}); }, 'Ticket reopened.')}><Icon name="refresh" size={15} />Reopen ticket</button>}
          <Menu label="More ticket actions" align="right" trigger={(open) => <button className="icon-btn" aria-label="More ticket actions" aria-haspopup="menu" aria-expanded={open}><Icon name="more" /></button>}>
            <button onClick={() => { void navigator.clipboard?.writeText(ticketKey(t)); toast('info', `${ticketKey(t)} copied.`); }}>Copy key</button>
            <button onClick={() => { void navigator.clipboard?.writeText(location.href); toast('info', 'Link copied.'); }}>Copy link</button>
            <button onClick={() => void act(async () => { await api(`/tickets/${id}/watch`, t.watching ? 'DELETE' : 'POST', t.watching ? undefined : {}); }, t.watching ? 'You stopped following this ticket.' : 'You are following this ticket.')}>{t.watching ? 'Unfollow' : 'Follow'}</button>
            <a href="#/board">Open the board</a>
          </Menu>
          <button className="icon-btn tw-toggle" aria-label="Toggle context panel" aria-pressed={contextOpen} onClick={() => setContextOpen(!contextOpen)}><Icon name="sliders" /></button>
          <button className="icon-btn tw-toggle" aria-label="Toggle intelligence panel" aria-pressed={intelOpen} onClick={() => setIntelOpen(!intelOpen)}><Icon name="spark" /></button>
        </div>
      </header>

      {closed && (
        <div className={`resolved-band ${sla.tone === 'breach' ? 'breach' : ''}`} role="status">
          <span className="rb-title"><Icon name="check" size={16} />{STATUS_WORD[t.status]}</span>
          {t.resolvedAt && <span><small>Resolved</small><strong>{when(t.resolvedAt)}</strong></span>}
          {t.resolvedAt && <span><small>Resolution time</small><strong>{hm(new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime())}</strong></span>}
          <span><small>SLA</small><strong className={sla.tone === 'breach' ? 'crit-text' : 'ok-text'}>{t.sla ? (sla.tone === 'breach' ? 'Breached' : 'Met') : 'No SLA'}</strong></span>
          <span><small>CSAT</small><strong>{t.survey ? `${t.survey.score} / 5` : 'Awaiting rating'}</strong></span>
        </div>
      )}

      <div className={`tw-grid ${contextOpen ? 'context-open' : ''} ${intelOpen ? 'intel-open' : ''}`}>
        {/* ── CONTEXT ─────────────────────────────────────────────────── */}
        <aside className="tw-context" aria-label="Ticket context">
          <ContextPanel t={t} user={user} act={act} busy={busy} categories={categories ?? []} engineers={engineers ?? []} />
          <RequesterPanel t={t} staff={staff} />
        </aside>

        {/* ── WORKSPACE ───────────────────────────────────────────────── */}
        <main className="tw-center" aria-label="Ticket workspace">
          <section className="description-block">
            <div className="section-title"><h2>Description</h2><span className="muted t-caption">{t.requester.name} · {when(t.createdAt)}</span></div>
            <p className="description">{t.description}</p>
            {t.formData && Object.keys(t.formData).length > 0 && (
              <dl className="properties compact form-answers">
                {Object.entries(t.formData).map(([k, v]) => <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</dd></div>)}
              </dl>
            )}
            <AttachmentsInline t={t} user={user} act={act} busy={busy} />
          </section>

          <CsatPrompt ticket={t} user={user} act={act} busy={busy} />

          <div className="tabs tw-tabs" role="tablist" aria-label="Workspace">
            <button role="tab" aria-selected={tab === 'conversation'} className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}>Conversation<span className="count">{replies.length}</span></button>
            <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>Activity</button>
          </div>

          {tab === 'conversation' ? (
            <>
              <section className="conversation" aria-label="Conversation">
                {replies.length ? (
                  <ol className="thread">
                    {replies.map((r) => (
                      <li className="msg reply" key={r.id}>
                        <Avatar name={r.author.name} size={32} />
                        <div className="msg-body">
                          <div className="msg-head"><strong>{r.author.name}</strong><span className="muted">{r.author.id === t.requesterId ? 'Requester' : labels[r.author.role]} · {clock(r.createdAt)} · {new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{r.editedAt ? ' · edited' : ''}</span>
                            {r.author.id === user.id && !closed && editing !== r.id && <button className="msg-edit" onClick={() => { setEditing(r.id); setEditText(r.body); }}>Edit</button>}
                          </div>
                          {editing === r.id ? (
                            <form className="composer-form" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api(`/tickets/${id}/replies/${r.id}`, 'PATCH', { body: editText }); setEditing(null); }, 'Reply updated.'); }}>
                              <textarea aria-label="Edit reply" value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} maxLength={10000} required />
                              <div className="composer-actions"><button type="button" className="text-btn" onClick={() => setEditing(null)}>Cancel</button><span className="grow" /><button className="primary" disabled={busy}>Save</button></div>
                            </form>
                          ) : <div className="msg-text"><MentionText body={r.body} mentions={r.mentions} /></div>}
                          {r.attachments && r.attachments.length > 0 && <ul className="msg-files">{r.attachments.map((a: Attachment) => <li key={a.id}><a href={`/api/tickets/${t.id}/attachments/${a.id}`} download={a.filename}><Icon name="paperclip" size={12} />{a.filename}</a></li>)}</ul>}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : <p className="thread-empty">No replies yet. {closed ? 'This ticket is finished.' : 'Start the conversation below.'}</p>}
              </section>

              {staff && <InternalNotes ticketId={id} refresh={refresh} />}

              {closed ? (
                <div className="composer closed-note"><Icon name="lock" size={14} />This ticket is {STATUS_WORD[t.status].toLowerCase()}. Use <strong>Reopen ticket</strong> above if you need more help.</div>
              ) : (
                <section className={`composer ${composer}`} aria-label="Composer">
                  {staff && (
                    <div className="composer-tabs" role="tablist" aria-label="Composer mode">
                      <button role="tab" aria-selected={composer === 'reply'} className={composer === 'reply' ? 'active' : ''} onClick={() => setComposer('reply')}><Icon name="message" size={14} />Reply</button>
                      <button role="tab" aria-selected={composer === 'note'} className={composer === 'note' ? 'active' : ''} onClick={() => setComposer('note')}><Icon name="lock" size={14} />Internal note</button>
                    </div>
                  )}
                  {composer === 'reply' || !staff ? (
                    <form className="composer-form" onSubmit={(e) => { e.preventDefault(); sendReply(); }}>
                      <label>
                        <span className="sr-only">Public reply</span>
                        {/* Explicit aria-label: a wrapping <label> would otherwise absorb the textarea's own value into its accessible name. */}
                        <MentionTextarea ticketId={id} id="public-reply" aria-label="Public reply" required maxLength={10000} rows={4} value={reply} onChange={setReply} placeholder={staff ? 'Write a reply to the requester… type @ to mention a colleague' : 'Write a reply…'}
                          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendReply(); } }} />
                      </label>
                      <div className="composer-actions">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => { setReply((v) => (v ? `${v} @` : '@')); document.getElementById('public-reply')?.focus(); }}><Icon name="user" size={14} />Mention</button>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => document.querySelector<HTMLInputElement>('input[aria-label="Choose a file"]')?.click()}><Icon name="paperclip" size={14} />Attach</button>
                        {staff && <button type="button" className="btn-ghost btn-sm" onClick={() => { setIntelOpen(true); document.getElementById('suggested-knowledge')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><Icon name="book" size={14} />Knowledge</button>}
                        {staff && <button type="button" className="btn-ghost btn-sm ai-word" onClick={() => { setIntelOpen(true); document.querySelector('.ai-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><Icon name="spark" size={14} />AI assist</button>}
                        <span className="grow" />
                        <span className="muted fine">Visible to the requester · Ctrl+Enter</span>
                        <button disabled={busy || !reply.trim()} className="primary">{busy ? 'Sending…' : 'Send reply'}<Icon name="arrow" size={14} /></button>
                      </div>
                    </form>
                  ) : <InternalNoteForm ticketId={id} act={act} busy={busy} />}
                </section>
              )}
            </>
          ) : (
            <>
              <ActivityFeed ticketId={id} refresh={refresh} />
              {staff && <EventsTimeline ticketId={id} refresh={refresh} />}
            </>
          )}
        </main>

        {/* ── INTELLIGENCE ────────────────────────────────────────────── */}
        <aside className="tw-intel" aria-label="Ticket intelligence">
          <SlaPanel t={t} />
          {staff && <div className="intel-ai"><p className="eyebrow intel-eyebrow"><Icon name="spark" size={12} />Ask OpsPilot · {ticketKey(t)}</p><AiTicketPanel ticket={t} user={user} act={act} refresh={refresh} onDraft={(text) => { setComposer('reply'); setReply(text); setTab('conversation'); setTimeout(() => document.getElementById('public-reply')?.focus(), 50); }} /></div>}
          <section className="intel-section" id="suggested-knowledge"><p className="eyebrow">Suggested knowledge</p><SuggestedArticles text={`${t.title} ${t.description}`} /><KnowledgeFallback title={t.title} description={t.description} /></section>
          {staff && <RelatedWork t={t} />}
          <Watchers ticket={t} user={user} act={act} busy={busy} />
          <ApprovalsPanel ticket={t} user={user} act={act} busy={busy} />
        </aside>
      </div>
      {(contextOpen || intelOpen) && <div className="tw-scrim" onClick={() => { setContextOpen(false); setIntelOpen(false); }} aria-hidden="true" />}

      {resolving && <ResolveDialog t={t} busy={busy} onClose={() => setResolving(false)} onResolve={(summary) => {
        setResolving(false);
        void act(async () => {
          if (summary.trim()) await api(`/tickets/${id}/replies`, 'POST', { body: summary.trim() });
          const fresh = await api<Ticket>(`/tickets/${id}`);
          await api(`/tickets/${id}`, 'PATCH', { status: 'RESOLVED', version: fresh.version });
        }, `${ticketKey(t)} resolved.`);
      }} />}
    </div>
  );
}

/* ── Context panel (left) ─────────────────────────────────────────────── */
/**
 * Ticket properties. The form is re-seeded when the ticket's own properties change on the server,
 * not on every version bump: a colleague's reply also increments the version, and remounting on
 * that silently threw away whatever the engineer had just selected. The save still carries
 * `t.version`, so a genuine concurrent edit is still rejected rather than overwritten.
 */
function ContextPanel({ t, user, act, busy, categories, engineers }: { t: Ticket; user: CurrentUser; act: Act; busy: boolean; categories: Category[]; engineers: Person[] }) {
  const staff = user.role !== 'EMPLOYEE';
  const due = t.dueAt ? new Date(t.dueAt) : null;
  return (
    <section className="ctx" aria-labelledby="ctx-h">
      <p className="eyebrow" id="ctx-h">Properties</p>
      {staff ? (
        <form className="ctx-form" key={`${t.id}-${t.status}-${t.assigneeId ?? ''}-${t.priority}-${t.categoryId}-${t.assetId ?? ''}`} onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          void act(async () => { await api(`/tickets/${t.id}`, 'PATCH', { ...f, assigneeId: f.assigneeId || null, assetId: f.assetId || null, version: t.version }); }, 'Ticket updated.');
        }}>
          <label>Status<select aria-label="Status" name="status" defaultValue={t.status}>{[t.status, ...transitions[t.status]].map((s) => <option key={s} value={s}>{labels[s]}</option>)}</select></label>
          <label>Assignee<select aria-label="Assignee" name="assigneeId" defaultValue={t.assigneeId ?? ''}><option value="">Unassigned</option>{engineers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Priority<select aria-label="Priority" name="priority" defaultValue={t.priority}>{priorities.map((p) => <option key={p} value={p}>{PRIORITY_CODE[p]} {PRIORITY_WORD[p]}</option>)}</select></label>
          <label>Category<select aria-label="Category" name="categoryId" defaultValue={t.categoryId}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <AssetPicker current={t.asset} />
          <button className="primary" disabled={busy}>Save changes</button>
        </form>
      ) : (
        <dl className="ctx-list">
          <div><dt>Status</dt><dd><StatusMark value={t.status} /></dd></div>
          <div><dt>Assigned to</dt><dd>{t.assignee?.name ?? 'Awaiting assignment'}</dd></div>
          <div><dt>Category</dt><dd>{t.category.name}</dd></div>
          <div><dt>Priority</dt><dd><PriorityMark value={t.priority} /></dd></div>
          <div><dt>Type</dt><dd>{labels[t.type]}</dd></div>
          {t.asset && <div><dt>Asset</dt><dd><a href={`#/assets/${t.asset.id}`}>{t.asset.tag}</a></dd></div>}
        </dl>
      )}
      <div className="ctx-class"><TicketClassification ticket={t} act={act} busy={busy} editable={staff} /></div>
      <dl className="ctx-list ctx-meta">
        {t.asset && <div><dt>Linked asset</dt><dd><a href={`#/assets/${t.asset.id}`}>Linked asset: {t.asset.tag}</a></dd></div>}
        {due && <div><dt>Due</dt><dd className={due.getTime() < Date.now() && !['RESOLVED', 'CLOSED'].includes(t.status) ? 'crit-text' : ''}>{when(t.dueAt)}</dd></div>}
        <div><dt>Created</dt><dd>{when(t.createdAt)}</dd></div>
        <div><dt>Updated</dt><dd>{when(t.updatedAt)}</dd></div>
        {t.resolvedAt && <div><dt>Resolved</dt><dd>{when(t.resolvedAt)}</dd></div>}
      </dl>
    </section>
  );
}

function RequesterPanel({ t, staff }: { t: Ticket; staff: boolean }) {
  const p = t.requesterProfile;
  if (!p) return null;
  return (
    <section className="ctx requester" aria-labelledby="req-h">
      <p className="eyebrow" id="req-h">Requester</p>
      <a className="req-card" href={`#/people/${p.id}`}>
        <Avatar name={p.name} size={36} />
        <span><strong>{p.name}</strong><small>{p.title ?? labels[p.role]}</small></span>
      </a>
      <dl className="ctx-list">
        <div><dt>Email</dt><dd><a href={`mailto:${p.email}`}>{p.email}</a></dd></div>
        {p.phone && <div><dt>Phone</dt><dd>{p.phone}</dd></div>}
        {p.location && <div><dt>Location</dt><dd>{p.location}</dd></div>}
        {p.department && <div><dt>Department</dt><dd><a href={`#/departments/${p.department.id}`}>{p.department.name}</a></dd></div>}
        {p.manager && <div><dt>Manager</dt><dd><a href={`#/people/${p.manager.id}`}>{p.manager.name}</a></dd></div>}
      </dl>
      {staff && <a className="ctx-link" href={`#/tickets?q=${encodeURIComponent(p.name)}`}>Their other tickets →</a>}
    </section>
  );
}

/* ── Attachments inline (secure downloads, no preview) ────────────────── */
function AttachmentsInline({ t, user, act, busy }: { t: Ticket; user: CurrentUser; act: Act; busy: boolean }) {
  return <div className="attachments-inline"><Attachments ticket={t} user={user} act={act} busy={busy} /></div>;
}

/* ── Activity ─────────────────────────────────────────────────────────── */
function ActivityFeed({ ticketId, refresh }: { ticketId: string; refresh: number }) {
  const { data, error } = useRecord<ActivityItem[]>(`/tickets/${ticketId}/activity`, refresh);
  return (
    <section className="activity-section" aria-labelledby="act-h">
      <div className="section-title"><h2 id="act-h">Activity</h2><span className="muted t-caption">Every visible change, oldest first</span></div>
      {!data ? <Pending error={error} /> : data.length ? (
        <ol className="sys-timeline">
          {data.map((a) => (
            <li key={`${a.kind}-${a.id}`} className={a.kind}>
              <time>{clock(a.at)}<small>{new Date(a.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></time>
              <span className="tl-mark" aria-hidden="true" />
              <span className="tl-body"><strong>{a.actor?.name ?? 'System'}</strong> <span>{a.title}</span>{a.internal && a.kind !== 'note' ? <em className="private-tag small">internal</em> : null}{a.body && a.kind === 'note' && <small>{a.body}</small>}</span>
            </li>
          ))}
        </ol>
      ) : <p className="muted t-sm">No activity recorded yet.</p>}
    </section>
  );
}

/* ── Intelligence ─────────────────────────────────────────────────────── */
function SlaPanel({ t }: { t: Ticket }) {
  const sla = t.sla;
  return (
    <section className="intel-section sla-panel" aria-labelledby="sla-h">
      <div className="section-title"><h2 id="sla-h">Service level</h2><span className="muted t-caption">24/7 clock</span></div>
      {!sla ? <p className="muted t-sm">No SLA policy applied to this ticket.</p> : (
        <>
          <SlaRow label="First response" state={sla.responseBreachAt ? 'breach' : sla.responseSatisfiedAt ? 'met' : sla.stopped ? 'paused' : sla.remainingResponseMs <= sla.responseMinutes * 60000 * 0.25 ? 'warn' : 'ok'}
            main={sla.responseBreachAt ? `Breached ${hm(Date.now() - new Date(sla.responseBreachAt).getTime())} ago` : sla.responseSatisfiedAt ? `Met in ${hm(new Date(sla.responseSatisfiedAt).getTime() - new Date(sla.startedAt).getTime())}` : sla.stopped ? 'Not measured · finished without a public reply' : `${hm(sla.remainingResponseMs)} remaining`}
            ratio={sla.responseSatisfiedAt || sla.responseBreachAt || sla.stopped ? null : sla.remainingResponseMs / (sla.responseMinutes * 60000)} target={`Target ${hm(sla.responseMinutes * 60000)}`} />
          <SlaRow label="Resolution" state={sla.resolutionBreachAt ? 'breach' : sla.stopped ? 'met' : sla.paused ? 'paused' : sla.remainingResolutionMs <= sla.resolutionMinutes * 60000 * 0.25 ? 'warn' : 'ok'}
            main={sla.resolutionBreachAt ? `Breached ${hm(Date.now() - new Date(sla.resolutionBreachAt).getTime())} ago` : sla.stopped ? `Met · ${hm(sla.elapsedMs)} used` : sla.paused ? `Paused · ${hm(sla.remainingResolutionMs)} left` : `${hm(sla.remainingResolutionMs)} remaining`}
            ratio={sla.stopped || sla.resolutionBreachAt ? null : sla.remainingResolutionMs / (sla.resolutionMinutes * 60000)} target={`Target ${hm(sla.resolutionMinutes * 60000)}`} />
          <p className="muted fine">Policy snapshot taken when this ticket started: {sla.responseMinutes} minute first response, {sla.resolutionMinutes} minute resolution at {labels[sla.priority] ?? sla.priority} priority. Resolution time pauses while the ticket is waiting for the requester.{sla.legacyBackfill ? ' This ticket predates SLA tracking.' : ''}</p>
        </>
      )}
    </section>
  );
}
function SlaRow({ label, state, main, ratio, target }: { label: string; state: 'ok' | 'warn' | 'breach' | 'met' | 'paused'; main: string; ratio: number | null; target: string }) {
  const word = state === 'breach' ? 'BREACHED' : state === 'warn' ? 'AT RISK' : state === 'met' ? 'MET' : state === 'paused' ? 'PAUSED' : 'ON TRACK';
  return (
    <div className={`sla-row2 ${state}`}>
      <div className="flex between"><span>{label}</span><span className="sla-state">{word}</span></div>
      <strong>{main}</strong>
      {ratio !== null && <span className="sla-track"><i style={{ width: `${Math.max(3, Math.min(100, ratio * 100))}%` }} /></span>}
      <small className="muted">{target}</small>
    </div>
  );
}

function KnowledgeFallback({ title, description }: { title: string; description: string }) {
  const terms = searchTerms(`${title} ${description}`);
  return <p className="muted t-caption">Matched from the knowledge base by the ticket's own words{terms.length ? '' : ' — nothing to match yet'}. <a href="#/knowledge">Browse all articles →</a></p>;
}

function RelatedWork({ t }: { t: Ticket }) {
  const { data } = useRecord<{ items: Ticket[]; total: number }>(`/tickets?requesterId=${t.requesterId}&pageSize=6&sort=updated`);
  const others = (data?.items ?? []).filter((x) => x.id !== t.id).slice(0, 5);
  return (
    <section className="intel-section" aria-labelledby="rel-h">
      <div className="section-title"><h2 id="rel-h">Related work</h2><span className="muted t-caption">Same requester</span></div>
      {!data ? <p className="muted t-sm">Loading…</p> : others.length ? (
        <ul className="related-list">{others.map((x) => <li key={x.id}><a href={`#/tickets/${x.id}`}><span className="mono-id">{ticketKey(x)}</span><span className="truncate">{x.title}</span><small>{STATUS_WORD[x.status]} · {fmtAgo(x.updatedAt)}</small></a></li>)}</ul>
      ) : <p className="muted t-sm">No other tickets from this requester.</p>}
    </section>
  );
}

/* ── Resolve dialog ───────────────────────────────────────────────────── */
function ResolveDialog({ t, busy, onClose, onResolve }: { t: Ticket; busy: boolean; onClose: () => void; onResolve: (summary: string) => void }) {
  const [summary, setSummary] = useState('');
  return (
    <Modal title={`Resolve ${ticketKey(t)}`} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || summary.trim().length < 10} onClick={() => onResolve(summary)}><Icon name="check" size={15} />Resolve ticket</button></>}>
      <p className="muted t-sm" style={{ marginBottom: 'var(--s3)' }}>The summary is sent to {t.requester.name} as a public reply, then the ticket moves to Resolved. The requester can reopen it or rate the outcome.</p>
      <label>Resolution summary <span className="req">*</span>
        <textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={10000} placeholder="What was the cause and what was done? This is customer-facing." autoFocus />
      </label>
      <p className="muted fine">At least 10 characters. Resolution codes are not recorded by this workspace, so none is asked for.</p>
    </Modal>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="tw" aria-busy="true" aria-label="Loading ticket">
      <div className="skeleton-surface" style={{ height: 88, marginBottom: 'var(--s4)' }} />
      <div className="tw-grid">
        <div className="skeleton-surface" style={{ height: 420 }} />
        <div><div className="skeleton-surface" style={{ height: 160, marginBottom: 'var(--s4)' }} /><div className="skeleton-surface" style={{ height: 320 }} /></div>
        <div className="skeleton-surface" style={{ height: 380 }} />
      </div>
    </div>
  );
}
