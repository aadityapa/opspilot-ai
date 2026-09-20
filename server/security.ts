/**
 * Security primitives with no third-party dependencies: TOTP (RFC 6238), secret encryption at
 * rest, one-time codes, and the password policy.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { appSecret } from './config.js';

/* ── Encryption at rest ─────────────────────────────────────────────────── */

const encryptionKey = scryptSync(appSecret, 'opspilot-secret-at-rest', 32, { N: 16384, r: 8, p: 1 });

/** AES-256-GCM. Output is `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function decryptSecret(stored: string) {
  const [version, iv, tag, body] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unrecognised secret format');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

/* ── TOTP ───────────────────────────────────────────────────────────────── */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;

/** A fresh 160-bit secret, base32 for the authenticator app. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export const totpStep = (now = new Date()) => Math.floor(now.getTime() / 1000 / TOTP_PERIOD);

/**
 * Verifies a code within ±1 step of clock drift. Returns the step that matched so the caller can
 * refuse a replay of the same code, or null.
 */
export function verifyTotp(secret: string, code: string, now = new Date(), lastStep: number | null = null) {
  const digits = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const current = totpStep(now);
  for (const step of [current, current - 1, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpAt(secret, step));
    const actual = Buffer.from(digits);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return step;
  }
  return null;
}

export const otpauthUri = (issuer: string, account: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;

/* ── One-time codes and tokens ──────────────────────────────────────────── */

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Ten recovery codes like `k7f3-9m2p-4qzt`, shown once and stored hashed. */
export function newRecoveryCodes(count = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(12);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
    return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
  });
}

export const normaliseRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

/* ── Password policy ────────────────────────────────────────────────────── */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

// Small, embedded list of the most common passwords and patterns. Not a substitute for a breach
// check, and documented as such; it stops the worst choices without a network call.
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwerty', 'qwerty123',
  'qwertyuiop', 'letmein', 'welcome', 'welcome1', 'admin', 'administrator', 'changeme', 'iloveyou',
  'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball', 'abc123', 'trustno1', 'master',
  'hello', 'freedom', 'whatever', 'shadow', 'superman', 'michael', 'batman', 'login', 'starwars',
  'summer', 'winter', 'spring', 'autumn', 'opspilot', 'helpdesk', 'support', 'company', 'secret',
]);

export interface PasswordCheck {
  ok: boolean;
  reasons: string[];
}

/**
 * Length first, then the things that make a long password weak anyway: a common word with digits
 * bolted on, a single repeated character, a keyboard run, or the person's own email address.
 */
export function checkPassword(password: string, context: { email?: string; name?: string } = {}): PasswordCheck {
  const reasons: string[] = [];
  if (password.length < PASSWORD_MIN) reasons.push(`Use at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) reasons.push(`Use at most ${PASSWORD_MAX} characters.`);
  const lower = password.toLowerCase();
  const stripped = lower.replace(/[^a-z]/g, '');
  const trailingDigits = lower.replace(/[^a-z0-9]/g, '').replace(/\d+$/, '');
  if (COMMON.has(lower) || COMMON.has(stripped) || COMMON.has(trailingDigits))
    reasons.push('That password is on the list of the most commonly used passwords.');
  if (/^(.)\1+$/.test(password)) reasons.push('A single repeated character is not a password.');
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop|asdfghjkl)/.test(lower) && password.length < 20)
    reasons.push('Keyboard and number runs are the first thing an attacker tries.');
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) reasons.push('Do not include your email address.');
  const first = context.name?.split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && lower.includes(first)) reasons.push('Do not include your name.');
  return { ok: reasons.length === 0, reasons };
}
