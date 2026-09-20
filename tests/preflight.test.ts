import { describe, it, expect } from 'vitest';
import { encodingProblem } from '../server/preflight.js';

/**
 * The RC1 host validation found a database cluster created in the operating system's locale
 * (WIN1252 on Windows). The application writes "status: OPEN → RESOLVED" into every audit detail,
 * which that encoding cannot represent, so ticket updates failed with HTTP 500. Startup now refuses
 * such a cluster and says how to fix it; this pins the rule.
 */
describe('database encoding preflight', () => {
  it('accepts UTF-8, however PostgreSQL spells it', () => {
    for (const ok of ['UTF8', 'utf8', 'UTF-8', ' UTF8 ']) expect(encodingProblem(ok), ok).toBeNull();
  });
  it('refuses an encoding that cannot store the characters the application writes, and names it', () => {
    for (const bad of ['WIN1252', 'LATIN1', 'SQL_ASCII', 'EUC_JP']) {
      const problem = encodingProblem(bad);
      expect(problem, bad).toContain(bad);
      expect(problem, bad).toMatch(/UTF-8/);
      expect(problem, bad).toMatch(/OPERATIONS-RUNBOOK|DATABASE_URL/);
    }
  });
});
