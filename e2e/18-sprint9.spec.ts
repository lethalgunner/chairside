import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * Sprint 9 "Switch in a day": import patients and coming appointments with
 * a dry run, split payment, help and what's new. New patients and
 * appointments are named "… Import" so nothing collides with other specs.
 */

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id}`)).toEqual([]);
}
function aheadWorkingDay(days: number): string {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  d.setUTCDate(d.getUTCDate() + days);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

test.describe.configure({ mode: 'serial' });

const m1 = phone();
const m2 = `8${m1.slice(1)}`;

test('owner imports patients: Check shows each row, a problem blocks Import, a clean sheet imports', async ({ page }) => {
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Pune' });
  await expect(page.locator('.branch-banner')).toContainText('Working in Demo Pune');
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Bring your data' }).click();
  await expect(page.getByRole('heading', { name: 'Bring your data', level: 1 })).toBeVisible();
  await axeClean(page, 'import empty');
  const box = page.getByLabel('Rows from Excel or a CSV file');
  await box.fill(`Patient Name,Gender,Contact No.,Age\nTara Import,F,${m1},29\nX,M,123,\n`);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'with problems' })).toContainText('1 patient to add, 0 skipped, 1 with problems');
  await expect(page.getByRole('button', { name: /^Import / })).toBeDisabled();
  await axeClean(page, 'import preview');
  await box.fill(`Patient Name,Gender,Contact No.,Age\nTara Import,F,${m1},29\nUday Import,M,${m2},52\n`);
  await page.getByRole('button', { name: 'Check' }).click();
  await page.getByRole('button', { name: 'Import 2 patients' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported 2 patients into Demo Pune' })).toBeVisible();
});

test('owner imports a coming appointment for an imported patient; it shows on that day', async ({ page }) => {
  const day = aheadWorkingDay(6);
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Pune' });
  await expect(page.locator('.branch-banner')).toContainText('Working in Demo Pune');
  await page.goto('/settings/import?kind=appointments');
  await page.getByLabel('Rows from Excel or a CSV file').fill(`Mobile,Patient,Date,Time,Doctor\n${m1},Tara Import,${dmy(day)},5:30 pm,Dr Demo Associate\n`);
  await page.getByRole('button', { name: 'Check' }).click();
  await page.getByRole('button', { name: 'Import 1 appointment' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported 1 appointment' })).toBeVisible();
  await page.goto(`/appointments?date=${day}`);
  await expect(page.getByRole('region', { name: 'Dr. Demo Associate' }).getByRole('listitem').filter({ hasText: 'Tara Import' })).toContainText('17:30');
});

test('desk splits a payment: ₹2,000 cash + the rest on UPI settles a ₹4,500 bill', async ({ page }) => {
  await login(page, 'desk');
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(phone());
  await page.getByLabel('Full name').fill('Vani Splitpay');
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.getByLabel('Age in years').fill('45');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name: 'Vani Splitpay', exact: true })).toBeVisible();
  const patientUrl = page.url();
  await page.getByRole('link', { name: 'New bill' }).click();
  await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Associate' });
  await page.getByLabel('Add treatment or item').fill('root canal');
  await page.getByLabel('Add treatment or item').press('Enter');
  await page.getByRole('button', { name: 'Issue bill' }).click();
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  await expect(page.locator('.callout.good')).toContainText('issued');

  await page.goto(patientUrl);
  await page.getByRole('link', { name: 'Record payment' }).click();
  await page.getByRole('button', { name: /Paid more than one way/ }).click();
  const form = page.getByRole('form', { name: 'Split payment' });
  await form.getByLabel('Amount (₹)').first().fill('2000');
  await form.getByRole('button', { name: 'Fill the rest' }).click();
  await expect(form.getByLabel('Amount (₹)').nth(1)).toHaveValue('2500');
  await axeClean(page, 'split payment');
  await form.getByRole('button', { name: 'Record ₹4,500.00 in 2 ways' }).click();
  await expect(page.getByRole('status')).toContainText('₹4,500.00 recorded at Demo Pune in 2 ways');
  await page.getByRole('link', { name: 'Back to Vani Splitpay' }).click();
  await expect(page.getByText('Nothing owed')).toBeVisible();
});

test('help and what’s new are a tap away and accessible', async ({ page }) => {
  await login(page, 'desk');
  await page.getByRole('link', { name: 'Help and what’s new' }).click();
  await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'What’s new' })).toContainText('Split payment');
  await axeClean(page, 'help');
});
