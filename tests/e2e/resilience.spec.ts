import { test, expect, type Page } from '@playwright/test';

/**
 * Release-candidate resilience: what the workspace does when the connection drops, when the
 * session ends mid-task, and when a live update arrives while someone is typing. The rule under
 * test is one sentence — unsaved work is never silently discarded — and each case exercises it
 * through the real interface against the real API.
 */
async function login(page: Page, role: string) {
  await page.goto('/');
  await page.getByLabel('Email address').fill(`${role}@opspilot.example`);
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}
async function openTicket(page: Page, title: RegExp) {
  await page.goto('/#/tickets');
  await page.getByLabel('Search tickets').fill(title.source.replace(/\\/g, ''));
  const link = page.getByRole('link', { name: title }).first();
  await expect(link).toBeVisible();
  await page.goto(`/${await link.getAttribute('href')}`);
  await expect(page.getByLabel('Public reply', { exact: true })).toBeVisible();
}

test('a network loss keeps the draft, reports the failure, and a retry sends exactly one reply', async ({ page, context }) => {
  await login(page, 'engineer');
  await openTicket(page, /Software license activation failed/);
  const draft = `Offline draft ${Date.now()}`;
  const box = page.getByLabel('Public reply', { exact: true });
  await box.fill(draft);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /could not be reached/ })).toBeVisible();
  await expect(box).toHaveValue(draft);
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText(draft, { exact: true })).toHaveCount(1);
  await expect(box).toHaveValue('');
  // Live updates come back after the interruption.
  await expect(page.getByText('Live updates reconnecting…')).toHaveCount(0);
});

test('an expired session asks for the password in place and keeps the reply that was being written', async ({ page, context }) => {
  await login(page, 'engineer');
  await openTicket(page, /Laptop fan runs constantly after firmware update/);
  const draft = `Draft that outlives the session ${Date.now()}`;
  const box = page.getByLabel('Public reply', { exact: true });
  await box.fill(draft);
  // The session ends server-side (revoked, expired, or a restart); the cookie the page holds is now worthless.
  await context.clearCookies();
  await page.getByRole('button', { name: 'Send reply' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your session has ended' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('engineer@opspilot.example');
  // The workspace underneath is untouched.
  await expect(box).toHaveValue(draft);
  await dialog.getByLabel('Password').fill('not-the-password');
  await dialog.getByRole('button', { name: 'Sign in' }).click();
  await expect(dialog.getByRole('alert')).toContainText(/Invalid email or password/);
  await dialog.getByLabel('Password').fill(process.env.DEMO_PASSWORD!);
  await dialog.getByRole('button', { name: 'Sign in' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(box).toHaveValue(draft);
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText(draft, { exact: true })).toHaveCount(1);
});

test('a live update from another session refreshes the list without resetting the search or the filter', async ({ page, browser }) => {
  await login(page, 'engineer');
  await page.goto('/#/tickets?sla=breached');
  await page.getByLabel('Search tickets').fill('Guest');
  await expect(page.getByRole('link', { name: /Guest Wi-Fi is not available/ })).toBeVisible();
  const before = page.url();
  // Someone else changes a ticket.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await login(p2, 'admin');
  await openTicket(p2, /Office printer shows offline/);
  await p2.getByLabel('Public reply', { exact: true }).fill(`Trigger ${Date.now()}`);
  await p2.getByRole('button', { name: 'Send reply' }).click();
  await p2.waitForTimeout(800);
  await other.close();
  await page.waitForTimeout(1200);
  expect(page.url()).toBe(before);
  await expect(page.getByLabel('Search tickets')).toHaveValue('Guest');
  await expect(page.getByRole('link', { name: /Guest Wi-Fi is not available/ })).toBeVisible();
});
