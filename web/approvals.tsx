import { useState } from 'react';
import { api } from './api';
import { useRecord, when, type Act } from './operations';
import { labels, type Approval, type CurrentUser } from '../shared/model';
import { Icon } from './ui/icons';
import { Avatar, EmptyState, Modal, Skeleton, Tabs, fmtAgo, ticketKey } from './ui';

type ApprovalRow = Approval & { ticket: { id: string; number: number; title: string; status: string; type: string; createdAt: string; formData: Record<string, unknown> | null; requester: { id: string; name: string; role: string }; catalogItem: { name: string; icon: string } | null } };

/**
 * Approval Center: business decisions, not tickets. Who, what, why, when, and what the decision
 * does — then a deliberate approve or reject. Uses only the approvals the caller is named on, the
 * approvals on their own requests, and the ticket's stored form answers.
 */
export function ApprovalsPage({ user, act, busy, refresh, route }: { user: CurrentUser; act: Act; busy: boolean; refresh: number; route: string }) {
  const q = new URLSearchParams(route.split('?')[1] ?? '');
  const tab = q.get('tab') ?? 'mine';
  const outcome = q.get('outcome') ?? '';
  const { data, error } = useRecord<ApprovalRow[]>('/approvals', refresh);
  const { data: requested } = useRecord<ApprovalRow[]>('/approvals?scope=requester', refresh);
  const [reviewing, setReviewing] = useState<ApprovalRow | null>(null);
  const [confirming, setConfirming] = useState<{ a: ApprovalRow; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<{ a: ApprovalRow; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!data) return <Skeleton rows={6} />;
  const pending = data.filter((a) => a.status === 'PENDING');
  const myRequests = (requested ?? []).filter((a) => a.status === 'PENDING');
  const completed = [...data.filter((a) => a.status !== 'PENDING'), ...(requested ?? []).filter((a) => a.status !== 'PENDING' && !data.some((d) => d.id === a.id))]
    .filter((a) => !outcome || a.status === outcome)
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
  const decide = (a: ApprovalRow, decision: 'APPROVED' | 'REJECTED', text: string) => {
    setConfirming(null); setReviewing(null);
    void act(async () => { await api(`/tickets/${a.ticket.id}/approvals/${a.id}/decide`, 'POST', { decision, note: text.trim() || undefined }); setDone({ a, decision }); setNote(''); }, decision === 'APPROVED' ? 'Approved.' : 'Rejected.');
  };
  const what = (a: ApprovalRow) => a.ticket.catalogItem?.name ?? a.ticket.title;
  const why = (a: ApprovalRow) => { const f = a.ticket.formData ?? {}; const k = Object.keys(f).find((x) => /reason|justif|why|purpose/i.test(x)); return k ? String(f[k]) : ''; };
  const tabs = [
    { key: 'mine', label: 'Needs my approval', href: '#/approvals', count: pending.length },
    { key: 'requested', label: 'Requested by me', href: '#/approvals?tab=requested', count: myRequests.length },
    { key: 'completed', label: 'Completed', href: '#/approvals?tab=completed', count: completed.length },
  ];

  return (
    <div className="emp approvals">
      <header className="emp-head">
        <div><p className="eyebrow">APPROVALS</p><h1>Decisions waiting for you</h1><p className="muted">{pending.length ? `${pending.length} request${pending.length === 1 ? '' : 's'} need${pending.length === 1 ? 's' : ''} your review.` : 'Nothing needs your review right now.'}</p></div>
        <div className="page-actions"><a className="btn" href="#/ask?q=Summarize%20my%20pending%20approvals"><Icon name="spark" size={15} />Summarize my approvals</a></div>
      </header>
      <Tabs items={tabs} current={tab} ariaLabel="Approval views" />

      {done && (
        <div className={`decision-band ${done.decision === 'APPROVED' ? 'ok' : 'crit'}`} role="status">
          <Icon name={done.decision === 'APPROVED' ? 'check' : 'x'} size={16} />
          <span><strong>{done.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</strong> — {what(done.a)} for {done.a.ticket.requester.name}. {done.decision === 'APPROVED' ? 'The request has moved to IT fulfilment.' : 'The requester has been told why.'}</span>
          <a href={`#/tickets/${done.a.ticket.id}`}>View request</a>
          <button className="text-btn btn-sm" onClick={() => setDone(null)} aria-label="Dismiss">Dismiss</button>
        </div>
      )}

      {tab === 'mine' && (
        !pending.length ? <EmptyState icon="checks" title="Nothing to approve">When a colleague requests something that needs your sign-off, it appears here and in your notifications.</EmptyState> : (
          <ul className="approval-list">
            {pending.map((a) => (
              <li key={a.id} className="approval-card">
                <div className="ap-who"><Avatar name={a.ticket.requester.name} size={40} /><div><strong>{a.ticket.requester.name}</strong><small>{labels[a.ticket.requester.role]}</small></div></div>
                <div className="ap-what">
                  <p className="eyebrow">{a.ticket.catalogItem ? `${a.ticket.catalogItem.name} request` : labels[a.ticket.type]}</p>
                  <strong>{a.ticket.title}</strong>
                  {why(a) && <p className="ap-why"><span>Business reason:</span> {why(a)}</p>}
                  <small className="muted">{ticketKey(a.ticket)} · requested {fmtAgo(a.ticket.createdAt)} · waiting {fmtAgo(a.createdAt).replace(' ago', '')}</small>
                </div>
                <div className="ap-actions">
                  <button onClick={() => { setReviewing(a); setNote(''); }}><Icon name="eye" size={15} />Review</button>
                  <button className="primary" onClick={() => setConfirming({ a, decision: 'APPROVED' })}>Approve</button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'requested' && (
        !myRequests.length ? <EmptyState icon="inbox" title="No requests waiting on someone else">Requests you raise that need sign-off show up here until they are decided.</EmptyState> : (
          <ul className="approval-list">
            {myRequests.map((a) => (
              <li key={a.id} className="approval-card slim">
                <div className="ap-what"><p className="eyebrow">{a.ticket.catalogItem ? `${a.ticket.catalogItem.name} request` : labels[a.ticket.type]}</p><strong>{a.ticket.title}</strong><small className="muted">Requested for {a.ticket.requester.id === user.id ? 'you' : a.ticket.requester.name} · {ticketKey(a.ticket)} · {when(a.createdAt)}</small></div>
                <div className="ap-route"><small>Approval</small><span className="person"><Avatar name={a.approver.name} size={22} />{a.approver.name}</span><span className="req-status warn"><i />Awaiting decision</span></div>
                <div className="ap-actions"><a className="btn" href={`#/requests/${a.ticket.id}`}>View request</a></div>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === 'completed' && (
        <>
          <div className="chips" style={{ marginBottom: 'var(--s3)' }}>
            {[['', 'All'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(([v, l]) => <a key={v} className={`chip-btn ${outcome === v ? 'active' : ''}`} aria-current={outcome === v ? 'page' : undefined} href={`#/approvals?tab=completed${v ? `&outcome=${v}` : ''}`}>{l}</a>)}
          </div>
          {!completed.length ? <EmptyState icon="checks" title="No decisions yet" /> : (
            <ul className="approval-list">
              {completed.slice(0, 50).map((a) => (
                <li key={a.id} className="approval-card slim">
                  <div className="ap-who"><Avatar name={a.ticket.requester.name} size={32} /><div><strong>{a.ticket.requester.name}</strong><small>{labels[a.ticket.requester.role]}</small></div></div>
                  <div className="ap-what"><strong>{what(a)}</strong><small className="muted">{ticketKey(a.ticket)} · {a.ticket.title}</small>{a.note && <p className="ap-why"><span>Note:</span> {a.note}</p>}</div>
                  <div className="ap-route"><small>{a.approver.id === user.id ? 'You decided' : `${a.approver.name} decided`}</small><span className={`req-status ${a.status === 'APPROVED' ? 'ok' : 'crit'}`}><i />{labels[a.status]}</span><small className="muted">{when(a.decidedAt)}</small></div>
                  <div className="ap-actions"><a className="btn-sm btn" href={`#/tickets/${a.ticket.id}`}>Open</a></div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {reviewing && (
        <Modal title="Review request" onClose={() => setReviewing(null)} wide footer={<><button onClick={() => setReviewing(null)}>Cancel</button><span className="grow" /><button className="danger" onClick={() => { setConfirming({ a: reviewing, decision: 'REJECTED' }); setReviewing(null); }}>Reject</button><button className="primary" onClick={() => { setConfirming({ a: reviewing, decision: 'APPROVED' }); setReviewing(null); }}>Approve</button></>}>
          <div className="review-head"><Avatar name={reviewing.ticket.requester.name} size={40} /><div><strong>{reviewing.ticket.requester.name}</strong><small className="muted">{labels[reviewing.ticket.requester.role]} · asked {when(reviewing.createdAt)}</small></div><span className="req-status warn"><i />Awaiting your decision</span></div>
          <dl className="review-list">
            <div><dt>Request</dt><dd><strong>{what(reviewing)}</strong>{reviewing.ticket.catalogItem && reviewing.ticket.title !== reviewing.ticket.catalogItem.name ? <><br />{reviewing.ticket.title}</> : null}<br /><span className="mono-id">{ticketKey(reviewing.ticket)}</span></dd></div>
            {why(reviewing) && <div><dt>Business justification</dt><dd>{why(reviewing)}</dd></div>}
            {reviewing.ticket.formData && Object.keys(reviewing.ticket.formData).length > 0 && <div><dt>Request details</dt><dd><dl className="properties compact">{Object.entries(reviewing.ticket.formData).map(([k, v]) => <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{String(v)}</dd></div>)}</dl></dd></div>}
            <div><dt>Approval history</dt><dd>Waiting on you since {when(reviewing.createdAt)}. Approving moves the request to IT fulfilment; rejecting closes it and tells the requester why.</dd></div>
            <div><dt>Note to requester</dt><dd><input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional for approval · required for rejection" /></dd></div>
          </dl>
          <p className="muted fine"><a href={`#/tickets/${reviewing.ticket.id}`}>Open the full request</a> if you need the conversation or attachments.</p>
        </Modal>
      )}

      {confirming && confirming.decision === 'APPROVED' && (
        <Modal title={`Approve ${what(confirming.a).toLowerCase()} for ${confirming.a.ticket.requester.name}?`} onClose={() => setConfirming(null)} footer={<><button onClick={() => setConfirming(null)}>Cancel</button><button className="primary" disabled={busy} onClick={() => decide(confirming.a, 'APPROVED', note)}>Approve</button></>}>
          <p className="t-body">The request moves to IT fulfilment and {confirming.a.ticket.requester.name} is notified.</p>
          <label style={{ marginTop: 'var(--s3)' }}>Note <span className="muted fine">(optional)</span><input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Anything the requester or IT should know" /></label>
        </Modal>
      )}
      {confirming && confirming.decision === 'REJECTED' && (
        <Modal title="Reject request" onClose={() => setConfirming(null)} footer={<><button onClick={() => setConfirming(null)}>Cancel</button><button className="danger" disabled={busy || note.trim().length < 3} onClick={() => decide(confirming.a, 'REJECTED', note)}>Reject request</button></>}>
          <p className="t-body">Tell {confirming.a.ticket.requester.name} why this request cannot be approved. They will see this reason on the request.</p>
          <label style={{ marginTop: 'var(--s3)' }}>Reason <span className="req">*</span><textarea aria-label="Reason" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoFocus /></label>
        </Modal>
      )}
    </div>
  );
}
