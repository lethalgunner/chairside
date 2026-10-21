import { expect, test } from '@playwright/test';
import { login, phone } from './helpers';

/** Input traps that made wrong bills or duplicates (Slice 3, T22). Demo Kanpur, whose day is still open. */

test('quantity, discount, amounts and phone search behave as staff type them', async ({ page }) => {
  await login(page, 'kanpurDesk');
  const mobile = phone();
  const name = 'Kiran Typist';
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(mobile);
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.getByLabel('Age in years').fill('35');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

  // Q14: a number pasted with +91 or a leading 0 finds the patient.
  for (const q of [`+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`, `0${mobile}`]) {
    await page.goto(`/patients?q=${encodeURIComponent(q)}`);
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

  // Q11: clear the quantity and type 2 → 2, not 12. −/+ step it.
  await page.getByRole('link', { name: 'New bill' }).click();
  await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Owner' });
  await page.getByLabel('Add treatment or item').fill('toothbrush');
  await page.getByLabel('Add treatment or item').press('Enter');
  const qty = page.getByLabel('Quantity for Toothbrush');
  await qty.click();
  await qty.press('End');
  await qty.press('Backspace');
  await expect(page.locator('.callout[role="alert"]')).toContainText('Quantity for “Toothbrush” must be a whole number from 1 to 99.');
  await qty.pressSequentially('2');
  await expect(qty).toHaveValue('2');
  await page.getByRole('button', { name: 'One more Toothbrush' }).click();
  await expect(qty).toHaveValue('3');
  await page.getByRole('button', { name: 'One less Toothbrush' }).click();
  await expect(qty).toHaveValue('2');

  // Q17: a discount above the price is explained in rupees, never paise.
  await page.getByLabel('Discount for Toothbrush').fill('500');
  await expect(page.locator('.callout[role="alert"]')).toHaveText('Discount on Toothbrush is more than its price (₹240).');
  await expect(page.getByText(/paise/)).toHaveCount(0);
  await page.getByLabel('Discount for Toothbrush').fill('');
  await page.getByRole('button', { name: 'Issue bill' }).click();
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  await expect(page.locator('.callout.good')).toContainText('issued');

  // Q16: "Rs. 100/-" is an amount; "abc" says why it isn't.
  await page.getByRole('link', { name: 'Record payment' }).click();
  const amount = page.getByLabel('Amount received (₹)');
  await amount.fill('abc');
  await expect(page.locator('#amount-err')).toHaveText('Enter the amount received in rupees, like 500, 1,500 or 1500.50.');
  await amount.fill('Rs. 100/-');
  await expect(page.locator('#amount-err')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Record ₹100\.00 Cash/ })).toBeEnabled();
});
