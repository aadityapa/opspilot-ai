/**
 * Turning a sentence somebody typed into terms worth searching for.
 *
 * The article search matches its query as one substring of a title or body, so a query assembled
 * from several words — "disconnects during video calls" — can only match an article that contains
 * that exact sentence, which no article does. Callers therefore take the terms below and try them
 * one at a time, longest first, stopping at the first that finds anything.
 *
 * Short words are kept deliberately. "VPN", "SSO", "MFA", "DNS" and "RAM" are the most identifying
 * words an IT request contains, and a minimum length of four characters would drop every one of
 * them.
 */

/** Words too ordinary to identify an article, including the demo seed's own filler. */
const COMMON = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'has', 'had', 'not', 'are', 'was',
  'were', 'but', 'you', 'your', 'our', 'its', 'when', 'what', 'why', 'how', 'who', 'can', 'cannot',
  'does', 'did', 'will', 'would', 'should', 'there', 'here', 'they', 'them', 'their', 'been',
  'being', 'into', 'onto', 'over', 'under', 'after', 'before', 'since', 'than', 'then', 'also',
  'only', 'just', 'some', 'any', 'all', 'every', 'each', 'other', 'another', 'again', 'still',
  'very', 'more', 'most', 'less', 'none', 'one', 'two', 'now', 'get', 'got', 'use', 'used',
  'demo', 'fictional', 'report', 'reports', 'issue', 'please', 'help', 'need', 'needs', 'work',
  'working', 'works',
]);

/**
 * Acronyms that identify a subject however they are typed. Ranking by length alone would bury
 * "VPN" underneath "disconnects" in "VPN disconnects during video calls" — and "VPN" is the word
 * the article and the ticket have in common.
 */
const ACRONYMS = new Set([
  'vpn', 'sso', 'mfa', '2fa', 'otp', 'dns', 'dhcp', 'vlan', 'lan', 'wan', 'wifi', 'rdp', 'ssh',
  'ftp', 'smtp', 'imap', 'pop3', 'ssl', 'tls', 'api', 'crm', 'erp', 'usb', 'ram', 'ssd', 'hdd',
  'cpu', 'gpu', 'pdf', 'csv', 'sql', 'nas', 'mdm', 'iam', 'pki', 'ad', 'gpo', 'ip',
]);

/** Written in capitals in the original text, so the person meant it as a name or an acronym. */
const shouted = (raw: string) => /^[A-Z][A-Z0-9]{1,4}$/.test(raw);

/**
 * Up to four candidate search terms from a piece of text, most identifying first, duplicates
 * removed. Returns an empty array when there is nothing distinctive to search for.
 */
export function searchTerms(text: string): string[] {
  const seen = new Set<string>();
  const terms: { word: string; acronym: boolean }[] = [];
  for (const raw of text.match(/[\p{L}\p{N}][\p{L}\p{N}+#._-]*/gu) ?? []) {
    const word = raw.toLowerCase().replace(/[._-]+$/, '');
    if (word.length < 2 || seen.has(word)) continue;
    const acronym = ACRONYMS.has(word) || shouted(raw);
    if (!acronym && (word.length < 3 || COMMON.has(word))) continue;
    seen.add(word);
    terms.push({ word, acronym });
  }
  // Acronyms first, then the longest word: in a sentence about work, the longest word is usually
  // the most specific one.
  return terms
    .sort((a, b) => Number(b.acronym) - Number(a.acronym) || b.word.length - a.word.length)
    .slice(0, 4)
    .map((t) => t.word);
}
