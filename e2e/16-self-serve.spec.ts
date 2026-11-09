import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Sprint 7 "Set it up yourself": a new clinic signs up and sees its checklist;
 * the owner adds a branch; the parallel-run switch hides the pilot-only parts
 * and brings them back. The switch is restored to on at the end, so later
 * specs see the demo clinic as before.
 */

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id}`)).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test('a new clinic signs up, lands on Getting started, and is its own world', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Set up your clinic' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your clinic' })).toBeVisible();
  await axeClean(page, 'signup');
  const email = `meera-${Date.now()}@signup.test`;
  await page.getByLabel('Clinic name').fill('Smile Care');
  await page.getByLabel('Your name').fill('Dr Meera Rao');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('long enough pw');
  await page.getByLabel('Password again').fill('long enough pw');
  await page.getByLabel('Branch name').fill('Smile Baner');
  await page.getByLabel('Branch code').fill('PUN');
  await page.getByLabel('City').fill('Pune');
  await page.getByLabel('State').selectOption('Maharashtra');
  await page.getByRole('button', { name: 'Create my clinic' }).click();

  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  await expect(page.getByText('1 of 6 done')).toBeVisible(); // the dentist-owner is already a doctor
  await axeClean(page, 'getting started');
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Finish setting up' })).toBeVisible();
  // A new clinic isn't in a parallel run, and sees none of the demo clinic's patients.
  await expect(page.getByRole('link', { name: 'Pilot scorecard' })).toHaveCount(0);
  await page.goto('/patients');
  await expect(page.getByText('Asha', { exact: false })).toHaveCount(0);

  // Same email again is refused.
  await page.context().clearCookies();
  await page.goto('/signup');
  await page.getByLabel('Clinic name').fill('Copy');
  await page.getByLabel('Your name').fill('Someone');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('long enough pw');
  await page.getByLabel('Password again').fill('long enough pw');
  await page.getByLabel('Branch name').fill('X Branch');
  await page.getByLabel('Branch code').fill('XBR');
  await page.getByLabel('State').selectOption('Maharashtra');
  await page.getByRole('button', { name: 'Create my clinic' }).click();
  await expect(page.locator('#su-email-err')).toContainText('already exists');
});

test('owner adds a branch, and the parallel-run switch hides and restores the pilot-only parts', async ({ page }) => {
  await login(page, 'owner');
  await page.goto('/settings/branches');
  await page.getByRole('button', { name: '+ Add a branch' }).click();
  const form = page.getByRole('form', { name: 'New branch' });
  await form.getByLabel('Code').fill('nsk');
  await form.getByLabel('Branch name').fill('Demo Nashik');
  await form.getByLabel('State').selectOption('Maharashtra');
  await axeClean(page, 'new branch form');
  await form.getByRole('button', { name: 'Add branch' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Demo Nashik added' })).toBeVisible();
  await expect(page.locator('#branch-select')).toContainText('Demo Nashik');

  // Switch the parallel run off.
  await page.goto('/settings/clinic');
  await axeClean(page, 'clinic settings');
  await page.getByLabel('Yes, we still use the old software too').uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pilot scorecard' })).toHaveCount(0);
  await page.locator('#branch-select').selectOption({ label: 'Demo Nashik' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Nashik');
  await page.goto('/day-close');
  await expect(page.getByText('Check against the old system')).toHaveCount(0);

  // And back on: everything returns.
  await page.goto('/settings/clinic');
  await page.getByLabel('Yes, we still use the old software too').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pilot scorecard' })).toBeVisible();
  await page.goto('/day-close');
  await expect(page.getByText('Check against the old system (pilot)')).toBeVisible();
});
