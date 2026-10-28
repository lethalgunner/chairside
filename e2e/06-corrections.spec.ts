import { expect, test, type Page } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * Correcting mistakes during the parallel run (Slice 3: T19 cancel a payment, T20 desk cancels its own bill).
 * Runs at Demo Kanpur: the golden path has already closed Demo Pune's day.
 */

async function registerAndBill(page: Page, name: string, item: string, doctor: string) {
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(phone());
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await page.getByLabel('Age in years').fill('52');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'New bill' }).click();
  await page.getByLabel('Doctor').selectOption({ label: doctor });
  await page.getByLabel('Add treatment or item').fill(item);
  await page.getByLabel('Add treatment or item').press('Enter');
  await page.getByRole('button', { name: 'Issue bill' }).click();
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  await expect(page.locator('.callout.good')).toContainText('issued');
}

test('owner cancels a mistaken payment; the bill is due again and the payment is struck through', async ({ page }) => {
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Kanpur' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Kanpur');
  await registerAndBill(page, 'Vikram Wrongpay', 'consult', 'Dr. Demo Owner');

  await page.getByRole('link', { name: 'Record payment' }).click();
  await page.getByLabel('Amount received (₹)').fill('500');
  await page.getByRole('button', { name: /Record ₹500\.00 Cash/ }).click();
  await expect(page.getByRole('status')).toContainText('recorded');
  await page.getByRole('link', { name: /Back to Vikram/ }).click();
  await expect(page.getByRole('heading', { name: 'Vikram Wrongpay', exact: true })).toBeVisible();

  await page.locator('table').first().getByRole('link').first().click();
  // A paid bill explains how to cancel it instead of hiding the button.
  await expect(page.getByText('This bill has payments. Cancel them first:')).toBeVisible();
  await page.locator('.callout').getByRole('link', { name: /DKNTR\// }).click();

  await page.getByRole('button', { name: 'Cancel this payment…' }).click();
  await page.getByLabel(/Why is DKNTR\/.* being cancelled\?/).fill('Typed in by mistake');
  await page.getByRole('button', { name: /^Cancel DKNTR\// }).click();
  await expect(page.getByText('Cancelled: Typed in by mistake.')).toBeVisible();

  await page.getByRole('link', { name: /DKNT\/\d{2}-\d{2}\/\d{5}/ }).click();
  await expect(page.locator('dd.strong.due-text')).toHaveText('₹500.00');
  await expect(page.getByText('Cancelled: Typed in by mistake')).toBeVisible();
  await page.getByRole('link', { name: 'Patient account →' }).click();
  await expect(page.locator('.tile.alert .k')).toHaveText('₹500.00');
  await expect(page.getByRole('row', { name: /Cancelled payment/ })).toBeVisible();
});

test('front desk cancels its own unpaid bill the same day, and is told who can cancel the rest', async ({ page }) => {
  await login(page, 'kanpurDesk');
  await expect(page.locator('.branch-banner')).toContainText('Demo Kanpur');
  await registerAndBill(page, 'Rekha Wrongbill', 'consult', 'Dr. Demo Owner');
  await page.getByRole('link', { name: 'View bill' }).click();
  await page.getByRole('button', { name: 'Cancel this bill…' }).click();
  await page.getByLabel(/Why is DKNT\/.* being cancelled\?/).fill('Billed the wrong patient');
  await page.getByRole('radio', { name: 'Yes — it will show under Done, not billed' }).check();
  await page.getByRole('button', { name: /^Cancel DKNT\// }).click();
  await expect(page.getByText('Cancelled: Billed the wrong patient.')).toBeVisible();

  // The owner's bill from the test above: the desk sees why it can't cancel it.
  await page.goto(`/patients?q=${encodeURIComponent('Vikram Wrongpay')}`);
  await page.getByRole('link', { name: 'Vikram Wrongpay' }).click();
  await expect(page.getByRole('heading', { name: 'Vikram Wrongpay', exact: true })).toBeVisible();
  await page.locator('table').first().getByRole('link').first().click();
  await expect(page.getByText('Only the owner can cancel this bill. You can cancel only bills you issued yourself.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel this bill…' })).toHaveCount(0);
});
