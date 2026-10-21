import { expect, test } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * The Pilot 0 walk-in journey at Demo Pune (GST-registered, ₹2,000 opening float).
 * Expected figures are worked by hand here, not read from the app:
 *
 *   Root canal treatment   4,500.00   exempt (SAC 9993)                      4,500.00
 *   Zirconia crown         6,000.00 − 600.00 discount = 5,400.00
 *                          GST 12% = 648.00 → CGST 324.00 + SGST 324.00     6,048.00
 *   Toothbrush               120.00   GST 18% = 21.60 → 10.80 + 10.80          141.60
 *   Raw total 10,689.60 → rounded to the rupee                             10,690.00
 *
 *   Paid 5,000 UPI + 2,000 cash → due 3,690.00
 *   Drawer: float 2,000 + cash 2,000 − paid out 100 = expected 3,900; counted 3,850 → short ₹50 (within ₹100)
 */
test('register → bill → part payment → ledger → day close → locked', async ({ page }) => {
  await login(page, 'desk');
  const mobile = phone();

  // Register with a pasted +91 number.
  await page.getByRole('navigation').getByRole('link', { name: 'New patient' }).click();
  await page.getByLabel('Mobile').fill(`+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`);
  await page.getByLabel('Full name').fill('Asha Testpatient');
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.getByLabel('Age in years').fill('34');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name: 'Asha Testpatient', exact: true })).toBeVisible();
  await expect(page.getByText('Nothing owed')).toBeVisible();

  // Build the bill with the keyboard.
  await page.getByRole('link', { name: 'New bill' }).click();
  await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Associate' });
  const filter = page.getByLabel('Add treatment or item');
  await filter.fill('root canal');
  await filter.press('Enter');
  await filter.fill('zirconia');
  await filter.press('Enter');
  await filter.fill('toothbrush');
  await filter.press('Enter');
  await page.getByLabel('Tooth for Root canal treatment').fill('26');
  await page.getByLabel('Discount for Zirconia crown').fill('600');
  await expect(page.locator('.callout[role="alert"]')).toContainText('Give a reason');
  await page.getByLabel('Reason for discount on Zirconia crown').fill('Senior citizen');
  await expect(page.locator('.kv.totals')).toContainText('₹10,690.00');
  await expect(page.locator('.kv.totals')).toContainText('₹669.60'); // 648.00 + 21.60; the 0.40 rounding is its own line
  await page.getByRole('button', { name: 'Issue bill' }).click();
  await expect(page.locator('.callout.confirm')).toContainText('₹10,690.00');
  await expect(page.locator('.callout.confirm')).toContainText('Demo Pune');
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  const issued = page.locator('.callout.good');
  await expect(issued).toContainText(/DPNT\/\d{2}-\d{2}\/\d{5}/);

  // Bill detail: line-level tax as calculated above.
  await page.getByRole('link', { name: 'View bill' }).click();
  await expect(page.getByText('Root canal treatment, tooth 26')).toBeVisible();
  await expect(page.getByRole('row', { name: /Zirconia crown/ })).toContainText('₹6,048.00');
  await expect(page.getByRole('row', { name: /Toothbrush/ })).toContainText('₹141.60');
  await expect(page.getByText('TEST SERIES', { exact: false })).toBeVisible();

  // Pay 5,000 by UPI; the allocation is spelled out first.
  await page.getByRole('link', { name: 'Record payment' }).click();
  await page.getByLabel('Amount received (₹)').fill('5000');
  await page.getByRole('button', { name: 'UPI' }).click();
  await expect(page.locator('.callout')).toContainText('will settle ₹5,000.00 of DPNT/');
  await expect(page.locator('.callout')).toContainText('leaving ₹5,690.00');
  await page.getByRole('button', { name: /Record ₹5,000\.00 UPI/ }).click();
  await expect(page.getByRole('status')).toContainText('of ₹5,000.00 recorded');

  // Pay 2,000 cash.
  await page.getByRole('link', { name: /Back to Asha/ }).click();
  await page.getByRole('link', { name: 'Record payment' }).click();
  await page.getByLabel('Amount received (₹)').fill('2000');
  await page.getByRole('button', { name: /Record ₹2,000\.00 Cash/ }).click();
  await expect(page.getByRole('status')).toContainText('recorded');

  // Ledger: derived balance.
  await page.getByRole('link', { name: /Back to Asha/ }).click();
  await expect(page.locator('.tile.alert .k')).toHaveText('₹3,690.00');
  await expect(page.getByText('Owes the clinic')).toBeVisible();

  // Day close.
  await page.getByRole('link', { name: 'Day close' }).click();
  await page.getByLabel('Amount paid out in rupees').fill('100');
  await page.getByLabel('What it was for').fill('Courier');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Courier: ₹100.00')).toBeVisible();
  await expect(page.locator('.card', { hasText: 'Cash drawer' })).toContainText('₹3,900.00');
  await page.getByLabel('₹500 notes').fill('7');
  await page.getByLabel('₹100 notes').fill('3');
  await page.getByLabel('₹50 notes').fill('1');
  await expect(page.locator('.big-line')).toContainText('short by ₹50.00');
  await page.getByLabel('Bills in the old system today').fill('99');
  await expect(page.locator('.legacy-compare .verdict')).toHaveText(/^\d+ bills may be missing from Chairside$/);
  await page.getByRole('button', { name: 'Close the day' }).click();
  await page.getByRole('button', { name: 'Yes, close the day' }).click();
  await expect(page.getByRole('heading', { name: 'Closed', exact: true })).toBeVisible();
  await expect(page.locator('.pill', { hasText: 'Closed' }).first()).toBeVisible();

  // Locked: a further payment is refused with a clear message.
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByRole('link', { name: 'Asha Testpatient' }).click();
  await page.getByRole('link', { name: 'Record payment' }).click();
  await page.getByLabel('Amount received (₹)').fill('100');
  await page.getByRole('button', { name: /Record ₹100\.00/ }).click();
  await expect(page.locator('.callout[role="alert"]')).toContainText('closed');
});
