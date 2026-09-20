import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useRecord, type Act } from './operations';
import { articleStatuses, articleVisibilities, labels, type Article, type ArticleFeedback, type ArticleSummary, type CatalogItem, type CurrentUser, type KnowledgeOverview, type Page, type Ticket } from '../shared/model';
import { Icon } from './ui/icons';
import { EmptyState, ErrorState, Skeleton, fmtDay, toast } from './ui';
import { icon as catalogIcon } from './catalog';

type Category = { id: string; name: string };
const visibilityLabel: Record<string, string> = { EMPLOYEE: 'Everyone', SUPPORT: 'Support team only' };
const statusLabel: Record<string, string> = { DRAFT: 'Draft', PUBLISHED: 'Published', ARCHIVED: 'Archived' };

/**
 * Knowledge: the answer people should find before they raise a request. Search leads, categories
 * browse, and an article reads like a document rather than a database row. Every count on this
 * page is a count of real rows the caller is allowed to see — the API computes them under the same
 * visibility rule it applies to the articles themselves.
 */
export function KnowledgePage({ route, user, act, busy, refresh }: { route: string; user: CurrentUser; act: Act; busy: boolean; refresh: number }) {
  const [path, query] = route.split('?');
  const id = path.split('/')[2];
  if (id === 'new')
    return user.role === 'ADMIN' ? <ArticleForm act={act} busy={busy} /> : <ErrorState error="Administrator role required" back={{ href: '#/knowledge', label: 'Knowledge' }} />;
  return id
    ? <ArticleView id={id} user={user} act={act} busy={busy} refresh={refresh} />
    : <KnowledgeHome user={user} refresh={refresh} query={query ?? ''} />;
}

/** Roughly 200 words a minute, rounded up, from the article's own text. Never shown below a minute. */
export const readingMinutes = (markdown: string) => Math.max(1, Math.ceil(markdown.trim().split(/\s+/).length / 200));

const CATEGORY_ICON: Record<string, string> = { 'Network': 'wifi', 'Access & identity': 'key', 'Hardware': 'laptop', 'Software': 'cloud', 'Security': 'shield', 'Employee services': 'users' };
const categoryIcon = (name: string) => CATEGORY_ICON[name] ?? 'book';

/* ── Home ─────────────────────────────────────────────────────────────── */

function KnowledgeHome({ user, refresh, query }: { user: CurrentUser; refresh: number; query: string }) {
  const params = new URLSearchParams(query);
  const categoryId = params.get('category') ?? '';
  const urlQ = params.get('q') ?? '';
  const [q, setQ] = useState(urlQ);
  const [status, setStatus] = useState('');
  useEffect(() => { setQ(urlQ); }, [urlQ]);
  const searching = q.trim().length >= 2;
  const { data: overview, error } = useRecord<KnowledgeOverview>('/knowledge/overview', refresh);
  const { data: categories } = useRecord<Category[]>('/categories');
  const listParams = new URLSearchParams({ pageSize: '20', ...(searching ? { q: q.trim() } : {}), ...(categoryId ? { categoryId } : {}), ...(status ? { status } : {}) });
  const { data: list } = useRecord<Page<ArticleSummary>>(searching || categoryId || status ? `/articles?${listParams}` : '/categories', refresh);
  // "Recommended" is derived from the reader's own open work, not from a recommendation engine:
  // the categories they currently have tickets in, and nothing else.
  const { data: mine } = useRecord<{ items: Ticket[] }>('/tickets?open=true&pageSize=10&sort=updated', refresh);
  const { data: catalog } = useRecord<CatalogItem[]>('/catalog');
  const current = categories?.find((c) => c.id === categoryId);
  const openCategories = [...new Set((mine?.items ?? []).map((t) => t.category?.id).filter(Boolean) as string[])];
  const recommended = (overview?.recent ?? []).filter((a) => openCategories.includes(a.category.id)).slice(0, 3);
  const recommendedBecause = (mine?.items ?? []).find((t) => t.category?.id === recommended[0]?.category.id);

  if (error) return <ErrorState error={error} />;
  const results = list && 'items' in list ? list.items : null;
  // Each article earns one place on the page: whatever is recommended is not repeated below it.
  const shown = new Set(recommended.map((a) => a.id));
  const helpfulRows = (overview?.helpful ?? []).filter((a) => !shown.has(a.id)).slice(0, 4);
  helpfulRows.forEach((a) => shown.add(a.id));
  const recentRows = (overview?.recent ?? []).filter((a) => !shown.has(a.id)).slice(0, 5);

  return (
    <div className="emp kb">
      <header className="emp-head">
        <div>
          <p className="eyebrow">KNOWLEDGE</p>
          <h1>Find answers. Solve problems faster.</h1>
          <p className="muted">{user.role === 'EMPLOYEE' ? 'Guidance written for everyone in the company. Many requests can be solved here in a couple of minutes.' : 'Company guidance plus the support runbooks. Employees never see runbooks or drafts, including in search.'}</p>
        </div>
        {user.role === 'ADMIN' && <div className="page-actions"><a className="btn" href="#/knowledge/new"><Icon name="plus" size={15} />New article</a></div>}
      </header>

      <section className="kb-search" aria-label="Search knowledge">
        <div className="help-field">
          <Icon name="search" size={18} />
          <input aria-label="Search articles" placeholder="Search guides, troubleshooting and company knowledge…" value={q}
            onChange={(e) => { setQ(e.target.value); const next = new URLSearchParams(query); if (e.target.value.trim()) next.set('q', e.target.value); else next.delete('q'); history.replaceState(null, '', `#/knowledge${next.toString() ? `?${next}` : ''}`); }} />
          {q && <button className="text-btn btn-sm" onClick={() => { setQ(''); location.hash = '/knowledge'; }}>Clear</button>}
        </div>
        {user.role === 'ADMIN' && (
          <label className="kb-status">Status
            <select aria-label="Article status filter" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {articleStatuses.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
            </select>
          </label>
        )}
      </section>

      {(searching || categoryId || status) ? (
        <section className="kb-results">
          <div className="section-title">
            <h2>{searching ? `Results for “${q.trim()}”` : current ? current.name : 'All articles'}</h2>
            <span className="muted t-caption">{results ? `${list && 'total' in list ? list.total : results.length} article${(list && 'total' in list ? list.total : 0) === 1 ? '' : 's'}` : ''}</span>
          </div>
          {!results ? <ResultsSkeleton /> : results.length ? (
            <ul className="kb-hits">{results.map((a) => <ResultRow key={a.id} a={a} />)}</ul>
          ) : (
            <EmptyState icon="search" title={`No articles found for “${q.trim() || current?.name}”`} action={<a className="btn" href="#/knowledge">Browse all categories</a>}>
              Try another search or browse all categories.
              {catalog && catalog.length > 0 && <> Still need help? <a href="#/tickets/new">Raise a request</a> and IT will route it.</>}
            </EmptyState>
          )}
        </section>
      ) : !overview ? <HomeSkeleton /> : (
        <>
          {recommended.length > 0 && (
            <section className="kb-block">
              <div className="section-title"><h2>Recommended for you</h2><span className="muted t-caption">{recommendedBecause ? `Because you have an open ${recommendedBecause.category?.name} ticket` : 'From your open work'}</span></div>
              <ul className="kb-hits">{recommended.map((a) => <ResultRow key={a.id} a={a} />)}</ul>
            </section>
          )}
          {helpfulRows.length > 0 && (
            <section className="kb-block">
              <div className="section-title"><h2>Most helpful</h2><span className="muted t-caption">Rated by colleagues</span></div>
              <ul className="kb-hits">{helpfulRows.map((a) => <ResultRow key={a.id} a={a} votes={a.helpfulVotes} />)}</ul>
            </section>
          )}
          {overview.categories.length > 0 && (
            <section className="kb-block">
              <div className="section-title"><h2>Browse by category</h2><span className="muted t-caption">{overview.total} articles</span></div>
              <ul className="kb-cats">
                {overview.categories.map((c) => (
                  <li key={c.id}>
                    <a href={`#/knowledge?category=${c.id}`}>
                      <span className="hr-icon" aria-hidden="true"><Icon name={categoryIcon(c.name)} size={18} /></span>
                      <span className="kb-cat-body"><strong>{c.name}</strong><small>{c.articles} article{c.articles === 1 ? '' : 's'}</small></span>
                      <Icon name="chevron" size={16} />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {recentRows.length > 0 && (
            <section className="kb-block">
              <div className="section-title"><h2>Recently updated</h2></div>
              <ul className="kb-hits">{recentRows.map((a) => <ResultRow key={a.id} a={a} />)}</ul>
            </section>
          )}
          {!overview.total && <EmptyState icon="book" title="No articles yet">{user.role === 'ADMIN' ? 'Write the first one — it will appear here and in search.' : 'IT has not published guidance yet.'}</EmptyState>}
        </>
      )}
    </div>
  );
}

/** A result carries enough context to choose: where it belongs, what it covers, how fresh it is. */
function ResultRow({ a, votes }: { a: ArticleSummary; votes?: number }) {
  return (
    <li className="kb-hit">
      <a href={`#/knowledge/${a.id}`}>
        <p className="eyebrow">{a.category.name.toUpperCase()}</p>
        <strong>{a.title}</strong>
        <span className="kb-meta">
          <span>Updated {fmtDay(a.updatedAt)}</span>
          {votes ? <><i aria-hidden="true">·</i><span>{votes} found this helpful</span></> : null}
          {a.visibility === 'SUPPORT' && <><i aria-hidden="true">·</i><span className="kb-restricted"><Icon name="lock" size={11} />Support only</span></>}
          {a.status !== 'PUBLISHED' && <><i aria-hidden="true">·</i><span className="kb-restricted">{statusLabel[a.status]}</span></>}
        </span>
      </a>
    </li>
  );
}

const HomeSkeleton = () => (
  <div className="kb-skeleton" aria-hidden="true">
    <div className="sk-line wide" /><div className="sk-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk-tile" />)}</div>
    <div className="sk-line" /><div className="sk-line" /><div className="sk-line" />
  </div>
);
const ResultsSkeleton = () => <div className="kb-skeleton" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <div key={i} className="sk-hit" />)}</div>;

/* ── Article ──────────────────────────────────────────────────────────── */

type Heading = { id: string; text: string; level: number };

function ArticleView({ id, user, act, busy, refresh }: { id: string; user: CurrentUser; act: Act; busy: boolean; refresh: number }) {
  const { data: a, error } = useRecord<Article>(`/articles/${id}`, refresh);
  const { data: siblings } = useRecord<Page<ArticleSummary>>(a ? `/articles?categoryId=${a.categoryId}&pageSize=12` : '/categories', refresh);
  const { data: catalog } = useRecord<CatalogItem[]>('/catalog');
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<ArticleFeedback | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState('');

  // Headings get stable ids so the contents list can address them. The HTML itself was sanitized
  // on the server; nothing here adds markup, only identifiers.
  const { html, headings } = useMemo(() => {
    if (!a) return { html: '', headings: [] as Heading[] };
    const doc = new DOMParser().parseFromString(`<div>${a.html}</div>`, 'text/html');
    const found: Heading[] = [];
    doc.querySelectorAll('h2, h3').forEach((h, i) => {
      const text = h.textContent ?? '';
      const slug = `s-${i}-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
      h.setAttribute('id', slug);
      found.push({ id: slug, text, level: h.tagName === 'H2' ? 2 : 3 });
    });
    return { html: doc.body.firstElementChild?.innerHTML ?? a.html, headings: found };
  }, [a]);

  useEffect(() => {
    if (!headings.length || !body.current) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: '-80px 0px -70% 0px' });
    body.current.querySelectorAll('h2, h3').forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [headings, html]);

  useEffect(() => { if (a?.feedback) setFeedback(a.feedback); }, [a?.id, a?.feedback]);

  if (error) return <ErrorState error={error} back={{ href: '#/knowledge', label: 'Knowledge' }} />;
  if (!a) return <ArticleSkeleton />;

  const minutes = readingMinutes(a.markdown);
  const related = (siblings && 'items' in siblings ? siblings.items : []).filter((x) => x.id !== a.id).slice(0, 5);
  // "Still need help?" offers only services that really sit in this article's category. Nothing is
  // recommended because it sounds related; the catalog item and the article share a category or
  // nothing is shown.
  const services = (catalog ?? []).filter((c) => c.categoryId === a.categoryId).slice(0, 3);
  const vote = (helpful: boolean) => void act(async () => { setFeedback(await api<ArticleFeedback>(`/articles/${a.id}/feedback`, 'POST', { helpful })); }, '');
  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}#/knowledge/${a.id}`;
    try { await navigator.clipboard.writeText(url); toast('success', 'Link copied.'); }
    catch { toast('info', url); }
  };

  return (
    <div className="emp kb-article">
      <div className="kb-crumbs">
        <a href="#/knowledge">Knowledge</a>
        <span aria-hidden="true">/</span>
        <a href={`#/knowledge?category=${a.categoryId}`}>{a.category.name}</a>
      </div>
      <div className="kb-layout">
        <nav className="kb-side" aria-label="Category articles">
          <p className="eyebrow">{a.category.name.toUpperCase()}</p>
          <ul>
            {(siblings && 'items' in siblings ? siblings.items : []).map((s) => (
              <li key={s.id}><a href={`#/knowledge/${s.id}`} aria-current={s.id === a.id ? 'page' : undefined} className={s.id === a.id ? 'active' : ''}>{s.title}</a></li>
            ))}
          </ul>
          <a className="text-btn" href={`#/knowledge?category=${a.categoryId}`}>All {a.category.name} articles →</a>
        </nav>

        <article className="kb-main">
          <header className="kb-head">
            <p className="eyebrow">{a.category.name.toUpperCase()}</p>
            <h1>{a.title}</h1>
            <p className="kb-byline">
              <span>Updated {fmtDay(a.updatedAt)}</span><i aria-hidden="true">·</i><span>{minutes} min read</span>
              {a.author && <><i aria-hidden="true">·</i><span>{a.author.name}</span></>}
              {a.visibility === 'SUPPORT' && <><i aria-hidden="true">·</i><span className="kb-restricted"><Icon name="lock" size={11} />Support team only</span></>}
              {a.status !== 'PUBLISHED' && <><i aria-hidden="true">·</i><span className="kb-restricted">{statusLabel[a.status]}</span></>}
            </p>
            <div className="kb-actions">
              <button className="btn-sm" onClick={copyLink}><Icon name="link" size={14} />Copy link</button>
              {user.role === 'ADMIN' && <button className="btn-sm" onClick={() => setEditing(!editing)}><Icon name="edit" size={14} />{editing ? 'Stop editing' : 'Edit'}</button>}
              {user.role === 'ADMIN' && a.status !== 'ARCHIVED' && (
                <button className="btn-sm" disabled={busy} onClick={() => void act(async () => { await api(`/articles/${a.id}`, 'PUT', { version: a.version, article: { title: a.title, markdown: a.markdown, categoryId: a.categoryId, visibility: a.visibility, status: 'ARCHIVED' } }); }, 'Article archived.')}><Icon name="archive" size={14} />Archive</button>
              )}
            </div>
          </header>

          {headings.length >= 3 && (
            <details className="kb-toc-mobile" open={tocOpen} onToggle={(e) => setTocOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary>Contents</summary>
              <ol>{headings.map((h) => <li key={h.id} className={`lvl-${h.level}`}><a href={`#/knowledge/${a.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTocOpen(false); }}>{h.text}</a></li>)}</ol>
            </details>
          )}

          {/* Server-sanitized HTML: scripts, event handlers and non-http(s) schemes are stripped before it is stored in the response. */}
          <div className="article-body" ref={body} dangerouslySetInnerHTML={{ __html: html }} />

          <section className="kb-verdict" aria-label="Was this helpful?">
            <div>
              <strong>Was this helpful?</strong>
              {feedback && (feedback.helpful + feedback.notHelpful > 0)
                ? <small className="muted">{feedback.helpful} of {feedback.helpful + feedback.notHelpful} {feedback.helpful + feedback.notHelpful === 1 ? 'person' : 'people'} found this helpful</small>
                : <small className="muted">Nobody has rated this yet.</small>}
            </div>
            <div className="kb-vote">
              <button className={feedback?.mine === true ? 'active' : ''} aria-pressed={feedback?.mine === true} disabled={busy} onClick={() => vote(true)}><Icon name="thumbUp" size={15} />Helpful</button>
              <button className={feedback?.mine === false ? 'active' : ''} aria-pressed={feedback?.mine === false} disabled={busy} onClick={() => vote(false)}><Icon name="thumbDown" size={15} />Not helpful</button>
            </div>
          </section>

          {editing && user.role === 'ADMIN' && <ArticleForm key={`${a.id}-${a.version}`} article={a} act={act} busy={busy} />}
        </article>

        <aside className="kb-aside">
          {headings.length >= 3 && (
            <nav className="kb-toc" aria-label="On this page">
              <p className="eyebrow">ON THIS PAGE</p>
              <ol>
                {headings.map((h) => (
                  <li key={h.id} className={`lvl-${h.level} ${active === h.id ? 'active' : ''}`}>
                    <a href={`#${h.id}`} aria-current={active === h.id ? 'true' : undefined} onClick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{h.text}</a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <section className="kb-panel">
            <p className="eyebrow">ARTICLE DETAILS</p>
            <dl className="ctx-list">
              <div><dt>Category</dt><dd><a href={`#/knowledge?category=${a.categoryId}`}>{a.category.name}</a></dd></div>
              <div><dt>Audience</dt><dd>{visibilityLabel[a.visibility]}</dd></div>
              {user.role === 'ADMIN' && <div><dt>Status</dt><dd>{statusLabel[a.status]}</dd></div>}
              <div><dt>Published</dt><dd>{a.publishedAt ? fmtDay(a.publishedAt) : 'Not published'}</dd></div>
              <div><dt>Reading time</dt><dd>{minutes} min</dd></div>
            </dl>
          </section>
          {services.length > 0 && (
            <section className="kb-panel kb-help">
              <p className="eyebrow">STILL NEED HELP?</p>
              <ul className="kb-services">
                {services.map((c) => (
                  <li key={c.id}><a href={`#/tickets/new?service=${c.id}`}><span className="hr-icon" aria-hidden="true">{catalogIcon(c.icon)}</span><span><strong>{c.name}</strong><small>{labels[c.type]}{c.requiresApproval ? ' · needs approval' : ''}</small></span><Icon name="arrow" size={14} /></a></li>
                ))}
              </ul>
              <a className="text-btn" href="#/ask"><Icon name="spark" size={13} />Ask OpsPilot instead</a>
            </section>
          )}
          {related.length > 0 && (
            <section className="kb-panel">
              <p className="eyebrow">RELATED IN {a.category.name.toUpperCase()}</p>
              <ul className="kb-related">{related.map((r) => <li key={r.id}><a href={`#/knowledge/${r.id}`}>{r.title}</a></li>)}</ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

const ArticleSkeleton = () => (
  <div className="emp kb-article" aria-hidden="true">
    <div className="kb-layout">
      <div className="kb-side"><div className="sk-line" /><div className="sk-line" /><div className="sk-line" /></div>
      <div className="kb-main kb-skeleton"><div className="sk-title" /><div className="sk-line wide" /><div className="sk-para" /><div className="sk-para" /><div className="sk-para short" /></div>
      <div className="kb-aside"><div className="sk-tile" /><div className="sk-tile" /></div>
    </div>
  </div>
);

/* ── Authoring (administrators) ───────────────────────────────────────── */

function ArticleForm({ article, act, busy }: { article?: Article; act: Act; busy: boolean }) {
  const { data: categories, error } = useRecord<Category[]>('/categories');
  return (
    <form
      className="emp-surface request-form kb-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        const body = { title: f.title, markdown: f.markdown, categoryId: f.categoryId, visibility: f.visibility, status: f.status };
        void act(async () => {
          const saved = await api<Article>(article ? `/articles/${article.id}` : '/articles', article ? 'PUT' : 'POST', article ? { version: article.version, article: body } : body);
          location.hash = `/knowledge/${saved.id}`;
        }, 'Article saved.');
      }}
    >
      <div className="section-title"><h2>{article ? 'Edit article' : 'New article'}</h2></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="field"><label htmlFor="kb-title" className="required">Title</label><input id="kb-title" name="title" defaultValue={article?.title} required minLength={5} maxLength={160} /></div>
      <div className="two-grid">
        <div className="field"><label htmlFor="kb-category" className="required">Category</label>
          <select id="kb-category" aria-label="Category" name="categoryId" defaultValue={article?.categoryId ?? ''} required>
            <option value="" disabled>Choose a category</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="kb-visibility">Visibility</label>
          <select id="kb-visibility" aria-label="Visibility" name="visibility" defaultValue={article?.visibility ?? 'EMPLOYEE'}>
            {articleVisibilities.map((v) => <option key={v} value={v}>{visibilityLabel[v]}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="kb-status">Status</label>
          <select id="kb-status" aria-label="Status" name="status" defaultValue={article?.status ?? 'DRAFT'}>
            {articleStatuses.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label htmlFor="kb-markdown" className="required">Markdown content</label>
        <textarea id="kb-markdown" aria-label="Markdown content" name="markdown" rows={16} required minLength={10} maxLength={20000} defaultValue={article?.markdown}
          placeholder={'## Heading\n\nWrite the guidance here. Markdown is sanitized on the server before it is rendered.'} />
      </div>
      <p className="muted fine">Rendered Markdown is sanitized server-side: scripts, inline event handlers and non-http(s) link schemes are removed. Archiving keeps the article for administrators and removes it from everyone else.</p>
      <div className="form-actions"><a className="btn" href="#/knowledge">Cancel</a><span className="grow" /><button className="primary" disabled={busy || !categories}>{busy ? 'Saving…' : 'Save article'}</button></div>
    </form>
  );
}
