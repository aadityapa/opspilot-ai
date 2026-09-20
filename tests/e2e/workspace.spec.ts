import { test, expect, type Page } from '@playwright/test';

/**
 * The workspace in a real browser: catalog request with an approval, the board with drag-and-drop,
 * the command palette, mentions and attachments on a ticket, the notification bell, and a rating.
 * Fictional seed accounts; each run creates its own tickets.
 */
const stamp = Date.now();

async function login(page: Page, role: string) {
  await page.goto('/');
  await page.getByLabel('Email address').fill(`${role}@opspilot.example`);
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Sign in to your OpsPilot workspace/ })).toBeVisible();
}

test('home, catalog request with a dynamic form, and the approval round trip', async ({ page }) => {
  await login(page, 'employee');
  await expect(page.getByRole('heading', { name: 'For you' })).toBeVisible();
  await page.getByRole('link', { name: 'Service Catalog', exact: true }).click();
  // Marketplace → service detail (what, why, approval) → details form.
  await page.getByRole('link', { name: /^New laptop/ }).first().click();
  await expect(page.getByRole('heading', { name: 'New laptop', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Start request' }).click();
  // Inline validation: submitting an empty form highlights the required fields instead of moving on.
  await page.getByRole('button', { name: 'Review request' }).click();
  await expect(page.getByRole('alert')).toContainText('Please complete');
  await page.getByLabel('Preferred model').selectOption('Developer 16"');
  await page.getByLabel('Needed by').fill('2026-10-01');
  await page.getByLabel('Reason').fill(`Replacement for the workspace browser test ${stamp}`);
  // Step 3 shows the answers back before anything is sent.
  await page.getByRole('button', { name: 'Review request' }).click();
  await expect(page.getByText('Developer 16"', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit request' }).click();
  // Success state carries the real ticket id and what happens next; the request view shows progress.
  await expect(page.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
  await expect(page.getByText(/^OPS-\d{4}$/)).toBeVisible();
  await page.getByRole('link', { name: 'View request' }).click();
  await expect(page.getByRole('heading', { name: 'New laptop', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Approval' })).toBeVisible();
  await expect(page.getByText('Awaiting approval', { exact: true })).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  await expect(page.getByText('Developer 16"')).toBeVisible();
  const requestURL = page.url();
  await logout(page);

  // Maya's manager in the seed is Jordan (admin): My Space flags it, the Approval Center decides it.
  await login(page, 'admin');
  await expect(page.locator('.foryou')).toContainText('New laptop');
  await page.getByRole('link', { name: 'Approvals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Decisions waiting for you' })).toBeVisible();
  const card = page.locator('.approval-card').filter({ hasText: 'New laptop' }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Review' }).click();
  const review = page.getByRole('dialog', { name: 'Review request' });
  await expect(review.getByText('Business justification')).toBeVisible();
  await review.getByLabel('Note').fill('Approved for the platform team');
  await review.getByRole('button', { name: 'Approve', exact: true }).click();
  // Approving is deliberate: a confirmation names the request and the requester.
  const confirm = page.getByRole('dialog', { name: /^Approve new laptop for/ });
  await confirm.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved.', { exact: true })).toBeVisible();
  await expect(page.locator('.decision-band')).toContainText('moved to IT fulfilment');
  await logout(page);

  await login(page, 'employee');
  await page.goto(requestURL);
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await expect(page.getByText('Approved for the platform team').first()).toBeVisible();
});

test('the board: quick filters, drag a card into the next stage, and a saved view', async ({ page }) => {
  await login(page, 'engineer');
  await page.getByRole('link', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Desk view' }).getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
  const open = page.getByRole('region', { name: 'Open column' });
  const inProgress = page.getByRole('region', { name: 'In Progress column' });
  await expect(open.locator('.card').first()).toBeVisible();
  // Pin the card by its key so a re-render between reading and dragging cannot swap the subject.
  const key = await open.locator('.card').first().locator('.card-key').innerText();
  const card = open.locator('.card').filter({ has: page.locator('.card-key', { hasText: key }) });
  await card.dragTo(inProgress.locator('header'));
  await expect(page.getByText(/Moved to In Progress/)).toBeVisible();
  await expect(inProgress.locator('.card').filter({ has: page.locator('.card-key', { hasText: key }) })).toBeVisible();
  // A card cannot be dragged straight to Resolved from Open: the column refuses and nothing changes.
  const anotherKey = await open.locator('.card').first().locator('.card-key').innerText();
  const another = open.locator('.card').filter({ has: page.locator('.card-key', { hasText: anotherKey }) });
  await another.dragTo(page.getByRole('region', { name: 'Resolved column' }).locator('header'));
  await expect(open.locator('.card').filter({ has: page.locator('.card-key', { hasText: anotherKey }) })).toBeVisible();
  // Quick filter + saved view.
  await page.getByLabel('Assignment filter').selectOption('unassigned');
  await expect(page).toHaveURL(/assigned=unassigned/);
  page.once('dialog', (d) => d.accept(`Unassigned ${stamp}`));
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByText(/View "Unassigned/)).toBeVisible();
  await expect(page.getByLabel('Saved views')).toContainText(`Unassigned ${stamp}`);
});

test('command palette jumps anywhere and finds people and tickets', async ({ page }) => {
  await login(page, 'engineer');
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  // Resources are identifiable from the palette alone: a person carries their role and team.
  await palette.getByLabel('Search or jump to').fill('Maya');
  await expect(palette.getByRole('option').filter({ hasText: 'Maya Chen' })).toBeVisible();
  await expect(palette.getByRole('option').filter({ hasText: 'Software Engineer' })).toBeVisible();
  // An asset by tag, a department by name, and an article by title, all in one search surface.
  await palette.getByLabel('Search or jump to').fill('LAP-0001');
  await expect(palette.getByRole('option').filter({ hasText: 'LAP-0001' })).toBeVisible();
  await palette.getByLabel('Search or jump to').fill('Engineering');
  await expect(palette.getByRole('option').filter({ hasText: /ENG · \d+ (person|people)/ })).toBeVisible();
  await palette.getByLabel('Search or jump to').fill('VPN');
  await expect(palette.getByRole('option').filter({ hasText: 'Reconnect to the company VPN' })).toBeVisible();

  await palette.getByLabel('Search or jump to').fill('People');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Find people across your organization' })).toBeVisible();
  // The suite's database accumulates accounts from earlier runs, so reach the person by search
  // rather than by assuming they are on the first page of the directory.
  await page.getByLabel('Search people').fill('Maya');
  await expect(page.getByRole('link', { name: /Maya Chen/ })).toBeVisible();
  await page.getByRole('link', { name: /Maya Chen/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Maya Chen', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Engineering' }).first()).toBeVisible();
});

test('mentions, attachments, followers and the notification bell', async ({ page }) => {
  await login(page, 'engineer');
  await page.goto('/#/tickets');
  // A ticket Maya raised, so she is someone who can be mentioned on it.
  await page.getByLabel('Search tickets').fill('VPN disconnects during video');
  const link = page.getByRole('link', { name: /VPN disconnects during video calls/ }).first();
  await expect(link).toBeVisible();
  await page.goto(`/${await link.getAttribute('href')}`);
  await expect(page.getByRole('heading', { name: 'Followers' })).toBeVisible();
  // Mention with the picker.
  const reply = page.getByLabel('Public reply', { exact: true });
  await reply.fill('Looping in @May');
  await page.getByRole('listbox').getByRole('button', { name: /Maya Chen/ }).click();
  await expect(reply).toHaveValue(/@Maya Chen /);
  await reply.fill(`${await reply.inputValue()}— can you reconnect and confirm? (${stamp})`);
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText('Reply sent.', { exact: true })).toBeVisible();
  await expect(page.locator('.mention').filter({ hasText: '@Maya Chen' }).last()).toBeVisible();
  // Attachment through the hidden file input; served as a download, never inline.
  await page.getByLabel('Choose a file').setInputFiles({ name: `photo-${stamp}.png`, mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]) });
  await expect(page.getByText(`photo-${stamp}.png attached.`)).toBeVisible();
  const download = page.getByRole('link', { name: `photo-${stamp}.png` });
  await expect(download).toBeVisible();
  const response = await page.request.get((await download.getAttribute('href'))!);
  expect(response.headers()['content-disposition']).toContain('attachment');
  // Follow (or, on a reused database, unfollow) the ticket from the aside: the button flips either way.
  const follow = page.getByRole('button', { name: /^(Follow|Unfollow)$/ });
  const before = await follow.innerText();
  await follow.click();
  await expect(page.getByRole('button', { name: before === 'Follow' ? 'Unfollow' : 'Follow', exact: true })).toBeVisible();
  await logout(page);

  // Maya was mentioned: the bell shows it, and the inbox lists it.
  await login(page, 'employee');
  const bell = page.getByRole('button', { name: /Notifications, \d+ unread/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByRole('dialog', { name: 'Recent notifications' }).getByText('You were mentioned on a ticket.').first()).toBeVisible();
  await page.getByRole('link', { name: 'All notifications and preferences →' }).click();
  await expect(page.getByRole('heading', { name: 'Your inbox' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Mentions/ })).toBeChecked();
});

test('an employee rates a resolved ticket exactly once', async ({ page }) => {
  await login(page, 'employee');
  await page.getByRole('link', { name: 'Service Catalog', exact: true }).click();
  await page.getByRole('link', { name: 'Report an IT issue' }).first().click();
  const title = `Rating flow ${stamp}`;
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Software' });
  await page.getByLabel('Description').fill('A ticket that will be resolved so the requester can rate it.');
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  // Employees land on a confirmation, then their request view; staff URLs use the ticket workspace.
  await expect(page.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
  await page.getByRole('link', { name: 'View request' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const ticketURL = page.url().replace('#/requests/', '#/tickets/');
  await logout(page);
  await login(page, 'engineer');
  await page.goto(ticketURL);
  await page.getByLabel('Status', { exact: true }).selectOption('IN_PROGRESS');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Ticket updated.', { exact: true })).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('RESOLVED');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Reopen ticket' })).toBeVisible();
  await logout(page);
  await login(page, 'employee');
  await page.goto(ticketURL);
  await expect(page.getByRole('heading', { name: 'How did we do?' })).toBeVisible();
  await page.getByRole('radio', { name: '4 stars' }).click();
  await page.getByLabel('Comment').fill('Sorted quickly');
  await page.getByRole('button', { name: 'Send rating' }).click();
  await expect(page.getByRole('heading', { name: 'Your rating' })).toBeVisible();
  await expect(page.getByText('Sorted quickly')).toBeVisible();
});
