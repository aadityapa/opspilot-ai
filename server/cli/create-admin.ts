/**
 * Creates the first administrator account, for a deployment where nobody can sign in yet.
 *
 *   FIRST_EMAIL=you@example.com FIRST_NAME="Your Name" FIRST_PASSWORD="temporary passphrase" \
 *     node dist/server/cli/create-admin.js
 *
 * In production: docker compose -f compose.prod.yaml exec -e FIRST_EMAIL=… -e FIRST_NAME=… \
 *     -e FIRST_PASSWORD=… app node dist/server/cli/create-admin.js
 *
 * Refuses to run if an administrator already exists: later accounts are created from the Users
 * page, where the action is attributed and audited. The password is temporary; the person must
 * replace it at first sign-in, and the policy applies to it.
 */
import { db } from '../db.js';
import { hashPassword } from '../password.js';
import { checkPassword } from '../security.js';

const email = process.env.FIRST_EMAIL?.trim().toLowerCase();
const name = process.env.FIRST_NAME?.trim();
const password = process.env.FIRST_PASSWORD;
if (!email || !name || !password) {
  console.error('Set FIRST_EMAIL, FIRST_NAME and FIRST_PASSWORD in the environment.');
  process.exit(1);
}
const policy = checkPassword(password, { email, name });
if (!policy.ok) {
  console.error(`That temporary password is not acceptable: ${policy.reasons.join(' ')}`);
  process.exit(1);
}
const existing = await db.user.count({ where: { role: 'ADMIN', deletedAt: null } });
if (existing > 0) {
  console.error(`An administrator already exists (${existing}). Create further accounts from the Users page.`);
  await db.$disconnect();
  process.exit(1);
}
const passwordHash = await hashPassword(password);
const user = await db.$transaction(async (tx) => {
  const u = await tx.user.create({ data: { email, name, role: 'ADMIN', passwordHash, mustChangePassword: true } });
  await tx.event.create({ data: { actorId: null, action: 'USER_CREATED', detail: `First administrator ${u.id} created from the command line; must change password at first sign-in` } });
  return u;
});
console.log(`Created administrator ${user.email}. They must change the password at first sign-in.`);
await db.$disconnect();
