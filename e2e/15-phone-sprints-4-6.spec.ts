import { expect, test } from '@playwright/test';
/** QA 8 Nov: the Sprint 4–6 screens fit a 390 px phone without sideways scrolling. */
import { login } from './helpers';
test.use({ viewport: { width: 390, height: 844 } });
test('phone: new screens fit 390 px', async ({ page }) => {
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Kanpur' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Kanpur');
  const bad: string[] = [];
  for (const path of ['/appointments', '/stock', '/settings/doctors', '/settings/medicines', '/settings/print', '/settings/team']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) bad.push(path + ' +' + over + 'px');
  }
  expect(bad).toEqual([]);
});
