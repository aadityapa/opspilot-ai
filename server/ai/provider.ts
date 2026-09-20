import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';

/**
 * Server-side AI provider boundary.
 *
 * Three modes, chosen by AI_MODE:
 *   disabled — every AI feature is off; endpoints answer 503 and the rest of the app is untouched.
 *   mock     — deterministic, credential-free, clearly labelled in the UI. Same output for the
 *              same input, so tests assert real behaviour rather than a recorded fixture.
 *   openai   — the official API over plain fetch. There is no configurable base URL, so the
 *              provider cannot be redirected to another host by configuration.
 *
 * The model is given no tools of any kind. It cannot run a shell command, read or write the
 * database, send mail, or reach the network. It returns text that this process validates and then
 * either shows to a human or discards.
 */

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export type AiMode = 'disabled' | 'mock' | 'openai';
export type Outcome = 'OK' | 'TIMEOUT' | 'ERROR' | 'REFUSED' | 'INVALID_OUTPUT' | 'RATE_LIMITED';

export class AiError extends Error {
  constructor(
    public outcome: Exclude<Outcome, 'OK'>,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
export interface CompletionResult<T> {
  value: T;
  usage: Usage;
  model: string;
}
export interface EmbeddingResult {
  vectors: number[][];
  usage: Usage;
  model: string;
  dimensions: number;
}
export interface CompletionRequest<T> {
  /** Fixed application instruction. Never contains user or article text. */
  system: string;
  /** Untrusted material, already redacted and fenced by the caller. */
  user: string;
  /** Name for the structured output schema, sent to the provider. */
  schemaName: string;
  /** JSON Schema describing the required output shape. */
  jsonSchema: Record<string, unknown>;
  /** Zod schema validating the parsed output before the application trusts it. */
  parse: z.ZodType<T>;
}

export interface AiProvider {
  readonly mode: AiMode;
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly dimensions: number;
  complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>>;
  embed(inputs: string[]): Promise<EmbeddingResult>;
}

/** Bounded concurrency shared by every AI call in the process, so a burst cannot exhaust sockets. */
class Gate {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private limit: number) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/** Deterministic pseudo-random unit vector derived from text. Used only by the mock provider. */
function hashEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  // A hashing vectoriser over lowercased word tokens plus bigrams. Two texts about the same topic
  // land near each other, which is what makes mock retrieval meaningful rather than arbitrary.
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const terms = [...words, ...words.slice(1).map((w, i) => `${words[i]}_${w}`)];
  for (const term of terms) {
    if (STOP_WORDS.has(term)) continue;
    const digest = createHash('sha256').update(term).digest();
    for (let block = 0; block < 4; block++) {
      const slot = digest.readUInt32BE(block * 4) % dimensions;
      const sign = (digest[16 + block] & 1) === 0 ? 1 : -1;
      vector[slot] += sign;
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? vector.map(() => 0) : vector.map((v) => v / norm);
}
/** Mirrors server/ai/support.ts word extraction, kept local so the provider has no app dependency. */
function contentWordsForMock(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
      (word) => word.length >= 4 && !MOCK_STOP_WORDS.has(word),
    ),
  );
}
const MOCK_STOP_WORDS = new Set([
  'this','that','these','those','with','from','your','their','they','them','have','has','had','will',
  'would','should','could','when','what','where','which','while','about','into','over','under','after',
  'before','then','than','there','here','untrusted','source','passage','passages','question','knowledge',
  'base','using','used','only','also','does','did','not','can','do','how','why','the','and','for','are',
]);
const STOP_WORDS = new Set([
  'the','a','an','and','or','of','to','in','is','are','was','were','be','been','for','on','at','it',
  'this','that','with','as','by','from','my','i','we','you','not','can','do','does','how','what','why',
]);

/**
 * Documented 429 codes that a retry cannot fix. The error-codes guide is explicit: "Retrying
 * billing, spend, or quota errors won't restore API access." Verified against the official
 * reference on 9 September 2026.
 */
const TERMINAL_QUOTA_CODES = new Set([
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'insufficient_quota',
]);

/** Reads `error.code` (falling back to `error.type`) without surfacing the provider's message text. */
async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { error?: { code?: string; type?: string } };
    return body?.error?.code ?? body?.error?.type ?? '';
  } catch {
    return '';
  }
}

/**
 * Honours the `Retry-After` header, which the provider asks callers to follow when present. Accepts
 * both the delay-seconds and HTTP-date forms, and caps the wait so one header cannot stall a request
 * past its own timeout budget.
 */
function retryAfterMs(response: Response, capMs = 10_000): number {
  const header = response.headers?.get?.('retry-after');
  if (!header) return 0;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : new Date(header).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms, capMs);
}

/** Mock deterministic provider. No credentials, no network, same answer every time. */
export class MockProvider implements AiProvider {
  readonly mode = 'mock' as const;
  readonly chatModel = 'mock-deterministic-v1';
  readonly embeddingModel = 'mock-hash-v1';
  constructor(readonly dimensions = 256) {}

  async embed(inputs: string[]): Promise<EmbeddingResult> {
    return {
      vectors: inputs.map((text) => hashEmbedding(text, this.dimensions)),
      usage: { inputTokens: inputs.reduce((n, t) => n + Math.ceil(t.length / 4), 0), outputTokens: 0 },
      model: this.embeddingModel,
      dimensions: this.dimensions,
    };
  }

  async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
    const draft = mockAnswer(request);
    const parsed = request.parse.safeParse(draft);
    if (!parsed.success)
      throw new AiError('INVALID_OUTPUT', 'The mock provider produced output the schema rejected');
    return {
      value: parsed.data,
      usage: { inputTokens: Math.ceil(request.user.length / 4), outputTokens: 120 },
      model: this.chatModel,
    };
  }
}

/**
 * The mock's "reasoning": keyword rules over the fenced input. It is intentionally simple and
 * transparent. It exists so the whole application path — validation, permissions, citation
 * checking, UI states — can be exercised deterministically, not to imitate model quality.
 */
function mockAnswer<T>(request: CompletionRequest<T>): unknown {
  const text = request.user.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));
  const passages = [...request.user.matchAll(/\[passage (\d+)\]/gi)].map((m) => Number(m[1]));

  if (request.schemaName === 'ticket_triage') {
    const category = has('vpn', 'wifi', 'wi-fi', 'network', 'access point', 'switch')
      ? 'Network'
      : has('password', 'login', 'sign in', 'account', 'lockout', 'folder', 'permission', 'access')
        ? 'Access & identity'
        : has('licence', 'license', 'install', 'application', 'software', 'update')
          ? 'Software'
          : 'Hardware';
    const priority = has('everyone', 'whole office', 'all staff', 'outage', 'cannot work', 'urgent', 'production down')
      ? 'URGENT'
      : has('battery', 'slow', 'intermittent', 'sometimes')
        ? 'MEDIUM'
        : has('printer', 'cosmetic', 'minor', 'whenever')
          ? 'LOW'
          : 'HIGH';
    return {
      summary: 'Mock analysis: the requester reports a problem that has persisted after a restart and needs an engineer to reproduce it.',
      suggestedCategory: category,
      suggestedPriority: priority,
      reasons: [
        `The description mentions terms associated with the ${category} category.`,
        'Priority follows the reported scope of impact in the ticket text.',
      ],
      missingInformation: [
        'When the problem started and whether it is constant or intermittent.',
        'The exact error message or code shown on screen.',
        'Whether any other person is affected.',
      ],
      troubleshootingSteps: [
        'Confirm the device has a current network connection and restart the affected application.',
        'Reproduce the problem once and record the exact wording of any error.',
        'Check whether a colleague on the same floor or team sees the same behaviour.',
      ],
    };
  }
  if (request.schemaName === 'conversation_summary')
    return {
      summary: 'Mock summary: the requester described the problem, the support team acknowledged it, and the conversation is awaiting the next action.',
      openQuestions: ['Has the requester confirmed whether the suggested step resolved the problem?'],
      nextAction: 'Confirm the current symptom with the requester, then apply the documented fix.',
    };
  if (request.schemaName === 'reply_draft')
    return {
      draft:
        'Thank you for reporting this, and sorry for the disruption.\n\n' +
        'Please try the documented steps for this issue and let me know whether the problem continues. ' +
        'If it does, tell me the exact error message you see and roughly when it started, and I will investigate further.\n\n' +
        'Kind regards,\nIT Support',
      toneNote: 'Neutral and factual. Review before sending.',
    };
  if (request.schemaName === 'knowledge_answer') {
    // The mock judges sufficiency rather than always answering. It compares the question's content
    // words against the supplied passages, which is crude but is a real decision: a stub that always
    // said "sufficient" would make the evaluation measure nothing about abstention.
    const question = /<untrusted source="question">\s*([\s\S]*?)<\/untrusted>/.exec(request.user)?.[1] ?? '';
    const questionWords = contentWordsForMock(question);
    const passageText = request.user.slice(request.user.indexOf('Knowledge-base passages'));
    const passageWords = contentWordsForMock(passageText);
    const shared = [...questionWords].filter((word) => passageWords.has(word));
    const covered = questionWords.size ? shared.length / questionWords.size : 0;
    if (!passages.length || covered < 0.34)
      return {
        sufficientEvidence: false,
        answer: '',
        citations: [],
        escalationAdvice:
          'The accessible knowledge articles do not cover this question. Raise a ticket so an engineer can help.',
      };
    // The answer restates substance from the top passage rather than being pure boilerplate. A real
    // model's answer is grounded in its sources, so a mock whose answer shares no wording with them
    // would fail the citation-support check for a reason that says nothing about the application.
    const firstPassage = /\[passage \d+\]\n([\s\S]*?)(?=\n<\/untrusted>)/.exec(request.user)?.[1] ?? '';
    const grounding = firstPassage
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => sentence.trim().length > 20)
      .slice(0, 2)
      .join(' ')
      .trim();
    return {
      sufficientEvidence: true,
      answer:
        `Mock answer, drawn from the cited passages and covering ${shared.slice(0, 8).join(', ')}.\n\n` +
        `${grounding}\n\n` +
        'Follow the cited steps in order, and raise a ticket if the problem continues after you have tried them.',
      citations: passages.slice(0, 3),
      escalationAdvice: '',
    };
  }
  return {};
}

/** Disabled provider. Every call fails the same way so callers have one path to handle. */
export class DisabledProvider implements AiProvider {
  readonly mode = 'disabled' as const;
  readonly chatModel = 'none';
  readonly embeddingModel = 'none';
  readonly dimensions = 0;
  async complete<T>(): Promise<CompletionResult<T>> {
    throw new AiError('ERROR', 'AI features are disabled on this installation', 503);
  }
  async embed(): Promise<EmbeddingResult> {
    throw new AiError('ERROR', 'AI features are disabled on this installation', 503);
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * OpenAI provider, verified against the official reference on 9 September 2026:
 *   POST /v1/responses  with { model, input:[{role,content}], text:{format:{type:"json_schema",
 *     name, strict, schema}}, max_output_tokens }
 *   -> { status, incomplete_details:{reason}, output:[{type:"message",content:[{type:"output_text",
 *        text}|{type:"refusal",refusal}]}], usage:{input_tokens,output_tokens} }
 *   POST /v1/embeddings with { model, input, dimensions, encoding_format:"float" }
 *   -> { data:[{embedding}], usage:{prompt_tokens,total_tokens} }
 * Authorization: Bearer <key>.
 */
export class OpenAiProvider implements AiProvider {
  readonly mode = 'openai' as const;
  constructor(
    private apiKey: string,
    readonly chatModel: string,
    readonly embeddingModel: string,
    readonly dimensions: number,
    private timeoutMs: number,
    private maxOutputTokens: number,
    private fetchImpl: FetchLike = fetch,
  ) {}

  private async call(path: string, body: unknown): Promise<unknown> {
    // Bounded retries, only for conditions that a retry can plausibly fix. A retry here repeats a
    // read-only provider call; it never repeats an application write, so it cannot duplicate an
    // action. Every application mutation stays behind a separate, explicit human step.
    let lastError: AiError = new AiError('ERROR', 'The AI provider could not be reached');
    let lastDelayMs = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, lastDelayMs || 400 * 2 ** (attempt - 1)));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${OPENAI_BASE_URL}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (response.status === 429 || response.status >= 500) {
          const code = await errorCode(response);
          // The documented billing, spend and quota codes are not transient: "Retrying billing,
          // spend, or quota errors won't restore API access." Retrying them wastes the caller's
          // time and tells them nothing, so they fail immediately with a message that says what to
          // actually do.
          if (TERMINAL_QUOTA_CODES.has(code))
            throw new AiError(
              'RATE_LIMITED',
              'The AI provider has refused the request because the account has reached a credit, spend or usage limit. Retrying will not help — check the provider billing settings.',
              429,
            );
          // The provider asks callers to honour Retry-After when present.
          lastDelayMs = retryAfterMs(response);
          lastError = new AiError(
            response.status === 429 ? 'RATE_LIMITED' : 'ERROR',
            response.status === 429
              ? 'The AI provider is rate limiting this workspace. Try again shortly.'
              : 'The AI provider reported a temporary failure.',
            response.status === 429 ? 429 : 502,
          );
          continue;
        }
        if (!response.ok)
          // The provider's own message may echo submitted content, so it is not surfaced.
          throw new AiError('ERROR', `The AI provider rejected the request (HTTP ${response.status}).`);
        return await response.json();
      } catch (error) {
        if (error instanceof AiError) throw error;
        lastError =
          error instanceof Error && error.name === 'AbortError'
            ? new AiError('TIMEOUT', 'The AI provider did not respond in time', 504)
            : new AiError('ERROR', 'The AI provider could not be reached');
        if (lastError.outcome === 'TIMEOUT') throw lastError;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  async complete<T>(request: CompletionRequest<T>): Promise<CompletionResult<T>> {
    const payload = await this.call('/responses', {
      model: this.chatModel,
      input: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      text: {
        format: { type: 'json_schema', name: request.schemaName, strict: true, schema: request.jsonSchema },
      },
      max_output_tokens: this.maxOutputTokens,
      store: false,
    });
    const envelope = responseEnvelope.safeParse(payload);
    if (!envelope.success) throw new AiError('INVALID_OUTPUT', 'The AI provider returned an unrecognised response');
    const body = envelope.data;
    if (body.status === 'incomplete')
      throw new AiError('INVALID_OUTPUT', 'The AI response was cut short before it was complete');
    const message = body.output.find((item) => item.type === 'message');
    const content = message?.content?.[0];
    if (content && 'refusal' in content) throw new AiError('REFUSED', 'The AI provider declined this request');
    if (!content || content.type !== 'output_text' || !('text' in content))
      throw new AiError('INVALID_OUTPUT', 'The AI provider returned no usable text');
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content.text);
    } catch {
      throw new AiError('INVALID_OUTPUT', 'The AI provider returned output that was not valid JSON');
    }
    const validated = request.parse.safeParse(parsedJson);
    if (!validated.success)
      throw new AiError('INVALID_OUTPUT', 'The AI provider returned output that did not match the required structure');
    return {
      value: validated.data,
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      },
      model: this.chatModel,
    };
  }

  async embed(inputs: string[]): Promise<EmbeddingResult> {
    const payload = await this.call('/embeddings', {
      model: this.embeddingModel,
      input: inputs,
      dimensions: this.dimensions,
      encoding_format: 'float',
    });
    const parsed = embeddingEnvelope.safeParse(payload);
    if (!parsed.success) throw new AiError('INVALID_OUTPUT', 'The embedding provider returned an unrecognised response');
    const vectors = parsed.data.data.sort((a, b) => a.index - b.index).map((row) => row.embedding);
    if (vectors.length !== inputs.length)
      throw new AiError('INVALID_OUTPUT', 'The embedding provider returned the wrong number of vectors');
    for (const vector of vectors)
      if (vector.length !== this.dimensions)
        throw new AiError(
          'INVALID_OUTPUT',
          `The embedding provider returned ${vector.length} dimensions where ${this.dimensions} were requested`,
        );
    return {
      vectors,
      usage: { inputTokens: parsed.data.usage?.prompt_tokens ?? 0, outputTokens: 0 },
      model: this.embeddingModel,
      dimensions: this.dimensions,
    };
  }
}

const responseEnvelope = z.object({
  status: z.string().optional(),
  incomplete_details: z.object({ reason: z.string().optional() }).nullish(),
  output: z
    .array(
      z.object({
        type: z.string(),
        content: z
          .array(
            z.union([
              z.object({ type: z.literal('output_text'), text: z.string() }),
              z.object({ type: z.literal('refusal'), refusal: z.string() }),
              z.object({ type: z.string() }),
            ]),
          )
          .optional(),
      }),
    )
    .default([]),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).nullish(),
});

const embeddingEnvelope = z.object({
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()) })),
  usage: z.object({ prompt_tokens: z.number().optional(), total_tokens: z.number().optional() }).nullish(),
});

const gate = new Gate(config.AI_MAX_CONCURRENCY);

/** Wraps a provider so every call is subject to the shared concurrency limit. */
function limited(provider: AiProvider): AiProvider {
  return {
    mode: provider.mode,
    chatModel: provider.chatModel,
    embeddingModel: provider.embeddingModel,
    dimensions: provider.dimensions,
    complete: (request) => gate.run(() => provider.complete(request)),
    embed: (inputs) => gate.run(() => provider.embed(inputs)),
  };
}

export function buildProvider(fetchImpl?: FetchLike): AiProvider {
  if (config.AI_MODE === 'disabled') return new DisabledProvider();
  if (config.AI_MODE === 'mock') return limited(new MockProvider());
  return limited(
    new OpenAiProvider(
      config.OPENAI_API_KEY!,
      config.AI_CHAT_MODEL,
      config.AI_EMBEDDING_MODEL,
      config.AI_EMBEDDING_DIMENSIONS,
      config.AI_TIMEOUT_MS,
      config.AI_MAX_OUTPUT_TOKENS,
      fetchImpl,
    ),
  );
}

export const provider = buildProvider();
