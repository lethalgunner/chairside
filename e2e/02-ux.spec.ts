import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login, phone } from './helpers';

async function registerPatient(page: import('@playwright/test').Page, name: string, mobile = phone()) {
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(mobile);
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await page.getByLabel('Age in years').fill('41');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  return mobile;
}

test('double-clicking "Yes, issue bill" issues exactly one bill', async ({ page }) => {
  await login(page, 'desk');
  await registerPatient(page, 'Ravi Doubleclick');
  await page.getByRole('link', { name: 'New bill' }).click();
  await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Associate' });
  await page.getByLabel('Add treatment or item').fill('scaling');
  await page.getByLabel('Add treatment or item').press('Enter');
  await page.getByRole('button', { name: 'Issue bill' }).click();
  await page.getByRole('button', { name: 'Yes, issue bill' }).dblclick();
  await expect(page.locator('.callout.good')).toBeVisible();
  await page.getByRole('link', { name: 'Back to patient' }).click();
  await expect(page.locator('table').first().locator('tbody tr')).toHaveCount(1);
});

test('duplicate warning can be overridden for a family member on the same phone', async ({ page }) => {
  await login(page, 'desk');
  const mobile = await registerPatient(page, 'Sunil Familyphone');
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(`0${mobile}`);
  await page.getByLabel('Full name').fill('Neha Familyphone');
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.getByLabel('Age in years').fill('9');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.locator('.callout[role="alert"]')).toContainText('Sunil Familyphone');
  await expect(page.getByRole('button', { name: 'Register patient' })).toBeDisabled();
  // Typed values survive the round trip.
  await expect(page.getByLabel('Age in years')).toHaveValue('9');
  await page.getByLabel(/This is a different person/).check();
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name: 'Neha Familyphone', exact: true })).toBeVisible();
});

test('validation errors are announced and linked to their fields', async ({ page }) => {
  await login(page, 'desk');
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill('12345');
  await page.getByRole('button', { name: 'Register patient' }).click();
  const mobile = page.getByLabel('Mobile');
  await expect(mobile).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#phone-err')).toHaveText('Enter a 10-digit Indian mobile number.');
  await expect(mobile).toHaveAttribute('aria-describedby', 'phone-err');
  await expect(page.locator('#sex-err')).toBeVisible();
});

test('"/" jumps to patient search from anywhere and finds by phone digits', async ({ page }) => {
  await login(page, 'desk');
  const mobile = await registerPatient(page, 'Kiran Searchable');
  await page.goto('/');
  await page.keyboard.press('/');
  await expect(page.locator('#global-search')).toBeFocused();
  await page.keyboard.type(mobile.slice(-5));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Kiran Searchable' })).toBeVisible();
});

test('save as done, bill later, then bill it from Unbilled', async ({ page }) => {
  await login(page, 'desk');
  await registerPatient(page, 'Meena Billlater');
  await page.getByRole('link', { name: 'New bill' }).click();
  await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Associate' });
  await page.getByLabel('Add treatment or item').fill('consult');
  await page.getByLabel('Add treatment or item').press('Enter');
  await page.getByRole('button', { name: 'Save as done, bill later' }).click();
  await expect(page.getByRole('heading', { name: 'Meena Billlater', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Unbilled' }).click();
  const row = page.getByRole('row', { name: /Meena Billlater/ });
  await expect(row).toContainText('₹500.00');
  await row.getByRole('link', { name: 'Bill', exact: true }).click();
  await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Associate' });
  await page.getByRole('button', { name: 'Add to this bill' }).click();
  await page.getByRole('button', { name: 'Issue bill' }).click();
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  await expect(page.locator('.callout.good')).toContainText('DPNT/');
  await page.goto('/unbilled');
  await expect(page.getByRole('row', { name: /Meena Billlater/ })).toHaveCount(0);
});

test('accessibility: no serious or critical axe violations on core screens', async ({ page }) => {
  await login(page, 'desk');
  const mobile = await registerPatient(page, 'Axe Patient');
  const pid = page.url().split('/patients/')[1]!.split('?')[0]!;
  for (const path of ['/', '/patients', '/patients/new', `/patients/${pid}`, `/bills/new?patient=${pid}`, `/receipts/new?patient=${pid}`, '/invoices', '/receivables', '/unbilled', '/day-close']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  }
  expect(mobile).toHaveLength(10);
});

test('login page passes axe too', async ({ page }) => {
  await page.goto('/login');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test.describe('phone-width layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('core screens do not scroll sideways at 390px', async ({ page }) => {
    await login(page, 'desk');
    for (const path of ['/', '/patients', '/patients/new', '/day-close']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });
});
