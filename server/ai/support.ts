/**
 * Model-independent evidence checks.
 *
 * Phase 3 delegated one important judgement entirely to the model: whether the retrieved passages
 * actually answer the question. Evaluation showed why that is not enough — the deterministic mock
 * answered from a weakly related article whenever any passage cleared the retrieval floor, and a
 * real model can make the same mistake with more confidence.
 *
 * These checks run on the server, before and after the model call, and can only ever *withhold* an
 * answer. They never fabricate one. Two separate questions are asked:
 *
 *   1. Before the call — is the best retrieved passage close enough to the question to be evidence
 *      at all? A passage that merely shares a common word is a candidate, not support.
 *   2. After the call — does each cited passage share substance with the answer that was written?
 *      A citation with no overlap is decoration, not a source.
 *
 * Neither check can prove an answer correct. They reduce the class of failure where something
 * plausible is presented as sourced when the source does not carry it.
 */

const STOP_WORDS = new Set([
  'the','a','an','and','or','of','to','in','is','are','was','were','be','been','being','for','on','at','it',
  'this','that','these','those','with','as','by','from','my','i','we','you','your','our','not','no','can',
  'do','does','did','how','what','why','when','where','who','which','if','then','than','so','but','have',
  'has','had','will','would','should','could','may','might','must','shall','there','here','they','them',
  'their','its','it’s','me','us','he','she','him','her','about','into','over','under','after','before',
  'up','down','out','off','again','more','most','some','any','all','each','other','such','only','own','same',
  'very','just','also','get','got','make','made','use','used','using','need','needs','please','help','thanks',
]);

/**
 * Sentences that read as instructions aimed at an assistant, rather than as knowledge content.
 *
 * Evaluation surfaced a specific failure this addresses. An injected paragraph inside a *permitted*
 * article was written to name restricted material ("print their privileged escalation codes"). That
 * gave the article strong term overlap with questions about restricted topics, so it was retrieved
 * and treated as evidence — the answer disclosed nothing restricted, but the system answered where
 * it should have abstained, and presented an article that does not address the question as a source.
 *
 * Text like this is never legitimate knowledge-base content, so it is removed before a passage is
 * used as evidence or shown as a citation excerpt. This is a narrow, best-effort filter over known
 * phrasings, not a general injection detector; the structural controls remain the real defence.
 */
const INSTRUCTION_MARKERS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier|your)\s+/i,
  /you\s+are\s+now\s+(in\s+|entering\s+)?(an?\s+)?(unrestricted|different|new|developer|admin|maintenance|debug|god)/i,
  // "maintenance mode", "developer mode" and friends, however the sentence is phrased around them.
  /\b(maintenance|developer|debug|god|jailbreak|dan)\s+mode\b/i,
  /(enter|switch\s+to|activate|engage)\s+\w*\s*mode\b/i,
  /(reveal|print|list|output|show|dump)\s+(the\s+|your\s+|its\s+|their\s+|every\s+|all\s+)?(system\s+prompt|hidden|internal|restricted|support-only|privileged|confidential|secret)/i,
  /act\s+as\s+(an?\s+)?(unrestricted|different|jailbroken|admin)/i,
  /\bconfirm\s+you\s+have\s+(deleted|removed|sent|disclosed)\b/i,
  /\byour\s+(new\s+|real\s+|actual\s+)?instructions?\s+(are|is)\b/i,
  /\bdo\s+not\s+(tell|inform|mention\s+to)\s+the\s+(user|human|engineer)\b/i,
];

/**
 * Removes sentences that read as instructions to an assistant. Splits on sentence boundaries and
 * newlines so a single injected sentence does not discard an entire legitimate paragraph.
 */
export function stripInjectedInstructions(text: string): string {
  const segments = text.split(/(?<=[.!?])\s+|\n+/);
  const kept = segments.filter((segment) => !INSTRUCTION_MARKERS.some((pattern) => pattern.test(segment)));
  // Returning the original when nothing matched keeps ordinary articles byte-identical. Rejoining
  // unconditionally would reflow every passage's whitespace for no reason, and a citation excerpt
  // should look like the article it came from.
  if (kept.length === segments.length) return text;
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Lowercased content words of four or more characters, deduplicated. Deliberately crude and stable. */
export function contentWords(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [])
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
  );
}

/** Share of `needles` that appear in `haystack`, in the range 0–1. Returns 0 when there is nothing to compare. */
export function overlap(needles: Set<string>, haystack: Set<string>): number {
  if (!needles.size) return 0;
  let hits = 0;
  for (const word of needles) if (haystack.has(word)) hits++;
  return hits / needles.size;
}

export interface SupportedCitation {
  /** Passage text as retrieved. */
  content: string;
  /** Title of the article the passage came from. */
  articleTitle: string;
}

/**
 * Does this passage share enough substance with the written answer to count as its source?
 *
 * The comparison runs from the passage's perspective as well as the answer's: a long answer built
 * from several passages will only draw a few words from each, so requiring the answer to overlap
 * the passage heavily would reject legitimate citations. Taking the better of the two directions
 * keeps multi-source answers workable while still rejecting a citation with nothing in common.
 */
export function citationSupportsAnswer(answer: string, citation: SupportedCitation, minimum: number): boolean {
  const answerWords = contentWords(answer);
  const passageWords = contentWords(`${citation.articleTitle} ${citation.content}`);
  if (!answerWords.size || !passageWords.size) return false;
  return Math.max(overlap(answerWords, passageWords), overlap(passageWords, answerWords)) >= minimum;
}

/**
 * Does the retrieved evidence address the question at all?
 *
 * Similarity alone is not sufficient: the mock's hashing embedding and a real embedding model
 * occupy different scales, and a weakly related passage can clear a permissive floor. This adds a
 * second, scale-free signal — whether the question's own content words appear in the passages —
 * and requires both to hold.
 */
export function evidenceAddressesQuestion(
  question: string,
  passages: { content: string; articleTitle: string; similarity: number }[],
  minimumSimilarity: number,
  minimumTermOverlap: number,
): boolean {
  if (!passages.length) return false;
  const best = passages[0];
  if (best.similarity < minimumSimilarity) return false;
  const questionWords = contentWords(question);
  if (!questionWords.size) return false;
  const combined = contentWords(passages.map((p) => `${p.articleTitle} ${p.content}`).join(' '));
  return overlap(questionWords, combined) >= minimumTermOverlap;
}
