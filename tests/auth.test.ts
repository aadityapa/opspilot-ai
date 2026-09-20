import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { hashPassword } from '../server/password.js';
import { decryptSecret, sha256, totpAt, totpStep } from '../server/security.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Integration tests require NODE_ENV=test and a database name ending in _test');

const app = createApp();
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-auth-password-2026';
const ids: string[] = [];
const email = (name: string) => `${name}-${tag}@example.test`;

async function makeUser(name: string, role: 'EMPLOYEE' | 'ENGINEER' | 'ADMIN', extra: Record<string, unknown> = {}) {
  const u = await db.user.create({ data: { email: email(name), name: `Auth ${name}`, passwordHash: await hashPassword(password), role, ...extra } });
  ids.push(u.id);
  return u;
}
const login = (agent: ReturnType<typeof request.agent>, name: string, pass = password) =>
  agent.post('/api/auth/login').set('Origin', origin).send({ email: email(name), password: pass });
const eventsFor = (userId: string | null, action: string) => db.event.findMany({ where: { actorId: userId, action }, orderBy: { createdAt: 'desc' } });

beforeAll(async () => {
  await makeUser('employee', 'EMPLOYEE');
  await makeUser('locker', 'EMPLOYEE');
  await makeUser('mfa', 'ENGINEER');
  await makeUser('admin', 'ADMIN');
  await makeUser('fresh', 'EMPLOYEE', { mustChangePassword: true });
});
afterAll(async () => {
  await db.event.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { actorId: null, createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } }] } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe('sign-in and lockout', () => {
  it('answers the same message for an unknown address and a wrong password, and audits both', async () => {
    const unknown = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: email('nobody'), password }).expect(401);
    const wrong = await login(request.agent(app), 'employee', 'not-the-password').expect(401);
    expect(unknown.body.error).toBe(wrong.body.error);
    expect(wrong.body.error).toContain(String(config.LOCKOUT_THRESHOLD));
    const anonymous = await db.event.findFirst({ where: { actorId: null, action: 'LOGIN_FAILED' }, orderBy: { createdAt: 'desc' } });
    expect(anonymous?.detail).toContain('Unknown');
    const user = await db.user.findUniqueOrThrow({ where: { email: email('employee') } });
    expect((await eventsFor(user.id, 'LOGIN_FAILED'))[0]?.detail).toBe('Wrong password');
    expect(user.failedLogins).toBe(1);
  });
  it('locks the account after the configured number of failures and refuses the right password while locked', async () => {
    const agent = request.agent(app);
    for (let i = 0; i < config.LOCKOUT_THRESHOLD; i++) await login(agent, 'locker', 'wrong-wrong-wrong').expect(401);
    const user = await db.user.findUniqueOrThrow({ where: { email: email('locker') } });
    expect(user.lockedUntil && user.lockedUntil > new Date()).toBe(true);
    expect(user.failedLogins).toBe(0);
    expect((await eventsFor(user.id, 'LOGIN_LOCKED')).length).toBe(1);
    await login(agent, 'locker').expect(401);
    expect((await eventsFor(user.id, 'LOGIN_FAILED'))[0]?.detail).toBe('Attempt while locked');
  });
  it('an administrator can unlock, after which sign-in works and the counter is clear', async () => {
    const admin = request.agent(app);
    const adminLogin = await login(admin, 'admin').expect(200);
    const locker = await db.user.findUniqueOrThrow({ where: { email: email('locker') } });
    await admin.post(`/api/admin/users/${locker.id}/unlock`).set('Origin', origin).set('X-CSRF-Token', adminLogin.body.csrfToken).send({}).expect(204);
    const r = await login(request.agent(app), 'locker').expect(200);
    expect(r.body.user.email).toBe(email('locker'));
    expect(r.body.mfaEnabled).toBe(false);
    expect(r.body.mustChangePassword).toBe(false);
    const after = await db.user.findUniqueOrThrow({ where: { id: locker.id } });
    expect(after.lockedUntil).toBeNull();
    expect(after.lastLoginAt).not.toBeNull();
    expect((await eventsFor(locker.id, 'LOGIN_SUCCESS')).length).toBe(1);
  });
  it('records where sessions come from and lets a person list and revoke them', async () => {
    const a = request.agent(app);
    const b = request.agent(app);
    const la = await login(a, 'employee').expect(200);
    await login(b, 'employee').expect(200);
    const list = await a.get('/api/auth/sessions').expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(list.body.every((s: { id: string }) => /^[0-9a-f-]{36}$/.test(s.id))).toBe(true);
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash|csrf/);
    const other = list.body.find((s: { current: boolean }) => !s.current);
    await a.delete(`/api/auth/sessions/${other.id}`).set('Origin', origin).set('X-CSRF-Token', la.body.csrfToken).expect(204);
    await b.get('/api/auth/me').expect(401);
    await a.get('/api/auth/me').expect(200);
    const revoked = await a.post('/api/auth/sessions/revoke-others').set('Origin', origin).set('X-CSRF-Token', la.body.csrfToken).send({}).expect(200);
    expect(revoked.body.revoked).toBe(0);
  });
});

describe('forced password change and policy', () => {
  it('blocks everything except the auth endpoints until the temporary password is replaced', async () => {
    const agent = request.agent(app);
    const r = await login(agent, 'fresh').expect(200);
    expect(r.body.mustChangePassword).toBe(true);
    await agent.get('/api/tickets').expect(403);
    await agent.get('/api/auth/me').expect(200);
    const weak = await agent.post('/api/auth/password').set('Origin', origin).set('X-CSRF-Token', r.body.csrfToken).send({ currentPassword: password, newPassword: 'password1234' }).expect(400);
    expect(weak.body.error).toMatch(/commonly used/);
    const wrongCurrent = await agent.post('/api/auth/password').set('Origin', origin).set('X-CSRF-Token', r.body.csrfToken).send({ currentPassword: 'nope-nope-nope', newPassword: 'a perfectly fine passphrase' }).expect(400);
    expect(wrongCurrent.body.error).toMatch(/Current password/);
    await agent.post('/api/auth/password').set('Origin', origin).set('X-CSRF-Token', r.body.csrfToken).send({ currentPassword: password, newPassword: 'a perfectly fine passphrase' }).expect(200);
    await agent.get('/api/tickets').expect(200);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.mustChangePassword).toBe(false);
    await login(request.agent(app), 'fresh', 'a perfectly fine passphrase').expect(200);
    await login(request.agent(app), 'fresh', password).expect(401);
  });
  it('new accounts created by an administrator start with a forced change and a policy-checked password', async () => {
    const admin = request.agent(app);
    const l = await login(admin, 'admin').expect(200);
    const bad = await admin.post('/api/admin/users').set('Origin', origin).set('X-CSRF-Token', l.body.csrfToken).send({ name: 'Weak Person', email: email('weak'), role: 'EMPLOYEE', password: 'qwertyuiop12' }).expect(400);
    expect(bad.body.error).toMatch(/commonly used|Keyboard/);
    const ok = await admin.post('/api/admin/users').set('Origin', origin).set('X-CSRF-Token', l.body.csrfToken).send({ name: 'New Person', email: email('new'), role: 'EMPLOYEE', password: 'temporary passphrase 2026' }).expect(201);
    ids.push(ok.body.id);
    expect(ok.body.mustChangePassword).toBe(true);
    expect(ok.body).not.toHaveProperty('passwordHash');
    const r = await login(request.agent(app), 'new', 'temporary passphrase 2026').expect(200);
    expect(r.body.mustChangePassword).toBe(true);
  });
});

describe('two-factor authentication', () => {
  const agent = request.agent(app);
  let csrf = '';
  let userId = '';
  let secret = '';
  let recoveryCodes: string[] = [];
  let enrolStep = 0;
  it('enrols with a code from the authenticator and issues recovery codes once', async () => {
    const l = await login(agent, 'mfa').expect(200);
    csrf = l.body.csrfToken;
    userId = l.body.user.id;
    const setup = await agent.post('/api/auth/mfa/setup').set('Origin', origin).set('X-CSRF-Token', csrf).send({}).expect(200);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauth).toContain('otpauth://totp/');
    secret = setup.body.secret;
    const stored = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.mfaPendingSecret).not.toContain(secret);
    expect(decryptSecret(stored.mfaPendingSecret!)).toBe(secret);
    const wrong = await agent.post('/api/auth/mfa/enable').set('Origin', origin).set('X-CSRF-Token', csrf).send({ code: '000000' }).expect(400);
    expect(wrong.body.error).toMatch(/did not match/);
    enrolStep = totpStep();
    const ok = await agent.post('/api/auth/mfa/enable').set('Origin', origin).set('X-CSRF-Token', csrf).send({ code: totpAt(secret, enrolStep) }).expect(200);
    expect(ok.body.recoveryCodes).toHaveLength(10);
    expect(ok.body.mfaEnabled).toBe(true);
    recoveryCodes = ok.body.recoveryCodes;
    const hashes = await db.recoveryCode.findMany({ where: { userId } });
    expect(hashes).toHaveLength(10);
    expect(hashes.map((h) => h.codeHash)).toContain(sha256(recoveryCodes[0].replace(/-/g, '')));
    expect((await eventsFor(userId, 'MFA_ENABLED')).length).toBe(1);
  });
  it('sign-in now stops at a pending session that can reach only the MFA endpoints', async () => {
    const fresh = request.agent(app);
    const r = await login(fresh, 'mfa').expect(200);
    expect(r.body).toMatchObject({ user: null, mfaRequired: true });
    expect(r.body.csrfToken).toBeTruthy();
    await fresh.get('/api/tickets').expect(403);
    await fresh.get('/api/dashboard').expect(403);
    const me = await fresh.get('/api/auth/me').expect(200);
    expect(me.body.mfaRequired).toBe(true);
    const bad = await fresh.post('/api/auth/mfa/verify').set('Origin', origin).set('X-CSRF-Token', r.body.csrfToken).send({ code: '123456' }).expect(400);
    expect(bad.body.error).toMatch(/did not match/);
    // Enrolment consumed the current step, so the code that enrolled cannot also sign in.
    const consumed = await fresh.post('/api/auth/mfa/verify').set('Origin', origin).set('X-CSRF-Token', r.body.csrfToken).send({ code: totpAt(secret, enrolStep) }).expect(400);
    expect(consumed.body.error).toMatch(/did not match/);
    const step = enrolStep + 1; // the next code, inside the ±1 drift window
    const ok = await fresh.post('/api/auth/mfa/verify').set('Origin', origin).set('X-CSRF-Token', r.body.csrfToken).send({ code: totpAt(secret, step) }).expect(200);
    expect(ok.body.user.email).toBe(email('mfa'));
    expect(ok.headers['set-cookie'][0]).toContain('opspilot=');
    expect(ok.body.csrfToken).not.toBe(r.body.csrfToken); // fresh session, fresh token
    await fresh.get('/api/tickets').expect(200);
    // The same code cannot be used twice.
    const again = request.agent(app);
    const r2 = await login(again, 'mfa').expect(200);
    const replay = await again.post('/api/auth/mfa/verify').set('Origin', origin).set('X-CSRF-Token', r2.body.csrfToken).send({ code: totpAt(secret, step) }).expect(400);
    expect(replay.body.error).toMatch(/did not match/);
  });
  it('a recovery code works exactly once', async () => {
    const one = request.agent(app);
    const r = await login(one, 'mfa').expect(200);
    await one.post('/api/auth/mfa/verify').set('Origin', origin).set('X-CSRF-Token', r.body.csrfToken).send({ code: recoveryCodes[3].toUpperCase() }).expect(200);
    expect(await db.recoveryCode.count({ where: { userId } })).toBe(9);
    const two = request.agent(app);
    const r2 = await login(two, 'mfa').expect(200);
    await two.post('/api/auth/mfa/verify').set('Origin', origin).set('X-CSRF-Token', r2.body.csrfToken).send({ code: recoveryCodes[3] }).expect(400);
  });
  it('a stale pending session cannot be used to bypass the second factor', async () => {
    const stale = request.agent(app);
    const r = await login(stale, 'mfa').expect(200);
    const row = await db.session.findFirst({ where: { userId, mfaPending: true }, orderBy: { createdAt: 'desc' } });
    expect(row!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    await db.session.update({ where: { tokenHash: row!.tokenHash }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await stale.post('/api/auth/mfa/verify').set('Origin', origin).set('X-CSRF-Token', r.body.csrfToken).send({ code: totpAt(secret, totpStep() + 1) }).expect(401);
  });
  it('turning it off needs both the password and a current code', async () => {
    await agent.post('/api/auth/mfa/disable').set('Origin', origin).set('X-CSRF-Token', csrf).send({ password: 'wrong-wrong-wrong', code: totpAt(secret, totpStep() + 1) }).expect(400);
    await agent.post('/api/auth/mfa/disable').set('Origin', origin).set('X-CSRF-Token', csrf).send({ password, code: '999999' }).expect(400);
    const off = await agent.post('/api/auth/mfa/disable').set('Origin', origin).set('X-CSRF-Token', csrf).send({ password, code: totpAt(secret, totpStep() + 1) }).expect(200);
    expect(off.body.mfaEnabled).toBe(false);
    expect(await db.recoveryCode.count({ where: { userId } })).toBe(0);
    const r = await login(request.agent(app), 'mfa').expect(200);
    expect(r.body.user).not.toBeNull();
  });
});

describe('password reset', () => {
  it('forgot answers identically for unknown and known addresses and records a token only for the known one', async () => {
    const unknown = await request(app).post('/api/auth/forgot').set('Origin', origin).send({ email: email('ghost') }).expect(202);
    const known = await request(app).post('/api/auth/forgot').set('Origin', origin).send({ email: email('employee') }).expect(202);
    expect(unknown.body).toEqual(known.body);
    const user = await db.user.findUniqueOrThrow({ where: { email: email('employee') } });
    expect(await db.passwordReset.count({ where: { userId: user.id } })).toBe(1);
    expect((await eventsFor(user.id, 'PASSWORD_RESET_REQUESTED')).length).toBe(1);
  });
  it('an administrator can issue a one-time link that resets the password and revokes every session', async () => {
    const admin = request.agent(app);
    const l = await login(admin, 'admin').expect(200);
    const employee = request.agent(app);
    await login(employee, 'employee').expect(200);
    const user = await db.user.findUniqueOrThrow({ where: { email: email('employee') } });
    const issued = await admin.post(`/api/admin/users/${user.id}/reset-link`).set('Origin', origin).set('X-CSRF-Token', l.body.csrfToken).send({}).expect(200);
    expect(issued.body.link.startsWith(`${config.APP_ORIGIN}/#/reset/`)).toBe(true);
    const token = issued.body.link.split('/#/reset/')[1];
    expect(await db.passwordReset.findUnique({ where: { tokenHash: sha256(token) } })).not.toBeNull();
    const weak = await request(app).post('/api/auth/reset').set('Origin', origin).send({ token, password: 'password12345' }).expect(400);
    expect(weak.body.error).toMatch(/commonly used/);
    await request(app).post('/api/auth/reset').set('Origin', origin).send({ token, password: 'brand new passphrase 2026' }).expect(200);
    await employee.get('/api/auth/me').expect(401); // old session gone
    await request(app).post('/api/auth/reset').set('Origin', origin).send({ token, password: 'another passphrase 2026' }).expect(400); // single use
    await login(request.agent(app), 'employee', 'brand new passphrase 2026').expect(200);
    await login(request.agent(app), 'employee', password).expect(401);
    expect((await eventsFor(user.id, 'PASSWORD_RESET')).length).toBe(1);
  });
  it('rejects a made-up or expired token', async () => {
    await request(app).post('/api/auth/reset').set('Origin', origin).send({ token: 'x'.repeat(43), password: 'brand new passphrase 2026' }).expect(400);
    const user = await db.user.findUniqueOrThrow({ where: { email: email('employee') } });
    const token = 'expired-token-for-test-' + tag;
    await db.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() - 1) } });
    await request(app).post('/api/auth/reset').set('Origin', origin).send({ token, password: 'brand new passphrase 2027' }).expect(400);
  });
});

describe('administrator account controls', () => {
  it('changing a role or disabling an account signs that person out everywhere', async () => {
    const admin = request.agent(app);
    const l = await login(admin, 'admin').expect(200);
    const victim = request.agent(app);
    await login(victim, 'locker').expect(200);
    const user = await db.user.findUniqueOrThrow({ where: { email: email('locker') } });
    const changed = await admin.patch(`/api/admin/users/${user.id}`).set('Origin', origin).set('X-CSRF-Token', l.body.csrfToken).send({ role: 'ENGINEER' }).expect(200);
    expect(changed.body.role).toBe('ENGINEER');
    await victim.get('/api/auth/me').expect(401);
    await admin.patch(`/api/admin/users/${l.body.user.id}`).set('Origin', origin).set('X-CSRF-Token', l.body.csrfToken).send({ role: 'EMPLOYEE' }).expect(400);
    await admin.patch(`/api/admin/users/${l.body.user.id}`).set('Origin', origin).set('X-CSRF-Token', l.body.csrfToken).send({ active: false }).expect(400);
    const list = await admin.get('/api/admin/users').expect(200);
    const row = list.body.find((u: { id: string }) => u.id === user.id);
    expect(row).toMatchObject({ role: 'ENGINEER', mfaEnabled: false });
    expect(row).not.toHaveProperty('passwordHash');
    expect(row).not.toHaveProperty('mfaSecret');
  });
  it('non-administrators cannot reach any of the account controls', async () => {
    const employee = request.agent(app);
    const l = await login(employee, 'employee', 'brand new passphrase 2026').expect(200);
    const admin = await db.user.findUniqueOrThrow({ where: { email: email('admin') } });
    for (const path of ['unlock', 'revoke-sessions', 'mfa-reset', 'reset-link'])
      await employee.post(`/api/admin/users/${admin.id}/${path}`).set('Origin', origin).set('X-CSRF-Token', l.body.csrfToken).send({}).expect(403);
    await employee.get('/api/admin/users').expect(403);
  });
});
