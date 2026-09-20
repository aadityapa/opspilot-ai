/**
 * Rate limits for the endpoints that cost more than a row lookup. Sign-in has its own limiter in
 * auth.ts; AI has a daily per-user budget and a concurrency cap in ai/. These cover the remaining
 * places where one client could make the database do unbounded work: search (six ILIKE queries per
 * call), analytics and reports (every ticket in the window), the audit export and file uploads.
 *
 * Ordinary ticket operations are deliberately not limited. Limits are per source address and per
 * process; under the test runner they are raised so a suite that hammers one route from one
 * address never fails for that reason.
 */
import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';

const factor = config.NODE_ENV === 'test' ? 100 : 1;
const make = (windowMs: number, limit: number, what: string) =>
  rateLimit({ windowMs, limit: limit * factor, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: `Too many ${what} requests from this address. Try again in a moment.` } });

/** 120 searches a minute: fast typing in the palette is debounced client-side, so this is far above real use. */
export const searchLimit = make(60_000, 120, 'search');
/** 60 heavy reads a minute per address: analytics, reports (JSON and CSV), the audit export. */
export const heavyReadLimit = make(60_000, 60, 'report');
/** 60 uploads per quarter hour per address. */
export const uploadLimit = make(15 * 60_000, 60, 'upload');
