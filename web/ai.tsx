import { useState } from 'react';
import { api, ApiError } from './api';
import { Pending, Title, useRecord, when, type Act } from './operations';
import {
  labels, priorities,
  type AiStatus, type AiUsageOverview, type AnswerResult, type CurrentUser,
  type DraftResult, type IndexOverview, type SummaryResult, type Ticket, type TriageResult,
} from '../shared/model';

/**
 * Phase 3 interface.
 *
 * Two rules shape every screen here. Nothing the model produces changes a record until a person
 * presses a button that says so, and mock output is labelled wherever it appears so a demo can
 * never be mistaken for a real model's judgement.
 */

export function MockBadge({ mock }: { mock: boolean }) {
  return mock ? (
    <span className="badge mock" title="Deterministic offline stand-in, not a language model">
      Mock AI
    </span>
  ) : null;
}

function AiError({ message }: { message: string }) {
  return (
    <div className="alert error" role="alert">
      {message}
    </div>
  );
}

/** Shared runner: tracks pending state and turns a failure into a readable message. */
function useAiAction<T>() {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<T>) => {
    setBusy(true);
    setError('');
    try {
      setData(await work());
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 504
          ? 'The AI provider did not respond in time. Nothing was changed — try again, or continue without it.'
          : e instanceof ApiError && e.status === 503
            ? 'AI features are switched off on this installation. Every other part of OpsPilot works normally.'
            : e instanceof ApiError && e.status === 429
              ? e.message
              : e instanceof Error
                ? e.message
                : 'The AI request failed.',
      );
    } finally {
      setBusy(false);
    }
  };
  return { data, setData, error, busy, run };
}

export function AiTicketPanel({
  ticket, user, act, refresh, onDraft,
}: {
  ticket: Ticket;
  user: CurrentUser;
  act: Act;
  refresh: number;
  onDraft: (text: string) => void;
}) {
  const { data: status } = useRecord<AiStatus>('/ai/status', refresh);
  const triage = useAiAction<TriageResult>();
  const summary = useAiAction<SummaryResult>();
  const draft = useAiAction<DraftResult>();
  const [applyCategory, setApplyCategory] = useState(true);
  const [applyPriority, setApplyPriority] = useState(true);

  if (user.role === 'EMPLOYEE') return null;
  if (!status) return null;
  if (!status.enabled)
    return (
      <section className="panel ai-panel">
        <div className="panel-head">
          <h2>AI assistance</h2>
          <span className="badge paused">Disabled</span>
        </div>
        <p className="muted fine">
          AI features are switched off on this installation. Triage, summaries, reply drafts and knowledge answers are
          unavailable; everything else works exactly as normal.
        </p>
      </section>
    );

  const stale = triage.data && triage.data.ticketVersion !== ticket.version;

  return (
    <section className="panel ai-panel">
      <div className="panel-head">
        <div>
          <h2>AI assistance</h2>
          <p className="muted">Suggestions for you to review. Nothing is changed or sent automatically.</p>
        </div>
        <MockBadge mock={status.mock} />
      </div>

      <div className="ai-actions">
        <button disabled={triage.busy} onClick={() => void triage.run(() => api<TriageResult>(`/ai/tickets/${ticket.id}/analyze`, 'POST', {}))}>
          {triage.busy ? 'Analyzing…' : 'Analyze ticket'}
        </button>
        <button disabled={summary.busy} onClick={() => void summary.run(() => api<SummaryResult>(`/ai/tickets/${ticket.id}/summary`, 'POST', {}))}>
          {summary.busy ? 'Summarizing…' : 'Summarize conversation'}
        </button>
        <button disabled={draft.busy} onClick={() => void draft.run(() => api<DraftResult>(`/ai/tickets/${ticket.id}/draft-reply`, 'POST', {}))}>
          {draft.busy ? 'Drafting…' : 'Draft a public reply'}
        </button>
      </div>
      <p className="muted fine">
        {status.usedToday} of {status.dailyLimit} AI requests used in the last 24 hours · model {status.chatModel}
      </p>

      {triage.error && <AiError message={triage.error} />}
      {triage.data && (
        <div className="ai-result">
          <h3>Triage suggestions</h3>
          <p>{triage.data.summary}</p>
          <dl className="properties">
            <dt>Suggested category</dt>
            <dd>
              {triage.data.suggestedCategory}
              {!triage.data.suggestedCategoryMatched && (
                <small className="muted"> — not a category in this workspace, so it cannot be applied</small>
              )}
            </dd>
            <dt>Suggested priority</dt>
            <dd>{labels[triage.data.suggestedPriority] ?? triage.data.suggestedPriority}</dd>
          </dl>
          <h4>Why</h4>
          <ul>{triage.data.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          {triage.data.missingInformation.length > 0 && (
            <>
              <h4>Ask the requester for</h4>
              <ul>{triage.data.missingInformation.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </>
          )}
          {triage.data.troubleshootingSteps.length > 0 && (
            <>
              <h4>Suggested troubleshooting</h4>
              <ul>{triage.data.troubleshootingSteps.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </>
          )}
          <p className="muted fine">{triage.data.reviewNote}</p>

          {stale ? (
            <div className="alert error" role="alert">
              This ticket changed after the analysis ran. Analyze it again before applying any suggestion.
            </div>
          ) : (
            <form
              className="ai-apply"
              onSubmit={(e) => {
                e.preventDefault();
                const payload = triage.data!;
                void act(async () => {
                  await api(`/ai/tickets/${ticket.id}/apply-triage`, 'POST', {
                    version: payload.ticketVersion,
                    fingerprint: payload.fingerprint,
                    ...(applyCategory && payload.suggestedCategoryId ? { categoryId: payload.suggestedCategoryId } : {}),
                    ...(applyPriority ? { priority: payload.suggestedPriority } : {}),
                  });
                  triage.setData(undefined);
                }, 'Reviewed suggestions applied and recorded in the audit log.');
              }}
            >
              <fieldset>
                <legend>Apply after review</legend>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={applyCategory && triage.data.suggestedCategoryMatched}
                    disabled={!triage.data.suggestedCategoryMatched}
                    onChange={(e) => setApplyCategory(e.target.checked)}
                  />
                  Set category to {triage.data.suggestedCategory}
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={applyPriority} onChange={(e) => setApplyPriority(e.target.checked)} />
                  Set priority to {labels[triage.data.suggestedPriority]}
                </label>
              </fieldset>
              <button
                className="primary"
                disabled={!applyPriority && !(applyCategory && triage.data.suggestedCategoryMatched)}
              >
                Apply selected suggestions
              </button>
            </form>
          )}
        </div>
      )}

      {summary.error && <AiError message={summary.error} />}
      {summary.data && (
        <div className="ai-result">
          <h3>
            Conversation summary <span className="badge internal">Support team only</span>
          </h3>
          <p>{summary.data.summary}</p>
          {summary.data.openQuestions.length > 0 && (
            <>
              <h4>Open questions</h4>
              <ul>{summary.data.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </>
          )}
          {summary.data.nextAction && (
            <p>
              <strong>Suggested next action:</strong> {summary.data.nextAction}
            </p>
          )}
        </div>
      )}

      {draft.error && <AiError message={draft.error} />}
      {draft.data && (
        <div className="ai-result">
          <h3>Draft reply</h3>
          <p className="muted fine">{draft.data.reviewNote}</p>
          <label>
            Editable draft
            <textarea
              rows={8}
              value={draft.data.draft}
              onChange={(e) => draft.setData({ ...draft.data!, draft: e.target.value })}
              aria-label="Editable draft reply"
            />
          </label>
          <div className="form-actions">
            <span className="muted fine">{draft.data.toneNote}</span>
            <button
              onClick={() => {
                onDraft(draft.data!.draft);
                draft.setData(undefined);
              }}
            >
              Copy into the reply box
            </button>
          </div>
          <p className="muted fine">
            Nothing has been sent. The draft moves into the public reply box, where you review it and press Send reply
            yourself.
          </p>
        </div>
      )}
    </section>
  );
}

/** Knowledge question interface with clickable citations. Available to every signed-in role. */
export function AskPage({ refresh }: { refresh: number }) {
  const { data: status } = useRecord<AiStatus>('/ai/status', refresh);
  // A suggested prompt elsewhere in the app links here as #/ask?q=…; it only pre-fills, never submits.
  const [question, setQuestion] = useState(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('q') ?? '');
  const answer = useAiAction<AnswerResult>();
  return (
    <>
      <Title title="Ask the knowledge base" />
      <p className="muted">
        Answers are written only from knowledge articles you are allowed to read. Articles you cannot access are never
        searched, so they cannot appear in an answer.
      </p>
      {!status ? (
        <Pending error="" />
      ) : !status.enabled ? (
        <section className="panel">
          <div className="empty">
            <h3>AI features are switched off</h3>
            <p className="muted">
              Browse the knowledge base directly, or raise a ticket. Every other part of OpsPilot works normally.
            </p>
            <a href="#/knowledge">Open the knowledge base</a>
          </div>
        </section>
      ) : (
        <>
          <section className="panel form-panel">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void answer.run(() => api<AnswerResult>('/ai/ask', 'POST', { question }));
              }}
            >
              <label>
                Your question
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  minLength={5}
                  maxLength={500}
                  required
                  placeholder="For example: how do I reconnect to the VPN?"
                />
              </label>
              <div className="form-actions">
                <span className="muted fine">
                  <MockBadge mock={status.mock} /> {status.usedToday} of {status.dailyLimit} AI requests used in 24 hours
                </span>
                <button className="primary" disabled={answer.busy}>
                  {answer.busy ? 'Searching the knowledge base…' : 'Ask'}
                </button>
              </div>
            </form>
          </section>

          {answer.error && <AiError message={answer.error} />}
          {answer.busy && (
            <div className="loading" role="status">
              Retrieving passages you are allowed to read…
            </div>
          )}
          {answer.data && !answer.busy && (
            <section className="panel">
              {answer.data.sufficientEvidence ? (
                <>
                  <div className="panel-head">
                    <h2>Answer</h2>
                    <MockBadge mock={answer.data.mock} />
                  </div>
                  <div className="ai-result">
                    <p className="answer-body">{answer.data.answer}</p>
                    <h3>Sources</h3>
                    <ol className="citations">
                      {answer.data.citations.map((c) => (
                        <li key={`${c.articleId}-${c.chunkIndex}`}>
                          <a href={`#/knowledge/${c.articleId}`}>
                            {c.articleTitle}
                            {c.heading ? ` — ${c.heading}` : ''}
                          </a>
                          <blockquote>{c.excerpt}</blockquote>
                        </li>
                      ))}
                    </ol>
                    <p className="muted fine">{answer.data.disclaimer}</p>
                  </div>
                </>
              ) : (
                <div className="empty">
                  <h3>Not enough evidence to answer</h3>
                  <p className="muted">{answer.data.escalationAdvice}</p>
                  <a className="primary" href="#/tickets/new">
                    Raise a ticket
                  </a>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

/** Administrator AI settings and retrieval-index status. Never displays a credential. */
export function AiSettings({ act, busy, refresh }: { act: Act; busy: boolean; refresh: number }) {
  const { data: status, error: statusError } = useRecord<AiStatus>('/ai/status', refresh);
  const { data: index, error: indexError } = useRecord<IndexOverview>('/admin/ai/index', refresh);
  const { data: usage } = useRecord<AiUsageOverview>('/admin/ai/usage', refresh);
  if (!status || !index) return <Pending error={statusError || indexError} />;
  const stateLabel: Record<string, string> = {
    INDEXED: 'Indexed',
    NOT_INDEXED: 'Not indexed',
    STALE_CONTENT: 'Stale — article edited',
    STALE_MODEL: 'Stale — embedding model changed',
    NOT_ELIGIBLE: 'Not eligible (not published)',
    FAILED: 'Failed',
  };
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Provider</h2>
            <p className="muted">Configured with environment variables on the server.</p>
          </div>
          <MockBadge mock={status.mock} />
        </div>
        <dl className="properties">
          <dt>Mode</dt>
          <dd>
            {status.mode}
            {status.mode === 'mock' && ' — deterministic stand-in, no credentials, clearly labelled in the interface'}
            {status.mode === 'disabled' && ' — every AI feature is off and the rest of OpsPilot is unaffected'}
          </dd>
          <dt>Chat model</dt>
          <dd>{status.chatModel ?? 'not configured'}</dd>
          <dt>Embedding model</dt>
          <dd>
            {status.embeddingModel ?? 'not configured'}
            {status.dimensions ? ` · ${status.dimensions} dimensions` : ''}
          </dd>
          <dt>Per-user limit</dt>
          <dd>{status.dailyLimit} requests per rolling 24 hours</dd>
          <dt>Request timeout</dt>
          <dd>{Math.round(status.timeoutMs / 1000)} seconds</dd>
          <dt>pgvector extension</dt>
          <dd>{index.pgvector ? 'installed' : 'not installed — exact SQL cosine ranking in use'}</dd>
        </dl>
        <p className="muted fine">
          API credentials are read from the server environment and are never sent to the browser, written to logs, or
          shown on this page.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Retrieval index</h2>
            <p className="muted">
              Only published articles are indexed. Editing an article clears its passages immediately, so a stale or
              newly-restricted passage can never be retrieved while a reindex is pending.
            </p>
          </div>
          <button
            disabled={busy || !status.enabled}
            onClick={() => void act(async () => { await api('/admin/ai/reindex', 'POST', {}); }, 'Reindex complete.')}
          >
            Reindex all
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Article</th>
                <th>Visibility</th>
                <th>Index state</th>
                <th>Passages</th>
                <th>Indexed</th>
              </tr>
            </thead>
            <tbody>
              {index.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <a href={`#/knowledge/${item.id}`}>{item.title}</a>
                    <small>{item.status.toLowerCase()}</small>
                  </td>
                  <td>{item.visibility === 'SUPPORT' ? <span className="badge internal">Support only</span> : <span className="muted">Everyone</span>}</td>
                  <td>
                    <span className={`badge ${item.state === 'INDEXED' ? 'met' : item.state === 'FAILED' ? 'breach' : 'paused'}`}>
                      {stateLabel[item.state] ?? item.state}
                    </span>
                    {item.indexError && <small className="muted">{item.indexError}</small>}
                  </td>
                  <td>{item.chunks}</td>
                  <td className="date-cell">{item.indexedAt ? when(item.indexedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {index.chunkTotals.length > 1 && (
          <p className="muted fine">
            Passages exist for more than one embedding model. Reindex to remove the superseded ones:{' '}
            {index.chunkTotals.map((t) => `${t.model} (${t.chunks})`).join(', ')}.
          </p>
        )}
      </section>

      {usage && (
        <section className="panel">
          <div className="panel-head">
            <h2>Usage · last {usage.windowDays} days</h2>
          </div>
          <div className="distribution-body">
            <div className="flex between">
              <span>Calls</span>
              <strong>{usage.calls}</strong>
            </div>
            <div className="flex between">
              <span>Input tokens (measured)</span>
              <strong>{usage.inputTokens.toLocaleString()}</strong>
            </div>
            <div className="flex between">
              <span>Output tokens (measured)</span>
              <strong>{usage.outputTokens.toLocaleString()}</strong>
            </div>
            <div className="flex between">
              <span>Average duration</span>
              <strong>{usage.averageDurationMs} ms</strong>
            </div>
            {usage.byOutcome.map((row) => (
              <div className="flex between" key={row.outcome}>
                <span>Outcome · {row.outcome.toLowerCase().replaceAll('_', ' ')}</span>
                <strong>{row.calls}</strong>
              </div>
            ))}
          </div>
          <p className="muted fine">{usage.costNote}</p>
        </section>
      )}
    </>
  );
}

export const aiPriorities = priorities;
