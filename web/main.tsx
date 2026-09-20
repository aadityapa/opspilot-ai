import React, { Suspense, lazy, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { api, setCsrf, ApiError, UNAUTHENTICATED_EVENT } from './api';
import {
  labels,
  statuses,
  priorities,
  transitions,
  type Ticket,
  type CurrentUser,
  type Person,
  type Metrics,
} from '../shared/model';
import './style.css';
import { Icon, Logo } from './ui/icons';
import { Modal, ToastHost } from './ui';
import { buildNav, routeCrumbs, useMedia, Sidebar, CreateMenu, Header } from './app-shell';
import {AssetsPage} from './assets';
import {TicketWorkspace} from './ticket';
import {KnowledgePage} from './knowledge';
import {AskPage} from './ai';
import {AccountPage,ForcedPasswordChange,ForgotPassword,MfaEnrol,MfaVerify,ResetPassword,type AuthState} from './account';
import {CommandPalette,NotificationBell,ProfileMenu,useLive} from './shell';
import {HomePage} from './myspace';
import {MyRequestsPage,RequestDetailPage} from './requests';
import {ApprovalsPage} from './approvals';
import {DeskPage} from './desk';
import {NewRequestPage} from './catalog';
import {DirectoryPage,ProfilePage} from './people';
import {DepartmentPage,DepartmentsPage} from './departments';
// Staff and administrator surfaces load on demand: an employee's first paint never pays for
// analytics, reports or the control plane. Each one falls back to its own layout-shaped skeleton.
const OverviewPage = lazy(() => import('./overview').then((m) => ({ default: m.OverviewPage })));
const AnalyticsPage = lazy(() => import('./analytics').then((m) => ({ default: m.AnalyticsPage })));
const ReportsPage = lazy(() => import('./reports').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('./admin').then((m) => ({ default: m.SettingsPage })));
const WorkspaceAdminPage = lazy(() => import('./workspace-admin').then((m) => ({ default: m.WorkspaceAdminPage })));
const UsersPage = lazy(() => import('./users').then((m) => ({ default: m.UsersPage })));
const AdminOverview = lazy(() => import('./admin-pages').then((m) => ({ default: m.AdminOverview })));
const RolesPage = lazy(() => import('./admin-pages').then((m) => ({ default: m.RolesPage })));
const WorkflowPage = lazy(() => import('./admin-pages').then((m) => ({ default: m.WorkflowPage })));
const SecurityPage = lazy(() => import('./admin-pages').then((m) => ({ default: m.SecurityPage })));
const DataPage = lazy(() => import('./admin-pages').then((m) => ({ default: m.DataPage })));
const RouteFallback = () => <div className="kb-skeleton route-skeleton" role="status" aria-label="Loading"><div className="sk-title" /><div className="sk-line wide" /><div className="sk-grid"><div className="sk-tile" /><div className="sk-tile" /><div className="sk-tile" /></div></div>;
import {NotificationsCenterPage} from './notify';
type Category = { id: string; name: string };
const date = (s: string) =>
  new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const number = (t: Ticket) => `OPS-${String(t.number).padStart(4, '0')}`;
const badge = (value: string) => (
  <span className={`badge ${value.toLowerCase()}`}>{labels[value] ?? value}</span>
);
/**
 * Sign in again without leaving the page. Nothing underneath is unmounted, so a half-written reply or
 * a filtered list survives. The email is fixed to the signed-in account; signing in as someone else
 * reloads the application so no state leaks between people.
 */
function SessionExpired({ email, onSignedIn, onLeave }: { email: string; onSignedIn: (r: AuthState) => void; onLeave: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="Your session has ended" onClose={onLeave}>
      <form
        id="reauth-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true); setError('');
          api<AuthState>('/auth/login', 'POST', { email, password: f.get('password') })
            .then((r) => { if (r.mfaRequired || r.mfaEnrollmentRequired) location.reload(); else onSignedIn(r); })
            .catch((err) => setError(err instanceof Error ? err.message : 'Sign-in failed'))
            .finally(() => setBusy(false));
        }}
      >
        <p className="t-body">Sign in again to continue as <strong>{email}</strong>. Anything you were typing on this page is still here.</p>
        {error && <div role="alert" className="alert error">{error}</div>}
        <div className="field" style={{ marginTop: 'var(--s3)' }}>
          <label htmlFor="reauth-password">Password</label>
          <input id="reauth-password" name="password" type="password" autoComplete="current-password" required maxLength={128} />
        </div>
        <div className="form-actions"><button type="button" onClick={onLeave}>Go to sign-in page</button><span className="grow" /><button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
      </form>
    </Modal>
  );
}

function App() {
  const [user, setUser] = useState<CurrentUser | null>(null),
    [boot, setBoot] = useState(true),
    [route, setRoute] = useState(location.hash.slice(1) || '/'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [dark, setDark] = useState(localStorage.getItem('theme') === 'dark'),
    [collapsed, setCollapsed] = useState(localStorage.getItem('opspilot:sidebar') === 'collapsed'),
    [navOpen, setNavOpen] = useState(false);
  const mobile = useMedia('(max-width: 900px)');
  useEffect(() => { localStorage.setItem('opspilot:sidebar', collapsed ? 'collapsed' : 'open'); }, [collapsed]);
  useEffect(() => { setNavOpen(false); }, [route]);
  // Everything the server said about the session beyond the user: pending second factor, required
  // enrolment, forced password change. `user` stays null until the session is fully verified.
  const [auth, setAuth] = useState<AuthState | null>(null),
    [view, setView] = useState<'login' | 'forgot'>('login'),
    [palette, setPalette] = useState(false);
  // The session ended while the workspace is open (expiry, revoked elsewhere, server restart with a
  // new secret). The workspace stays mounted — drafts, filters and scroll position with it — and a
  // dialog asks for the password again. Only a different account, or a second factor, sends the
  // person through the full sign-in page.
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!user) { setExpired(false); return; }
    const onExpired = () => setExpired(true);
    window.addEventListener(UNAUTHENTICATED_EVENT, onExpired);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onExpired);
  }, [user]);
  // Live hints from the server: refetch what is on screen, at most a few times a second.
  const liveTimer = useRef<number | null>(null);
  const live = useLive(!!user, () => {
    if (liveTimer.current) return;
    liveTimer.current = window.setTimeout(() => { liveTimer.current = null; setRefresh((n) => n + 1); }, 400);
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
      if (e.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  function applyAuth(r: AuthState) {
    setCsrf(r.csrfToken);
    setAuth(r);
    setUser(r.user);
  }
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    const onHash = () => {
      setRoute(location.hash.slice(1) || '/');
      setError('');
      setNotice('');
    };
    window.addEventListener('hashchange', onHash);
    api<AuthState>('/auth/me')
      .then(applyAuth)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) setError(e.message);
      })
      .finally(() => setBoot(false));
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  async function act(work: () => Promise<void>, success = '') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(success);
      setRefresh((n) => n + 1);
    } catch (e) {
      // A 401 while signed in is handled by the re-authentication dialog (see `expired`) and the work
      // stays on screen; the message is still shown (it is the sign-in page's own feedback too).
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  if (boot)
    return (
      <div className="loading" role="status">
        Loading OpsPilot…
      </div>
    );
  if (route.startsWith('/reset/') && !user)
    return <ResetPassword token={route.slice('/reset/'.length)} busy={busy} act={act} error={error} onDone={() => { location.hash = '/'; setView('login'); }} />;
  if (!user && auth?.mfaRequired)
    return <MfaVerify busy={busy} act={act} error={error} onDone={applyAuth} />;
  if (!user && auth?.mfaEnrollmentRequired && auth.account)
    return <MfaEnrol gated account={auth.account} busy={busy} act={act} error={error} onDone={(s) => s && applyAuth(s)} />;
  if (!user && view === 'forgot')
    return <ForgotPassword busy={busy} act={act} error={error} notice={notice} onBack={() => { setView('login'); setError(''); setNotice(''); }} />;
  if (user && auth?.mustChangePassword)
    return <ForcedPasswordChange user={user} busy={busy} act={act} error={error} onDone={() => setAuth({ ...auth, mustChangePassword: false })} />;
  if (!user)
    return (
      <div className="login">
        <section className="login-story" aria-label="About OpsPilot">
          <div className="brand">
            <span className="brand-mark"><Logo size={30} /></span>
            <span><strong>OpsPilot</strong><small>Enterprise Service Operations</small></span>
          </div>
          <div className="login-pitch">
            <h1>Keep services moving.</h1>
            <p>Connect employees, IT operations, knowledge, assets and service delivery in one intelligent workspace.</p>
            <ul className="login-points">
              <li><Icon name="users" size={16} /><span><strong>People</strong> find answers and request services without learning ITSM.</span></li>
              <li><Icon name="activity" size={16} /><span><strong>Operations</strong> see, prioritise, investigate and act from one queue.</span></li>
              <li><Icon name="chart" size={16} /><span><strong>Leadership</strong> reads service health and direction, not vanity numbers.</span></li>
            </ul>
          </div>
          {/* Product preview: abstract surfaces, no figures — nothing here pretends to be live data. */}
          <div className="login-preview" aria-hidden="true">
            <div className="lp-window">
              <div className="lp-bar"><i /><i /><i /></div>
              <div className="lp-body">
                <div className="lp-side"><i className="w" /><i /><i /><i className="on" /><i /><i /></div>
                <div className="lp-main">
                  <div className="lp-strip"><span /><span /><span /><span /></div>
                  <div className="lp-rows"><span className="ok" /><span className="ok" /><span className="warn" /><span className="ok" /><span className="crit" /><span className="ok" /></div>
                  <div className="lp-cards"><span /><span /></div>
                </div>
              </div>
            </div>
          </div>
          <small className="login-foot">Reviewed AI assistance · Fictional demo workspace</small>
        </section>
        <main className="login-main">
          <form
            className="login-card"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(async () => {
                const r = await api<AuthState>('/auth/login', 'POST', {
                  email: f.get('email'),
                  password: f.get('password'),
                });
                applyAuth(r);
              });
            }}
          >
            <p className="eyebrow">WELCOME BACK</p>
            <h2>Sign in to your OpsPilot workspace.</h2>
            <p className="muted">Use the account provided by your administrator.</p>
            {error && (
              <div role="alert" className="alert error">
                {error}
              </div>
            )}
            <div className="field">
              <label htmlFor="login-email">Work email</label>
              <input id="login-email" name="email" type="email" autoComplete="username" required placeholder="you@company.com" aria-label="Email address" />
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={128} aria-label="Password" />
            </div>
            <button disabled={busy} className="primary btn-lg">
              {busy ? 'Signing in…' : 'Sign in'}
              {!busy && <Icon name="arrow" />}
            </button>
            <button type="button" className="text-btn" onClick={() => { setView('forgot'); setError(''); }}>
              Forgotten your password?
            </button>
            <p className="muted fine">
              Accounts are provisioned by your administrator; there is no self-registration.
            </p>
          </form>
        </main>
      </div>
    );
  const staff = user.role !== 'EMPLOYEE';
  const groups = buildNav(user);
  const signOut = () => void act(async () => { await api('/auth/logout', 'POST', {}); setUser(null); setAuth(null); setCsrf(''); location.hash = '/'; });
  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''} ${navOpen ? 'nav-open' : ''}`}>
      {expired && (
        <SessionExpired
          email={user.email}
          onSignedIn={(r) => {
            if (!r.user || r.user.id !== user.id) { location.reload(); return; }
            applyAuth(r);
            setExpired(false);
            setRefresh((n) => n + 1);
          }}
          onLeave={() => { setExpired(false); setUser(null); setAuth(null); setCsrf(''); location.hash = '/'; }}
        />
      )}
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <Sidebar groups={groups} route={route} collapsed={collapsed && !mobile} onNavigate={() => setNavOpen(false)} />
      {mobile && navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <div className="workspace">
        <Header
          crumbs={routeCrumbs(route, groups)}
          mobile={mobile}
          collapsed={collapsed}
          navOpen={navOpen}
          onToggleNav={() => (mobile ? setNavOpen((o) => !o) : setCollapsed((c) => !c))}
          onSearch={() => setPalette(true)}
          dark={dark}
          onTheme={() => setDark(!dark)}
        >
          <CreateMenu user={user} />
          <a className="icon-btn ai-btn" href="#/ask" aria-label="Open Ask OpsPilot" data-tip="Ask OpsPilot"><Icon name="spark" /></a>
          <NotificationBell user={user} refresh={refresh} act={act} />
          <ProfileMenu user={user} dark={dark} busy={busy} onTheme={() => setDark(!dark)} onSignOut={signOut} />
        </Header>
        <CommandPalette user={user} open={palette} onClose={() => setPalette(false)} />
        <main id="main" tabIndex={-1}>
          <Suspense fallback={<RouteFallback />}>
          <div aria-live="polite">{notice && <div className="alert success">{notice}</div>}</div>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {route === '/' ? (
            <HomePage user={user} refresh={refresh} />
          ) : (route === '/dashboard' || route.startsWith('/dashboard?')) && staff ? (
            <OverviewPage user={user} refresh={refresh} route={route} />
          ) : route.startsWith('/board') || route.startsWith('/desk') || route === '/tickets' || route.startsWith('/tickets?') ? (
            <DeskPage route={route} user={user} act={act} busy={busy} refresh={refresh} />
          ) : route.startsWith('/approvals') ? (
            <ApprovalsPage user={user} act={act} busy={busy} refresh={refresh} route={route} />
          ) : route === '/people' || route.startsWith('/people?') ? (
            <DirectoryPage user={user} refresh={refresh} route={route} />
          ) : route === '/departments' ? (
            <DepartmentsPage user={user} refresh={refresh} />
          ) : route.startsWith('/departments/') ? (
            <DepartmentPage id={route.split('/')[2]} user={user} refresh={refresh} />
          ) : route.startsWith('/people/') ? (
            <ProfilePage id={route.split('/')[2].split('?')[0]} user={user} act={act} busy={busy} refresh={refresh} route={route} />
          ) : (route === '/reports' || route.startsWith('/reports?') || route.startsWith('/reports/')) && staff ? (
            <ReportsPage refresh={refresh} route={route} />
          ) : (route === '/analytics' || route.startsWith('/analytics?')) && staff ? (
            <AnalyticsPage user={user} refresh={refresh} route={route} />
          ) : (route.startsWith('/admin') || route.startsWith('/settings') || route === '/users') && user.role === 'ADMIN' ? (
            <Administration route={route} user={user} act={act} busy={busy} refresh={refresh} />
          ) : route === '/requests' || route.startsWith('/requests?') ? (
            <MyRequestsPage user={user} route={route} refresh={refresh} />
          ) : route.startsWith('/requests/') ? (
            <RequestDetailPage id={route.split('/')[2].split('?')[0]} user={user} act={act} busy={busy} refresh={refresh} />
          ) : route === '/tickets/new' || route.startsWith('/tickets/new?') ? (
            <NewRequestPage user={user} busy={busy} act={act} route={route} />
          ) : route.startsWith('/tickets/') ? (
            <TicketWorkspace id={route.split('/')[2].split('?')[0]} user={user} refresh={refresh} busy={busy} act={act} route={route} />
          ) : route.startsWith('/assets') ? (
            <AssetsPage route={route} user={user} act={act} busy={busy} refresh={refresh} />
          ) : route.startsWith('/knowledge') ? (
            <KnowledgePage route={route} user={user} act={act} busy={busy} refresh={refresh} />
          ) : route === '/ask' || route.startsWith('/ask?') ? (
            <AskPage refresh={refresh} />
          ) : route === '/notifications' ? (
            <NotificationsCenterPage user={user} act={act} busy={busy} refresh={refresh} />
          ) : route === '/account' ? (
            <AccountPage user={user} refresh={refresh} busy={busy} act={act} mfaEnabled={!!auth?.mfaEnabled} onMfaChange={(enabled) => setAuth((a) => (a ? { ...a, mfaEnabled: enabled } : a))} />
          ) : RESTRICTED.some((prefix) => route === prefix || route.startsWith(`${prefix}/`) || route.startsWith(`${prefix}?`)) ? (
            <Denied user={user} />
          ) : (
            <NotFound user={user} />
          )}
          </Suspense>
        </main>
        <footer className="app-foot">
          <span>OpsPilot AI · Secure, connected IT support</span>
          <span className="app-foot-right">
            {live === 'reconnecting' && <span className="live-state" role="status"><i aria-hidden="true" />Live updates reconnecting…</span>}
            <span>Reviewed AI assistance · demo data</span>
          </span>
        </footer>
        <ToastHost />
      </div>
    </div>
  );
}
type Act = (work: () => Promise<void>, success?: string) => Promise<void>;
/** Same contract as useRecord: data is never returned for a path other than the one requested. */
function useData<T>(path: string, refresh = 0) {
  const [state, setState] = useState<{ path: string; data?: T; error: string }>({ path, error: '' });
  useEffect(() => {
    let live = true;
    setState({ path, error: '' });
    api<T>(path)
      .then((d) => {
        if (live) setState({ path, data: d, error: '' });
      })
      .catch((e) => {
        if (live) setState({ path, error: e.message });
      });
    return () => {
      live = false;
    };
  }, [path, refresh]);
  return state.path === path ? { data: state.data, error: state.error } : { data: undefined, error: '' };
}
function State({ error }: { error?: string }) {
  return error ? (
    <div className="alert error" role="alert">
      {error}
    </div>
  ) : (
    <div className="loading" role="status">
      Loading workspace data…
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
const NewLink = () => (
  <a className="primary" href="#/tickets/new">
    <Icon name="plus" />
    New ticket
  </a>
);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/** One entry for the control plane: `/admin/*`, plus the older `/settings/*` and `/users` paths, which keep working. */
function Administration({ route, user, act, busy, refresh }: { route: string; user: CurrentUser; act: Act; busy: boolean; refresh: number }) {
  const path = route.split('?')[0];
  const section = path === '/users' ? 'users' : path.startsWith('/settings/') ? path.split('/')[2] : path.split('/')[2] ?? 'overview';
  switch (section) {
    case 'catalog': case 'templates': case 'departments': case 'announcements': return <WorkspaceAdminPage section={section} act={act} busy={busy} refresh={refresh} />;
    case 'sla': case 'audit': case 'outbox': case 'ai': return <SettingsPage section={section} act={act} busy={busy} refresh={refresh} />;
    case 'users': return <UsersPage refresh={refresh} busy={busy} act={act} currentId={user.id} />;
    case 'roles': return <RolesPage />;
    case 'workflow': return <WorkflowPage />;
    case 'security': return <SecurityPage refresh={refresh} />;
    case 'data': return <DataPage act={act} busy={busy} refresh={refresh} />;
    default: return <AdminOverview refresh={refresh} />;
  }
}

/** Areas that exist but are role-gated. A signed-in person who lands here is told so, without permission internals. */
const RESTRICTED = ['/admin', '/settings', '/users', '/dashboard', '/analytics', '/reports'];
function Denied({ user }: { user: CurrentUser }) {
  const staff = user.role !== 'EMPLOYEE';
  return (
    <div className="state-page" role="alert">
      <p className="eyebrow">403</p>
      <h1>You don’t have access to this area.</h1>
      <p className="muted">If you believe you need access, contact your OpsPilot administrator.</p>
      <div className="page-actions"><a className="primary" href="#/">Return home</a>{staff && <a className="btn" href="#/tickets">Open Service Desk</a>}</div>
    </div>
  );
}
function NotFound({ user }: { user: CurrentUser }) {
  const staff = user.role !== 'EMPLOYEE';
  return (
    <div className="state-page">
      <p className="eyebrow">404</p>
      <h1>We couldn’t find that page.</h1>
      <p className="muted">The link may be outdated or you may not have access.</p>
      <div className="page-actions"><a className="primary" href="#/">Go to My Space</a>{staff ? <a className="btn" href="#/tickets">Open Service Desk</a> : <a className="btn" href="#/requests">My requests</a>}</div>
    </div>
  );
}
