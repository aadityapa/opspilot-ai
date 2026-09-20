import { test, expect, type Page } from '@playwright/test';
async function login(page: Page, role: string) {
  await page.goto('/');
  await page.getByLabel('Email address').fill(`${role}@opspilot.example`);
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: /Sign in to your OpsPilot workspace/ })).toBeVisible();
}
test('employee → engineer → resolution → metrics, with URL authorization', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'employee');
  await page.getByRole('link', { name: 'Service Catalog', exact: true }).click();
  await page.getByRole('link', { name: 'Report an IT issue' }).first().click();
  const title = `VPN workflow ${Date.now()}`;
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Network' });
  await page
    .getByLabel('Description')
    .fill('VPN disconnects while connecting to the fictional office network.');
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  // Employees land on a confirmation, then their request view; staff URLs use the ticket workspace.
  await expect(page.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
  await page.getByRole('link', { name: 'View request' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const ticketURL = page.url().replace('#/requests/', '#/tickets/');
  await logout(page);
  await login(page, 'employee2');
  await page.goto(ticketURL);
  await expect(page.getByRole('alert')).toContainText('Ticket not found');
  await logout(page);
  await login(page, 'engineer');
  await page.goto(ticketURL);
  await page.getByLabel('Status', { exact: true }).selectOption('IN_PROGRESS');
  await page.getByLabel('Assignee', { exact: true }).selectOption({ label: 'Alex Morgan' });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Ticket updated.', { exact: true })).toBeVisible();
  await page
    .getByLabel('Public reply', { exact: true })
    .fill('The VPN profile was corrected. Please reconnect and confirm.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText('Reply sent.', { exact: true })).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('RESOLVED');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Reopen ticket' })).toBeVisible();
  if (process.env.CAPTURE_SCREENSHOTS === 'true')
    await page.screenshot({ path: 'docs/screenshots/ticket.png', fullPage: true });
  await page.getByRole('link', { name: 'Command Center', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operations Command Center' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ticket flow' })).toBeVisible();
  // The ticket just resolved is counted: MTTR is a figure, not the "nothing resolved" placeholder.
  const pulse = page.getByRole('region', { name: 'Service operations pulse' });
  await expect(pulse.getByText('MTTR', { exact: true })).toBeVisible();
  await expect(pulse.getByText('Nothing resolved in this window')).toHaveCount(0);
  if (process.env.CAPTURE_SCREENSHOTS === 'true')
    await page.screenshot({ path: 'docs/screenshots/dashboard.png', fullPage: true });
  await logout(page);
  await login(page, 'employee');
  await page.goto(ticketURL);
  await expect(
    page.getByText('The VPN profile was corrected. Please reconnect and confirm.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reopen ticket' }).click();
  await expect(page.getByLabel('Public reply', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('administrator creates and disables a user', async ({ page }) => {
  await login(page, 'admin');
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await page.getByRole('navigation', { name: 'Administration sections' }).getByRole('link', { name: 'Accounts & access', exact: true }).click();
  const name = `Synthetic User ${Date.now()}`;
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email', { exact: true }).fill(`synthetic-${Date.now()}@example.test`);
  // The policy refuses a password containing the person's own name, so this one must not.
  await page.getByLabel('Temporary password').fill('Temporary-passphrase-2026');
  await page.getByRole('button', { name: 'Create user' }).click();
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText('Must change password')).toBeVisible();
  await row.getByText('Manage').click();
  await row.getByRole('button', { name: 'Disable account' }).click();
  await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
  // The list refreshes in place rather than remounting, so the row's own controls stay open and
  // the opposite action is offered immediately.
  await expect(row.getByRole('button', { name: 'Enable account' })).toBeVisible();
});
test('mobile navigation, theme persistence and keyboard entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByLabel('Email address')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email address')).toBeFocused();
  await login(page, 'employee');
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // On a phone the navigation is an off-canvas drawer: closed until asked for, closed again after a jump.
  await expect(page.getByRole('link', { name: 'My requests', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('link', { name: 'My requests', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'My requests', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My requests', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My requests', exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // Back on a desktop the sidebar collapses to an icon rail instead.
  await page.setViewportSize({ width: 1366, height: 800 });
  await expect(page.getByRole('link', { name: 'My requests', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('link', { name: 'My requests', exact: true })).toHaveAttribute('data-tip', 'My requests');
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
});
