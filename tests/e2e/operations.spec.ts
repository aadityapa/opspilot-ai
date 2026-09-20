import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, role: string) {
  await page.goto('/');
  await page.getByLabel('Email address').fill(`${role}@opspilot.example`);
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}
/**
 * Opens a seeded ticket by searching for it. The end-to-end database is reused between runs and
 * accumulates tickets, so a seeded ticket is not reliably on the first page of the queue.
 * Navigation goes through the href because the list re-renders as its data resolves.
 */
async function openTicket(page: Page, title: RegExp | string) {
  await page.goto('/#/tickets');
  await page.getByLabel('Search tickets').fill(typeof title === 'string' ? title : title.source.replace(/\\/g, ''));
  const link = page.getByRole('link', { name: title }).first();
  await expect(link).toBeVisible();
  await page.goto(`/${await link.getAttribute('href')}`);
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: /Sign in to your OpsPilot workspace/ })).toBeVisible();
}

test('asset inventory is scoped: an employee sees only their own assigned hardware', async ({ page }) => {
  await login(page, 'employee');
  await page.getByRole('link', { name: 'My assets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My assets', exact: true })).toBeVisible();
  // Maya Chen owns LAP-0001 and DSK-0001 in the seed; LAP-0002 belongs to the other employee.
  await expect(page.getByRole('link', { name: /^LAP-0001/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^LAP-0002/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^SWT-0001/ })).toHaveCount(0);
  // Administrator-only controls are absent for an employee.
  await expect(page.getByRole('link', { name: 'Add asset' })).toHaveCount(0);

  await page.getByRole('link', { name: /^LAP-0001/ }).first().click();
  await expect(page.getByText('LAP-0001', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Serial number', { exact: true })).toBeVisible();
  // The asset workspace answers ownership and service context, not just the record.
  await expect(page.getByRole('heading', { name: 'Service history' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lifecycle' })).toBeVisible();

  await logout(page);
  await login(page, 'engineer');
  await page.getByRole('link', { name: 'Assets', exact: true }).click();
  // Staff see the whole inventory. The list is paginated, so find the switch by search rather than
  // relying on which page of the sorted inventory it lands on.
  await page.getByLabel('Search assets').fill('SWT-0001');
  await page.getByLabel('Search assets').press('Enter');
  await expect(page.getByRole('link', { name: /^SWT-0001/ })).toBeVisible();
});

test('internal notes and the audit timeline stay invisible to the requester', async ({ page }) => {
  const secret = `Internal triage note ${Date.now()}`;
  await login(page, 'employee');
  await page.getByRole('link', { name: 'Service Catalog', exact: true }).click();
  await page.getByRole('link', { name: 'Report an IT issue' }).first().click();
  const title = `Internal note check ${Date.now()}`;
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Hardware' });
  await page.getByLabel('Description').fill('A synthetic ticket used to verify internal note privacy.');
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  // Employees land on a confirmation, then their request view; staff URLs use the ticket workspace.
  await expect(page.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
  await page.getByRole('link', { name: 'View request' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const ticketURL = page.url().replace('#/requests/', '#/tickets/');

  // The requester has no internal note controls at all.
  await expect(page.getByRole('heading', { name: 'Internal notes' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Activity timeline' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Service level' })).toBeVisible();

  await logout(page);
  await login(page, 'engineer');
  await page.goto(ticketURL);
  await expect(page.getByRole('heading', { name: 'Internal notes' })).toBeVisible();
  // The composer has a Reply tab and an Internal note tab; the note form only exists on its tab.
  await page.getByRole('tab', { name: 'Internal note' }).click();
  await page.getByLabel('Internal note', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Add internal note' }).click();
  await expect(page.getByText('Internal note added.', { exact: true })).toBeVisible();
  await expect(page.getByText(secret, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByRole('heading', { name: 'Activity timeline' })).toBeVisible();
  await expect(page.getByText('Internal note added', { exact: false }).first()).toBeVisible();

  await logout(page);
  await login(page, 'employee');
  await page.goto(ticketURL);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  // The requester's own ticket search must not surface the note text either. Employees have no
  // Service Desk entry in the sidebar, so reach their ticket list by URL.
  await page.goto('/#/tickets');
  await page.getByLabel('Search tickets').fill(secret);
  await expect(page.getByRole('heading', { name: 'No tickets match this view' })).toBeVisible();
});

test('SLA state is visible on the ticket page and on the dashboard', async ({ page }) => {
  await login(page, 'engineer');
  await page.getByRole('link', { name: 'Service Desk', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'SLA' })).toBeVisible();
  await openTicket(page, 'VPN disconnects during video calls');

  const sla = page.locator('.sla-panel');
  await expect(sla.getByRole('heading', { name: 'Service level' })).toBeVisible();
  await expect(sla.getByText('First response', { exact: true })).toBeVisible();
  await expect(sla.getByText('Resolution', { exact: true })).toBeVisible();
  await expect(sla).toContainText('Policy snapshot taken when this ticket started');

  // Regression guard: an existing asset link must survive an unrelated edit. The picker loads its
  // options asynchronously, so an uncontrolled select would drop the link on save.
  await expect(page.getByLabel('Linked asset', { exact: true })).toHaveValue(/.+/);
  await expect(page.getByText('Linked asset: LAP-0001')).toBeVisible();
  await page.getByLabel('Priority', { exact: true }).selectOption('HIGH');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Ticket updated.', { exact: true })).toBeVisible();
  await expect(page.getByText('Linked asset: LAP-0001')).toBeVisible();

  await page.getByRole('link', { name: 'Command Center', exact: true }).click();
  // The command center: pulse, health strip, attention feed and SLA module, all from /api/operations/summary.
  await expect(page.getByRole('heading', { name: 'SLA performance' })).toBeVisible();
  const pulse = page.getByRole('region', { name: 'Service operations pulse' });
  await expect(pulse.getByText('SLA breached', { exact: true })).toBeVisible();
  await expect(pulse.getByText('SLA at risk', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /Operational health of active tickets/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs your attention' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Critical & at-risk work' })).toBeVisible();
  // The dashboard filters live in the URL and re-scope the summary.
  await page.getByLabel('Time range').selectOption('14');
  await expect(page).toHaveURL(/days=14/);
  await expect(page.getByRole('button', { name: '14D' })).toHaveAttribute('aria-pressed', 'true');
});

test('knowledge base hides support-only runbooks and drafts from employees', async ({ page }) => {
  await login(page, 'employee');
  await page.getByRole('link', { name: 'Knowledge', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Find answers. Solve problems faster.' })).toBeVisible();
  // The reused database accumulates published articles, so find the seeded one by search.
  await page.getByLabel('Search articles').fill('Reconnect to the company');
  await expect(page.getByRole('link', { name: /Reconnect to the company VPN/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Engineer runbook/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Draft:/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'New article' })).toHaveCount(0);

  // Searching for restricted text returns nothing rather than leaking a title or excerpt.
  await page.getByLabel('Search articles').fill('escalation procedure');
  await expect(page.getByRole('heading', { name: /No articles found for/ })).toBeVisible();

  await page.getByLabel('Search articles').fill('Reconnect to the company');
  await page.getByRole('link', { name: /Reconnect to the company VPN/ }).click();
  await expect(page.getByRole('heading', { name: 'Reconnect to the company VPN', level: 1 })).toBeVisible();
  await expect(page.locator('.article-body')).toContainText('Sign out of the VPN client completely');
  await expect(page.locator('.article-body script')).toHaveCount(0);
  // A long article gets a contents list, and the reader can say whether it helped.
  await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible();
  await page.getByRole('button', { name: 'Helpful', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Helpful', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await logout(page);
  await login(page, 'engineer');
  await page.getByRole('link', { name: 'Knowledge', exact: true }).click();
  await page.getByLabel('Search articles').fill('access point replacement');
  await expect(page.getByRole('link', { name: /Engineer runbook: access point replacement/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Draft:/ })).toHaveCount(0);
});

test('the resource layer connects: ticket → person → department → asset → service history', async ({ page }) => {
  await login(page, 'engineer');
  // Start from a ticket in the queue and walk to the requester's profile.
  await page.goto('/#/tickets');
  await page.getByLabel('Search tickets').fill('VPN disconnects during video calls');
  await page.getByRole('link', { name: /VPN disconnects during video calls/ }).first().click();
  await expect(page.getByRole('heading', { name: 'VPN disconnects during video calls', level: 1 })).toBeVisible();
  await page.getByRole('complementary', { name: 'Ticket context' }).getByRole('link', { name: 'Maya Chen' }).first().click();
  await expect(page.getByRole('heading', { name: 'Maya Chen', level: 1 })).toBeVisible();

  // Profile → department, and back to the profile.
  await page.getByRole('link', { name: 'Engineering' }).first().click();
  await expect(page.getByRole('heading', { name: 'Engineering', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  // Support roles see the department's service demand; the figures come from the same endpoint the
  // Command Center uses, scoped to this department.
  await expect(page.getByLabel('Service demand')).toBeVisible();

  // Profile → assigned asset → its service history, which leads back to a ticket.
  await page.goto('/#/people');
  await page.getByLabel('Search people').fill('Maya');
  await page.getByRole('link', { name: /Maya Chen/ }).first().click();
  await page.getByRole('link', { name: 'Assets' }).click();
  await page.getByRole('link', { name: /LAP-0001/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Service history' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: /VPN disconnects during video calls/ })).toBeVisible();
});

test('an employee cannot reach department service demand, by UI or by URL', async ({ page }) => {
  await login(page, 'employee');
  await page.goto('/#/departments');
  await expect(page.getByRole('heading', { name: 'Departments', level: 1 })).toBeVisible();
  // The operational columns are absent for an employee.
  await expect(page.getByRole('columnheader', { name: 'Open requests' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'SLA risk' })).toHaveCount(0);
  await page.getByRole('link', { name: /Engineering/ }).first().click();
  await expect(page.getByLabel('Service demand')).toHaveCount(0);
  // Frontend hiding is not authorization: the endpoint itself refuses them.
  const denied = await page.evaluate(async () => (await fetch('/api/operations/summary?days=30', { credentials: 'include' })).status);
  expect(denied).toBe(403);
});

test('an administrator publishes an article and edits SLA policy', async ({ page }) => {
  await login(page, 'admin');
  await page.getByRole('link', { name: 'Knowledge', exact: true }).click();
  await page.getByRole('link', { name: 'New article' }).click();
  const title = `Synthetic guidance ${Date.now()}`;
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Software' });
  await page.getByLabel('Visibility', { exact: true }).selectOption('EMPLOYEE');
  await page.getByLabel('Status', { exact: true }).selectOption('PUBLISHED');
  await page
    .getByLabel('Markdown content')
    .fill('## Synthetic article\n\nThis article was created by an automated browser test.');
  await page.getByRole('button', { name: 'Save article' }).click();
  // Saving navigates to the new article, so assert on the destination rather than a transient notice.
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('.article-body h2')).toContainText('Synthetic article');

  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await page.getByRole('navigation', { name: 'Administration sections' }).getByRole('link', { name: 'Service levels', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'First-response and resolution targets' })).toBeVisible();
  const urgentResponse = page.getByLabel('Urgent first response minutes');
  await urgentResponse.fill('20');
  await page.getByRole('row').filter({ hasText: 'Urgent' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Urgent targets saved.', { exact: true })).toBeVisible();
  await urgentResponse.fill('15');
  await page.getByRole('row').filter({ hasText: 'Urgent' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Urgent targets saved.', { exact: true })).toBeVisible();

  await page.getByRole('navigation', { name: 'Administration sections' }).getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByText('SLA_POLICY_UPDATED').first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Administration sections' }).getByRole('link', { name: 'Notification outbox' }).click();
  await expect(page.getByRole('heading', { name: 'Notification outbox', level: 1 })).toBeVisible();
});

test('an employee cannot reach administrator settings by URL', async ({ page }) => {
  await login(page, 'employee');
  await page.goto('/#/settings/sla');
  await expect(page.getByRole('heading', { name: /You don’t have access to this area/ })).toBeVisible();
  await page.goto('/#/knowledge/new');
  await expect(page.getByRole('alert')).toContainText('Administrator role required');
});

test('service intelligence, reports and the administration control plane', async ({ page }) => {
  await login(page, 'admin');
  // Analytics: URL-scoped filters, honest comparisons, and drill-downs that land in the Service Desk.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operational performance' })).toBeVisible();
  await page.getByRole('button', { name: '90D' }).click();
  await expect(page).toHaveURL(/days=90/);
  await expect(page.getByLabel('Headline performance')).toBeVisible();
  await page.getByRole('button', { name: 'SLA', exact: true }).click();
  await expect(page.getByRole('img', { name: /inside SLA per day/ })).toBeVisible();
  await page.getByRole('heading', { name: 'Team workload' }).scrollIntoViewIfNeeded();
  await expect(page.getByText('this is not a ranking')).toBeVisible();
  // Reports: the library, a report with its filters, and an export that carries the same filters.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Service reports' })).toBeVisible();
  await page.getByRole('link', { name: /SLA performance/ }).click();
  await expect(page.getByRole('heading', { name: 'SLA performance', level: 1 })).toBeVisible();
  await page.getByLabel('Period').selectOption('90');
  await expect(page).toHaveURL(/days=90/);
  await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', /\/api\/reports\/sla\?.*days=90.*format=csv/);
  // Administration: one control plane with secondary navigation, and honest read-only pages.
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Administration sections' });
  await nav.getByRole('link', { name: 'Workflow' }).click();
  await expect(page.getByRole('heading', { name: 'Statuses and transitions' })).toBeVisible();
  await nav.getByRole('link', { name: 'Roles & permissions' }).click();
  await expect(page.getByRole('heading', { name: 'Administrator', level: 2 })).toBeVisible();
  await nav.getByRole('link', { name: 'Security' }).click();
  await expect(page.getByRole('heading', { name: 'Protections in force' })).toBeVisible();
  await expect(page.getByText(/SAML|SCIM/)).toBeVisible();
  await nav.getByRole('link', { name: 'Accounts & access', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accounts & access', level: 1 })).toBeVisible();
  // Old paths keep working.
  await page.goto('/#/settings/sla');
  await expect(page.getByRole('heading', { name: 'Service levels', level: 1 })).toBeVisible();
});

test('restricted and unknown routes explain themselves without leaking', async ({ page }) => {
  await login(page, 'employee');
  await page.goto('/#/analytics');
  await expect(page.getByRole('heading', { name: /You don’t have access to this area/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return home' })).toBeVisible();
  await page.goto('/#/no-such-page');
  await expect(page.getByRole('heading', { name: /We couldn’t find that page/ })).toBeVisible();
  await page.getByRole('link', { name: 'Go to My Space' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
});
