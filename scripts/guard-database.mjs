/**
 * Refuses to run a destructive test setup against a database that holds real application data.
 *
 * A name check alone is not a safeguard. `opspilot_test` is only a convention, and somebody will
 * eventually point it at something that matters — or name their production database badly. So the
 * name is checked *and* the database itself is inspected and marked.
 *
 * The rule:
 *   - A database carrying the OpsPilot test marker is a test database. Proceed.
 *   - A database with no OpsPilot application tables, or with tables but no rows in them, is
 *     unclaimed. Mark it and proceed.
 *   - Anything else holds data somebody may care about. Refuse, and say why.
 *
 * The marker is a tiny table written once. It survives migrations (nothing drops it) and makes the
 * decision explicit and inspectable rather than inferred from a string.
 */
import pg from 'pg';

// The marker lives in its own schema, not in `public`. Prisma's migrate deploy refuses to run
// against a non-empty `public` schema (P3005), so writing the marker there would break the very
// fresh-database case this guard is meant to allow. Found by running the suite after adding it.
const MARKER_SCHEMA = 'opspilot_guard';
const MARKER_TABLE = 'disposable';

/** Tables whose contents mean "this is somebody's workspace, not scratch space". */
const APPLICATION_TABLES = ['Ticket', 'Asset', 'Article', 'Reply', 'Event'];

export async function assertDisposableDatabase(url, { purpose, expectedSuffix, appUrl }) {
  if (!url) throw new Error(`Set the database URL for ${purpose}. See docs/SETUP.md.`);

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`The ${purpose} database URL is not a valid URL.`);
  }
  const name = parsed.pathname.slice(1);

  // 1. Naming convention. Necessary but, on its own, not sufficient.
  if (expectedSuffix && !name.endsWith(expectedSuffix))
    throw new Error(
      `Refusing to run ${purpose}: the database is named "${name}", which does not end in "${expectedSuffix}".\n` +
        `Create a dedicated database — see docs/SETUP.md.`,
    );

  // 2. It must not be the application database, however it is named.
  if (appUrl) {
    const app = new URL(appUrl);
    const same = (a, b) =>
      a.hostname === b.hostname && (a.port || '5432') === (b.port || '5432') && a.pathname === b.pathname;
    if (same(parsed, app))
      throw new Error(
        `Refusing to run ${purpose}: the target is the same database as DATABASE_URL.\n` +
          `Tests create and delete records. Point ${purpose} at a separate database — see docs/SETUP.md.`,
      );
  }

  // 3. Inspect the database itself.
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Could not connect to the ${purpose} database "${name}".\n` +
        `Is the database container running, and is the host/port right? Host access uses port 5433; ` +
        `inside a container it is db:5432. See docs/SETUP.md.\n` +
        `Underlying error: ${error instanceof Error ? error.code ?? error.message : 'unknown'}`,
    );
  }
  try {
    const marked = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS present`,
      [MARKER_SCHEMA, MARKER_TABLE],
    );
    if (marked.rows[0].present) return { decision: 'already-marked', name };

    // Which application tables exist here at all? A fresh database has none.
    const existing = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [APPLICATION_TABLES],
    );
    const present = existing.rows.map((row) => row.table_name);

    const populated = [];
    for (const table of present) {
      const count = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
      if (count.rows[0].n > 0) populated.push(`${table}=${count.rows[0].n}`);
    }

    // Data alone does not mean "real workspace". The browser suite seeds fictional demo records by
    // design, and a database created before this guard existed will already hold them. The precise
    // signal is the `isDemo` flag the application already maintains: every seeded account is demo,
    // production refuses demo logins outright, and so a real workspace always has at least one
    // non-demo account. That is what distinguishes scratch space from somebody's data.
    let realAccounts = 0;
    if (present.length) {
      const users = await client.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='User') AS present`,
      );
      if (users.rows[0].present) {
        const real = await client.query(`SELECT count(*)::int AS n FROM "User" WHERE "isDemo" = false`);
        realAccounts = real.rows[0].n;
      }
    }
    if (realAccounts > 0)
      throw new Error(
        `Refusing to run ${purpose} against "${name}": it holds ${realAccounts} non-demo account(s) and application data (${populated.join(', ') || 'no rows'}).\n` +
          `This looks like a real workspace, and ${purpose} deletes and rewrites records.\n\n` +
          `If this really is a disposable database — for example one an earlier test run left behind,\n` +
          `which is normal, because some browser tests create ordinary accounts — claim it once:\n` +
          `    npm.cmd run db:claim-test -- --confirm\n\n` +
          `Otherwise create a separate database and point the URL at it. See docs/SETUP.md.`,
      );
    if (populated.length)
      console.log(
        `  "${name}" holds only fictional demo data (${populated.join(', ')}); claiming it as disposable.`,
      );

    await client.query(`CREATE SCHEMA IF NOT EXISTS "${MARKER_SCHEMA}"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${MARKER_SCHEMA}"."${MARKER_TABLE}" (
         purpose TEXT PRIMARY KEY,
         claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         note TEXT NOT NULL
       )`,
    );
    await client.query(
      `INSERT INTO "${MARKER_SCHEMA}"."${MARKER_TABLE}" (purpose, note) VALUES ($1, $2) ON CONFLICT (purpose) DO NOTHING`,
      [purpose, `Claimed by OpsPilot as a disposable database. DROP SCHEMA "${MARKER_SCHEMA}" CASCADE to unclaim it.`],
    );
    return { decision: present.length ? 'claimed-empty' : 'claimed-fresh', name };
  } finally {
    await client.end();
  }
}
