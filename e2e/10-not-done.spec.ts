import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * "Was this work done?" on cancelling a bill, and "Not done: remove" on
 * Unbilled (Q20, T28). Runs at Demo Kanpur: the golden path closed Demo Pune.
 */

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id}`)).toEqual([]);
}

async function newPatientAtKanpur(page: Page, name: string) {
  await page.locator('#branch-select').selectOption({ label: 'Demo Kanpur' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Kanpur');
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(phone());
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.getByLabel('Age in years').fill('47');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'New bill' }).click();
  await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Owner' });
  await page.getByLabel('Add treatment or item').fill('consult');
  await page.getByLabel('Add treatment or item').press('Enter');
}

test('owner cancels a wrong-patient bill answering "No": nothing is left under Done, not billed', async ({ page }) => {
  await login(page, 'owner');
  await newPatientAtKanpur(page, 'Sunita Wrongpatient');
  await page.getByRole('button', { name: 'Issue bill' }).click();
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  await expect(page.locator('.callout.good')).toContainText('issued');
  await page.getByRole('link', { name: 'View bill' }).click();

  await page.getByRole('button', { name: 'Cancel this bill…' }).click();
  await page.getByLabel(/Why is DKNT\/.* being cancelled\?/).fill('Billed to the wrong patient');
  const confirm = page.getByRole('button', { name: /^Cancel DKNT\// });
  // The question must be answered first.
  await expect(page.getByRole('group', { name: /Was this work done\?/ })).toBeVisible();
  await expect(confirm).toBeDisabled();
  await axeClean(page, 'cancel dialog');
  await page.getByRole('radio', { name: 'No — it wasn’t done' }).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText('Cancelled: Billed to the wrong patient.')).toBeVisible();

  await page.goto('/unbilled');
  await expect(page.getByRole('row', { name: /Sunita Wrongpatient/ })).toHaveCount(0);
});

test('front desk can’t remove unbilled work; the owner removes it with a reason', async ({ page, browser }) => {
  await login(page, 'owner');
  await newPatientAtKanpur(page, 'Gita Neverseen');
  await page.getByRole('button', { name: 'Save as done, bill later' }).click();
  await expect(page.getByRole('heading', { name: 'Gita Neverseen', exact: true })).toBeVisible();

  // The Kanpur desk sees the row and can bill it, but not remove it.
  const deskContext = await browser.newContext();
  const desk = await deskContext.newPage();
  await login(desk, 'kanpurDesk');
  await desk.goto('/unbilled');
  const deskRow = desk.getByRole('row', { name: /Gita Neverseen/ });
  await expect(deskRow.getByRole('link', { name: 'Bill', exact: true })).toBeVisible();
  await expect(deskRow.getByRole('button', { name: 'Not done: remove' })).toHaveCount(0);
  await deskContext.close();

  await page.goto('/unbilled');
  const row = page.getByRole('row', { name: /Gita Neverseen/ });
  await row.getByRole('button', { name: 'Not done: remove' }).click();
  const remove = row.getByRole('button', { name: 'Remove', exact: true });
  await row.getByLabel('Why wasn’t Consultation done?').fill('no');
  await expect(remove).toBeDisabled();
  await axeClean(page, 'unbilled with remove form');
  await row.getByLabel('Why wasn’t Consultation done?').fill('Patient left before the consultation');
  await remove.click();
  await expect(page.getByRole('row', { name: /Gita Neverseen/ })).toHaveCount(0);
  await axeClean(page, 'unbilled after remove');

  // On a phone the rows stack, with the remove form open, and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const first = page.locator('table.stack-table tbody tr').first();
  // Rekha Wrongbill's consultation (06-corrections, cancelled with "Yes") is still listed at Demo Kanpur.
  await first.getByRole('button', { name: 'Not done: remove' }).click();
  await expect(first.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await axeClean(page, 'unbilled at 390');
});
