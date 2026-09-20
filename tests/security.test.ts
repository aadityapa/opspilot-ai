import { describe, it, expect } from 'vitest';
import {
  base32Decode, base32Encode, checkPassword, decryptSecret, encryptSecret, newRecoveryCodes, newTotpSecret,
  normaliseRecoveryCode, otpauthUri, totpAt, verifyTotp,
} from '../server/security.js';

// RFC 6238 appendix B test vectors (SHA-1, 8 digits); the last six digits are what a 6-digit app shows.
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_B32 = base32Encode(Buffer.from(RFC_SECRET_ASCII, 'ascii'));

describe('TOTP (RFC 6238)', () => {
  it('encodes and decodes base32 losslessly', () => {
    expect(RFC_SECRET_B32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET_B32).toString('ascii')).toBe(RFC_SECRET_ASCII);
    for (let i = 0; i < 20; i++) {
      const secret = newTotpSecret();
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(base32Encode(base32Decode(secret))).toBe(secret);
    }
  });
  it('reproduces the published test vectors', () => {
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];
    for (const [seconds, expected] of vectors) expect(totpAt(RFC_SECRET_B32, Math.floor(seconds / 30))).toBe(expected);
  });
  it('accepts the current step and one step either side, and nothing further', () => {
    const now = new Date(1111111111 * 1000);
    expect(verifyTotp(RFC_SECRET_B32, '050471', now)).toBe(37037037);
    expect(verifyTotp(RFC_SECRET_B32, '081804', now)).toBe(37037036); // previous step
    expect(verifyTotp(RFC_SECRET_B32, totpAt(RFC_SECRET_B32, 37037038), now)).toBe(37037038); // next step
    expect(verifyTotp(RFC_SECRET_B32, totpAt(RFC_SECRET_B32, 37037035), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, '000000', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, '05047', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, 'abcdef', now)).toBeNull();
  });
  it('refuses a replay of a step that was already used', () => {
    const now = new Date(1111111111 * 1000);
    expect(verifyTotp(RFC_SECRET_B32, '050471', now, 37037037)).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, '050471', now, 37037036)).toBe(37037037);
  });
  it('tolerates spaces in the code people type', () => {
    expect(verifyTotp(RFC_SECRET_B32, '050 471', new Date(1111111111 * 1000))).toBe(37037037);
  });
  it('builds an otpauth URI the common apps accept', () => {
    const uri = otpauthUri('OpsPilot AI', 'maya@example.test', RFC_SECRET_B32);
    expect(uri.startsWith('otpauth://totp/OpsPilot%20AI:maya%40example.test?')).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET_B32}`);
    expect(uri).toContain('issuer=OpsPilot%20AI');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('secrets at rest', () => {
  it('round-trips and never stores the plaintext', () => {
    const secret = newTotpSecret();
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(stored.startsWith('v1.')).toBe(true);
    expect(decryptSecret(stored)).toBe(secret);
  });
  it('produces a different ciphertext every time and rejects tampering', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    const parts = a.split('.');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
    expect(() => decryptSecret('garbage')).toThrow();
  });
});

describe('recovery codes', () => {
  it('are unique, unambiguous and normalise consistently', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
      expect(code).not.toMatch(/[01lio]/); // no look-alike characters
      expect(normaliseRecoveryCode(code.toUpperCase().replace(/-/g, ' '))).toBe(normaliseRecoveryCode(code));
    }
  });
});

describe('password policy', () => {
  it('requires twelve characters', () => {
    expect(checkPassword('short1!').ok).toBe(false);
    expect(checkPassword('exactly12chr').ok).toBe(true);
  });
  it('rejects the common passwords even when padded with digits', () => {
    for (const bad of ['password1234', 'Password12345', 'qwertyuiop12', 'letmein12345', 'welcome12345'])
      expect(checkPassword(bad).ok, bad).toBe(false);
  });
  it('rejects repeats, keyboard runs and personal details', () => {
    expect(checkPassword('aaaaaaaaaaaa').ok).toBe(false);
    expect(checkPassword('1234567890ab').ok).toBe(false);
    expect(checkPassword('maya.chen-2026!', { email: 'maya.chen@example.test' }).ok).toBe(false);
    expect(checkPassword('jordan-rules-2026', { name: 'Jordan Patel' }).ok).toBe(false);
  });
  it('accepts a passphrase and explains every refusal', () => {
    expect(checkPassword('correct horse battery staple', { email: 'a@b.c' })).toEqual({ ok: true, reasons: [] });
    const result = checkPassword('password', { email: 'password@x.io' });
    expect(result.ok).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
