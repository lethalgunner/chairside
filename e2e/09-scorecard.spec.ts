import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * Pilot scorecard (Sprint 1, T26). Runs after the golden path, which closed
 * Demo Pune today with 99 bills typed in for the old system. The demo seed has
 * no earlier days, so today is the only day with activity.
 */

const LABEL = /^(Pass|Not yet|No data|For information)$/;

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
}

function criterion(page: Page, scope: string, title: string) {
  return page.getByRole('region', { name: scope }).getByRole('row', { name: new RegExp(title) });
}

test('a signed-out visitor is sent to /login', async ({ page }) => {
  await page.goto('/scorecard');
  await expect(page).toHaveURL(/\/login$/);
});

test('the owner sees every criterion with a measured value, a pass mark and a text label', async ({ page }) => {
  await login(page, 'owner'); // renders the dashboard: today's dashboard view is recorded
  await page.getByRole('navigation').getByRole('link', { name: 'Pilot scorecard' }).click();
  await expect(page.getByRole('heading', { name: 'Pilot scorecard', exact: true })).toBeVisible();

  for (const scope of ['All branches in view', 'Demo Pune', 'Demo Kanpur']) {
    const results = page.getByRole('region', { name: scope }).locator('tbody td[data-label="Result"]');
    await expect(results).toHaveCount(5);
    for (const r of await results.all()) await expect(r).toHaveText(LABEL);
  }
  // 99 old-system bills against a handful in Chairside.
  await expect(criterion(page, 'Demo Pune', 'Old-system bills also in Chairside')).toContainText(/of 99 old-system bills/);
  await expect(criterion(page, 'Demo Pune', 'Old-system bills also in Chairside')).toContainText('Not yet');
  await expect(criterion(page, 'Demo Pune', 'Day totals match')).toContainText('0 of 1 day matched');
  // The owner opened the dashboard today, the only day with activity.
  await expect(criterion(page, 'Demo Pune', 'Owner opened the dashboard')).toContainText('1 of 1 day');
  await expect(criterion(page, 'Demo Pune', 'Owner opened the dashboard')).toContainText('Pass');
  await expect(criterion(page, 'Demo Pune', 'Days closed')).toContainText('1 of 1 day with activity');
  await expect(page.getByText(/smaller of Chairside’s bills and the old system’s/)).toBeVisible();
  await axeClean(page);

  // A range that ends in the future is refused with a reason.
  await page.goto('/scorecard?from=2026-01-01&to=2099-01-01');
  await expect(page.getByRole('status').filter({ hasText: 'cannot end in the future' })).toBeVisible();
});

test.describe('on the owner’s phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('stacks without sideways scrolling and passes axe', async ({ page }) => {
    await login(page, 'owner');
    await page.goto('/scorecard');
    await expect(page.getByRole('region', { name: 'Demo Pune' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await axeClean(page);
  });
});

test('front desk has no link and is refused with a plain message', async ({ page }) => {
  await login(page, 'desk');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Pilot scorecard' })).toHaveCount(0);
  await page.goto('/scorecard');
  await expect(page.getByText('The pilot scorecard is for the owner, branch managers, the accountant and the auditor.')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('registration still works and adds one timed registration to the scorecard', async ({ page, context }) => {
  await login(page, 'owner');
  await page.goto('/scorecard');
  const reg = criterion(page, 'Demo Pune', 'Registration time');
  const countOf = async () => {
    const m = /\((\d+) registrations?\)/.exec((await reg.textContent()) ?? '');
    return m ? Number(m[1]) : 0;
  };
  const before = await countOf();

  await context.clearCookies();
  const desk = page;
  await login(desk, 'desk');
  await desk.getByRole('navigation').getByRole('link', { name: 'New patient' }).click();
  await desk.getByLabel('Mobile').fill(phone());
  await desk.getByLabel('Full name').fill('Tara Timedpatient');
  await desk.getByRole('button', { name: 'Female', exact: true }).click();
  await desk.getByLabel('Age in years').fill('29');
  await desk.getByRole('button', { name: 'Register patient' }).click();
  await expect(desk.getByRole('heading', { name: 'Tara Timedpatient', exact: true })).toBeVisible();

  await context.clearCookies();
  await login(page, 'owner');
  await page.goto('/scorecard');
  await expect(reg).toContainText(`(${before + 1} registration${before + 1 === 1 ? '' : 's'})`);
  await expect(reg).toContainText(/\d+\.\d s/);
});
