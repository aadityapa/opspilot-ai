import { test, expect, type Page } from '@playwright/test';
import { totpAt, totpStep } from '../../server/security.js';

/**
 * Account security in the browser: an administrator issues a temporary account, the new person is
 * forced to choose a password, enrols a second factor by reading the manual key off the screen,
 * signs in through the code screen, then an administrator hands over a reset link and it works.
 *
 * Each run creates its own account, so the reused end-to-end database never collides with itself.
 */
const stamp = Date.now();
const email = `security-${stamp}@example.test`;
const tempPassword = 'Temporary-passphrase-2026';
const ownPassword = 'chosen by the person 2026';
const resetPassword = 'after the reset link 2026';

async function signIn(page: Page, who: string, password: string) {
  await page.goto('/');
  await page.getByLabel('Email address').fill(who);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Sign in to your OpsPilot workspace/ })).toBeVisible();
}

test('temporary account → forced password change → MFA enrolment → code at sign-in → admin reset link', async ({ page }) => {
  // 1. Administrator creates the account.
  await signIn(page, 'admin@opspilot.example', process.env.DEMO_PASSWORD!);
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await page.getByRole('navigation', { name: 'Administration sections' }).getByRole('link', { name: 'Accounts & access', exact: true }).click();
  await page.getByLabel('Full name').fill(`Security Person ${stamp}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Temporary password').fill(tempPassword);
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('row').filter({ hasText: email }).getByText('Must change password')).toBeVisible();
  await signOut(page);

  // 2. First sign-in is gated on choosing a password; a weak one is explained, then a good one works.
  await signIn(page, email, tempPassword);
  await expect(page.getByRole('heading', { name: /Choose your own password/ })).toBeVisible();
  await page.getByLabel('Current password').fill(tempPassword);
  await page.getByLabel('New password', { exact: true }).fill('password1234');
  await page.getByLabel('Confirm new password').fill('password1234');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('alert')).toContainText('commonly used');
  await page.getByLabel('Current password').fill(tempPassword);
  await page.getByLabel('New password', { exact: true }).fill(ownPassword);
  await page.getByLabel('Confirm new password').fill(ownPassword);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();

  // 3. Enrol a second factor from the account page, reading the manual key rather than the QR.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Account & security' }).click();
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
  await expect(page.getByText('Off', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  await expect(page.getByRole('img', { name: 'QR code for the authenticator app' })).toBeVisible();
  const key = (await page.locator('.secret-key').innerText()).replace(/\s+/g, '');
  expect(key).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel('Code from the app').fill('000000');
  await page.getByRole('button', { name: 'Turn on two-factor authentication' }).click();
  await expect(page.getByRole('alert')).toContainText('did not match');
  const enrolStep = totpStep();
  await page.getByLabel('Code from the app').fill(totpAt(key, enrolStep));
  await page.getByRole('button', { name: 'Turn on two-factor authentication' }).click();
  const codes = page.getByLabel('Recovery codes');
  await expect(codes).toBeVisible();
  const recovery = (await codes.innerText()).trim().split('\n');
  expect(recovery).toHaveLength(10);
  await page.getByRole('button', { name: 'I have saved them' }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();
  // The session list shows this device, and nothing that looks like a token.
  await expect(page.getByRole('heading', { name: 'Where you are signed in' })).toBeVisible();
  await expect(page.getByText('This device')).toBeVisible();
  await signOut(page);

  // 4. Sign-in now stops at the code screen; a recovery code gets through.
  await signIn(page, email, ownPassword);
  await expect(page.getByRole('heading', { name: 'Enter your verification code' })).toBeVisible();
  await page.getByLabel('Verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toContainText('did not match');
  await page.getByLabel('Verification code').fill(recovery[0]);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await signOut(page);

  // 5. An administrator issues a reset link; using it sets a new password and signs out everywhere.
  await signIn(page, 'admin@opspilot.example', process.env.DEMO_PASSWORD!);
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await page.getByRole('navigation', { name: 'Administration sections' }).getByRole('link', { name: 'Accounts & access', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row.getByText('Enrolled')).toBeVisible();
  await row.getByText('Manage').click();
  await row.getByRole('button', { name: 'Issue password reset link' }).click();
  const link = (await page.locator('.recovery-codes').innerText()).trim();
  expect(link).toContain('/#/reset/');
  await signOut(page);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(resetPassword);
  await page.getByLabel('Confirm new password').fill(resetPassword);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('heading', { name: /Sign in to your OpsPilot workspace/ })).toBeVisible();
  await signIn(page, email, ownPassword);
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  await signIn(page, email, resetPassword);
  await expect(page.getByRole('heading', { name: 'Enter your verification code' })).toBeVisible();
  await page.getByLabel('Verification code').fill(totpAt(key, totpStep() + 1));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
});

test('the forgotten-password screen never reveals whether an address exists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Forgotten your password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgotten your password?' })).toBeVisible();
  await page.getByLabel('Email address').fill(`nobody-${stamp}@example.test`);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/If that address has an account/)).toBeVisible();
  await page.getByLabel('Email address').fill('employee@opspilot.example');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/If that address has an account/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await expect(page.getByRole('heading', { name: /Sign in to your OpsPilot workspace/ })).toBeVisible();
});

test('five wrong passwords lock the account and an administrator can unlock it', async ({ page }) => {
  const victim = `lock-${stamp}@example.test`;
  await signIn(page, 'admin@opspilot.example', process.env.DEMO_PASSWORD!);
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await page.getByRole('navigation', { name: 'Administration sections' }).getByRole('link', { name: 'Accounts & access', exact: true }).click();
  await page.getByLabel('Full name').fill(`Lock Person ${stamp}`);
  await page.getByLabel('Email', { exact: true }).fill(victim);
  await page.getByLabel('Temporary password').fill(tempPassword);
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('row').filter({ hasText: victim })).toBeVisible();
  await signOut(page);
  for (let i = 0; i < 5; i++) {
    await signIn(page, victim, 'definitely-wrong-2026');
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  }
  await signIn(page, victim, tempPassword);
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  await signIn(page, 'admin@opspilot.example', process.env.DEMO_PASSWORD!);
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await page.getByRole('navigation', { name: 'Administration sections' }).getByRole('link', { name: 'Accounts & access', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: victim });
  await expect(row.getByText(/Locked until/)).toBeVisible();
  await row.getByText('Manage').click();
  await row.getByRole('button', { name: 'Unlock' }).click();
  await expect(row.getByText(/Locked until/)).toHaveCount(0);
  await signOut(page);
  await signIn(page, victim, tempPassword);
  await expect(page.getByRole('heading', { name: /Choose your own password/ })).toBeVisible();
});
