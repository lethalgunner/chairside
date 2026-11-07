import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * "+ New item" on the bill (KS, 7 Nov 2026): the owner adds a treatment to the
 * price list without leaving the bill; the desk is told to ask the owner.
 * At Demo Kanpur (not GST-registered); the golden path closed Demo Pune.
 */

async function newPatient(page: Page, name: string) {
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(phone());
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.getByLabel('Age in years').fill('41');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'New bill' }).first().click();
  await expect(page.getByRole('heading', { name: `Bill for ${name}` })).toBeVisible();
}

test('owner adds a new item from the bill: saved to the price list, on the bill, billable', async ({ page }) => {
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Kanpur' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Kanpur');
  await newPatient(page, 'Meera Newitem');

  await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Owner' });
  await page.getByLabel('Add treatment or item').fill('Laser gum contouring');
  await page.getByRole('button', { name: '+ Add “Laser gum contouring” as a new item' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Laser gum contouring');
  await expect(page.getByLabel('Price (₹)')).toBeFocused();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  // A bad price is caught on the field; nothing is added.
  await page.getByLabel('Price (₹)').fill('abc');
  await page.getByRole('button', { name: 'Save and add to bill' }).click();
  await expect(page.locator('#new-price-err')).toBeVisible();
  await expect(page.getByRole('row', { name: /Laser gum contouring/ })).toHaveCount(0);

  await page.getByLabel('Price (₹)').fill('6,500');
  await page.getByRole('button', { name: 'Save and add to bill' }).click();
  await expect(page.getByRole('row', { name: /Laser gum contouring/ })).toContainText('₹6,500');
  await expect(page.getByRole('form', { name: 'New item for the price list' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Issue bill' }).click();
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  await expect(page.locator('.callout.good')).toContainText('₹6,500');

  await page.goto('/settings/catalogue');
  await expect(page.getByRole('row', { name: /Laser gum contouring/ })).toContainText('LGC');
});

test('front desk sees no "+ New item", and is told to ask the owner', async ({ page }) => {
  await login(page, 'kanpurDesk');
  await newPatient(page, 'Ravi Nonewitem');
  await page.getByLabel('Add treatment or item').fill('zzz not a treatment');
  await expect(page.getByText('Only the owner can add items to the price list.')).toBeVisible();
  await expect(page.getByRole('button', { name: /New item|as a new item/ })).toHaveCount(0);
});
