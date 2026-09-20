import { useEffect, useState } from 'react';
import { api } from './api';
import { AssetPicker, useRecord, type Act } from './operations';
import { labels, priorityFor, ticketTypes, type ArticleSummary, type CatalogItem, type CurrentUser, type FormField, type Ticket, type TicketTemplate } from '../shared/model';
import { searchTerms } from '../shared/search';
import { Icon } from './ui/icons';
import { EmptyState, Skeleton, fmtAgo, ticketKey } from './ui';
import { APPROVER_WORD } from './employee';

type Category = { id: string; name: string };

/** Catalog icons as inline SVG paths, so they look the same on every platform and font. */
export const ICONS: Record<string, string> = {
  box: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  laptop: 'M4 5h16v11H4z M2 19h20',
  key: 'M14 3a5 5 0 1 1-3.5 8.6L4 18v2h2l1-1 1 1h2v-2l1-1h2l1.4-1.4A5 5 0 0 1 14 3z M15 8h.01',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  phone: 'M7 3h10v18H7z M11 18h2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0',
  wrench: 'M14 4a5 5 0 0 0 6 6l-9 9a2 2 0 0 1-3-3l9-9a5 5 0 0 0-3-3z',
  shield: 'M12 3l7 3v6c0 5-3 7-7 9-4-2-7-4-7-9V6z',
  cloud: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4 4 0 0 1 0 9z',
  printer: 'M6 9V3h12v6 M6 18H3v-7h18v7h-3 M6 14h12v7H6z',
  wifi: 'M2 9a15 15 0 0 1 20 0 M5 12.5a10 10 0 0 1 14 0 M8.5 16a5 5 0 0 1 7 0 M12 19.5h.01',
  chair: 'M6 3h12v9H6z M4 12h16v3H4z M6 15v6 M18 15v6',
  card: 'M2 6h20v12H2z M2 10h20 M6 15h4',
  calendar: 'M3 5h18v16H3z M3 10h18 M8 3v4 M16 3v4',
  bug: 'M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0z M3 13h5 M16 13h5 M5 7l3 2 M19 7l-3 2 M5 19l3-2 M19 19l-3-2',
  rocket: 'M12 3c3 2 5 6 5 10l-2 3h-6l-2-3c0-4 2-8 5-10z M9 16l-3 4 M15 16l3 4 M12 9h.01',
};
export const icon = (name: string) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={ICONS[name] ?? ICONS.box} />
  </svg>
);

/** Knowledge articles that match what the person is typing, shown before they submit. */
export function SuggestedArticles({ text }: { text: string }) {
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const q = searchTerms(text).join(' ');
  useEffect(() => {
    const terms = q ? q.split(' ') : [];
    if (!terms.length) { setItems([]); return; }
    let live = true;
    const t = setTimeout(() => void (async () => {
      for (const term of terms) {
        const r = await api<{ items: ArticleSummary[] }>(`/articles?q=${encodeURIComponent(term)}&pageSize=3`).catch(() => ({ items: [] }));
        if (!live) return;
        if (r.items.length) { setItems(r.items); return; }
      }
      if (live) setItems([]);
    })(), 350);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  if (!items.length) return null;
  return (
    <aside className="suggestions" aria-live="polite">
      <p className="eyebrow">THIS MIGHT HELP FIRST</p>
      <ul>{items.map((a) => <li key={a.id}><a href={`#/knowledge/${a.id}`}>{a.title}</a><small>{a.category.name}</small></li>)}</ul>
    </aside>
  );
}

/** Renders a catalog item's field schema as inputs and returns the answers as a plain object. */
export function DynamicForm({ fields, values, onChange, invalid }: { fields: FormField[]; values: Record<string, string | number | boolean>; onChange: (v: Record<string, string | number | boolean>) => void; invalid?: Set<string> }) {
  const set = (k: string, v: string | number | boolean) => onChange({ ...values, [k]: v });
  return (
    <div className="dynamic-form">
      {fields.map((f) => {
        const v = values[f.key];
        const bad = invalid?.has(f.key) ?? false;
        const common = { id: `field-${f.key}`, name: f.key, required: f.required, 'aria-invalid': bad || undefined, 'aria-describedby': bad ? `err-${f.key}` : f.help ? `help-${f.key}` : undefined };
        return (
          <div key={f.key} className={`field ${f.kind === 'checkbox' ? 'check' : ''}`}>
            {f.kind === 'checkbox' ? <label className="check"><input type="checkbox" {...common} checked={v === true} onChange={(e) => set(f.key, e.target.checked)} /> {f.label}</label> : <label htmlFor={common.id} className={f.required ? 'required' : ''}>{f.label}</label>}
            {f.kind === 'text' && <input {...common} maxLength={200} placeholder={f.placeholder} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />}
            {f.kind === 'textarea' && <textarea {...common} rows={4} maxLength={4000} placeholder={f.placeholder} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />}
            {f.kind === 'number' && <input {...common} type="number" value={v === undefined ? '' : String(v)} onChange={(e) => set(f.key, e.target.value === '' ? '' : Number(e.target.value))} />}
            {f.kind === 'date' && <input {...common} type="date" value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />}
            {f.kind === 'select' && <select {...common} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)}><option value="">Choose…</option>{f.options?.map((o) => <option key={o} value={o}>{o}</option>)}</select>}
            {bad ? <small id={`err-${f.key}`} className="field-error">This field is required.</small> : f.help && <small id={`help-${f.key}`} className="field-help">{f.help}</small>}
          </div>
        );
      })}
    </div>
  );
}

/* ── Service catalog: marketplace → service detail → request flow ─────── */

type Step = 'browse' | 'detail' | 'form' | 'review' | 'submitted';
type Answers = Record<string, string | number | boolean>;
const params = (route: string) => new URLSearchParams(route.split('?')[1] ?? '');
const go = (q: Record<string, string>) => { const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v)); location.hash = `/tickets/new${p.toString() ? `?${p}` : ''}`; };
const approvalWord = (c: CatalogItem) => (c.requiresApproval ? APPROVER_WORD[c.approverKind] ?? 'Approval required' : 'No approval needed');
const approverName = (c: CatalogItem, user: CurrentUser & { managerName?: string }) => (c.approverKind === 'ADMIN' ? 'an administrator' : c.approverKind === 'DEPARTMENT_MANAGER' ? 'the department manager' : user.managerName ?? 'your manager');
const fieldKindWord: Record<string, string> = { text: 'Short answer', textarea: 'Details', select: 'Choice', number: 'Number', date: 'Date', checkbox: 'Yes / no' };

export function NewRequestPage({ user, act, busy, route }: { user: CurrentUser; act: Act; busy: boolean; route: string }) {
  const q = params(route);
  const { data: categories, error } = useRecord<Category[]>('/categories');
  const { data: catalog } = useRecord<CatalogItem[]>('/catalog');
  const { data: templates } = useRecord<TicketTemplate[]>('/templates');
  const { data: mine } = useRecord<{ items: Ticket[] }>(`/tickets?${user.role === 'EMPLOYEE' ? '' : `requesterId=${user.id}&`}sort=updated&pageSize=20`);
  const serviceId = q.get('service') ?? '';
  const submittedId = q.get('submitted') ?? '';
  const stepParam = q.get('step');
  const step: Step = submittedId ? 'submitted' : !serviceId ? 'browse' : stepParam === 'form' ? 'form' : stepParam === 'review' ? 'review' : 'detail';
  const [answers, setAnswers] = useState<Answers>({});
  const [extra, setExtra] = useState({ title: '', description: '' });
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (step === 'browse' || step === 'detail') { setAnswers({}); setExtra({ title: '', description: '' }); setTouched(false); } }, [serviceId, step === 'browse']); // eslint-disable-line react-hooks/exhaustive-deps
  // A quick tile elsewhere remembers which service was chosen.
  useEffect(() => { const picked = sessionStorage.getItem('catalog-pick'); if (picked) { sessionStorage.removeItem('catalog-pick'); go({ service: picked }); } }, []);

  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!categories || !catalog) return <Skeleton rows={8} />;
  const item = serviceId && serviceId !== 'issue' ? catalog.find((c) => c.id === serviceId) : undefined;

  if (step === 'submitted') return <SubmittedPage ticketId={submittedId} user={user} />;
  if (serviceId === 'issue') return <IssueFlow user={user} act={act} busy={busy} categories={categories} templates={templates ?? []} presetQ={q.get('q') ?? ''} />;
  if (serviceId && !item) return <div className="emp"><EmptyState icon="search" title="That service is no longer available" action={<a className="btn" href="#/tickets/new">Browse services</a>} /></div>;
  if (item && step === 'detail') return <ServiceDetail item={item} user={user} recent={(mine?.items ?? []).filter((t) => t.catalogItemId === item.id)} />;
  if (item && (step === 'form' || step === 'review')) {
    const missing = item.fields.filter((f) => f.required && (answers[f.key] === undefined || answers[f.key] === '' || answers[f.key] === false));
    const submit = () => void act(async () => {
      const t = await api<Ticket>('/tickets', 'POST', { title: extra.title || item.name, description: extra.description || `${item.name} requested from the service catalog.`, categoryId: item.categoryId, catalogItemId: item.id, formData: answers, type: item.type });
      location.hash = `/tickets/new?submitted=${t.id}`;
    }, '');
    return (
      <div className="emp reqflow">
        <a className="back-link" href={`#/tickets/new?service=${item.id}`}><Icon name="arrowLeft" size={14} />{item.name}</a>
        <ol className="stepper" aria-label="Request steps">
          <li className={step === 'form' ? 'current' : 'done'} aria-current={step === 'form' ? 'step' : undefined}><span>1</span>Details</li>
          <li className={step === 'review' ? 'current' : ''} aria-current={step === 'review' ? 'step' : undefined}><span>2</span>Review</li>
          <li><span>3</span>Submitted</li>
        </ol>
        <div className="reqflow-grid">
          <div className="reqflow-main">
            {step === 'form' ? (
              <form className="emp-surface request-form" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!missing.length) go({ service: item.id, step: 'review' }); else document.getElementById(`field-${missing[0].key}`)?.focus(); }}>
                <div className="section-title"><div><h2>{item.name}</h2><p className="muted t-sm">{item.description}</p></div></div>
                {touched && missing.length > 0 && <div className="alert error" role="alert">Please complete {missing.length === 1 ? 'the highlighted field' : `${missing.length} highlighted fields`}: {missing.map((f) => f.label).join(', ')}.</div>}
                {item.fields.length > 0 && <fieldset className="form-section"><legend>Your request</legend><DynamicForm fields={item.fields} values={answers} onChange={setAnswers} invalid={touched ? new Set(missing.map((f) => f.key)) : undefined} /></fieldset>}
                <fieldset className="form-section"><legend>Anything else</legend>
                  <div className="field"><label htmlFor="req-summary">Summary <span className="muted fine">(optional)</span></label><input id="req-summary" maxLength={160} placeholder={item.name} value={extra.title} onChange={(e) => setExtra({ ...extra, title: e.target.value })} aria-describedby="req-summary-help" /><small id="req-summary-help" className="field-help">Shown to IT as the request title. Leave blank to use the service name.</small></div>
                  <div className="field"><label htmlFor="req-notes">Notes for IT <span className="muted fine">(optional)</span></label><textarea id="req-notes" rows={3} maxLength={10000} value={extra.description} onChange={(e) => setExtra({ ...extra, description: e.target.value })} aria-describedby="req-notes-help" /><small id="req-notes-help" className="field-help">Context that helps IT fulfil this faster. Never include passwords.</small></div>
                </fieldset>
                <div className="form-actions"><a className="btn" href={`#/tickets/new?service=${item.id}`}>Cancel</a><span className="grow" /><button className="primary">Review request<Icon name="arrow" size={15} /></button></div>
              </form>
            ) : (
              <section className="emp-surface request-review">
                <div className="section-title"><h2>Review your request</h2><span className="muted t-caption">Nothing is sent until you submit</span></div>
                <dl className="review-list">
                  <div><dt>Service</dt><dd>{item.name}</dd></div>
                  <div><dt>Request for</dt><dd>{user.name}</dd></div>
                  {item.fields.map((f) => <div key={f.key}><dt>{f.label}</dt><dd>{answers[f.key] === undefined || answers[f.key] === '' ? <span className="muted">—</span> : typeof answers[f.key] === 'boolean' ? (answers[f.key] ? 'Yes' : 'No') : String(answers[f.key])}</dd></div>)}
                  <div><dt>Summary</dt><dd>{extra.title || item.name}</dd></div>
                  {extra.description && <div><dt>Notes for IT</dt><dd>{extra.description}</dd></div>}
                  <div><dt>Approval</dt><dd>{item.requiresApproval ? `${approvalWord(item)} — ${approverName(item, user)} decides first` : 'None needed — goes straight to IT'}</dd></div>
                </dl>
                <div className="form-actions"><button onClick={() => go({ service: item.id, step: 'form' })}><Icon name="arrowLeft" size={14} />Back</button><span className="grow" /><button className="primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit request'}</button></div>
              </section>
            )}
          </div>
          <aside className="reqflow-side">
            <section className="emp-surface summary-card">
              <p className="eyebrow">Request summary</p>
              <dl className="ctx-list">
                <div><dt>Service</dt><dd>{item.name}</dd></div>
                <div><dt>Request for</dt><dd>{user.name}</dd></div>
                <div><dt>Type</dt><dd>{labels[item.type]}</dd></div>
                <div><dt>Approval</dt><dd>{approvalWord(item)}</dd></div>
                <div><dt>Fulfilment</dt><dd className="muted">No estimate is configured for this service</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      </div>
    );
  }
  return <Marketplace catalog={catalog} categories={categories} user={user} recent={mine?.items ?? []} initialQ={q.get('q') ?? ''} categoryId={q.get('category') ?? ''} />;
}

/* ── Marketplace ──────────────────────────────────────────────────────── */
function Marketplace({ catalog, categories, recent, initialQ, categoryId }: { catalog: CatalogItem[]; categories: Category[]; user: CurrentUser; recent: Ticket[]; initialQ: string; categoryId: string }) {
  const [q, setQ] = useState(initialQ);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setArticles([]); return; }
    let live = true;
    const t = setTimeout(() => void api<{ items: ArticleSummary[] }>(`/articles?q=${encodeURIComponent(term)}&pageSize=4`).then((r) => { if (live) setArticles(r.items); }).catch(() => {}), 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const lower = q.trim().toLowerCase();
  const searching = lower.length >= 2;
  const matches = (c: CatalogItem) => c.name.toLowerCase().includes(lower) || c.description.toLowerCase().includes(lower);
  const inScope = catalog.filter((c) => (!categoryId || c.categoryId === categoryId) && (!searching || matches(c)));
  const groups = categories.map((c) => ({ c, items: inScope.filter((i) => i.categoryId === c.id) })).filter((g) => g.items.length);
  const allGroups = categories.map((c) => ({ c, items: catalog.filter((i) => i.categoryId === c.id) })).filter((g) => g.items.length);
  const recentServices = [...new Map(recent.filter((t) => t.catalogItemId).map((t) => [t.catalogItemId!, t])).keys()].map((id) => catalog.find((c) => c.id === id)).filter((c): c is CatalogItem => !!c).slice(0, 4);
  const current = categories.find((c) => c.id === categoryId);
  return (
    <div className="emp catalog">
      <header className="emp-head">
        <div><p className="eyebrow">SERVICE CATALOG</p><h1>How can we help?</h1><p className="muted">Find the service you need, read the answer first, or report an issue.</p></div>
        <div className="page-actions"><a className="btn" href="#/ask?q=Help%20me%20choose%20the%20right%20request"><Icon name="spark" size={15} />Help me choose</a></div>
      </header>
      <div className="help catalog-help">
        <div className="help-field"><Icon name="search" size={18} /><input aria-label="Search services and help" placeholder="Search services and help…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={!!initialQ} />{q && <button className="text-btn btn-sm" onClick={() => setQ('')}>Clear</button>}</div>
      </div>
      {searching ? (
        <div className="cat-results">
          {articles.length > 0 && (
            <section className="emp-surface"><div className="section-title"><h2>Knowledge</h2><span className="muted t-caption">Read first — it may solve this without a request</span></div>
              <ul className="kb-list">{articles.map((a) => <li key={a.id}><a href={`#/knowledge/${a.id}`}><span className="hr-icon"><Icon name="book" size={16} /></span><span><strong>{a.title}</strong><small>{a.category.name}</small></span><Icon name="chevron" size={16} /></a></li>)}</ul>
            </section>
          )}
          <section className="emp-surface"><div className="section-title"><h2>Services</h2><span className="muted t-caption">{inScope.length} match{inScope.length === 1 ? '' : 'es'}</span></div>
            {inScope.length ? <ServiceList items={inScope} categories={categories} /> : <p className="calm">No service matches “{q}”. <a href={`#/tickets/new?service=issue&q=${encodeURIComponent(q)}`}>Report it as an issue</a> and IT will route it.</p>}
          </section>
        </div>
      ) : (
        <>
          {!categoryId && recentServices.length > 0 && (
            <section className="cat-block"><div className="section-title"><h2>Recently used</h2><span className="muted t-caption">From your own requests</span></div>
              <div className="service-chips">{recentServices.map((c) => <a key={c.id} className="service-chip" href={`#/tickets/new?service=${c.id}`}><span className="hr-icon">{icon(c.icon)}</span><span><strong>{c.name}</strong><small>{approvalWord(c)}</small></span></a>)}</div>
            </section>
          )}
          {!categoryId && (
            <section className="cat-block"><div className="section-title"><h2>Categories</h2></div>
              <ul className="cat-grid">
                {allGroups.map(({ c, items }) => <li key={c.id}><a href={`#/tickets/new?category=${c.id}`}><span className="hr-icon">{icon(items[0].icon)}</span><span><strong>{c.name}</strong><small>{items.length} service{items.length === 1 ? '' : 's'} · {items.slice(0, 2).map((i) => i.name).join(', ')}</small></span><Icon name="chevron" size={16} /></a></li>)}
                <li><a href="#/tickets/new?service=issue" className="issue"><span className="hr-icon"><Icon name="alert" size={18} /></span><span><strong>Report an IT issue</strong><small>Something is broken, slow or not working</small></span><Icon name="chevron" size={16} /></a></li>
              </ul>
            </section>
          )}
          <section className="cat-block"><div className="section-title"><h2>{current ? current.name : 'All services'}</h2>{current ? <a href="#/tickets/new">All services →</a> : <span className="muted t-caption">{catalog.length} services</span>}</div>
            {groups.length ? groups.map(({ c, items }) => <div key={c.id} className="cat-group">{!current && <h3 className="eyebrow">{c.name}</h3>}<ServiceList items={items} categories={categories} /></div>) : <p className="calm">No services in this category yet.</p>}
          </section>
        </>
      )}
    </div>
  );
}

function ServiceList({ items }: { items: CatalogItem[]; categories: Category[] }) {
  return (
    <ul className="service-list">
      {items.map((c) => (
        <li key={c.id}>
          <a href={`#/tickets/new?service=${c.id}`} className="service-item">
            <span className="hr-icon" aria-hidden="true">{icon(c.icon)}</span>
            <span className="svc-body"><strong>{c.name}</strong><small>{c.description}</small></span>
            <span className="svc-meta"><span>{labels[c.type]}</span><span className={c.requiresApproval ? 'warn-text' : ''}>{approvalWord(c)}</span></span>
            <span className="svc-cta">Start request<Icon name="arrow" size={13} /></span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/* ── Service detail ───────────────────────────────────────────────────── */
function ServiceDetail({ item, user, recent }: { item: CatalogItem; user: CurrentUser; recent: Ticket[] }) {
  return (
    <div className="emp service-detail">
      <a className="back-link" href="#/tickets/new"><Icon name="arrowLeft" size={14} />Service catalog</a>
      <div className="reqflow-grid">
        <div className="reqflow-main">
          <section className="emp-surface">
            <div className="svc-hero"><span className="hr-icon large" aria-hidden="true">{icon(item.icon)}</span><div><p className="eyebrow">{item.category?.name ?? labels[item.type]}</p><h1>{item.name}</h1><p className="muted">{item.description}</p></div></div>
            <dl className="svc-facts">
              <div><dt>Approval</dt><dd>{item.requiresApproval ? `${approvalWord(item)} · ${approverName(item, user)} decides before IT starts` : 'None needed — goes straight to IT'}</dd></div>
              <div><dt>Handled as</dt><dd>{labels[item.type]}{item.category ? ` · ${item.category.name}` : ''}</dd></div>
              <div><dt>Estimated fulfilment</dt><dd className="muted">Not configured for this service</dd></div>
            </dl>
            {item.fields.length > 0 && (
              <div className="svc-needs"><p className="eyebrow">What you'll need</p><ul>{item.fields.map((f) => <li key={f.key}><strong>{f.label}</strong><small>{fieldKindWord[f.kind]}{f.required ? ' · required' : ' · optional'}{f.help ? ` · ${f.help}` : ''}</small></li>)}</ul></div>
            )}
            <div className="form-actions"><a className="primary btn-lg" href={`#/tickets/new?service=${item.id}&step=form`}>Start request<Icon name="arrow" size={15} /></a></div>
          </section>
        </div>
        <aside className="reqflow-side">
          {recent.length > 0 && (
            <section className="emp-surface"><p className="eyebrow">Your previous requests</p>
              <ul className="related-list">{recent.slice(0, 4).map((t) => <li key={t.id}><a href={`#/requests/${t.id}`}><span className="mono-id">{ticketKey(t)}</span><span className="truncate">{t.title}</span><small>{labels[t.status]} · {fmtAgo(t.updatedAt)}</small></a></li>)}</ul>
            </section>
          )}
          <section className="emp-surface ask-strip"><p className="eyebrow"><Icon name="spark" size={12} /> Ask OpsPilot</p><div className="ask-chips"><a className="chip-btn" href={`#/ask?q=${encodeURIComponent(`How do I request ${item.name.toLowerCase()}?`)}`}>How do I request {item.name.toLowerCase()}?</a><a className="chip-btn" href="#/ask?q=Help%20me%20choose%20the%20right%20request">Help me choose the right request</a></div></section>
        </aside>
      </div>
    </div>
  );
}

/* ── Issue flow (free-form) ───────────────────────────────────────────── */
function IssueFlow({ user, act, busy, categories, templates, presetQ }: { user: CurrentUser; act: Act; busy: boolean; categories: Category[]; templates: TicketTemplate[]; presetQ: string }) {
  const staff = user.role !== 'EMPLOYEE';
  const [template, setTemplate] = useState<TicketTemplate | null>(null);
  const [description, setDescription] = useState('');
  const [title, setTitle] = useState(presetQ);
  const [impact, setImpact] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [urgency, setUrgency] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (template) { setDescription(template.description); setTitle(template.title); } }, [template]);
  return (
    <div className="emp reqflow">
      <a className="back-link" href="#/tickets/new"><Icon name="arrowLeft" size={14} />Service catalog</a>
      <div className="reqflow-grid">
        <form className="emp-surface request-form reqflow-main" noValidate onSubmit={(e) => {
          e.preventDefault(); setTouched(true);
          const f = new FormData(e.currentTarget);
          const ok = title.trim().length >= 5 && description.trim().length >= 10 && !!f.get('categoryId');
          if (!ok) return;
          void act(async () => {
            const priority = staff ? (f.get('priority') as string) || undefined : undefined;
            const t = await api<Ticket>('/tickets', 'POST', { title: title.trim(), description: description.trim(), categoryId: f.get('categoryId'), type: f.get('type') ?? 'INCIDENT', assetId: f.get('assetId') || null, impact, urgency, ...(priority ? { priority } : {}), templateId: template?.id ?? null });
            location.hash = staff ? `/tickets/${t.id}` : `/tickets/new?submitted=${t.id}`;
          }, staff ? 'Ticket created.' : '');
        }}>
          <div className="section-title"><div><h2>Report an IT issue</h2><p className="muted t-sm">Tell us what happened and how it affects your work. IT will route and prioritise it.</p></div>
            {templates.length > 0 && <select aria-label="Start from a template" style={{ width: 'auto' }} value={template?.id ?? ''} onChange={(e) => setTemplate(templates.find((t) => t.id === e.target.value) ?? null)}><option value="">Start from a template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
          </div>
          <fieldset className="form-section"><legend>What happened</legend>
            <div className="field"><label htmlFor="issue-title" className="required">Title</label><input id="issue-title" required name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="A short description of the issue" aria-invalid={touched && title.trim().length < 5} aria-describedby="issue-title-help" /><small id="issue-title-help" className={touched && title.trim().length < 5 ? 'field-error' : 'field-help'}>{touched && title.trim().length < 5 ? 'At least 5 characters.' : 'One line, the way you would say it to a colleague.'}</small></div>
            <div className="field"><label htmlFor="issue-description" className="required">Description</label><textarea id="issue-description" required name="description" rows={7} maxLength={10000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What were you trying to do? What happened? Include any error messages, but never passwords or access keys." aria-invalid={touched && description.trim().length < 10} aria-describedby="issue-description-help" /><small id="issue-description-help" className={touched && description.trim().length < 10 ? 'field-error' : 'field-help'}>{touched && description.trim().length < 10 ? 'At least 10 characters.' : 'Screens, error text and when it started all help.'}</small></div>
            <SuggestedArticles text={`${title} ${description}`} />
          </fieldset>
          <fieldset className="form-section"><legend>Where and how much</legend>
            <div className="two-grid">
              <label>Category <span className="req">*</span><select aria-label="Category" name="categoryId" required defaultValue={template?.categoryId ?? ''} key={`c-${template?.id ?? 'none'}`}><option value="">Select a category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Type<select aria-label="Type" name="type" defaultValue={template?.type ?? 'INCIDENT'} key={`ty-${template?.id ?? 'none'}`}>{ticketTypes.filter((t) => staff || t !== 'PROBLEM').map((t) => <option key={t} value={t}>{labels[t]}</option>)}</select></label>
            </div>
            <div className="two-grid">
              <label>How many people are affected?<select aria-label="Impact" value={impact} onChange={(e) => setImpact(e.target.value as typeof impact)}><option value="LOW">Just me</option><option value="MEDIUM">My team</option><option value="HIGH">Many people or a whole service</option></select></label>
              <label>How quickly do you need this?<select aria-label="Urgency" value={urgency} onChange={(e) => setUrgency(e.target.value as typeof urgency)}><option value="LOW">When convenient</option><option value="MEDIUM">Soon</option><option value="HIGH">I cannot work</option></select></label>
            </div>
            <p className="muted fine">IT will treat this as <strong>{labels[priorityFor(impact, urgency)]}</strong> priority{staff ? '' : '; the support team can adjust it'}.</p>
            {staff && <label>Priority override<select aria-label="Priority" name="priority" defaultValue=""><option value="">Use the matrix</option>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{labels[p]}</option>)}</select></label>}
            <AssetPicker />
          </fieldset>
          <div className="form-actions"><a className="btn" href="#/tickets/new">Cancel</a><span className="grow" /><button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create ticket'}</button></div>
        </form>
        <aside className="reqflow-side">
          <section className="emp-surface summary-card"><p className="eyebrow">What happens next</p>
            <ol className="next-list"><li>IT sees the issue in the Service Desk with the priority above.</li><li>An engineer picks it up and replies in the conversation.</li><li>You are notified at every step and can add detail any time.</li></ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ── Submitted ────────────────────────────────────────────────────────── */
function SubmittedPage({ ticketId, user }: { ticketId: string; user: CurrentUser }) {
  const { data: t, error } = useRecord<Ticket>(`/tickets/${ticketId}`);
  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!t) return <Skeleton rows={5} />;
  const pending = t.approvals?.find((a) => a.status === 'PENDING');
  const staff = user.role !== 'EMPLOYEE';
  return (
    <div className="emp submitted">
      <section className="emp-surface submitted-card" role="status">
        <span className="submitted-mark" aria-hidden="true"><Icon name="check" size={24} /></span>
        <h1>Request submitted</h1>
        <p className="mono-id big">{ticketKey(t)}</p>
        <p className="muted">{pending ? `Your request has been sent to ${pending.approver.name} for approval.` : 'Your request has been sent to IT.'}</p>
        <ol className="next-list">
          {pending && <li><strong>{pending.approver.name}</strong> reviews your request</li>}
          <li><strong>IT</strong> {t.type === 'REQUEST' ? 'fulfils the request' : 'investigates the issue'} and keeps you posted here</li>
          <li>You are notified when it is complete and can rate the outcome</li>
        </ol>
        <div className="form-actions center">
          <a className="primary" href={staff && t.type !== 'REQUEST' ? `#/tickets/${t.id}` : `#/requests/${t.id}`}>View request</a>
          <a className="btn" href="#/">Return to My Space</a>
          <a className="btn" href="#/tickets/new">Browse services</a>
        </div>
      </section>
    </div>
  );
}
