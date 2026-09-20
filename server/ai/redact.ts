/**
 * Best-effort redaction applied to every string before it leaves the process for a provider.
 *
 * This is a risk-reduction measure, not a guarantee. Pattern matching cannot recognise every
 * secret or every piece of personal data, and it will miss credentials that do not look like the
 * shapes below — an unusual internal token format, a password typed as ordinary prose, or a
 * hostname that is itself sensitive. Treat it as one layer among several, and keep telling users
 * not to paste credentials into tickets. Documented in SECURITY.md.
 */
export const REDACTED = '[redacted]';

const patterns: [RegExp, string][] = [
  // Private keys and certificate blocks, including the body between the markers.
  [/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[redacted key block]'],
  // Common provider/API key shapes.
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, REDACTED],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bASIA[0-9A-Z]{16}\b/g, REDACTED],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
  // Bearer tokens and basic-auth headers.
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, REDACTED],
  // Credentials embedded in a URL: scheme://user:secret@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  // Explicit "password: value" / "api_key=value" style assignments.
  [/\b(pass(?:word|phrase)?|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*("[^"\n]*"|'[^'\n]*'|\S+)/gi, `$1: ${REDACTED}`],
  // Payment card numbers (13-19 digits, optionally grouped).
  [/\b(?:\d[ -]?){13,19}\b/g, '[redacted number]'],
  // Email addresses: personal data the model does not need to answer a support question.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
  // IPv4 addresses.
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]'],
];

export function redact(text: string): string {
  return patterns.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

/** Redacts, collapses runaway whitespace and hard-caps length so one huge input cannot blow the budget. */
export function prepare(text: string, maxChars: number): string {
  const cleaned = redact(text).replace(/[ \t]{4,}/g, '   ').replace(/\n{4,}/g, '\n\n\n').trim();
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars)}\n[truncated]`;
}
