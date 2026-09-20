import { db } from '../db.js';
import { config } from '../config.js';
import { AiError, provider as defaultProvider, type AiProvider } from './provider.js';
import type { AiOperation, AiOutcome } from '../../generated/prisma/client.js';

/**
 * Per-user usage limits and operational logging.
 *
 * The log deliberately records metadata only — who, which operation, which model, how long, what
 * outcome, how many tokens. It never records the prompt, the ticket body, article text, the
 * question or the generated answer. That keeps the log useful for operations and cost review while
 * making it useless as a route around permissions.
 */

/** Counts a rolling 24 hours rather than a calendar day, so a limit cannot be reset by a clock edge. */
export async function usedToday(userId: string, now: Date): Promise<number> {
  return db.aiUsage.count({
    where: { userId, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  });
}

export async function assertWithinLimit(userId: string, now: Date): Promise<void> {
  const used = await usedToday(userId, now);
  if (used >= config.AI_DAILY_USER_LIMIT)
    throw new AiError(
      'RATE_LIMITED',
      `You have reached the AI usage limit of ${config.AI_DAILY_USER_LIMIT} requests in 24 hours. It resets as earlier requests age out.`,
      429,
    );
}

export async function record(entry: {
  userId: string;
  operation: AiOperation;
  provider: AiProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  outcome: AiOutcome;
}): Promise<void> {
  await db.aiUsage.create({
    data: {
      userId: entry.userId,
      operation: entry.operation,
      provider: entry.provider.mode,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      durationMs: entry.durationMs,
      outcome: entry.outcome,
    },
  });
  // One structured line per call. No prompt, no content, no identifiers beyond the user id.
  console.log(
    JSON.stringify({
      event: 'ai_call',
      operation: entry.operation,
      provider: entry.provider.mode,
      model: entry.model,
      durationMs: entry.durationMs,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      outcome: entry.outcome,
    }),
  );
}

const outcomeOf = (error: unknown): AiOutcome => (error instanceof AiError ? error.outcome : 'ERROR');

/**
 * Runs one AI operation with the limit checked first and the outcome always recorded, including
 * failures — otherwise a user could burn provider budget by triggering errors for free.
 */
export async function meter<T>(
  args: { userId: string; operation: AiOperation; provider?: AiProvider; now?: Date },
  work: (provider: AiProvider) => Promise<{ value: T; usage: { inputTokens: number; outputTokens: number }; model: string }>,
): Promise<T> {
  const active = args.provider ?? defaultProvider;
  const now = args.now ?? new Date();
  if (active.mode === 'disabled')
    throw new AiError('ERROR', 'AI features are disabled on this installation', 503);
  await assertWithinLimit(args.userId, now);
  const started = Date.now();
  try {
    const result = await work(active);
    await record({
      userId: args.userId,
      operation: args.operation,
      provider: active,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: Date.now() - started,
      outcome: 'OK',
    });
    return result.value;
  } catch (error) {
    await record({
      userId: args.userId,
      operation: args.operation,
      provider: active,
      model: active.chatModel,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - started,
      outcome: outcomeOf(error),
    });
    throw error;
  }
}
