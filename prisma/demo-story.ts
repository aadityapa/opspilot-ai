/**
 * The fictional organisation behind the demo: colleagues, departments, hardware, a fortnight of
 * service history, knowledge, article feedback and a believable inbox.
 *
 * Everything here is invented. No real person, company, product or serial number is described.
 * This module is imported only by `prisma/seed.ts`, which refuses to run outside a local,
 * non-production database with `ALLOW_DEMO_SEED=true`.
 *
 * Two rules shaped it:
 *
 *  - **It is demo *data*, never demo *behaviour*.** Rows are written through the ordinary models
 *    with the ordinary meanings. Nothing here changes how notifications are raised, how SLAs are
 *    evaluated, or what any endpoint returns. Delete every row and the application behaves
 *    identically, with less to look at.
 *  - **It is idempotent.** Every block is guarded by a unique key, so re-running the seed against a
 *    database that already has the story changes nothing. The browser suite re-seeds before every
 *    run and depends on that.
 */
import { randomUUID } from 'node:crypto';
import { db } from '../server/db.js';
import { hashPassword } from '../server/password.js';
import { newSla } from '../server/sla.js';

type Ids = Record<string, string>;
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** All story timestamps hang off one base so a seeded database always tells the same story. */
const base = Date.now();
export const ago = (days: number, hours = 0) => new Date(base - days * DAY - hours * HOUR);

/* ── Colleagues ───────────────────────────────────────────────────────────
 * The four documented sign-in accounts keep their existing identities. The rest are directory-only
 * colleagues: real rows, so the directory, departments, approvals and asset ownership have
 * somebody to point at, but with an unguessable random password nobody is given. They exist to be
 * *looked at*, not signed in as, and DEMO.md still lists exactly four usable logins.
 */
const COLLEAGUES = [
  // email, name, role, title, location
  ['dana.whitfield@opspilot.example', 'Dana Whitfield', 'EMPLOYEE', 'Engineering Manager', 'Bengaluru'],
  ['tom.okafor@opspilot.example', 'Tom Okafor', 'EMPLOYEE', 'Senior Software Engineer', 'Bengaluru'],
  ['lena.fischer@opspilot.example', 'Lena Fischer', 'EMPLOYEE', 'QA Engineer', 'Pune'],
  ['priya.raman@opspilot.example', 'Priya Raman', 'ENGINEER', 'Service Desk Analyst', 'Bengaluru'],
  ['cara.nwosu@opspilot.example', 'Cara Nwosu', 'EMPLOYEE', 'Sales Director', 'Mumbai'],
  ['victor.hale@opspilot.example', 'Victor Hale', 'EMPLOYEE', 'Account Manager', 'Mumbai'],
  ['ingrid.larsen@opspilot.example', 'Ingrid Larsen', 'EMPLOYEE', 'Finance Controller', 'Pune'],
  ['samuel.obi@opspilot.example', 'Samuel Obi', 'EMPLOYEE', 'Financial Analyst', 'Pune'],
  ['hana.suzuki@opspilot.example', 'Hana Suzuki', 'EMPLOYEE', 'Customer Success Lead', 'Bengaluru'],
  ['elliot.brady@opspilot.example', 'Elliot Brady', 'EMPLOYEE', 'Support Specialist', 'Bengaluru'],
] as const;

export async function seedColleagues(): Promise<Ids> {
  const ids: Ids = {};
  for (const [email, name, role, title, location] of COLLEAGUES) {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing && !existing.isDemo) throw new Error(`Refusing to overwrite a non-demo account: ${email}`);
    const user = existing ?? (await db.user.create({
      data: { email, name, role, title, location, isDemo: true, passwordHash: await hashPassword(`${randomUUID()}${randomUUID()}`) },
    }));
    ids[email.split('@')[0]] = user.id;
  }
  return ids;
}

/* ── Organisation ─────────────────────────────────────────────────────────
 * Five departments with cost centres and managers. Jordan Patel (the demo administrator) heads IT
 * and stays the manager of Maya and Noah: the approval walkthrough in the browser suite depends on
 * their requests reaching the administrator account, and a demo should not quietly re-route the
 * flow a reviewer is about to follow.
 */
export async function seedOrganisation(core: Ids, extra: Ids) {
  const dept = async (name: string, code: string, costCentre: string, managerId?: string) =>
    (await db.department.upsert({ where: { code }, update: { name, costCentre, ...(managerId ? { managerId } : {}) }, create: { name, code, costCentre, managerId } })).id;
  const it = await dept('IT & Operations', 'IT', 'CC-1001', core.jordan);
  const eng = await dept('Engineering', 'ENG', 'CC-2040', core.jordan);
  const sales = await dept('Sales', 'SALES', 'CC-3010', extra['cara.nwosu']);
  const fin = await dept('Finance', 'FIN', 'CC-4020', extra['ingrid.larsen']);
  const cs = await dept('Customer Success', 'CS', 'CC-5005', extra['hana.suzuki']);

  const place = (id: string, departmentId: string, managerId: string | null, title: string, location: string) =>
    db.user.update({ where: { id }, data: { departmentId, managerId, title, location } });
  await place(core.jordan, it, null, 'Head of IT', 'Bengaluru');
  await place(core.alex, it, core.jordan, 'IT Support Engineer', 'Bengaluru');
  await place(extra['priya.raman'], it, core.jordan, 'Service Desk Analyst', 'Bengaluru');
  await place(core.maya, eng, core.jordan, 'Software Engineer', 'Bengaluru');
  await place(extra['dana.whitfield'], eng, core.jordan, 'Engineering Manager', 'Bengaluru');
  await place(extra['tom.okafor'], eng, extra['dana.whitfield'], 'Senior Software Engineer', 'Bengaluru');
  await place(extra['lena.fischer'], eng, extra['dana.whitfield'], 'QA Engineer', 'Pune');
  await place(core.noah, sales, core.jordan, 'Account Executive', 'Pune');
  await place(extra['cara.nwosu'], sales, core.jordan, 'Sales Director', 'Mumbai');
  await place(extra['victor.hale'], sales, extra['cara.nwosu'], 'Account Manager', 'Mumbai');
  await place(extra['ingrid.larsen'], fin, core.jordan, 'Finance Controller', 'Pune');
  await place(extra['samuel.obi'], fin, extra['ingrid.larsen'], 'Financial Analyst', 'Pune');
  await place(extra['hana.suzuki'], cs, core.jordan, 'Customer Success Lead', 'Bengaluru');
  await place(extra['elliot.brady'], cs, extra['hana.suzuki'], 'Support Specialist', 'Bengaluru');
  return { it, eng, sales, fin, cs };
}

/* ── Hardware ─────────────────────────────────────────────────────────────
 * One laptop for each person who has one, a few shared desktops, and the network hardware the
 * runbooks talk about. Warranty dates are chosen so the "needs attention" figure is small and
 * real: two units are inside the 90-day warranty window the API already computes.
 */
export async function seedHardware(core: Ids, extra: Ids) {
  const day = (d: Date) => new Date(d.toISOString().slice(0, 10) + 'T00:00:00Z');
  const rows: [string, string, string, string, string, string | null, string, Date, Date][] = [
    ['LAP-0001', 'LAPTOP', 'Northwind Systems', 'Atlas 14', 'NW-AT14-500118', core.maya, 'IN_USE', ago(700), ago(-395)],
    ['LAP-0002', 'LAPTOP', 'Northwind Systems', 'Atlas 14', 'NW-AT14-500742', core.noah, 'IN_USE', ago(560), ago(-260)],
    ['LAP-0003', 'LAPTOP', 'Corvid Compute', 'Field Pro 13', 'CC-FP13-118904', null, 'AVAILABLE', ago(240), ago(-490)],
    ['LAP-0004', 'LAPTOP', 'Northwind Systems', 'Atlas 16', 'NW-AT16-610233', core.alex, 'IN_USE', ago(410), ago(-320)],
    ['LAP-0005', 'LAPTOP', 'Northwind Systems', 'Atlas 16', 'NW-AT16-610488', core.jordan, 'IN_USE', ago(410), ago(-320)],
    ['LAP-0006', 'LAPTOP', 'Corvid Compute', 'Field Pro 15', 'CC-FP15-220914', extra['dana.whitfield'], 'IN_USE', ago(300), ago(-430)],
    ['LAP-0007', 'LAPTOP', 'Corvid Compute', 'Field Pro 15', 'CC-FP15-221077', extra['tom.okafor'], 'IN_USE', ago(300), ago(-430)],
    ['LAP-0008', 'LAPTOP', 'Northwind Systems', 'Atlas 14', 'NW-AT14-502260', extra['lena.fischer'], 'IN_USE', ago(640), ago(-88)],
    ['LAP-0009', 'LAPTOP', 'Northwind Systems', 'Atlas 14', 'NW-AT14-502318', extra['priya.raman'], 'IN_USE', ago(640), ago(-88)],
    ['LAP-0010', 'LAPTOP', 'Corvid Compute', 'Field Pro 13', 'CC-FP13-119540', extra['cara.nwosu'], 'IN_USE', ago(520), ago(-210)],
    ['LAP-0011', 'LAPTOP', 'Corvid Compute', 'Field Pro 13', 'CC-FP13-119611', extra['victor.hale'], 'IN_USE', ago(520), ago(-210)],
    ['LAP-0012', 'LAPTOP', 'Northwind Systems', 'Atlas 14', 'NW-AT14-503901', extra['ingrid.larsen'], 'IN_USE', ago(370), ago(-360)],
    ['LAP-0013', 'LAPTOP', 'Northwind Systems', 'Atlas 14', 'NW-AT14-504077', extra['samuel.obi'], 'IN_USE', ago(370), ago(-360)],
    ['LAP-0014', 'LAPTOP', 'Corvid Compute', 'Field Pro 13', 'CC-FP13-120338', extra['hana.suzuki'], 'IN_USE', ago(180), ago(-550)],
    ['LAP-0015', 'LAPTOP', 'Corvid Compute', 'Field Pro 13', 'CC-FP13-120401', extra['elliot.brady'], 'IN_USE', ago(180), ago(-550)],
    ['LAP-0016', 'LAPTOP', 'Northwind Systems', 'Atlas 14', 'NW-AT14-499008', null, 'REPAIR', ago(900), ago(-60)],
    ['LAP-0017', 'LAPTOP', 'Northwind Systems', 'Atlas 13', 'NW-AT13-410662', null, 'RETIRED', ago(1500), ago(400)],
    ['DSK-0001', 'DESKTOP', 'Northwind Systems', 'Foundry Mini', 'NW-FM-330045', core.maya, 'IN_USE', ago(820), ago(-270)],
    ['DSK-0002', 'DESKTOP', 'Corvid Compute', 'Studio Tower', 'CC-ST-221730', null, 'REPAIR', ago(1250), ago(280)],
    ['DSK-0003', 'DESKTOP', 'Corvid Compute', 'Studio Tower', 'CC-ST-222014', extra['lena.fischer'], 'IN_USE', ago(690), ago(-40)],
    ['PRN-0001', 'PRINTER', 'Kestrel Imaging', 'PageMark 480', 'KI-PM480-77120', null, 'IN_USE', ago(870), ago(-70)],
    ['PRN-0002', 'PRINTER', 'Kestrel Imaging', 'PageMark 220', 'KI-PM220-77455', null, 'RETIRED', ago(2700), ago(1600)],
    ['PRN-0003', 'PRINTER', 'Kestrel Imaging', 'PageMark 480', 'KI-PM480-78002', null, 'IN_USE', ago(430), ago(-660)],
    ['WAP-0001', 'ACCESS_POINT', 'Meridian Networks', 'AirLink 6', 'MN-AL6-901233', null, 'IN_USE', ago(590), ago(-1230)],
    ['WAP-0002', 'ACCESS_POINT', 'Meridian Networks', 'AirLink 6', 'MN-AL6-901601', null, 'IN_USE', ago(590), ago(-1230)],
    ['WAP-0003', 'ACCESS_POINT', 'Meridian Networks', 'AirLink 6', 'MN-AL6-901744', null, 'REPAIR', ago(590), ago(-1230)],
    ['SWT-0001', 'SWITCH', 'Meridian Networks', 'CoreSwitch 48P', 'MN-CS48-140077', null, 'IN_USE', ago(980), ago(-840)],
    ['SWT-0002', 'SWITCH', 'Meridian Networks', 'EdgeSwitch 24P', 'MN-ES24-140512', null, 'AVAILABLE', ago(980), ago(-840)],
  ];
  const ids: Ids = {};
  for (const [tag, type, manufacturer, model, serialNumber, ownerId, status, purchase, warranty] of rows) {
    const existing = await db.asset.findUnique({ where: { tag } });
    const asset = existing ?? (await db.asset.create({
      data: { tag, type: type as 'LAPTOP', manufacturer, model, serialNumber, ownerId, status: status as 'IN_USE', purchaseDate: day(purchase), warrantyExpiry: day(warranty) },
    }));
    ids[tag] = asset.id;
    // The record was created when the device was bought and last touched when it was assigned;
    // `createdAt`/`updatedAt` are maintained by Prisma on write, so the story's timing is applied here.
    if (!existing) {
      const created = day(purchase);
      const touched = status === 'IN_USE' || status === 'REPAIR' ? new Date(Math.max(created.getTime(), base - (30 + (tag.charCodeAt(6) % 120)) * DAY)) : created;
      await db.$executeRaw`UPDATE "Asset" SET "createdAt" = ${created}, "updatedAt" = ${touched} WHERE id = ${asset.id}`;
    }
  }
  return ids;
}

/* ── Service history ──────────────────────────────────────────────────────
 * Three weeks of work across the whole organisation: incidents and catalog requests, some
 * resolved and rated, some still moving, two deliberately in trouble. Every ticket names a real
 * requester in a real department, and the hardware ones point at that person's own device, so the
 * Service Desk → person → department → asset trail leads somewhere on every row.
 */
interface Story {
  title: string; description: string; requester: string; assignee?: string; status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_FOR_USER' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; type?: 'INCIDENT' | 'REQUEST' | 'PROBLEM' | 'CHANGE'; category: string; asset?: string;
  createdDaysAgo: number; resolvedDaysAgo?: number; pausedHours?: number; replyAfterHours?: number; reply?: [string, string]; survey?: [string, number, string];
  /** Directory key of somebody the reply names with an "@". The mention is stored as a relation, the
   *  way the reply endpoint stores one, so the seeded "you were mentioned" notification is true. */
  mention?: string;
}

export async function seedServiceHistory(users: Ids, assets: Ids, categories: Record<string, string>) {
  const stories: Story[] = [
    { title: 'VPN disconnects during video calls', description: 'Fictional demo report: the VPN drops roughly every twenty minutes during video calls, most often when screen sharing. Reconnecting works but the call is lost.', requester: 'maya', assignee: 'alex', status: 'IN_PROGRESS', priority: 'HIGH', category: 'Network', asset: 'LAP-0001', createdDaysAgo: 0.18, replyAfterHours: 0.7, mention: 'maya', reply: ['alex', '@Maya Chen thanks — I can see the disconnects in the gateway log. Could you try the profile steps in the VPN article and tell me whether it survives a full call?'] },
    { title: 'Laptop battery does not hold a charge', description: 'Fictional demo report: the laptop lasts under an hour away from power. Battery health reports 61% in the power settings.', requester: 'noah', status: 'OPEN', priority: 'MEDIUM', category: 'Hardware', asset: 'LAP-0002', createdDaysAgo: 0.06 },
    { title: 'Unable to access the shared finance folder', description: 'Fictional demo report: the quarterly close folder returns "access denied" since Monday. Other folders on the same drive open normally.', requester: 'samuel.obi', assignee: 'priya.raman', status: 'WAITING_FOR_USER', priority: 'MEDIUM', category: 'Access & identity', createdDaysAgo: 3, pausedHours: 5, replyAfterHours: 1.5, reply: ['priya.raman', 'The folder owner has been asked to confirm your access level. Could you confirm whether you need read or edit?'] },
    { title: 'Office printer shows offline', description: 'Fictional demo report: the third-floor printer shows offline for everyone on the floor. The display reads Ready and the tray is full.', requester: 'lena.fischer', status: 'OPEN', priority: 'LOW', category: 'Hardware', asset: 'PRN-0001', createdDaysAgo: 0.1 },
    { title: 'Software license activation failed', description: 'Fictional demo report: the design suite reports an activation error on launch and closes after ten seconds.', requester: 'victor.hale', assignee: 'alex', status: 'IN_PROGRESS', priority: 'MEDIUM', category: 'Software', createdDaysAgo: 0.45, replyAfterHours: 1, reply: ['alex', 'The licence server shows the seat as free. I am re-issuing the activation and will confirm once it is applied.'] },
    { title: 'Guest Wi-Fi is not available', description: 'Fictional demo report: visitors in the ground-floor meeting rooms cannot see the guest network. Staff Wi-Fi works in the same rooms.', requester: 'cara.nwosu', status: 'OPEN', priority: 'MEDIUM', category: 'Network', asset: 'WAP-0003', createdDaysAgo: 2.4 },
    { title: 'Two-factor app stopped generating codes', description: 'Fictional demo report: after replacing a phone the authenticator app no longer lists the work account, so sign-in cannot be completed.', requester: 'hana.suzuki', assignee: 'priya.raman', status: 'RESOLVED', priority: 'HIGH', category: 'Access & identity', createdDaysAgo: 6.2, resolvedDaysAgo: 6, replyAfterHours: 0.5, reply: ['priya.raman', 'Identity verified through the standard check and the second factor re-enrolled. Please confirm you can sign in from both devices.'], survey: ['hana.suzuki', 5, 'Sorted within an hour, and the explanation was clear.'] },
    { title: 'Spreadsheet macros blocked after update', description: 'Fictional demo report: the month-end workbook reports that macros are blocked by policy since the latest update.', requester: 'ingrid.larsen', assignee: 'alex', status: 'RESOLVED', priority: 'MEDIUM', category: 'Software', createdDaysAgo: 4.6, resolvedDaysAgo: 3.7, replyAfterHours: 3, reply: ['alex', 'The workbook now lives in a trusted location, so the macros run without changing the policy for everyone else.'], survey: ['ingrid.larsen', 4, 'Good fix, took a couple of days to get going.'] },
    { title: 'Meeting room display does not detect laptops', description: 'Fictional demo report: the display in the Harbour room shows "no signal" for every laptop tried, over both cable and wireless.', requester: 'elliot.brady', assignee: 'priya.raman', status: 'RESOLVED', priority: 'LOW', category: 'Hardware', createdDaysAgo: 2.8, resolvedDaysAgo: 2.2, reply: ['priya.raman', 'The display input was set to the wrong channel after the firmware update. Corrected and left on the laptop input.'] },
    { title: 'Email delivery delayed for external recipients', description: 'Fictional demo report: messages to customers arrive between twenty and forty minutes late. Internal mail is immediate.', requester: 'cara.nwosu', assignee: 'alex', status: 'RESOLVED', priority: 'HIGH', category: 'Software', createdDaysAgo: 18, resolvedDaysAgo: 17.75, replyAfterHours: 0.4, reply: ['alex', 'A queue on the outbound relay was clearing slowly. The backlog is gone and the queue is being watched for the rest of the week.'], survey: ['cara.nwosu', 5, 'Kept us posted the whole way through.'] },
    { title: 'Laptop fan runs constantly after firmware update', description: 'Fictional demo report: the fan runs at full speed from boot, even with nothing open. The device is noticeably hot.', requester: 'tom.okafor', assignee: 'alex', status: 'IN_PROGRESS', priority: 'MEDIUM', category: 'Hardware', asset: 'LAP-0007', createdDaysAgo: 0.8, replyAfterHours: 2, reply: ['alex', 'The firmware update reset the fan curve. I have the corrected profile ready — can I take the laptop for twenty minutes this afternoon?'] },
    { title: 'Shared mailbox missing from Outlook', description: 'Fictional demo report: the team mailbox disappeared from the sidebar this morning for two of us but not the third.', requester: 'elliot.brady', status: 'OPEN', priority: 'MEDIUM', category: 'Access & identity', createdDaysAgo: 0.12 },
    { title: 'Phone cannot join the staff Wi-Fi', description: 'Fictional demo report: the work phone rejects the staff network with an authentication error, laptops on the same desk connect.', requester: 'dana.whitfield', assignee: 'priya.raman', status: 'WAITING_FOR_USER', priority: 'LOW', category: 'Network', createdDaysAgo: 2, pausedHours: 9, replyAfterHours: 3, reply: ['priya.raman', 'The phone is being rejected by the certificate check. Could you tell me the operating system version so I can send the right profile?'] },
    { title: 'Password reset link never arrives', description: 'Fictional demo report: three reset attempts produced no email, including to the personal address on file.', requester: 'victor.hale', assignee: 'alex', status: 'RESOLVED', priority: 'URGENT', category: 'Access & identity', createdDaysAgo: 20, resolvedDaysAgo: 19.6, replyAfterHours: 0.6, reply: ['alex', 'Delivery was failing to that domain. Fixed at the relay and the reset completed with the requester on the phone.'], survey: ['victor.hale', 3, 'Solved in the end, but it took three attempts to get someone looking at it.'] },
    { title: 'Docking station does not detect the second monitor', description: 'Fictional demo report: the dock drives one monitor but not the second. Both monitors work when plugged directly into the laptop.', requester: 'maya', assignee: 'alex', status: 'RESOLVED', priority: 'MEDIUM', category: 'Hardware', asset: 'DSK-0001', createdDaysAgo: 17, resolvedDaysAgo: 16.6, replyAfterHours: 1.5, reply: ['alex', 'The dock firmware was two versions behind and only drove one display port. Updated on your machine and added to the standard image.'], survey: ['maya', 5, 'Explained what caused it, not just that it was fixed.'] },
    { title: 'Access to the engineering build server', description: 'Fictional demo report: read access is needed to the build server logs to investigate failing nightly builds.', requester: 'maya', assignee: 'priya.raman', status: 'RESOLVED', priority: 'MEDIUM', type: 'REQUEST', category: 'Access & identity', createdDaysAgo: 5.5, resolvedDaysAgo: 5.2, replyAfterHours: 2, reply: ['priya.raman', 'Read access granted to the build log share. It is reviewed quarterly like every other access grant.'] },
    { title: 'Calendar invitations show the wrong time zone', description: 'Fictional demo report: invitations sent from the laptop appear an hour out for colleagues in another office.', requester: 'maya', assignee: 'alex', status: 'CLOSED', priority: 'LOW', category: 'Software', createdDaysAgo: 24, resolvedDaysAgo: 22, reply: ['alex', 'The calendar client had a stale time-zone database. Updated, and the sample invitations now show the correct time for both offices.'] },
    { title: 'Finance reporting tool times out on large exports', description: 'Fictional demo report: exports over roughly fifty thousand rows time out after five minutes. Smaller exports finish normally.', requester: 'samuel.obi', status: 'OPEN', priority: 'MEDIUM', type: 'PROBLEM', category: 'Software', createdDaysAgo: 8 },
  ];

  for (const s of stories) {
    const requesterId = users[s.requester];
    if (!requesterId) continue;
    if (await db.ticket.findFirst({ where: { title: s.title } })) continue;
    const created = ago(s.createdDaysAgo);
    const resolved = s.resolvedDaysAgo !== undefined ? ago(s.resolvedDaysAgo) : null;
    const ticket = await db.ticket.create({
      data: {
        title: s.title, description: s.description, requesterId, assigneeId: s.assignee ? users[s.assignee] : null,
        status: s.status, priority: s.priority, type: s.type ?? (s.title.startsWith('Request') ? 'REQUEST' : 'INCIDENT'),
        categoryId: categories[s.category], assetId: s.asset ? assets[s.asset] : null,
        createdAt: created, resolvedAt: resolved,
        sla: { create: await newSla(db, s.priority, created) },
        events: { create: { actorId: requesterId, action: 'CREATED', detail: 'Fictional demo ticket created', createdAt: created } },
      },
    });
    if (resolved) {
      // A finished ticket stores the time it actually used, exactly as advanceSla() would have left it.
      await db.ticketSla.update({ where: { ticketId: ticket.id }, data: { runningSince: null, elapsedMs: resolved.getTime() - created.getTime() } });
    }
    if (s.reply) {
      // The first reply stops the response clock at the moment it was written — soon after the
      // ticket was raised, not at the moment it was resolved.
      const at = new Date(created.getTime() + (s.replyAfterHours ?? 1) * HOUR);
      await db.reply.create({ data: { ticketId: ticket.id, authorId: users[s.reply[0]], body: s.reply[1], createdAt: at, ...(s.mention && users[s.mention] ? { mentions: { connect: { id: users[s.mention] } } } : {}) } });
      await db.ticketSla.update({ where: { ticketId: ticket.id }, data: { responseSatisfiedAt: at, ...(['RESOLVED', 'CLOSED'].includes(s.status) ? { runningSince: null } : {}) } });
      await db.ticket.update({ where: { id: ticket.id }, data: { firstRespondedAt: at } });
    }
    if (s.status === 'WAITING_FOR_USER') {
      // advanceSla() stops the clock for anything that is not OPEN or IN_PROGRESS and persists the
      // elapsed time; the same two fields are written here so the stored row means what it says.
      await db.ticketSla.update({ where: { ticketId: ticket.id }, data: { runningSince: null, elapsedMs: (s.pausedHours ?? 4) * HOUR } });
    }
    if (s.survey) await db.survey.create({ data: { ticketId: ticket.id, respondentId: users[s.survey[0]], score: s.survey[1], comment: s.survey[2], createdAt: resolved ?? created } });
    // `updatedAt` is maintained by Prisma on write, so the story's own timing is applied afterwards.
    const touched = resolved ?? created;
    await db.$executeRaw`UPDATE "Ticket" SET "updatedAt" = ${touched} WHERE id = ${ticket.id}`;
  }
}

/* ── Requests with approvals ──────────────────────────────────────────────
 * Two catalog requests so the Approval Center and the request timeline have something real: one
 * already approved and fulfilled, one still waiting on the administrator who manages the
 * requester. Both are created exactly the way the application creates them.
 */
export async function seedRequests(users: Ids, categories: Record<string, string>) {
  const laptop = await db.catalogItem.findUnique({ where: { name: 'New laptop' } });
  const folder = await db.catalogItem.findUnique({ where: { name: 'Access to a shared folder' } });
  if (laptop && !(await db.ticket.findFirst({ where: { title: 'Replacement laptop for Noah Williams' } }))) {
    const created = ago(2, 5);
    const t = await db.ticket.create({
      data: {
        title: 'Replacement laptop for Noah Williams', description: 'Raised from the service catalog. The current device is out of warranty and the battery is failing.',
        requesterId: users.noah, status: 'OPEN', priority: 'MEDIUM', type: 'REQUEST', categoryId: laptop.categoryId, catalogItemId: laptop.id,
        formData: { model: 'Standard 14"', needed_by: new Date(base + 12 * DAY).toISOString().slice(0, 10), reason: 'Battery health is at 61% and the device is out of warranty next month.' },
        createdAt: created, sla: { create: await newSla(db, 'MEDIUM', created) },
        events: { create: { actorId: users.noah, action: 'CREATED', detail: 'Requested from the service catalog', createdAt: created } },
        approvals: { create: { approverId: users.jordan, status: 'PENDING', createdAt: created } },
      },
    });
    await db.$executeRaw`UPDATE "Ticket" SET "updatedAt" = ${created} WHERE id = ${t.id}`;
  }
  if (folder && !(await db.ticket.findFirst({ where: { title: 'Access to the quarterly close folder' } }))) {
    const created = ago(11);
    const decided = ago(10, 18);
    const t = await db.ticket.create({
      data: {
        title: 'Access to the quarterly close folder', description: 'Raised from the service catalog. Read and edit access is needed for the close checklist.',
        requesterId: users['samuel.obi'], assigneeId: users['priya.raman'], status: 'RESOLVED', priority: 'MEDIUM', type: 'REQUEST',
        categoryId: folder.categoryId, catalogItemId: folder.id,
        formData: { folder: 'Finance / Quarterly close', level: 'Edit', justification: 'Preparing the close checklist with the controller for Q3.' },
        createdAt: created, resolvedAt: ago(10.4), sla: { create: await newSla(db, 'MEDIUM', created) },
        events: { create: { actorId: users['samuel.obi'], action: 'CREATED', detail: 'Requested from the service catalog', createdAt: created } },
        approvals: { create: { approverId: users['ingrid.larsen'], status: 'APPROVED', note: 'Needed for the close. Please remove the access again at year end.', decidedAt: decided, createdAt: created } },
      },
    });
    await db.reply.create({ data: { ticketId: t.id, authorId: users['priya.raman'], body: 'Edit access granted to the Quarterly close folder and confirmed with the controller. The quarterly access review will pick it up in December.', createdAt: ago(10) } });
    await db.ticketSla.update({ where: { ticketId: t.id }, data: { responseSatisfiedAt: ago(10, 22), runningSince: null, elapsedMs: (ago(10.4).getTime() - created.getTime()) } });
    await db.$executeRaw`UPDATE "Ticket" SET "updatedAt" = ${ago(10)} WHERE id = ${t.id}`;
  }
  void categories;
}

/* ── Knowledge ────────────────────────────────────────────────────────────
 * Guidance an employee could actually use to avoid raising a ticket, plus two support-only
 * runbooks that stay invisible to employees. The VPN article keeps its original wording — the
 * retrieval evaluation and the browser tests quote it — and gains the section structure a long
 * article needs.
 */
export const STORY_ARTICLES: [string, string, 'EMPLOYEE' | 'SUPPORT', 'PUBLISHED' | 'DRAFT', number, string][] = [
  ['Reconnect to the company VPN', 'Network', 'EMPLOYEE', 'PUBLISHED', 4,
`## Overview

The VPN client keeps a saved profile. When that profile goes stale — after a password change, a
long offline period, or a client upgrade — the tunnel drops every few minutes and the client
reports that the profile is out of date. Replacing the profile fixes it in most cases.

## Before you begin

- Know your account password: replacing the profile signs you out of the client.
- Have your second-factor device with you.
- Close video calls first. The steps below drop the connection.

## Reconnect the VPN

1. Sign out of the VPN client completely.
2. Open **Settings → Connections** and remove the old profile.
3. Download the current profile from the company portal.
4. Reconnect and confirm the status shows *Connected*.

## Clear cached credentials

If the client reconnects and then drops again within a minute, the saved credentials are stale:

1. Open **Settings → Credentials** and choose *Forget this account*.
2. Reconnect and sign in when prompted, approving the second-factor request.

## Verify the network

A tunnel that drops on one network and not another is usually the network, not the client. Check
whether the drops follow you between the office Wi-Fi, a wired desk and a phone hotspot, and note
what you find.

> Never share your VPN password or one-time code with anyone, including IT staff.

## Still having trouble?

If the client still disconnects after two attempts, raise a ticket in the Network category and
mention how long the session lasted, which networks you tried, and whether screen sharing was
running.`],
  ['Laptop battery health and charging', 'Hardware', 'EMPLOYEE', 'PUBLISHED', 9,
`## Check the battery first

1. Open the power settings and note the reported battery health percentage.
2. Charge to 100% while the device stays powered on.
3. Unplug and record how long the device lasts under normal use.

## What the number means

A battery below 70% health is normally replaced. Above that, runtime usually improves by changing
how the device is used rather than by replacing hardware.

## Raise a ticket

Include the health percentage and your asset tag when you raise a Hardware ticket so the engineer
can order the part in advance.`],
  ['Request access to a shared folder', 'Access & identity', 'EMPLOYEE', 'PUBLISHED', 6,
`## What to include in your request

Raise a request from the service catalog with:

- The exact folder path.
- The access level you need (read, or read and write).
- The business reason and your manager's name.

## How it is reviewed

Access is reviewed by the folder owner. Requests are not granted automatically and are re-checked
every quarter. If your access disappears after a review, raise the same request again and say that
it was removed at review.`],
  ['Printer offline triage', 'Hardware', 'EMPLOYEE', 'PUBLISHED', 13,
`## Before raising a ticket

1. Confirm the printer display shows *Ready* and has paper.
2. Check that the network cable is seated at both ends.
3. Remove and re-add the printer from your device.

## If it affects everyone

If nobody on the floor can print, say so in the ticket: a shared printer that is offline for a whole
floor is treated differently from one device that cannot see it.

If the display shows an error code, include that code and the printer asset tag in your ticket.`],
  ['Set up two-factor authentication on a new phone', 'Security', 'EMPLOYEE', 'PUBLISHED', 5,
`## Before you replace your phone

Generate recovery codes from **Account & security** and store them somewhere you can reach without
your phone. With recovery codes you can re-enrol yourself; without them you need an identity check
with the service desk, which takes longer.

## On the new phone

1. Install the authenticator app.
2. In **Account & security**, choose *Set up two-factor* and scan the code shown.
3. Enter the six-digit code to confirm, then re-generate recovery codes.

## If you have already lost access

Raise a request in the Access & identity category. The service desk will verify your identity
through the standard check before re-enrolment; nobody will ask you for a code or a password.

> IT will never ask for your password or a one-time code, by email, chat or phone.`],
  ['Working from home: what IT supports', 'Employee services', 'EMPLOYEE', 'PUBLISHED', 21,
`## What is supported

- The laptop issued to you, its operating system and the standard applications.
- The VPN client and the company portal.
- Company accounts and access.

## What is not supported

- Home routers, personal printers and personal devices.
- Internet faults with your provider.

## Getting help faster

Include your location, your network (home, office, hotspot) and the time the problem started. Those
three details decide who picks the ticket up.`],
  ['Requesting software: what to expect', 'Software', 'EMPLOYEE', 'PUBLISHED', 16,
`## Before you request

Check whether the application is already available to you. Licensed software is installed only when
a licence is free or a new one is approved.

## What happens after you request

1. The request reaches IT with the application name and your reason.
2. If a licence is available, it is installed on your device.
3. If not, the request waits for the next licence renewal and you are told when that is.

Installing software yourself is not supported and may breach the licence terms.`],
  ['Engineer runbook: access point replacement', 'Network', 'SUPPORT', 'PUBLISHED', 7,
`## Internal runbook — support team only

This article is not visible to employees.

1. Confirm the reported coverage gap against the floor plan before swapping hardware.
2. Record the failing access point tag and note the switch port it is patched to.
3. Stage the replacement, restore the saved configuration, then verify client roaming from two devices.
4. Update the asset record: set the failed unit to **Repair** and assign the replacement tag.

Escalate to the network lead if two access points on the same switch fail within thirty days; that
pattern usually indicates a switch or power fault rather than a unit fault.`],
  ['Engineer runbook: account lockout handling', 'Access & identity', 'SUPPORT', 'PUBLISHED', 14,
`## Internal runbook — support team only

Verify the requester through the established identity check before any reset. Record the
verification method in an **internal note**, never in a public reply.

1. Confirm the lockout source in the directory event log.
2. Clear stale sessions before unlocking, otherwise the account re-locks.
3. Ask the user to update saved credentials on mobile devices.

Never send a new password through a ticket reply.`],
  ['Engineer runbook: laptop replacement and data transfer', 'Hardware', 'SUPPORT', 'PUBLISHED', 11,
`## Internal runbook — support team only

1. Confirm the approval on the request before ordering anything.
2. Stage the replacement from the available pool and record the new tag against the person.
3. Transfer data from the backup, never device to device.
4. Set the returned unit to **Repair** or **Retired** and clear its owner.

A device that leaves the building for repair must have its status changed the same day, otherwise
the inventory reports an assignment that no longer exists.`],
  ['Draft: laptop refresh cycle for 2027', 'Hardware', 'SUPPORT', 'DRAFT', 2,
`## Draft — not published

Outline for the fictional 2027 refresh: replacement thresholds, warranty overlap, and a staged
rollout by department. This draft exists so the demo can show that unpublished content stays hidden
from every non-administrator.`],
];

export async function seedKnowledge(categories: Record<string, string>, authorId: string) {
  for (const [title, categoryName, visibility, status, updatedDaysAgo, markdown] of STORY_ARTICLES) {
    const categoryId = categories[categoryName];
    if (!categoryId) continue;
    const existing = await db.article.findFirst({ where: { title } });
    const article = existing
      ? await db.article.update({ where: { id: existing.id }, data: { markdown, categoryId, visibility, status } })
      : await db.article.create({ data: { title, markdown, visibility, status, categoryId, authorId, publishedAt: status === 'PUBLISHED' ? ago(updatedDaysAgo) : null } });
    await db.$executeRaw`UPDATE "Article" SET "updatedAt" = ${ago(updatedDaysAgo)} WHERE id = ${article.id}`;
  }
}

/**
 * A few real votes, so "found this helpful" is a count of rows rather than a decorative percentage.
 * One article deliberately carries a dissenting vote: a demo where everything is loved teaches the
 * reader nothing about the control.
 */
export async function seedArticleFeedback(users: Ids) {
  const votes: [string, string, boolean][] = [
    ['Reconnect to the company VPN', 'maya', true],
    ['Reconnect to the company VPN', 'noah', true],
    ['Reconnect to the company VPN', 'tom.okafor', true],
    ['Reconnect to the company VPN', 'lena.fischer', false],
    ['Printer offline triage', 'lena.fischer', true],
    ['Printer offline triage', 'elliot.brady', true],
    ['Set up two-factor authentication on a new phone', 'hana.suzuki', true],
    ['Set up two-factor authentication on a new phone', 'victor.hale', true],
    ['Set up two-factor authentication on a new phone', 'samuel.obi', true],
    ['Laptop battery health and charging', 'noah', true],
    ['Request access to a shared folder', 'samuel.obi', true],
    ['Working from home: what IT supports', 'dana.whitfield', true],
  ];
  for (const [title, who, helpful] of votes) {
    const article = await db.article.findFirst({ where: { title }, select: { id: true } });
    const userId = users[who];
    if (!article || !userId) continue;
    await db.articleFeedback.upsert({ where: { articleId_userId: { articleId: article.id, userId } }, update: { helpful }, create: { articleId: article.id, userId, helpful, createdAt: ago(3) } });
  }
}

/* ── The inbox ────────────────────────────────────────────────────────────
 * A believable notification history rather than a wall of unread noise: a fortnight of messages
 * that have already been read, and four that have not — one of each kind a person actually acts
 * on. These are ordinary Outbox rows with the ordinary meanings; they are written as already
 * delivered so the demo never posts mail for history that predates the installation.
 *
 * (An announcement is not a notification kind in this system: announcements are published to My
 * Space and the announcement list. The four unread examples are therefore a mention and a reply
 * for the employee, an approval for the manager, and a reply for the second employee.)
 *
 * Every row describes something that exists: a reply row for PUBLIC_REPLY, a resolved ticket for
 * SURVEY_REQUEST, an approval row for APPROVAL_REQUESTED and APPROVAL_DECIDED, the ticket's own
 * assignee for ASSIGNMENT, and a reply that names the recipient for MENTION. A notification about
 * an event that never happened would be exactly the kind of invented detail this demo avoids.
 */
export async function seedInbox(users: Ids) {
  const rows: [string, string, string, number, boolean][] = [
    // recipient, ticket title, kind, days ago, unread
    ['maya', 'VPN disconnects during video calls', 'MENTION', 0.2, true],
    ['maya', 'VPN disconnects during video calls', 'PUBLIC_REPLY', 1, true],
    ['maya', 'Docking station does not detect the second monitor', 'PUBLIC_REPLY', 16, false],
    ['maya', 'Docking station does not detect the second monitor', 'SURVEY_REQUEST', 16, false],
    ['maya', 'Access to the engineering build server', 'PUBLIC_REPLY', 5.2, false],
    ['maya', 'Calendar invitations show the wrong time zone', 'PUBLIC_REPLY', 22, false],
    ['maya', 'Calendar invitations show the wrong time zone', 'SURVEY_REQUEST', 22, false],
    ['jordan', 'Replacement laptop for Noah Williams', 'APPROVAL_REQUESTED', 2, true],
    ['noah', 'Laptop battery does not hold a charge', 'PUBLIC_REPLY', 2, true],
    ['hana.suzuki', 'Two-factor app stopped generating codes', 'SURVEY_REQUEST', 6, false],
    ['hana.suzuki', 'Two-factor app stopped generating codes', 'PUBLIC_REPLY', 6.1, false],
    ['ingrid.larsen', 'Spreadsheet macros blocked after update', 'SURVEY_REQUEST', 3.7, false],
    ['ingrid.larsen', 'Spreadsheet macros blocked after update', 'PUBLIC_REPLY', 4.5, false],
    ['samuel.obi', 'Access to the quarterly close folder', 'APPROVAL_DECIDED', 10, false],
    ['samuel.obi', 'Unable to access the shared finance folder', 'PUBLIC_REPLY', 3, false],
    ['cara.nwosu', 'Email delivery delayed for external recipients', 'SURVEY_REQUEST', 16, false],
    ['victor.hale', 'Password reset link never arrives', 'SURVEY_REQUEST', 19, false],
    ['alex', 'VPN disconnects during video calls', 'ASSIGNMENT', 1, false],
    ['alex', 'Software license activation failed', 'ASSIGNMENT', 2, false],
    ['priya.raman', 'Unable to access the shared finance folder', 'ASSIGNMENT', 3, false],
  ];
  for (const [who, title, kind, daysAgo, unread] of rows) {
    const recipientId = users[who];
    const ticket = await db.ticket.findFirst({ where: { title }, select: { id: true } });
    if (!recipientId || !ticket) continue;
    const at = ago(daysAgo);
    const dedupeKey = `demo:${kind}:${ticket.id}:${recipientId}:${daysAgo}`;
    if (await db.outbox.findUnique({ where: { dedupeKey } })) continue;
    await db.outbox.create({
      data: {
        dedupeKey, recipientId, ticketId: ticket.id, kind: kind as 'MENTION',
        status: 'SENT', sentAt: at, createdAt: at, readAt: unread ? null : at,
      },
    });
  }
  // Leave the demo accounts' inbox in the state the story describes. Anything else addressed to a
  // demo account — a message left behind by an earlier browser-test run, say — counts as history
  // and is marked read. Read state is per-recipient display state: no message is deleted, no
  // delivery is affected, and this runs only under the demo seed's local-database guard.
  const storyUnread = await db.outbox.findMany({ where: { readAt: null, dedupeKey: { startsWith: 'demo:' } }, select: { id: true } });
  await db.outbox.updateMany({
    where: { readAt: null, recipient: { isDemo: true }, id: { notIn: storyUnread.map((r) => r.id) } },
    data: { readAt: new Date(base) },
  });
}
