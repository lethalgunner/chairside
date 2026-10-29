import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * Sprint 3 "Front desk, done right": waiting room (T36), next-visit recalls
 * (T37), edit patient (T38), reset link (T39), export (T40). At Demo Kanpur:
 * the golden path closed Demo Pune. wa.me is stubbed.
 */

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id}`)).toEqual([]);
}

async function register(page: Page, name: string): Promise<string> {
  const mobile = phone();
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(mobile);
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await page.getByLabel('Age in years').fill('38');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return mobile;
}

test('waiting room: token, seat, done, "seen, not billed" until the bill is issued', async ({ page }) => {
  await login(page, 'kanpurDesk');
  await register(page, 'Vikram Queuetest');
  await page.getByRole('button', { name: 'Add to today’s queue' }).click();
  await expect(page.getByRole('link', { name: /^Token \d+ · Waiting$/ })).toBeVisible();

  await page.getByRole('link', { name: 'Waiting room' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting room' })).toBeVisible();
  const row = page.getByRole('row', { name: /Vikram Queuetest/ });
  await expect(row).toContainText('Waiting');
  await axeClean(page, 'queue');
  await row.getByRole('button', { name: /^Seat: token/ }).click();
  await expect(row).toContainText('In chair');
  await row.getByRole('button', { name: /^Done: token/ }).click();
  await expect(page.locator('.callout.warn')).toContainText('Seen, not billed');
  await expect(page.locator('.callout.warn')).toContainText('Vikram Queuetest');

  // Bill from the callout; the flag clears.
  await page.locator('.callout.warn').getByRole('link', { name: /Vikram Queuetest/ }).click();
  await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Owner' });
  await page.getByLabel('Add treatment or item').fill('consult');
  await page.getByLabel('Add treatment or item').press('Enter');
  await page.getByRole('button', { name: 'Issue bill' }).click();
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  await expect(page.locator('.callout.good')).toContainText('issued');
  await page.goto('/queue');
  await expect(page.getByText('Seen, not billed')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Vikram Queuetest/ })).toContainText('Done');
});

test('next visit: set on the patient page, listed under Recalls, reminded on WhatsApp, then booked', async ({ page, context }) => {
  await context.route('https://wa.me/**', (r) => r.fulfill({ status: 200, body: 'stub' }));
  await login(page, 'kanpurDesk');
  const mobile = await register(page, 'Nisha Recalltest');
  const card = page.getByRole('region', { name: 'Next visit' });
  await expect(card).toContainText('No next visit set.');
  await card.getByRole('button', { name: 'Continue treatment' }).click();
  await card.getByRole('button', { name: 'Set next visit' }).click();
  await expect(card).toContainText('Continue treatment due');
  await axeClean(page, 'patient with next visit');

  await page.getByRole('link', { name: 'Recalls' }).click();
  const row = page.getByRole('row', { name: /Nisha Recalltest/ });
  await expect(row).toContainText('Continue treatment');
  const remind = row.getByRole('link', { name: /Remind on WhatsApp/ });
  const href = (await remind.getAttribute('href'))!;
  expect(href.startsWith(`https://wa.me/91${mobile}?text=`)).toBe(true);
  const text = decodeURIComponent(href.split('text=')[1]!);
  expect(text).toContain('Namaste Nisha,');
  expect(text).not.toMatch(/treatment|Recalltest/i);
  const popup = context.waitForEvent('page');
  await remind.click();
  await (await popup).close();
  await expect(row.getByText('Reminded today')).toBeVisible();
  await axeClean(page, 'recalls');
  await row.getByRole('button', { name: /^Booked:/ }).click();
  await expect(page.getByRole('row', { name: /Nisha Recalltest/ })).toHaveCount(0);
});

test('edit patient: fix a misspelt name; the change shows straight away', async ({ page }) => {
  await login(page, 'kanpurDesk');
  await register(page, 'Rahul Sharmaa');
  await page.getByRole('link', { name: 'Edit details' }).click();
  await expect(page.getByLabel('Full name')).toHaveValue('Rahul Sharmaa');
  await page.getByLabel('Full name').fill('Rahul Sharma');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Details saved.');
  await expect(page.getByRole('heading', { name: 'Rahul Sharma', exact: true })).toBeVisible();
});

test('owner: reset password link for a member who set one; export downloads CSV; the desk cannot export', async ({ page, browser }) => {
  await login(page, 'owner');
  await page.goto('/settings/team');
  await page.getByRole('button', { name: /^Reset password link for Meena/ }).click();
  await expect(page.locator('.invite-link')).toContainText('Password reset link for Meena (Kanpur desk).');
  await expect(page.getByLabel('Invite link')).toHaveValue(/\/setup\?token=/);

  await page.goto('/settings/export');
  await axeClean(page, 'export');
  const res = await page.request.get('/export/bills');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  expect(res.headers()['cache-control']).toContain('no-store');
  const csv = await res.text();
  expect(csv).toMatch(/^﻿Bill number,Date,Branch,Patient/);
  expect(csv).toMatch(/DPNT\/\d{2}-\d{2}\/\d{5}/);

  const desk = await browser.newContext();
  const deskPage = await desk.newPage();
  await login(deskPage, 'desk');
  const refused = await deskPage.request.get('/export/patients');
  expect(refused.status()).toBe(403);
  await desk.close();
});
