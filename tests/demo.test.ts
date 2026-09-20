import { describe, it, expect } from 'vitest';
import { demoResetRefusal, nonDemoAccountRefusal } from '../scripts/demo-guard.js';
import { searchTerms } from '../shared/search.js';

/**
 * `npm run demo:reset` erases every application table. It exists for the sales demo, and a sales
 * convenience must never become a way to lose somebody's data, so the conditions are pinned here
 * rather than left to be discovered.
 */
describe('demo:reset guard', () => {
  const ok = {
    nodeEnv: 'development',
    allowDemoSeed: 'true',
    demoPassword: 'a-sufficiently-long-demo-password',
    databaseUrl: 'postgresql://opspilot:secret@127.0.0.1:5433/opspilot',
  };

  it('allows a local demo workspace', () => {
    expect(demoResetRefusal(ok)).toBeNull();
    for (const host of ['localhost', '127.0.0.1', 'db'])
      expect(demoResetRefusal({ ...ok, databaseUrl: `postgresql://u:p@${host}:5432/opspilot` }), host).toBeNull();
  });

  it('refuses in production, whatever else is configured', () => {
    const why = demoResetRefusal({ ...ok, nodeEnv: 'production' });
    expect(why).toMatch(/production/);
  });

  it('refuses unless demo data is explicitly permitted', () => {
    for (const value of [undefined, '', 'false', 'TRUE', 'yes', '1'])
      expect(demoResetRefusal({ ...ok, allowDemoSeed: value }), String(value)).toMatch(/ALLOW_DEMO_SEED/);
  });

  it('refuses without the password the demo accounts are re-created with', () => {
    expect(demoResetRefusal({ ...ok, demoPassword: undefined })).toMatch(/DEMO_PASSWORD/);
    expect(demoResetRefusal({ ...ok, demoPassword: '' })).toMatch(/DEMO_PASSWORD/);
  });

  it('refuses a database anywhere but this machine, and never echoes the URL', () => {
    const url = 'postgresql://opspilot:hunter2@db.internal.example.com:5432/opspilot';
    const why = demoResetRefusal({ ...ok, databaseUrl: url });
    expect(why).toMatch(/db\.internal\.example\.com/);
    expect(why).not.toMatch(/hunter2/);
    expect(why).toMatch(/Nothing was changed/);
  });

  it('refuses a database that holds an account somebody actually uses', () => {
    expect(nonDemoAccountRefusal(0)).toBeNull();
    expect(nonDemoAccountRefusal(1)).toMatch(/Nothing was changed/);
    expect(nonDemoAccountRefusal(37)).toMatch(/37 account/);
  });
});

/**
 * The article search matches its query as a single substring, so the terms handed to it have to be
 * single words. An earlier version joined the first four long words into a phrase, which could only
 * match an article containing that exact sentence: the "suggested knowledge" panel on a ticket, and
 * the "this might help first" panel on a request, therefore never showed anything.
 */
describe('search terms', () => {
  it('keeps short acronyms, which are the most identifying words in IT', () => {
    expect(searchTerms('Cannot connect to the VPN')).toContain('vpn');
    expect(searchTerms('SSO login fails')).toContain('sso');
    expect(searchTerms('MFA code not accepted')).toContain('mfa');
  });

  it('drops ordinary words that identify nothing', () => {
    const terms = searchTerms('I need help with the thing that will not work please');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('help');
    expect(terms).not.toContain('please');
  });

  it('returns single words, longest first, without duplicates', () => {
    const terms = searchTerms('Printer offline: the printer shows offline for everyone');
    expect(terms.every((t) => !t.includes(' '))).toBe(true);
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms[0].length).toBeGreaterThanOrEqual(terms[terms.length - 1].length);
  });

  it('finds the demo story ticket its article', () => {
    // "VPN" is what the ticket and the article have in common. Ranking by length alone buried it
    // under "disconnects" and the panel stayed empty; an acronym now comes first.
    expect(searchTerms('VPN disconnects during video calls')[0]).toBe('vpn');
  });

  it('puts an acronym ahead of longer ordinary words, typed either way', () => {
    expect(searchTerms('Cannot reach the SSO provider from the office network')[0]).toBe('sso');
    expect(searchTerms('vpn keeps dropping on the hotel connection')[0]).toBe('vpn');
  });

  it('gives up quietly when there is nothing to search for', () => {
    expect(searchTerms('')).toEqual([]);
    expect(searchTerms('   ')).toEqual([]);
    expect(searchTerms('it is so')).toEqual([]);
  });

  it('never asks for more than four terms', () => {
    expect(searchTerms('alpha bravo charlie delta echo foxtrot golf hotel').length).toBeLessThanOrEqual(4);
  });
});
