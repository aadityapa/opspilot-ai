import { test, expect, type Page } from '@playwright/test';

/**
 * Regressions reproduced during the UI audit, fixed, and pinned here:
 *  - popovers (account menu, bell, create menu) must close on Escape, outside click and navigation;
 *  - an unknown report kind is a dead end that says so, not a silent library fallback;
 *  - /knowledge/new for a non-administrator is a forbidden state, not an article lookup;
 *  - account creation lives in its own pane with designed inline validation;
 *  - the person → assets tab carries the intended owner.
 */
async function login(page: Page, role: string) {
  await page.goto('/');
  await page.getByLabel('Email address').fill(`${role}@opspilot.example`);
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}

test('popovers close on Escape, outside click and navigation', async ({ page }) => {
  await login(page, 'engineer');
  const menu = page.getByRole('menu', { name: 'Account' });
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(menu).toBeVisible();
  await page.mouse.click(400, 500);
  await expect(menu).toHaveCount(0);

  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(menu).toBeVisible();
  await page.goto('/#/knowledge');
  await expect(page.getByRole('heading', { name: 'Find answers. Solve problems faster.' })).toBeVisible();
  await expect(menu).toHaveCount(0);

  // The same rule for the create menu and the notification inbox.
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('menu', { name: 'Create' })).toBeVisible();
  await page.goto('/#/tickets');
  await expect(page.getByRole('heading', { name: 'Service Desk' })).toBeVisible();
  await expect(page.getByRole('menu', { name: 'Create' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByRole('dialog', { name: 'Recent notifications' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Recent notifications' })).toHaveCount(0);
});

test('an unknown report kind is an explicit dead end and real kinds render their own workspace', async ({ page }) => {
  await login(page, 'engineer');
  await page.goto('/#/reports/demand');
  await expect(page.getByRole('heading', { name: 'There is no report by that name.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Service reports' })).toHaveCount(0);
  await page.goto('/#/reports/departments?days=30');
  await expect(page.getByRole('heading', { name: 'Department demand' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export CSV' })).toBeVisible();
  await page.goto('/#/reports/agents?days=30');
  await expect(page.getByRole('heading', { name: 'Agent workload' })).toBeVisible();
});

test('an engineer cannot author knowledge and is told so plainly', async ({ page }) => {
  await login(page, 'engineer');
  await page.goto('/#/knowledge');
  await expect(page.getByRole('link', { name: 'New article' })).toHaveCount(0);
  await page.goto('/#/knowledge/new');
  await expect(page.getByRole('heading', { name: 'Only administrators write knowledge articles.' })).toBeVisible();
  await expect(page.getByText('Something did not load')).toHaveCount(0);
});

test('account creation is a pane with designed validation; nothing is sent until it passes', async ({ page }) => {
  await login(page, 'admin');
  let posted = 0;
  await page.route('**/api/admin/users', async (route) => { if (route.request().method() === 'POST') posted++; await route.continue(); });
  await page.goto('/#/admin/users');
  await page.getByRole('button', { name: 'Add account' }).click();
  const pane = page.getByRole('dialog', { name: 'Add an account' });
  await expect(pane).toBeVisible();
  await pane.getByRole('button', { name: 'Create user' }).click();
  await expect(pane.getByText('Enter the person’s full name')).toBeVisible();
  await expect(pane.getByText('Enter a valid work e-mail address.')).toBeVisible();
  await expect(pane.getByText('The temporary password needs at least 12 characters.')).toBeVisible();
  await expect(pane.getByLabel('Full name')).toBeFocused();
  expect(posted).toBe(0);
  await pane.getByLabel('Full name').fill('Validation Person');
  await pane.getByLabel('Email', { exact: true }).fill('validation@example.test');
  await pane.getByLabel('Temporary password').fill('validation-person-passphrase');
  await pane.getByRole('button', { name: 'Create user' }).click();
  await expect(pane.getByText('must not contain the person’s name')).toBeVisible();
  expect(posted).toBe(0);
  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);
});

test('a person’s Assets tab shows that person’s hardware, not the whole inventory', async ({ page }) => {
  await login(page, 'engineer');
  await page.goto('/#/people');
  await page.getByRole('link', { name: /Maya Chen/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Maya Chen' })).toBeVisible();
  await page.locator('main').getByRole('link', { name: /^Assets/ }).first().click();
  await expect(page).toHaveURL(/tab=assets/);
  await expect(page.getByRole('heading', { name: 'Assigned hardware' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Technology inventory' })).toHaveCount(0);
});
