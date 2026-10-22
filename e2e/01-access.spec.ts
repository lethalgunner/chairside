import { expect, test } from '@playwright/test';
import { login } from './helpers';

const ROUTES = ['/', '/patients', '/patients/new', '/invoices', '/receivables', '/unbilled', '/day-close', '/gst', '/bills/new?patient=x', '/receipts/new?patient=x', '/settings', '/settings/team', '/settings/catalogue', '/settings/branches'];

test.describe('no anonymous access', () => {
  for (const r of ROUTES) {
    test(`GET ${r} sends a signed-out visitor to /login`, async ({ page }) => {
      await page.goto(r);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    });
  }

  test('a forged session cookie is refused', async ({ page, context }) => {
    await context.addCookies([{ name: 'cs_session', value: 'forged-value', domain: 'localhost', path: '/' }]);
    await page.goto('/patients');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a server-action POST without a session gets no data', async ({ request }) => {
    const res = await request.post('/', { headers: { 'Next-Action': 'deadbeef', 'Content-Type': 'text/plain' }, data: '[]', maxRedirects: 0 });
    expect([303, 307, 308]).toContain(res.status());
    expect(res.headers()['location']).toContain('/login');
  });

  test('wrong password shows one generic message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('desk@demo.local');
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.callout[role="alert"]')).toHaveText('Email or password is incorrect.');
  });

  test('health endpoint is public and reveals nothing', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

test.describe('roles and branch context', () => {
  test('front desk sees only its branch and no GST papers', async ({ page }) => {
    await login(page, 'desk');
    await expect(page.locator('.branch-banner')).toContainText('Demo Pune');
    await expect(page.getByRole('link', { name: 'GST working papers' })).toHaveCount(0);
    await expect(page.locator('#branch-select')).toHaveCount(0);
    await page.goto('/gst');
    await expect(page.getByText('You don’t have access to GST papers.')).toBeVisible();
  });

  test('front desk sees no Settings and is refused every settings screen', async ({ page }) => {
    await login(page, 'desk');
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await page.goto('/settings');
    await expect(page.getByText('You don’t have access to settings.')).toBeVisible();
    await page.goto('/settings/team');
    await expect(page.getByText('Only the owner can manage the team.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create invite link' })).toHaveCount(0);
    await page.goto('/settings/catalogue');
    await expect(page.getByText('Only the owner can change the price list.')).toBeVisible();
    await page.goto('/settings/branches');
    await expect(page.getByText('Only the owner can change branch details.')).toBeVisible();
  });

  test('owner on All branches must pick a branch before creating anything', async ({ page }) => {
    await login(page, 'owner');
    await page.locator('#branch-select').selectOption('all');
    await expect(page.locator('.branch-banner')).toContainText('all branches');
    await expect(page.getByRole('navigation').getByRole('link', { name: 'New patient' })).toHaveCount(0);
    await page.goto('/patients/new');
    await expect(page.getByText('Pick a branch in the sidebar first.')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Demo Kanpur' })).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByRole('cell', { name: 'Demo Kanpur' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Demo Pune' })).toBeVisible();
  });
});

test.describe('invite links', () => {
  test('an invited person sets their own password once and lands in their branch', async ({ page, context }) => {
    const { readFileSync } = await import('node:fs');
    const link = readFileSync('e2e/.invite-link', 'utf8').trim();
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Welcome, Ravi (new desk)' })).toBeVisible();
    await page.getByLabel('New password').fill('short');
    await page.getByLabel('Type it again').fill('short');
    await page.getByRole('button', { name: 'Set password and sign in' }).click();
    await expect(page.locator('.callout[role="alert"]')).toContainText('at least 10');
    await page.getByLabel('New password').fill('ravi likes clean books');
    await page.getByLabel('Type it again').fill('ravi likes clean books');
    await page.getByRole('button', { name: 'Set password and sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expect(page.locator('.branch-banner')).toContainText('Demo Kanpur');
    await context.clearCookies();
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  });
});
