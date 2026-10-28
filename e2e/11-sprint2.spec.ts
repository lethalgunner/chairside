import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * Sprint 2 "Money in, on WhatsApp": UPI QR (T31), WhatsApp reminder (T32),
 * day summary (T33), amount in words (T34). Runs last, at Demo Kanpur for
 * new bills (the golden path closed Demo Pune) and on Pune's closed day for
 * the summary. wa.me is stubbed: nothing leaves the test machine.
 */

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id}`)).toEqual([]);
}

test('owner sets a UPI ID; a Kanpur bill shows a scan-to-pay QR, the amount in words, and a WhatsApp reminder', async ({ page, context }) => {
  await context.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa stub</title>' }));
  await login(page, 'owner');

  // T31: Settings → Branches. A bad ID is refused in plain words, a good one saves.
  await page.goto('/settings/branches');
  const form = page.getByRole('form', { name: 'Demo Kanpur details' });
  await form.getByLabel('UPI ID for scan-to-pay').fill('demokanpur');
  await form.getByLabel('Name patients see when paying').fill('Demo Dental Kanpur');
  await form.getByRole('button', { name: 'Save Demo Kanpur' }).click();
  await expect(form.getByText('A UPI ID looks like clinicname@okhdfcbank.')).toBeVisible();
  await form.getByLabel('UPI ID for scan-to-pay').fill('DemoKanpur@OKICICI');
  await form.getByRole('button', { name: 'Save Demo Kanpur' }).click();
  await expect(form.getByRole('status')).toContainText('Demo Kanpur saved.', { timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole('form', { name: 'Demo Kanpur details' }).getByLabel('UPI ID for scan-to-pay')).toHaveValue('demokanpur@okicici');

  // A ₹500 consultation at Kanpur.
  await page.locator('#branch-select').selectOption({ label: 'Demo Kanpur' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Kanpur');
  await page.goto('/patients/new');
  const mobile = phone();
  await page.getByLabel('Mobile').fill(mobile);
  await page.getByLabel('Full name').fill('Rekha Upitest');
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.getByLabel('Age in years').fill('52');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await page.getByRole('link', { name: 'New bill' }).click();
  await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Owner' });
  await page.getByLabel('Add treatment or item').fill('consult');
  await page.getByLabel('Add treatment or item').press('Enter');
  await page.getByRole('button', { name: 'Issue bill' }).click();
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  await page.getByRole('link', { name: 'View bill' }).click();

  // T34 + T31 on the bill.
  await expect(page.locator('dd.words')).toHaveText('Rupees Five Hundred only');
  const qr = page.getByRole('region', { name: 'Scan to pay ₹500.00 by UPI' });
  await expect(qr.getByRole('img', { name: 'UPI QR code: pay ₹500.00 to Demo Dental Kanpur' })).toBeVisible();
  await expect(qr).toContainText('demokanpur@okicici');
  await expect(qr).toContainText(/Reference DKNT\/\d{2}-\d{2}\/\d{5}/);
  await axeClean(page, 'bill with QR');

  // The payment page shows the same QR under the form.
  await page.getByRole('link', { name: 'Record payment' }).click();
  await expect(page.getByRole('region', { name: 'Patient paying by UPI? Let them scan' })).toContainText('₹500.00');

  // T32 on the patient page: the Pilot 0 tick comes first, then WhatsApp opens and the reminder is noted.
  await page.goto('/patients');
  await page.getByRole('link', { name: 'Rekha Upitest' }).click();
  await page.getByRole('button', { name: 'Remind on WhatsApp about ₹500.00' }).click();
  await expect(page.getByRole('link', { name: 'Open WhatsApp' })).toHaveCount(0);
  await page.getByLabel('I checked ₹500.00 in our old software').check();
  const open = page.getByRole('link', { name: 'Open WhatsApp' });
  const href = (await open.getAttribute('href'))!;
  expect(href.startsWith(`https://wa.me/91${mobile}?text=`)).toBe(true);
  const text = decodeURIComponent(href.split('text=')[1]!);
  expect(text).toContain('Namaste Rekha,');
  expect(text).toContain('₹500.00 is pending');
  expect(text).toContain('UPI to demokanpur@okicici');
  expect(text).not.toMatch(/consult|Dr\./i);
  const popup = context.waitForEvent('page');
  await open.click();
  await (await popup).close();
  await expect(page.getByText('Reminded today')).toBeVisible();
  await axeClean(page, 'patient with reminder');

  // Receivables shows it too, once per patient per branch.
  await page.goto('/receivables');
  const row = page.getByRole('row', { name: /Rekha Upitest/ });
  await expect(row.getByText('Reminded today')).toBeVisible();
});

test('the Kanpur front desk sees the reminder on Receivables', async ({ page }) => {
  await login(page, 'kanpurDesk');
  await page.goto('/receivables');
  await expect(page.getByRole('row', { name: /Rekha Upitest/ }).getByRole('button', { name: /Remind on WhatsApp/ })).toBeVisible();
});

test('day summary: after the golden path closed Demo Pune, the owner can send the day to WhatsApp, totals only', async ({ page }) => {
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Pune' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Pune');
  await page.goto('/day-close');
  const link = page.getByRole('link', { name: 'Send summary on WhatsApp' });
  const href = (await link.getAttribute('href'))!;
  expect(href.startsWith('https://wa.me/?text=')).toBe(true);
  const text = decodeURIComponent(href.split('text=')[1]!);
  expect(text).toMatch(/^\*Demo Pune · /);
  expect(text).toContain('Drawer: short by ₹50.00');
  expect(text).toContain('Cash paid out: ₹100.00');
  expect(text).toMatch(/Old software: \d+ bills may be missing from Chairside/);
  expect(text).not.toMatch(/Asha|Testpatient|root canal|crown/i);
  await axeClean(page, 'day close with summary');
});
