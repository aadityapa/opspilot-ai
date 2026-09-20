/**
 * Authentication: sign-in with lockout, second factor (TOTP + recovery codes), password lifecycle
 * (policy, change, reset), and session management. Every security-relevant action writes an
 * audit event with the source address, whether or not a user was identified.
 *
 * Sessions are server-side rows keyed by a SHA-256 of the cookie token. A session created after a
 * correct password but before the second factor is "pending": it can reach only the MFA and
 * sign-out endpoints, expires in ten minutes, and is replaced by a fresh token once verified.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { hashPassword, verifyPassword } from './password.js';
import { HttpError, fail, idOf, admin } from './http.js';
import { loginSchema, userSchema, type CurrentUser } from '../shared/contracts.js';
import {
  checkPassword, decryptSecret, encryptSecret, newRecoveryCodes, newTotpSecret, normaliseRecoveryCode,
  otpauthUri, sha256, verifyTotp,
} from './security.js';
import { sendToMailpit } from './notifications.js';
import type { Prisma } from '../generated/prisma/client.js';

export const cookieName = config.NODE_ENV === 'production' ? '__Host-opspilot' : 'opspilot';
export const cookieOptions = { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/' };
const SESSION_MS = config.SESSION_HOURS * 60 * 60 * 1000;
const PENDING_MS = 10 * 60 * 1000;
const RESET_MS = 30 * 60 * 1000;
const ADMIN_RESET_MS = 24 * 60 * 60 * 1000;
const dummyHash = await hashPassword(randomBytes(32).toString('hex'));

export const clientIp = (req: Request) => (req.ip ?? '').replace(/^::ffff:/, '') || null;
const agentOf = (req: Request) => (req.get('user-agent') ?? '').slice(0, 200) || null;

type Tx = Prisma.TransactionClient;
export async function audit(tx: Tx | typeof db, data: { actorId?: string | null; action: string; detail: string; ip?: string | null; ticketId?: string | null; internal?: boolean }) {
  await tx.event.create({ data: { actorId: data.actorId ?? null, action: data.action, detail: data.detail, ip: data.ip ?? null, ticketId: data.ticketId ?? null, internal: data.internal ?? true } });
}

const publicUser = (u: { id: string; name: string; email: string; role: CurrentUser['role'] }): CurrentUser => ({ id: u.id, name: u.name, email: u.email, role: u.role });

async function issueSession(res: Response, req: Request, userId: string, pending: boolean) {
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(32).toString('hex');
  const ttl = pending ? PENDING_MS : SESSION_MS;
  await db.session.create({ data: { tokenHash: sha256(token), csrfToken, userId, expiresAt: new Date(Date.now() + ttl), ip: clientIp(req), userAgent: agentOf(req), mfaPending: pending } });
  res.cookie(cookieName, token, { ...cookieOptions, maxAge: ttl });
  return csrfToken;
}

const enrollmentRequiredFor = (user: { role: CurrentUser['role']; mfaEnabled: boolean }) => config.mfaRequiredRoles.includes(user.role) && !user.mfaEnabled;

/** What a signed-in (or half-signed-in) client needs to know about where it stands. */
function stateOf(user: { id: string; name: string; email: string; role: CurrentUser['role']; mfaEnabled: boolean; mustChangePassword: boolean }, pending: boolean, csrfToken: string) {
  if (pending && user.mfaEnabled) return { user: null, csrfToken, mfaRequired: true };
  if (pending) return { user: null, csrfToken, mfaEnrollmentRequired: true, account: { name: user.name, email: user.email } };
  return { user: publicUser(user), csrfToken, mustChangePassword: user.mustChangePassword, mfaEnabled: user.mfaEnabled };
}

async function recordFailure(userId: string, ip: string | null, what: string) {
  const user = await db.user.update({ where: { id: userId }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true } });
  const locked = user.failedLogins >= config.LOCKOUT_THRESHOLD;
  if (locked) await db.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + config.LOCKOUT_MINUTES * 60 * 1000) } });
  await audit(db, { actorId: userId, action: locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', detail: locked ? `${what}; account locked for ${config.LOCKOUT_MINUTES} minutes after ${config.LOCKOUT_THRESHOLD} failures` : what, ip });
}

const genericLoginError = `Invalid email or password. After ${config.LOCKOUT_THRESHOLD} failed attempts the account is locked for ${config.LOCKOUT_MINUTES} minutes.`;

/* ── Public routes: sign-in and password reset ──────────────────────────── */

export const publicAuthRouter = Router();

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.LOGIN_RATE_LIMIT, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });
const forgotLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: Math.max(5, Math.floor(config.LOGIN_RATE_LIMIT / 2)), standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many reset requests. Try again later.' } });

publicAuthRouter.post('/auth/login', loginLimit, async (req, res) => {
  const data = loginSchema.parse(req.body);
  const ip = clientIp(req);
  const user = await db.user.findUnique({ where: { email: data.email } });
  const valid = await verifyPassword(data.password, user?.passwordHash ?? dummyHash);
  if (!user || user.deletedAt || (config.NODE_ENV === 'production' && user.isDemo)) {
    await audit(db, { action: 'LOGIN_FAILED', detail: 'Unknown or unavailable account', ip });
    fail(401, genericLoginError);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit(db, { actorId: user.id, action: 'LOGIN_FAILED', detail: 'Attempt while locked', ip });
    fail(401, genericLoginError);
  }
  if (!valid) {
    await recordFailure(user.id, ip, 'Wrong password');
    fail(401, genericLoginError);
  }
  if (!user.active) {
    await audit(db, { actorId: user.id, action: 'LOGIN_FAILED', detail: 'Account disabled', ip });
    fail(401, genericLoginError);
  }
  const old = req.cookies[cookieName];
  if (typeof old === 'string') await db.session.deleteMany({ where: { tokenHash: sha256(old) } });
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const pending = user.mfaEnabled || enrollmentRequiredFor(user);
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, ...(pending ? {} : { lastLoginAt: new Date() }) } });
  const csrfToken = await issueSession(res, req, user.id, pending);
  await audit(db, { actorId: user.id, action: pending ? 'LOGIN_PASSWORD_OK' : 'LOGIN_SUCCESS', detail: pending ? (user.mfaEnabled ? 'Password accepted; second factor pending' : 'Password accepted; MFA enrolment required by policy') : 'Signed in', ip });
  res.json(stateOf(user, pending, csrfToken));
});

const forgotSchema = z.object({ email: z.email().max(254).transform((v) => v.toLowerCase()) }).strict();
publicAuthRouter.post('/auth/forgot', forgotLimit, async (req, res) => {
  const { email } = forgotSchema.parse(req.body);
  const ip = clientIp(req);
  const user = await db.user.findFirst({ where: { email, active: true, deletedAt: null } });
  // The response is identical whether or not the address exists.
  if (user && !(config.NODE_ENV === 'production' && user.isDemo)) {
    const token = randomBytes(32).toString('base64url');
    await db.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_MS) } });
    await audit(db, { actorId: user.id, action: 'PASSWORD_RESET_REQUESTED', detail: config.MAIL_MODE === 'mailpit' ? 'Reset link emailed' : 'Reset requested; mail delivery is disabled, so an administrator must issue the link', ip });
    if (config.MAIL_MODE === 'mailpit' && config.NODE_ENV !== 'production') {
      const link = `${config.APP_ORIGIN}/#/reset/${token}`;
      try {
        await sendToMailpit({ to: user.email, subject: 'OpsPilot · reset your password', text: `Someone asked to reset the password for this account.\n\nIf that was you, open this link within 30 minutes:\n${link}\n\nIf it was not you, ignore this message; nothing changes.`, messageId: `<reset-${Date.now()}@opspilot.example>` });
      } catch {
        /* The token is still valid; an administrator can also issue a link. */
      }
    }
  } else await audit(db, { action: 'PASSWORD_RESET_REQUESTED', detail: 'Unknown or unavailable account', ip });
  res.status(202).json({ message: 'If that address has an account, a reset link is on its way.' });
});

const resetSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(128) }).strict();
publicAuthRouter.post('/auth/reset', loginLimit, async (req, res) => {
  const { token, password } = resetSchema.parse(req.body);
  const ip = clientIp(req);
  const reset = await db.passwordReset.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date() || !reset.user.active || reset.user.deletedAt) {
    await audit(db, { action: 'PASSWORD_RESET_REJECTED', detail: 'Invalid, expired or used token', ip });
    fail(400, 'That reset link is invalid or has expired. Request a new one.');
  }
  const policy = checkPassword(password, { email: reset.user.email, name: reset.user.name });
  if (!policy.ok) fail(400, policy.reasons.join(' '));
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
    await tx.passwordReset.deleteMany({ where: { userId: reset.userId, id: { not: reset.id } } });
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false, failedLogins: 0, lockedUntil: null } });
    await tx.session.deleteMany({ where: { userId: reset.userId } });
    await audit(tx, { actorId: reset.userId, action: 'PASSWORD_RESET', detail: 'Password reset via link; all sessions revoked', ip });
  });
  res.json({ message: 'Password updated. Sign in with the new one.' });
});

/* ── Session middleware ─────────────────────────────────────────────────── */

const PENDING_ALLOWED = new Set(['/auth/me', '/auth/logout', '/auth/mfa/verify', '/auth/mfa/setup', '/auth/mfa/enable']);
const CHANGE_ALLOWED_PREFIX = '/auth/';

export async function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies[cookieName];
  if (typeof token !== 'string') fail(401, 'Please sign in');
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || !session.user.active || session.user.deletedAt || (config.NODE_ENV === 'production' && session.user.isDemo)) fail(401, 'Please sign in');
  if (session.lastSeenAt.getTime() < Date.now() - 5 * 60 * 1000) await db.session.update({ where: { tokenHash: session.tokenHash }, data: { lastSeenAt: new Date() } });
  res.locals.user = publicUser(session.user);
  res.locals.tokenHash = session.tokenHash;
  res.locals.csrfToken = session.csrfToken;
  res.locals.sessionId = session.id;
  res.locals.pending = session.mfaPending;
  res.locals.account = session.user;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const supplied = Buffer.from(req.get('x-csrf-token') ?? '');
    const expected = Buffer.from(session.csrfToken);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail(403, 'CSRF validation failed');
  }
  if (session.mfaPending && !PENDING_ALLOWED.has(req.path)) fail(403, session.user.mfaEnabled ? 'Complete two-factor verification first' : 'Two-factor enrolment is required before you can continue');
  if (!session.mfaPending && session.user.mustChangePassword && !req.path.startsWith(CHANGE_ALLOWED_PREFIX)) fail(403, 'You must change your password before continuing');
  next();
}

declare global {
  namespace Express {
    interface Locals {
      sessionId: string;
      pending: boolean;
      account: { id: string; name: string; email: string; role: CurrentUser['role']; mfaEnabled: boolean; mfaSecret: string | null; mfaPendingSecret: string | null; mfaLastStep: number | null; passwordHash: string; mustChangePassword: boolean; notifyPrefs: unknown; departmentId: string | null; managerId: string | null };
    }
  }
}

/* ── Authenticated routes ───────────────────────────────────────────────── */

export const authRouter = Router();

authRouter.get('/auth/me', (_req, res) => res.json(stateOf(res.locals.account, res.locals.pending, res.locals.csrfToken)));

authRouter.post('/auth/logout', async (req, res) => {
  await db.session.deleteMany({ where: { tokenHash: res.locals.tokenHash } });
  await audit(db, { actorId: res.locals.user.id, action: 'LOGOUT', detail: 'Signed out', ip: clientIp(req) });
  res.clearCookie(cookieName, cookieOptions).status(204).end();
});

const codeSchema = z.object({ code: z.string().trim().min(6).max(20) }).strict();

authRouter.post('/auth/mfa/setup', async (_req, res) => {
  const account = res.locals.account;
  if (account.mfaEnabled) fail(409, 'Two-factor authentication is already enabled');
  const secret = newTotpSecret();
  await db.user.update({ where: { id: account.id }, data: { mfaPendingSecret: encryptSecret(secret) } });
  res.json({ secret, otpauth: otpauthUri('OpsPilot AI', account.email, secret) });
});

async function upgradePendingSession(req: Request, res: Response, userId: string) {
  await db.session.deleteMany({ where: { tokenHash: res.locals.tokenHash } });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date(), failedLogins: 0 } });
  return issueSession(res, req, userId, false);
}

authRouter.post('/auth/mfa/enable', async (req, res) => {
  const { code } = codeSchema.parse(req.body);
  const account = res.locals.account;
  const ip = clientIp(req);
  if (account.mfaEnabled) fail(409, 'Two-factor authentication is already enabled');
  if (!account.mfaPendingSecret) fail(400, 'Start enrolment first');
  const secret = decryptSecret(account.mfaPendingSecret);
  const step = verifyTotp(secret, code);
  if (step === null) {
    await audit(db, { actorId: account.id, action: 'MFA_ENROL_FAILED', detail: 'Code did not match during enrolment', ip });
    fail(400, 'That code did not match. Check the time on your phone and try the next code.');
  }
  const codes = newRecoveryCodes();
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: account.id }, data: { mfaEnabled: true, mfaSecret: account.mfaPendingSecret, mfaPendingSecret: null, mfaLastStep: step } });
    await tx.recoveryCode.deleteMany({ where: { userId: account.id } });
    await tx.recoveryCode.createMany({ data: codes.map((c) => ({ userId: account.id, codeHash: sha256(normaliseRecoveryCode(c)) })) });
    await audit(tx, { actorId: account.id, action: 'MFA_ENABLED', detail: 'Authenticator app enrolled; 10 recovery codes issued', ip });
  });
  const csrfToken = res.locals.pending ? await upgradePendingSession(req, res, account.id) : res.locals.csrfToken;
  res.json({ recoveryCodes: codes, ...stateOf({ ...account, mfaEnabled: true }, false, csrfToken) });
});

authRouter.post('/auth/mfa/verify', async (req, res) => {
  const { code } = codeSchema.parse(req.body);
  const account = res.locals.account;
  const ip = clientIp(req);
  if (!res.locals.pending) fail(409, 'This session is already verified');
  if (!account.mfaEnabled || !account.mfaSecret) fail(409, 'Two-factor authentication is not enabled on this account');
  let ok = false;
  if (/^\d{6}$/.test(code.replace(/\s+/g, ''))) {
    const step = verifyTotp(decryptSecret(account.mfaSecret), code, new Date(), account.mfaLastStep);
    if (step !== null) {
      ok = true;
      await db.user.update({ where: { id: account.id }, data: { mfaLastStep: step } });
    }
  } else {
    const deleted = await db.recoveryCode.deleteMany({ where: { userId: account.id, codeHash: sha256(normaliseRecoveryCode(code)) } });
    ok = deleted.count === 1;
    if (ok) await audit(db, { actorId: account.id, action: 'MFA_RECOVERY_CODE_USED', detail: `Recovery code used; ${await db.recoveryCode.count({ where: { userId: account.id } })} remaining`, ip });
  }
  if (!ok) {
    await recordFailure(account.id, ip, 'Second factor rejected');
    const locked = await db.user.findUnique({ where: { id: account.id }, select: { lockedUntil: true } });
    if (locked?.lockedUntil && locked.lockedUntil > new Date()) {
      await db.session.deleteMany({ where: { tokenHash: res.locals.tokenHash } });
      res.clearCookie(cookieName, cookieOptions);
      fail(401, genericLoginError);
    }
    fail(400, 'That code did not match.');
  }
  const csrfToken = await upgradePendingSession(req, res, account.id);
  await audit(db, { actorId: account.id, action: 'LOGIN_SUCCESS', detail: 'Second factor verified', ip });
  res.json(stateOf(account, false, csrfToken));
});

const disableSchema = z.object({ password: z.string().min(1).max(128), code: z.string().trim().min(6).max(20) }).strict();
authRouter.post('/auth/mfa/disable', async (req, res) => {
  const { password, code } = disableSchema.parse(req.body);
  const account = res.locals.account;
  const ip = clientIp(req);
  if (!account.mfaEnabled || !account.mfaSecret) fail(409, 'Two-factor authentication is not enabled');
  if (config.mfaRequiredRoles.includes(account.role)) fail(403, 'Your role requires two-factor authentication; it cannot be turned off');
  if (!(await verifyPassword(password, account.passwordHash))) fail(400, 'Password did not match');
  if (verifyTotp(decryptSecret(account.mfaSecret), code) === null) fail(400, 'That code did not match');
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: account.id }, data: { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaLastStep: null } });
    await tx.recoveryCode.deleteMany({ where: { userId: account.id } });
    await audit(tx, { actorId: account.id, action: 'MFA_DISABLED', detail: 'Authenticator removed by the user', ip });
  });
  res.json(stateOf({ ...account, mfaEnabled: false }, false, res.locals.csrfToken));
});

authRouter.post('/auth/mfa/recovery-codes', async (req, res) => {
  const { code } = codeSchema.parse(req.body);
  const account = res.locals.account;
  if (!account.mfaEnabled || !account.mfaSecret) fail(409, 'Two-factor authentication is not enabled');
  if (verifyTotp(decryptSecret(account.mfaSecret), code) === null) fail(400, 'That code did not match');
  const codes = newRecoveryCodes();
  await db.$transaction(async (tx) => {
    await tx.recoveryCode.deleteMany({ where: { userId: account.id } });
    await tx.recoveryCode.createMany({ data: codes.map((c) => ({ userId: account.id, codeHash: sha256(normaliseRecoveryCode(c)) })) });
    await audit(tx, { actorId: account.id, action: 'MFA_RECOVERY_CODES_REGENERATED', detail: '10 new recovery codes issued; previous ones invalidated', ip: clientIp(req) });
  });
  res.json({ recoveryCodes: codes });
});

const changeSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) }).strict();
authRouter.post('/auth/password', async (req, res) => {
  const { currentPassword, newPassword } = changeSchema.parse(req.body);
  const account = res.locals.account;
  const ip = clientIp(req);
  if (!(await verifyPassword(currentPassword, account.passwordHash))) {
    await audit(db, { actorId: account.id, action: 'PASSWORD_CHANGE_FAILED', detail: 'Current password did not match', ip });
    fail(400, 'Current password did not match');
  }
  if (currentPassword === newPassword) fail(400, 'Choose a password you have not used');
  const policy = checkPassword(newPassword, { email: account.email, name: account.name });
  if (!policy.ok) fail(400, policy.reasons.join(' '));
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: account.id }, data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: account.id, tokenHash: { not: res.locals.tokenHash } } });
    await audit(tx, { actorId: account.id, action: 'PASSWORD_CHANGED', detail: 'Password changed; other sessions revoked', ip });
  });
  res.json({ message: 'Password changed. Other devices have been signed out.' });
});

authRouter.get('/auth/sessions', async (_req, res) => {
  const sessions = await db.session.findMany({ where: { userId: res.locals.user.id, expiresAt: { gt: new Date() }, mfaPending: false }, select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true, expiresAt: true }, orderBy: { lastSeenAt: 'desc' } });
  res.json(sessions.map((s) => ({ ...s, current: s.id === res.locals.sessionId })));
});

authRouter.delete('/auth/sessions/:id', async (req, res) => {
  const id = idOf(req);
  const deleted = await db.session.deleteMany({ where: { id, userId: res.locals.user.id } });
  if (!deleted.count) fail(404, 'Session not found');
  await audit(db, { actorId: res.locals.user.id, action: 'SESSION_REVOKED', detail: id === res.locals.sessionId ? 'Current session revoked' : 'A session was revoked', ip: clientIp(req) });
  if (id === res.locals.sessionId) res.clearCookie(cookieName, cookieOptions);
  res.status(204).end();
});

authRouter.post('/auth/sessions/revoke-others', async (req, res) => {
  const deleted = await db.session.deleteMany({ where: { userId: res.locals.user.id, tokenHash: { not: res.locals.tokenHash } } });
  await audit(db, { actorId: res.locals.user.id, action: 'SESSION_REVOKED', detail: `${deleted.count} other session(s) revoked`, ip: clientIp(req) });
  res.json({ revoked: deleted.count });
});

/* ── Administrator account controls ─────────────────────────────────────── */

export const adminUserSelect = { id: true, name: true, email: true, role: true, active: true, mfaEnabled: true, lockedUntil: true, lastLoginAt: true, mustChangePassword: true, createdAt: true, deletedAt: true } as const;

export const adminAuthRouter = Router();
adminAuthRouter.get('/admin/users', admin, async (_req, res) => res.json(await db.user.findMany({ where: { deletedAt: null }, select: adminUserSelect, orderBy: { name: 'asc' } })));

adminAuthRouter.post('/admin/users', admin, async (req, res) => {
  const { password, ...data } = userSchema.parse(req.body);
  const policy = checkPassword(password, { email: data.email, name: data.name });
  if (!policy.ok) fail(400, policy.reasons.join(' '));
  const passwordHash = await hashPassword(password);
  const user = await db.$transaction(async (tx) => {
    // A new account always starts with a password the administrator chose; the person replaces it
    // on first sign-in.
    const u = await tx.user.create({ data: { ...data, passwordHash, mustChangePassword: true }, select: adminUserSelect });
    await audit(tx, { actorId: res.locals.user.id, action: 'USER_CREATED', detail: `User ${u.id} created with role ${u.role}; must change password at first sign-in`, ip: clientIp(req) });
    return u;
  });
  res.status(201).json(user);
});

adminAuthRouter.patch('/admin/users/:id', admin, async (req, res) => {
  const data = z.object({ active: z.boolean().optional(), role: z.enum(['EMPLOYEE', 'ENGINEER', 'ADMIN']).optional() }).strict().parse(req.body);
  const id = idOf(req);
  if (id === res.locals.user.id && (data.active === false || (data.role && data.role !== 'ADMIN'))) fail(400, 'You cannot remove your own access');
  const user = await db.$transaction(async (tx) => {
    const before = await tx.user.findFirst({ where: { id, deletedAt: null } });
    if (!before) fail(404, 'User not found');
    const u = await tx.user.update({ where: { id }, data, select: adminUserSelect });
    if (data.active === false || (data.role && data.role !== before.role)) await tx.session.deleteMany({ where: { userId: id } });
    const changes = Object.entries(data).map(([k, v]) => `${k}: ${String(before[k as keyof typeof before])} → ${String(v)}`).join('; ');
    await audit(tx, { actorId: res.locals.user.id, action: 'USER_UPDATED', detail: `User ${id} ${changes}`, ip: clientIp(req) });
    return u;
  });
  res.json(user);
});

adminAuthRouter.post('/admin/users/:id/unlock', admin, async (req, res) => {
  const id = idOf(req);
  await db.user.update({ where: { id }, data: { lockedUntil: null, failedLogins: 0 } });
  await audit(db, { actorId: res.locals.user.id, action: 'USER_UNLOCKED', detail: `User ${id} unlocked by an administrator`, ip: clientIp(req) });
  res.status(204).end();
});

adminAuthRouter.post('/admin/users/:id/revoke-sessions', admin, async (req, res) => {
  const id = idOf(req);
  const deleted = await db.session.deleteMany({ where: { userId: id } });
  await audit(db, { actorId: res.locals.user.id, action: 'SESSION_REVOKED', detail: `${deleted.count} session(s) of user ${id} revoked by an administrator`, ip: clientIp(req) });
  res.json({ revoked: deleted.count });
});

adminAuthRouter.post('/admin/users/:id/mfa-reset', admin, async (req, res) => {
  const id = idOf(req);
  if (id === res.locals.user.id) fail(400, 'Reset your own second factor from your account page');
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaLastStep: null } });
    await tx.recoveryCode.deleteMany({ where: { userId: id } });
    await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, { actorId: res.locals.user.id, action: 'MFA_RESET_BY_ADMIN', detail: `Second factor removed from user ${id}; sessions revoked`, ip: clientIp(req) });
  });
  res.status(204).end();
});

/** Issues a one-time reset link that the administrator hands over out of band. Valid for 24 hours. */
adminAuthRouter.post('/admin/users/:id/reset-link', admin, async (req, res) => {
  const id = idOf(req);
  const user = await db.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) fail(404, 'User not found');
  const token = randomBytes(32).toString('base64url');
  await db.$transaction(async (tx) => {
    await tx.passwordReset.deleteMany({ where: { userId: id, usedAt: null } });
    await tx.passwordReset.create({ data: { userId: id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ADMIN_RESET_MS), requestedBy: res.locals.user.id } });
    await audit(tx, { actorId: res.locals.user.id, action: 'PASSWORD_RESET_LINK_ISSUED', detail: `Reset link issued for user ${id}, valid 24 hours`, ip: clientIp(req) });
  });
  res.json({ link: `${config.APP_ORIGIN}/#/reset/${token}`, expiresInHours: 24 });
});
