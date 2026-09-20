import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { api, setCsrf } from './api';
import { Pending, useRecord, when, type Act } from './operations';
import type { CurrentUser } from '../shared/model';

/** What the server tells a client about where its session stands. */
export interface AuthState {
  user: CurrentUser | null;
  csrfToken: string;
  mfaRequired?: boolean;
  mfaEnrollmentRequired?: boolean;
  mustChangePassword?: boolean;
  mfaEnabled?: boolean;
  account?: { name: string; email: string };
}

const fields = (e: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;

function Gate({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return (
    <div className="login">
      <main className="login-main" style={{ gridColumn: '1 / -1' }}>
        <div className="login-card">
          <div className="brand"><span className="brand-mark">O</span> OpsPilot <span className="ai-tag">AI</span></div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          {children}
        </div>
      </main>
    </div>
  );
}

/** Second step of sign-in: a six-digit code from the authenticator, or a recovery code. */
export function MfaVerify({ onDone, busy, act, error }: { onDone: (s: AuthState) => void; busy: boolean; act: Act; error: string }) {
  return (
    <Gate eyebrow="TWO-FACTOR AUTHENTICATION" title="Enter your verification code">
      <p className="muted">Open your authenticator app and enter the current six-digit code, or use one of your recovery codes.</p>
      {error && <div role="alert" className="alert error">{error}</div>}
      <form onSubmit={(e) => { e.preventDefault(); const f = fields(e); void act(async () => { const r = await api<AuthState>('/auth/mfa/verify', 'POST', { code: f.code }); setCsrf(r.csrfToken); onDone(r); }); }}>
        <label>Verification code<input name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required minLength={6} maxLength={20} placeholder="123 456" /></label>
        <button disabled={busy} className="primary">{busy ? 'Checking…' : 'Verify'}</button>
      </form>
      <button className="text-btn" onClick={() => void act(async () => { await api('/auth/logout', 'POST', {}); onDone({ user: null, csrfToken: '' }); })}>Cancel and sign out</button>
    </Gate>
  );
}

/** Enrolment, used both from the account page and as a gate when policy requires it. */
export function MfaEnrol({ account, onDone, busy, act, gated, error }: { account: { name: string; email: string }; onDone: (s: AuthState | null) => void; busy: boolean; act: Act; gated: boolean; error: string }) {
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [qr, setQr] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [verified, setVerified] = useState<AuthState | null>(null);
  useEffect(() => {
    void api<{ secret: string; otpauth: string }>('/auth/mfa/setup', 'POST', {}).then(async (s) => { setSetup(s); setQr(await QRCode.toDataURL(s.otpauth, { margin: 1, width: 196 })); }).catch(() => {});
  }, []);
  const body = codes ? (
    <>
      <div className="alert success">Two-factor authentication is on for {account.email}.</div>
      <p><strong>Save these recovery codes now.</strong> Each works once, and they are the only way in if you lose your phone. They will not be shown again.</p>
      <pre className="recovery-codes" aria-label="Recovery codes">{codes.join('\n')}</pre>
      <button className="primary" onClick={() => onDone(verified)}>I have saved them</button>
    </>
  ) : (
    <>
      <p className="muted">{gated ? 'Your role requires a second factor. ' : ''}Scan the code with an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password, Aegis…), then enter the six-digit code it shows.</p>
      {error && <div role="alert" className="alert error">{error}</div>}
      {setup ? (
        <div className="mfa-setup">
          {qr && <img src={qr} alt="QR code for the authenticator app" width={196} height={196} />}
          <p className="muted fine">Cannot scan? Enter this key manually:<br /><code className="secret-key">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code></p>
        </div>
      ) : <Pending error="" />}
      <form onSubmit={(e) => { e.preventDefault(); const f = fields(e); void act(async () => { const r = await api<AuthState & { recoveryCodes: string[] }>('/auth/mfa/enable', 'POST', { code: f.code }); setCsrf(r.csrfToken); setCodes(r.recoveryCodes); setVerified(r); }); }}>
        <label>Code from the app<input name="code" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={8} placeholder="123 456" /></label>
        <button disabled={busy || !setup} className="primary">{busy ? 'Checking…' : 'Turn on two-factor authentication'}</button>
      </form>
      {gated && <button className="text-btn" onClick={() => void act(async () => { await api('/auth/logout', 'POST', {}); onDone({ user: null, csrfToken: '' }); })}>Cancel and sign out</button>}
    </>
  );
  return gated ? <Gate eyebrow="SET UP TWO-FACTOR AUTHENTICATION" title={`Protect ${account.name}'s account`}>{body}</Gate> : <section className="panel">{body}</section>;
}

/** Shown when an administrator created the account or flagged it: nothing else works until this is done. */
export function ForcedPasswordChange({ user, onDone, busy, act, error }: { user: CurrentUser; onDone: () => void; busy: boolean; act: Act; error: string }) {
  return (
    <Gate eyebrow="FIRST SIGN-IN" title={`Choose your own password, ${user.name.split(' ')[0]}`}>
      <p className="muted">The password you were given is temporary. Pick a new one — at least 12 characters, and not something on the common-password list.</p>
      {error && <div role="alert" className="alert error">{error}</div>}
      <PasswordChangeForm busy={busy} act={act} onDone={onDone} />
    </Gate>
  );
}

function PasswordChangeForm({ busy, act, onDone }: { busy: boolean; act: Act; onDone?: () => void }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = fields(e); const form = e.currentTarget; void act(async () => { if (f.newPassword !== f.confirm) throw new Error('The two new passwords do not match'); await api('/auth/password', 'POST', { currentPassword: f.currentPassword, newPassword: f.newPassword }); form.reset(); onDone?.(); }, 'Password changed. Other devices have been signed out.'); }}>
      <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
      <label>New password<input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
      <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
      <button disabled={busy} className="primary">{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  );
}

export function ForgotPassword({ onBack, busy, act, error, notice }: { onBack: () => void; busy: boolean; act: Act; error: string; notice: string }) {
  return (
    <Gate eyebrow="PASSWORD RESET" title="Forgotten your password?">
      <p className="muted">Enter your email address. If it has an account, a reset link will be sent. If mail is not set up for this workspace, ask an administrator to issue a link instead.</p>
      {error && <div role="alert" className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}
      <form onSubmit={(e) => { e.preventDefault(); const f = fields(e); void act(async () => { await api('/auth/forgot', 'POST', { email: f.email }); }, 'If that address has an account, a reset link is on its way.'); }}>
        <label>Email address<input name="email" type="email" autoComplete="username" required /></label>
        <button disabled={busy} className="primary">{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <button className="text-btn" onClick={onBack}>Back to sign in</button>
    </Gate>
  );
}

export function ResetPassword({ token, onDone, busy, act, error }: { token: string; onDone: () => void; busy: boolean; act: Act; error: string }) {
  return (
    <Gate eyebrow="PASSWORD RESET" title="Choose a new password">
      {error && <div role="alert" className="alert error">{error}</div>}
      <form onSubmit={(e) => { e.preventDefault(); const f = fields(e); void act(async () => { if (f.password !== f.confirm) throw new Error('The two passwords do not match'); await api('/auth/reset', 'POST', { token, password: f.password }); onDone(); }, 'Password updated. Sign in with the new one.'); }}>
        <label>New password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} autoFocus /></label>
        <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
        <button disabled={busy} className="primary">{busy ? 'Saving…' : 'Set new password'}</button>
      </form>
      <a className="text-btn" href="#/" onClick={onDone}>Back to sign in</a>
    </Gate>
  );
}

interface SessionRow { id: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; expiresAt: string; current: boolean }

function browserOf(agent: string | null) {
  if (!agent) return 'Unknown client';
  if (/Edg\//.test(agent)) return 'Microsoft Edge';
  if (/Firefox\//.test(agent)) return 'Firefox';
  if (/Chrome\//.test(agent) && !/Chromium/.test(agent)) return 'Chrome';
  if (/HeadlessChrome|Chromium/.test(agent)) return 'Chromium';
  if (/Safari\//.test(agent)) return 'Safari';
  return agent.split(' ')[0].slice(0, 40);
}

export function AccountPage({ user, act, busy, refresh, mfaEnabled, onMfaChange }: { user: CurrentUser; act: Act; busy: boolean; refresh: number; mfaEnabled: boolean; onMfaChange: (enabled: boolean) => void }) {
  const [enrolling, setEnrolling] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const { data: sessions, error } = useRecord<SessionRow[]>('/auth/sessions', refresh);
  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>{user.name}</h1><p className="muted">{user.email}</p></div></div>
      <div className="detail-grid">
        <div>
          <section className="panel">
            <h2>Two-factor authentication</h2>
            {mfaEnabled ? (
              <>
                <p><span className="badge resolved">On</span> Your account asks for a code from your authenticator app at every sign-in.</p>
                {newCodes && <><p><strong>New recovery codes.</strong> The old ones no longer work.</p><pre className="recovery-codes">{newCodes.join('\n')}</pre></>}
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); const f = fields(e); const form = e.currentTarget; void act(async () => { const r = await api<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', 'POST', { code: f.code }); setNewCodes(r.recoveryCodes); form.reset(); }, 'Recovery codes regenerated.'); }}>
                  <label>Current code<input name="code" inputMode="numeric" required minLength={6} maxLength={8} /></label>
                  <button disabled={busy}>New recovery codes</button>
                </form>
                <details>
                  <summary>Turn off two-factor authentication</summary>
                  <form onSubmit={(e) => { e.preventDefault(); const f = fields(e); void act(async () => { const r = await api<AuthState>('/auth/mfa/disable', 'POST', { password: f.password, code: f.code }); setCsrf(r.csrfToken); onMfaChange(false); }, 'Two-factor authentication turned off.'); }}>
                    <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
                    <label>Current code<input name="code" inputMode="numeric" required minLength={6} maxLength={8} /></label>
                    <button disabled={busy} className="danger">Turn off</button>
                  </form>
                </details>
              </>
            ) : enrolling ? (
              <MfaEnrol account={user} gated={false} busy={busy} act={act} error="" onDone={() => { setEnrolling(false); onMfaChange(true); }} />
            ) : (
              <>
                <p><span className="badge open">Off</span> Add an authenticator app so a stolen password alone is not enough to sign in.</p>
                <button className="primary" onClick={() => setEnrolling(true)}>Set up two-factor authentication</button>
              </>
            )}
          </section>
          <section className="panel">
            <h2>Password</h2>
            <p className="muted">At least 12 characters. Changing it signs out every other device.</p>
            <PasswordChangeForm busy={busy} act={act} />
          </section>
        </div>
        <div>
          <section className="panel">
            <h2>Where you are signed in</h2>
            {!sessions ? <Pending error={error} /> : (
              <div className="table-scroll"><table>
                <thead><tr><th>Device</th><th>Address</th><th>Last active</th><th></th></tr></thead>
                <tbody>{sessions.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{browserOf(s.userAgent)}</strong>{s.current && <small>This device</small>}</td>
                    <td>{s.ip ?? '—'}</td>
                    <td>{when(s.lastSeenAt)}</td>
                    <td><button disabled={busy} onClick={() => void act(async () => { await api(`/auth/sessions/${s.id}`, 'DELETE'); if (s.current) location.reload(); }, 'Session signed out.')}>{s.current ? 'Sign out' : 'Revoke'}</button></td>
                  </tr>))}</tbody>
              </table></div>
            )}
            <button disabled={busy || !sessions || sessions.length < 2} onClick={() => void act(async () => { await api('/auth/sessions/revoke-others', 'POST', {}); }, 'Every other device has been signed out.')}>Sign out everywhere else</button>
          </section>
          <section className="panel">
            <h2>Your data</h2>
            <p className="muted">Download everything OpsPilot holds about you as a JSON file: profile, tickets, replies, audit events, assets, notifications and AI usage totals.</p>
            <a className="primary" href="/api/auth/export" download>Download my data</a>
          </section>
        </div>
      </div>
    </>
  );
}
