import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * T30 (QA Q18, narrowed): the owner's evening check on a 390 px phone. The nav
 * wraps so every item is on screen, the dashboard tables stack into cards with
 * every column labelled, and no screen scrolls sideways. The Bills list and the
 * bill builder are out of scope here.
 */
const PATHS = ['/', '/patients', '/receivables', '/unbilled', '/day-close', '/gst'];
const WIDTH = 390;

/** Go to a screen and wait until its streamed content has replaced the loading state. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('main .state-block')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

async function checkScreens(page: Page, who: string) {
  for (const path of PATHS) {
    await open(page, path);
    const label = `${who} ${path}`;

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${label}: sideways scroll`).toBeLessThanOrEqual(1);

    // Every nav item is inside the viewport: none hidden behind a scroll row.
    const links = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
    const n = await links.count();
    expect(n, `${label}: nav links`).toBeGreaterThan(2);
    for (let i = 0; i < n; i++) {
      const box = await links.nth(i).boundingBox();
      const name = await links.nth(i).innerText();
      expect(box, `${label}: ${name} rendered`).not.toBeNull();
      expect(box!.x, `${label}: ${name} left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${label}: ${name} right edge`).toBeLessThanOrEqual(WIDTH + 0.5);
    }

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${label}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  }
}

/** Every dashboard table cell is labelled and on screen, so no column is hidden on a phone. */
async function checkDashboardTables(page: Page) {
  await open(page, '/');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const tables = page.locator('main table');
  const count = await tables.count();
  expect(count).toBeGreaterThan(0);
  for (let t = 0; t < count; t++) {
    await expect(tables.nth(t)).toHaveClass(/stack-table/);
    const cells = tables.nth(t).locator('tbody td');
    const c = await cells.count();
    for (let i = 0; i < c; i++) {
      const cell = cells.nth(i);
      expect(await cell.getAttribute('data-label'), `table ${t} cell ${i} label`).toBeTruthy();
      const box = await cell.boundingBox();
      expect(box, `table ${t} cell ${i} rendered`).not.toBeNull();
      expect(box!.x + box!.width, `table ${t} cell ${i} right edge`).toBeLessThanOrEqual(WIDTH + 0.5);
    }
  }
}

test.describe('owner and desk on a 390 px phone (T30)', () => {
  test.use({ viewport: { width: WIDTH, height: 844 } });

  test('owner, all branches: nav wraps, tables stack, nothing scrolls sideways, axe clean', async ({ page }) => {
    await login(page, 'owner');
    await expect(page.locator('.branch-banner')).toContainText('all branches');
    await expect(page.locator('.branch-banner')).toContainText('pick a branch in the branch menu to bill or take payments');
    await expect(page.locator('.branch-banner')).not.toContainText('sidebar');
    const branches = page.getByRole('region', { name: 'Branches today' });
    await expect(branches).toBeVisible();
    // The columns QA found hidden (Q18) are on screen, each with its label.
    const pune = branches.getByRole('row', { name: /Demo Pune/ });
    for (const col of ['Collected', 'Old system bills']) {
      const cell = pune.locator(`td[data-label="${col}"]`);
      await cell.scrollIntoViewIfNeeded();
      await expect(cell).toBeInViewport({ ratio: 1 });
      expect(await cell.evaluate((el) => getComputedStyle(el, '::before').content)).toContain(col);
    }
    await checkDashboardTables(page);
    await checkScreens(page, 'owner/all');
  });

  test('owner, one branch: same checks', async ({ page }) => {
    await login(page, 'owner');
    await page.locator('#branch-select').selectOption({ label: 'Demo Pune' });
    await expect(page.locator('.branch-banner')).toContainText('Working in Demo Pune');
    await checkDashboardTables(page);
    await checkScreens(page, 'owner/pune');
  });

  test('front desk: same checks', async ({ page }) => {
    await login(page, 'desk');
    await checkDashboardTables(page);
    await checkScreens(page, 'desk');
  });
});
