import { test, expect, type Page } from '@playwright/test';

/**
 * Browser coverage for the Phase 3 interface. The end-to-end environment runs with AI_MODE=mock,
 * so these are deterministic and need no credentials.
 */

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

test('an engineer analyses a ticket and must approve before anything changes', async ({ page }) => {
  await login(page, 'engineer');
  await openTicket(page, 'VPN disconnects during video calls');

  const panel = page.locator('.ai-panel');
  await expect(panel.getByRole('heading', { name: 'AI assistance' })).toBeVisible();
  // Mock mode is labelled wherever AI output appears.
  await expect(panel.getByText('Mock AI').first()).toBeVisible();

  const priorityBefore = await page.getByLabel('Priority', { exact: true }).inputValue();
  await panel.getByRole('button', { name: 'Analyze ticket' }).click();
  await expect(panel.getByRole('heading', { name: 'Triage suggestions' })).toBeVisible();
  await expect(panel.getByText('Suggested category')).toBeVisible();
  await expect(panel.getByText(/nothing has been changed on the ticket/i)).toBeVisible();
  // No confidence figure is presented anywhere in the panel.
  await expect(panel).not.toHaveText(/\d+(\.\d+)?\s?%/);
  // The ticket itself is untouched until the engineer applies something.
  expect(await page.getByLabel('Priority', { exact: true }).inputValue()).toBe(priorityBefore);

  await panel.getByRole('button', { name: 'Apply selected suggestions' }).click();
  await expect(page.getByText('Reviewed suggestions applied and recorded in the audit log.')).toBeVisible();
  // The acceptance is attributed to the engineer in the audit timeline (Activity tab of the workspace).
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText(/accepted AI triage suggestions/i).first()).toBeVisible();
});

test('a draft reply is editable and is never sent automatically', async ({ page }) => {
  // Self-contained: this suite runs repeatedly against the same end-to-end database, so the test
  // creates the ticket it needs rather than relying on the state of a seeded one.
  await login(page, 'employee');
  await page.getByRole('link', { name: 'Service Catalog', exact: true }).click();
  await page.getByRole('link', { name: 'Report an IT issue' }).first().click();
  const title = `Draft review ${Date.now()}`;
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Hardware' });
  await page.getByLabel('Description').fill('A synthetic ticket used to verify the reply-draft review workflow.');
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  // Employees land on a confirmation, then their request view; staff URLs use the ticket workspace.
  await expect(page.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
  await page.getByRole('link', { name: 'View request' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const ticketURL = page.url().replace('#/requests/', '#/tickets/');
  await logout(page);

  await login(page, 'engineer');
  await page.goto(ticketURL);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const panel = page.locator('.ai-panel');
  const repliesBefore = await page.locator('.conversation .reply').count();
  await panel.getByRole('button', { name: 'Draft a public reply' }).click();
  await expect(panel.getByRole('heading', { name: 'Draft reply' })).toBeVisible();
  await expect(panel.getByText(/nothing has been sent/i).first()).toBeVisible();
  // Drafting alone posts nothing.
  expect(await page.locator('.conversation .reply').count()).toBe(repliesBefore);

  const draft = panel.getByLabel('Editable draft reply');
  await expect(draft).toBeVisible();
  await draft.fill('Edited by the engineer before sending, which is the required workflow.');
  await panel.getByRole('button', { name: 'Copy into the reply box' }).click();

  // The draft lands in the ordinary reply box; sending is still the engineer's explicit action.
  const replyBox = page.getByLabel('Public reply', { exact: true });
  await expect(replyBox).toHaveValue(/Edited by the engineer before sending/);
  expect(await page.locator('.conversation .reply').count()).toBe(repliesBefore);
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText('Reply sent.', { exact: true })).toBeVisible();
  // Wait for the refetched conversation rather than counting before it arrives.
  await expect(page.locator('.conversation').getByText('Edited by the engineer before sending')).toBeVisible();
  await expect(page.locator('.conversation .reply')).toHaveCount(repliesBefore + 1);
});

test('an employee gets a cited answer and never sees restricted sources', async ({ page }) => {
  await login(page, 'employee');
  // My Space also offers an "Ask OpsPilot" shortcut, so pick the sidebar entry explicitly.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Ask OpsPilot', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ask the knowledge base' })).toBeVisible();

  await page.getByLabel('Your question').fill('How do I reconnect to the company VPN profile?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByRole('heading', { name: 'Answer' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
  await expect(page.getByText(/not that the answer is correct/i)).toBeVisible();

  // Citations are clickable and lead to an article the employee may open.
  const source = page.locator('.citations a').first();
  await expect(source).toBeVisible();
  await source.click();
  await expect(page.locator('.article-body')).toBeVisible();
  await expect(page.getByText('Support only')).toHaveCount(0);
});

test('an unanswerable question says so instead of inventing an answer', async ({ page }) => {
  await login(page, 'employee');
  await page.goto('/#/ask');
  await page.getByLabel('Your question').fill('What is the capital city of France and its population?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByRole('heading', { name: 'Not enough evidence to answer' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Raise a ticket' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sources' })).toHaveCount(0);
});

test('an employee has no AI ticket controls and no admin AI settings', async ({ page }) => {
  await login(page, 'employee');
  await openTicket(page, 'VPN disconnects during video calls');
  await expect(page.locator('.ai-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Analyze ticket' })).toHaveCount(0);
  await page.goto('/#/settings/ai');
  await expect(page.getByRole('heading', { name: /You don’t have access to this area/ })).toBeVisible();
});

test('an administrator sees index status and no credentials', async ({ page }) => {
  await login(page, 'admin');
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await page.getByRole('navigation', { name: 'Administration sections' }).getByRole('link', { name: 'AI & retrieval' }).click();
  await expect(page.getByRole('heading', { name: 'Provider' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Retrieval index' })).toBeVisible();
  await expect(page.getByText(/never sent to the browser/i)).toBeVisible();
  // A key must never be rendered, even partially.
  await expect(page.locator('body')).not.toHaveText(/sk-[A-Za-z0-9]{8}/);
  await expect(page.getByText(/no monetary cost/i)).toBeVisible();

  await page.getByRole('button', { name: 'Reindex all' }).click();
  await expect(page.getByText('Reindex complete.')).toBeVisible();
  await expect(page.getByText('Indexed').first()).toBeVisible();
});

test('the AI panel stays usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'engineer');
  await openTicket(page, 'VPN disconnects during video calls');
  // On a phone the intelligence panel is a drawer; open it to reach the AI controls.
  await page.getByRole('button', { name: 'Toggle intelligence panel' }).click();
  await expect(page.locator('.ai-panel').getByRole('button', { name: 'Analyze ticket' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/#/ask');
  await expect(page.getByLabel('Your question')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

/**
 * Failure and transitional states. These are driven by intercepting the AI endpoints in the browser,
 * because the states that matter most to a user — a timeout, an outage, a usage limit — are the ones
 * hardest to produce on demand from a healthy server.
 */
test('the interface explains an AI timeout without losing the page', async ({ page }) => {
  await login(page, 'engineer');
  await openTicket(page, 'VPN disconnects during video calls');
  await page.route('**/api/ai/tickets/*/analyze', (route) =>
    route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: 'The AI provider did not respond in time' }) }),
  );
  await page.locator('.ai-panel').getByRole('button', { name: 'Analyze ticket' }).click();
  const alert = page.locator('.ai-panel').getByRole('alert');
  await expect(alert).toContainText(/did not respond in time/i);
  await expect(alert).toContainText(/nothing was changed/i);
  // The ticket is still fully usable after an AI failure.
  await expect(page.getByLabel('Public reply', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Service level' })).toBeVisible();
});

test('the interface explains an AI outage and a usage limit distinctly', async ({ page }) => {
  await login(page, 'engineer');
  await openTicket(page, 'VPN disconnects during video calls');

  await page.route('**/api/ai/tickets/*/summary', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'AI features are disabled on this installation' }) }),
  );
  await page.locator('.ai-panel').getByRole('button', { name: 'Summarize conversation' }).click();
  await expect(page.locator('.ai-panel').getByRole('alert')).toContainText(/switched off/i);

  await page.route('**/api/ai/tickets/*/draft-reply', (route) =>
    route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'You have reached the AI usage limit of 50 requests in 24 hours.' }) }),
  );
  await page.locator('.ai-panel').getByRole('button', { name: 'Draft a public reply' }).click();
  await expect(page.locator('.ai-panel').getByRole('alert').filter({ hasText: /usage limit/i })).toBeVisible();
});

test('the ask page shows a loading state and recovers from a failure', async ({ page }) => {
  await login(page, 'employee');
  await page.goto('/#/ask');

  // Hold the response open so the pending state is observable rather than a race.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/ai/ask', async (route) => {
    await held;
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'The AI provider reported a temporary failure.' }) });
  });
  await page.getByLabel('Your question').fill('How do I reconnect to the company VPN profile?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByRole('status')).toContainText(/retrieving passages/i);
  await expect(page.getByRole('button', { name: /Searching the knowledge base/ })).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toContainText(/temporary failure/i);

  // The page still works once the provider recovers.
  await page.unroute('**/api/ai/ask');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
});

test('empty states are explained rather than blank', async ({ page }) => {
  await login(page, 'employee');
  await page.goto('/#/notifications');
  const notifications = page.locator('.inbox-page');
  await expect(notifications.getByText(/nothing to catch up on|OPS-/i).first()).toBeVisible();

  await page.goto('/#/knowledge');
  await page.getByLabel('Search articles').fill('zzzz-no-such-article-zzzz');
  await expect(page.getByRole('heading', { name: /No articles found for/ })).toBeVisible();

  await page.goto('/#/tickets');
  await page.getByLabel('Search tickets').fill('zzzz-no-such-ticket-zzzz');
  await expect(page.getByRole('heading', { name: 'No tickets match this view' })).toBeVisible();

  await page.goto('/#/assets');
  await page.getByLabel('Search assets').fill('zzzz-no-such-asset-zzzz');
  await page.getByLabel('Search assets').press('Enter');
  await expect(page.getByRole('heading', { name: 'No assets match these filters' })).toBeVisible();
});
