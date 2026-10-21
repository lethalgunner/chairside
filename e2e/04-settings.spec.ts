import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Owner settings (Pilot 0 slice 2). Runs after the golden path, so changes
 * here (a new item, Kanpur's GST status) cannot disturb the earlier specs.
 */

test('team: owner invites a front desk user, the link sets a password, deactivation signs them out', async ({ page, browser }) => {
  await login(page, 'owner');
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Team' }).click();
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();

  await page.getByLabel('Full name').fill('Kavya (desk)');
  await page.getByLabel('Email').fill('Kavya@Demo.local');
  await page.getByLabel('Role').selectOption('front_desk');
  await page.locator('#invite-branch').selectOption({ label: 'Demo Pune' });
  await page.getByRole('button', { name: 'Create invite link' }).click();
  await expect(page.getByText('It works once, for 72 hours.')).toBeVisible();
  const link = await page.getByLabel('Invite link').inputValue();
  expect(link).toMatch(/\/setup\?token=[A-Za-z0-9_-]{40,}$/);
  const row = page.getByRole('row', { name: /Kavya \(desk\)/ });
  await expect(row).toContainText('kavya@demo.local');
  await expect(row).toContainText('Front desk · Demo Pune');
  await expect(row).toContainText('Invite pending');

  // The invited person, in their own browser.
  const theirs = await browser.newContext();
  const p2 = await theirs.newPage();
  await p2.goto(link);
  await expect(p2.getByRole('heading', { name: 'Welcome, Kavya (desk)' })).toBeVisible();
  await p2.getByLabel('New password').fill('kavya keeps the books');
  await p2.getByLabel('Type it again').fill('kavya keeps the books');
  await p2.getByRole('button', { name: 'Set password and sign in' }).click();
  await expect(p2.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(p2.locator('.branch-banner')).toContainText('Demo Pune');
  await expect(p2.getByRole('navigation').getByRole('link', { name: 'Settings' })).toHaveCount(0);

  await page.reload();
  await expect(row).toContainText('Set up');
  await page.getByRole('button', { name: 'Deactivate Kavya (desk)' }).click();
  await expect(row).toContainText('Deactivated');
  await p2.reload();
  await expect(p2).toHaveURL(/\/login$/);
  await theirs.close();

  // The owner cannot switch themself off.
  await expect(page.getByRole('row', { name: /Dr\. Demo Owner/ }).getByRole('button', { name: /Deactivate/ })).toHaveCount(0);
});
