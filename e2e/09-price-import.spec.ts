import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Paste the price list from Excel (Sprint 1, T25). Runs after every other
 * spec; it only adds new codes and changes Teeth whitening, which no earlier
 * spec bills.
 */

const tsv = (...rows: string[][]) => rows.map((r) => r.join('\t')).join('\n');
const HEADER = ['Code', 'Name', 'Category', 'Price (₹)', 'GST treatment', 'HSN/SAC', 'GST %'];

async function openPanel(page: Page) {
  await login(page, 'owner');
  await page.goto('/settings/catalogue');
  await page.getByRole('button', { name: 'Paste from Excel' }).click();
  await expect(page.getByRole('heading', { name: 'Paste from Excel' })).toBeVisible();
}

test('owner pastes three rows, one updating an existing code, and sees the new prices', async ({ page }) => {
  await openPanel(page);
  const paste = tsv(
    HEADER,
    ['PIMP', 'Implant fixture', 'Implants', '₹25,000', 'implant', '9021', '5%'],
    ['XRAY', 'IOPA X-ray', 'Diagnostics', '300/-', 'exempt', '9993', ''],
    ['whit', 'Teeth whitening', 'Cosmetic', '8,500', 'cosmetic', '9997', '18'],
  );
  await page.getByLabel('Rows from Excel').fill(paste);
  await expect(page.getByRole('button', { name: /^Save/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Check', exact: true }).click();

  await expect(page.locator('.import-summary')).toContainText('2 new, 1 update, 0 errors.');
  const preview = page.getByRole('table', { name: 'Rows to save' });
  await expect(preview.getByRole('row', { name: /PIMP/ })).toContainText('New');
  const whit = preview.getByRole('row', { name: /WHIT/ });
  await expect(whit).toContainText('Will update');
  await expect(whit).toContainText('₹8,000.00 → ₹8,500.00');

  await page.getByRole('button', { name: 'Save 3 items' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved 3 items.' })).toBeVisible();

  const list = page.getByRole('region', { name: 'Items' });
  await expect(list.getByRole('row', { name: /Implant fixture/ })).toContainText('₹25,000.00');
  await expect(list.getByRole('row', { name: /Implant fixture/ })).toContainText('5% · 9021');
  await expect(list.getByRole('row', { name: /IOPA X-ray/ })).toContainText('₹300.00');
  await expect(list.getByRole('row', { name: /Teeth whitening/ })).toContainText('₹8,500.00');
  // Still there after a full reload: it was saved, not just shown.
  await page.reload();
  await expect(page.getByRole('row', { name: /Teeth whitening/ })).toContainText('₹8,500.00');
});

test('a bad pasted row shows its error and blocks Save; the panel passes axe and fits a phone', async ({ page }) => {
  const AxeBuilder = (await import('@axe-core/playwright')).default;
  await openPanel(page);
  await page.getByLabel('Rows from Excel').fill(tsv(['BRK1', 'Bracket', 'Ortho', '1,200', 'retail', '3306', '18'], ['BRK2', 'Wire', 'Ortho', 'twelve hundred', 'luxury', '3306', '18']));
  await page.getByRole('button', { name: 'Check', exact: true }).click();

  await expect(page.locator('.import-summary')).toContainText('1 new, 0 updates, 1 error.');
  const bad = page.getByRole('table', { name: 'Rows to save' }).getByRole('row', { name: /BRK2/ });
  await expect(bad).toContainText('Error');
  await expect(bad).toContainText('Price (₹): Enter the price in rupees, like 500, 1,500 or 1500.50.');
  await expect(bad).toContainText('GST treatment: “luxury” isn’t a GST treatment.');
  await expect(page.getByRole('button', { name: 'Save 1 item' })).toBeDisabled();

  const axe = async (label: string) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${label}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  };
  await axe('1366');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(bad).toContainText('Error');
  await axe('390');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // Too much at once gets a plain message before anything is sent.
  await page.getByLabel('Rows from Excel').fill('x'.repeat(210 * 1024));
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByLabel('Rows from Excel')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('This paste is too large (210 KB). Paste at most 200 KB, about 500 rows, at a time.')).toBeVisible();

  // Nothing from the bad paste was saved.
  await page.reload();
  await expect(page.getByRole('row', { name: /Bracket/ })).toHaveCount(0);
});
