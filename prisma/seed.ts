import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { hashPassword } from '../server/password.js';
import { z } from 'zod';
import { seedArticleFeedback, seedColleagues, seedHardware, seedInbox, seedKnowledge, seedOrganisation, seedRequests, seedServiceHistory } from './demo-story.js';

/**
 * The demo seed. It writes fictional data through the ordinary models and changes no behaviour:
 * every row here could have been created by using the application. See `prisma/demo-story.ts` for
 * the organisation it describes.
 */
async function seed() {
  if (config.NODE_ENV === 'production' || config.ALLOW_DEMO_SEED !== 'true')
    throw new Error('Demo seed requires non-production mode and ALLOW_DEMO_SEED=true');
  const password = z.string().min(16).max(128).parse(process.env.DEMO_PASSWORD);
  const host = new URL(config.DATABASE_URL).hostname;
  if (!['localhost', '127.0.0.1', 'db'].includes(host))
    throw new Error('Demo seed is restricted to a local database host');
  const people = [
    ['employee@opspilot.example', 'Maya Chen', 'EMPLOYEE'],
    ['employee2@opspilot.example', 'Noah Williams', 'EMPLOYEE'],
    ['engineer@opspilot.example', 'Alex Morgan', 'ENGINEER'],
    ['admin@opspilot.example', 'Jordan Patel', 'ADMIN'],
  ] as const;
  const users = [];
  for (const [email, name, role] of people) {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing && !existing.isDemo) throw new Error('Refusing to overwrite a non-demo account');
    users.push(
      await db.user.upsert({
        where: { email },
        update: { passwordHash: await hashPassword(password), active: true },
        create: { email, name, role, isDemo: true, passwordHash: await hashPassword(password) },
      }),
    );
  }
  const [maya, noah, alex, jordan] = users;
  const core = { maya: maya.id, noah: noah.id, alex: alex.id, jordan: jordan.id };

  const categories: Record<string, string> = {};
  for (const name of ['Access & identity', 'Hardware', 'Network', 'Software', 'Security', 'Employee services'])
    categories[name] = (await db.category.upsert({ where: { name }, update: {}, create: { name } })).id;

  const extra = await seedColleagues();
  await seedOrganisation(core, extra);
  const directory = { ...core, ...extra };

  const assets = await seedHardware(core, extra);
  await seedWorkspace(users, categories, jordan.id);
  await seedServiceHistory(directory, assets, categories);
  await seedRequests(directory, categories);
  await seedKnowledge(categories, jordan.id);
  await seedArticleFeedback(directory);
  await seedInbox(directory);

  const [ticketCount, assetCount, articleCount, personCount] = await Promise.all([
    db.ticket.count(), db.asset.count(), db.article.count(), db.user.count({ where: { isDemo: true } }),
  ]);
  console.log(
    `Seeded a fictional organisation: ${personCount} people in 5 departments, ${assetCount} assets, ${ticketCount} tickets and requests, ${articleCount} knowledge articles, plus catalog items, templates, an announcement and a read inbox. Four accounts can sign in; the rest are directory-only. Password comes from DEMO_PASSWORD.`,
  );
}

/** Service catalog, templates and the welcome announcement. Idempotent. */
async function seedWorkspace(users: { id: string; email: string }[], categories: Record<string, string>, adminId: string) {
  const cat = (name: string) => categories[name];
  const catalog = [
    { name: 'New laptop', description: 'Request a laptop for a new starter or a replacement for a failing one.', icon: 'laptop', type: 'REQUEST', categoryId: cat('Hardware'), priority: 'MEDIUM', requiresApproval: true, approverKind: 'MANAGER', sortOrder: 1,
      fields: [{ key: 'model', label: 'Preferred model', kind: 'select', required: true, options: ['Standard 14"', 'Developer 16"', 'Lightweight 13"'] }, { key: 'needed_by', label: 'Needed by', kind: 'date', required: true }, { key: 'reason', label: 'Reason', kind: 'textarea', required: true, placeholder: 'New starter, replacement, project need…' }] },
    { name: 'Access to a shared folder', description: 'Get read or edit access to a team drive or shared folder.', icon: 'key', type: 'REQUEST', categoryId: cat('Access & identity'), priority: 'MEDIUM', requiresApproval: true, approverKind: 'MANAGER', sortOrder: 2,
      fields: [{ key: 'folder', label: 'Folder or drive name', kind: 'text', required: true }, { key: 'level', label: 'Access level', kind: 'select', required: true, options: ['Read', 'Edit'] }, { key: 'justification', label: 'Why do you need it?', kind: 'textarea', required: true }] },
    { name: 'Software installation', description: 'Have an approved application installed on your device.', icon: 'cloud', type: 'REQUEST', categoryId: cat('Software'), priority: 'LOW', requiresApproval: false, approverKind: 'MANAGER', sortOrder: 3,
      fields: [{ key: 'application', label: 'Application', kind: 'text', required: true }, { key: 'licence', label: 'I have confirmed a licence is available', kind: 'checkbox' }] },
    { name: 'New starter onboarding', description: 'Accounts, hardware and access for someone joining the company.', icon: 'user', type: 'REQUEST', categoryId: cat('Access & identity'), priority: 'HIGH', requiresApproval: true, approverKind: 'ADMIN', sortOrder: 4,
      fields: [{ key: 'full_name', label: 'New starter name', kind: 'text', required: true }, { key: 'start_date', label: 'Start date', kind: 'date', required: true }, { key: 'department', label: 'Department', kind: 'select', required: true, options: ['Engineering', 'Sales', 'IT & Operations', 'Finance', 'Customer Success'] }, { key: 'needs_laptop', label: 'Needs a laptop', kind: 'checkbox' }] },
    { name: 'Wi-Fi or VPN problem', description: 'Report a connectivity issue with the office network or the VPN.', icon: 'wifi', type: 'INCIDENT', categoryId: cat('Network'), priority: 'MEDIUM', requiresApproval: false, approverKind: 'MANAGER', sortOrder: 5,
      fields: [{ key: 'where', label: 'Where does it happen?', kind: 'select', required: true, options: ['Office', 'Home', 'Travelling'] }, { key: 'since', label: 'Since when?', kind: 'text', placeholder: 'e.g. this morning' }] },
    { name: 'Reset two-factor authentication', description: 'Re-enrol your second factor after replacing or losing a phone.', icon: 'shield', type: 'REQUEST', categoryId: cat('Security'), priority: 'HIGH', requiresApproval: false, approverKind: 'MANAGER', sortOrder: 6,
      fields: [{ key: 'device', label: 'What happened to the old device?', kind: 'select', required: true, options: ['Replaced', 'Lost or stolen', 'Reset'] }, { key: 'recovery', label: 'I still have my recovery codes', kind: 'checkbox' }] },
  ] as const;
  for (const item of catalog) await db.catalogItem.upsert({ where: { name: item.name }, update: { description: item.description, icon: item.icon, fields: item.fields as unknown as object[], requiresApproval: item.requiresApproval, approverKind: item.approverKind, sortOrder: item.sortOrder }, create: { ...item, fields: item.fields as unknown as object[] } });
  const templates = [
    { name: 'Application crash', title: 'Application crashes on launch', description: 'Which application?\nWhat were you doing when it crashed?\nExact error message, if any:\nDoes it happen every time?', categoryId: cat('Software'), priority: 'MEDIUM', type: 'INCIDENT' },
    { name: 'Printer not working', title: 'Printer is offline or not printing', description: 'Printer name or location:\nWhat does the printer display show?\nDoes it affect everyone nearby or just you?', categoryId: cat('Hardware'), priority: 'LOW', type: 'INCIDENT' },
  ] as const;
  for (const t of templates) await db.ticketTemplate.upsert({ where: { name: t.name }, update: {}, create: t });
  if (!(await db.announcement.findFirst({ where: { title: 'Welcome to OpsPilot' } })))
    await db.announcement.create({ data: { title: 'Welcome to OpsPilot', body: 'Raise requests from the service catalog, follow the tickets you care about, and rate a resolution when it lands. This is fictional demo data: nothing here is real.', audience: 'ALL', pinned: true, authorId: adminId } });
  if (!(await db.announcement.findFirst({ where: { title: 'Planned network maintenance this weekend' } })))
    await db.announcement.create({ data: { title: 'Planned network maintenance this weekend', body: 'The office network switches are being upgraded on Saturday between 07:00 and 11:00. Wi-Fi and the VPN will drop for short periods. Nothing is needed from you; raise a ticket if a problem continues into Monday.', audience: 'ALL', authorId: adminId } });
  void users;
}
try {
  await seed();
} finally {
  await db.$disconnect();
}
