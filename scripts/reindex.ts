/**
 * Rebuilds the knowledge retrieval index from the command line.
 *
 * Use it after enabling AI for the first time, after changing AI_EMBEDDING_MODEL or
 * AI_EMBEDDING_DIMENSIONS, or after a bulk article import. Administrators can do the same thing
 * from Settings → AI & retrieval; this exists for scripted setup.
 *
 *   npm.cmd run ai:reindex
 *
 * Only published articles are indexed. Drafts and archived articles have their passages removed.
 */
import 'dotenv/config';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { provider } from '../server/ai/provider.js';
import { reindexAll } from '../server/ai/retrieval.js';

if (config.AI_MODE === 'disabled') {
  console.error('AI_MODE is "disabled". Set AI_MODE=mock or AI_MODE=openai before reindexing.');
  process.exit(1);
}

const actor = await db.user.findFirst({ where: { role: 'ADMIN', active: true }, orderBy: { createdAt: 'asc' } });
if (!actor) {
  console.error('No active administrator account exists to attribute the reindex to.');
  process.exit(1);
}

console.log(`Reindexing with ${provider.embeddingModel} (${provider.dimensions} dimensions)…`);
const reports = await reindexAll(actor.id, provider);
for (const report of reports)
  console.log(`  ${report.state.padEnd(14)} ${report.chunks.toString().padStart(3)} passage(s)  ${report.title}${report.error ? ` — ${report.error}` : ''}`);
const indexed = reports.filter((r) => r.state === 'INDEXED').length;
const failed = reports.filter((r) => r.state === 'FAILED').length;
console.log(`\n${indexed} indexed, ${failed} failed, ${reports.length} published article(s) considered.`);
await db.$disconnect();
if (failed) process.exit(1);
