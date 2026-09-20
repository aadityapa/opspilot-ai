/**
 * One CSV cell encoder for every export. RFC 4180 quoting for commas, quotes and line breaks, plus
 * the spreadsheet-injection guard: a cell that a spreadsheet would evaluate as a formula (`=`,
 * `+`, `-`, `@`, tab or carriage return first) is prefixed with a single quote, which every
 * spreadsheet shows as text and none executes. Plain numbers (including negatives such as `-5`)
 * are left alone, so numeric columns still sort and sum.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');
