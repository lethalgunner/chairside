import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Old system vs Chairside on the owner's dashboard (T21, Q10). The golden path
 * closed Demo Pune today with 99 bills typed in for the old system.
 */
test.describe('parallel run on the owner’s phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows each day’s difference without sideways scrolling, and passes axe', async ({ page }) => {
    await login(page, 'owner');
    const card = page.getByRole('region', { name: 'Parallel run' });
    await expect(card).toBeVisible();
    const pune = card.getByRole('row', { name: /Demo Pune/ });
    await expect(pune).toContainText('Closed');
    await expect(pune).toContainText(/\d+ bills may be missing from Chairside/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });
});

test('the closed day card shows the same comparison', async ({ page }) => {
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Pune' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Pune');
  await page.goto('/day-close');
  await expect(page.locator('.legacy-compare')).toContainText('Old system');
  await expect(page.locator('.legacy-compare .verdict')).toHaveText(/^\d+ bills may be missing from Chairside$/);
});
