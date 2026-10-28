import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { addDays, businessDate, shortDay } from '../src/domain/dates';
import { login } from './helpers';

/**
 * Past days, read-only (Q19, T27). The golden path has closed Demo Pune today.
 * Yesterday gets an open day book at Demo Pune here (a day someone worked and
 * nobody closed), the only way to put activity on an earlier date in e2e.
 */
const today = businessDate();
const yesterday = addDays(today, -1);

test.beforeAll(async () => {
  const sql = postgres(process.env.DATABASE_URL_E2E ?? 'postgresql://postgres@localhost:5432/chairside_e2e', { max: 1, onnotice: () => {} });
  const [b] = await sql<{ id: string; org_id: string }[]>`select id, org_id from branches where code = 'DPN'`;
  await sql`insert into day_books (org_id, branch_id, business_date, status, opening_float_paise) values (${b!.org_id}, ${b!.id}, ${yesterday}, 'open', 200000) on conflict do nothing`;
  await sql.end();
});

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id}`)).toEqual([]);
}

async function noSidewaysScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(1);
}

test('owner is told yesterday was not closed, and sees yesterday read-only on the dashboard and day close', async ({ page }) => {
  await login(page, 'owner');
  const notice = page.locator('.callout', { hasText: `${shortDay(yesterday)} was not closed` });
  await expect(notice).toContainText('Demo Pune');
  await notice.getByRole('link', { name: `View ${shortDay(yesterday)}` }).click();

  await expect(page).toHaveURL(new RegExp(`\\?date=${yesterday}$`));
  await expect(page.getByRole('heading', { level: 1, name: shortDay(yesterday) })).toBeVisible();
  await expect(page.locator('.past-day')).toHaveText(`Viewing ${shortDay(yesterday)} (read-only)`);
  await expect(page.getByText(`Billed on ${shortDay(yesterday)}`)).toBeVisible();
  await expect(page.getByRole('link', { name: /Find patient to bill|Bill them/ })).toHaveCount(0);
  await expect(page.getByText('Done, not billed')).toHaveCount(0);
  await axeClean(page, 'past dashboard');

  // Day close for yesterday at Demo Pune: figures only, nothing to press.
  await page.locator('#branch-select').selectOption({ label: 'Demo Pune' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Pune');
  await page.goto(`/day-close?date=${yesterday}`);
  await expect(page.locator('.past-day')).toHaveText(`Viewing ${shortDay(yesterday)} (read-only)`);
  await expect(page.getByText('This day was not closed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: `Collected on ${shortDay(yesterday)}` })).toBeVisible();
  for (const name of ['Close the day', 'Add', 'Reopen day']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Cash paid out of the drawer' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Count the drawer' })).toHaveCount(0);
  await axeClean(page, 'past day close');

  // Next day lands on today, where the owner may reopen the closed day again.
  await page.getByRole('link', { name: 'Next day' }).click();
  await expect(page).toHaveURL(/\/day-close$/);
  await expect(page.locator('.past-day')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reopen day' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Next day' })).toHaveCount(0);

  // The date control: previous day, then a picked date, then back to today.
  await page.getByRole('link', { name: 'Previous day' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?date=${yesterday}$`));
  await page.getByLabel('Go to day').fill(addDays(today, -3));
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.locator('.past-day')).toContainText(shortDay(addDays(today, -3)));
  await page.getByRole('link', { name: 'Back to today' }).click();
  await expect(page.locator('.past-day')).toHaveCount(0);
});

test('a future, ancient or malformed date quietly shows today', async ({ page }) => {
  await login(page, 'owner');
  for (const bad of [addDays(today, 1), addDays(today, -401), '2026-02-30', 'yesterday']) {
    await page.goto(`/?date=${encodeURIComponent(bad)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Today', exact: true }), bad).toBeVisible();
    await expect(page.locator('.past-day')).toHaveCount(0);
  }
});

test('Bills "Today" shows only today’s bills with the day’s subtotal by mode', async ({ page }) => {
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Pune' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Pune');
  await page.getByRole('link', { name: 'Bills' }).click();
  await page.getByRole('navigation', { name: 'Which bills' }).getByRole('link', { name: 'Today' }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices\\?date=${today}$`));
  const subtotal = page.locator('.day-subtotal');
  await expect(subtotal).toContainText(/\d+ bills? · ₹[\d,]+\.\d{2} billed/);
  // The golden path took ₹5,000 by UPI and ₹2,000 cash at Demo Pune today.
  await expect(subtotal).toContainText(/Collected today: .*UPI ₹[\d,]+\.\d{2}.*Total ₹/);
  await expect(page.getByRole('row', { name: /Asha Testpatient/ }).first()).toBeVisible();
  await axeClean(page, 'bills today');

  // Yesterday had no bills at Demo Pune.
  await page.getByRole('link', { name: 'Previous day' }).click();
  await expect(page.getByText(`No bills on ${shortDay(yesterday)}.`)).toBeVisible();
  await expect(subtotal).toContainText('0 bills');
  await page.getByRole('navigation', { name: 'Which bills' }).getByRole('link', { name: 'All' }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(page.locator('.day-subtotal')).toHaveCount(0);
});

test.describe('on the owner’s phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Bills and past days fit 390 px without sideways scrolling and pass axe', async ({ page }) => {
    await login(page, 'owner');
    for (const path of ['/invoices', `/invoices?date=${today}`, `/?date=${yesterday}`]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await noSidewaysScroll(page, path);
      await axeClean(page, path);
    }
    // Every Bills column is still there on a phone, each with its label.
    await page.goto('/invoices');
    const first = page.locator('table.stack-table tbody tr').first();
    for (const label of ['Bill', 'Date', 'Branch', 'Patient', 'Status', 'Total', 'Paid', 'Due']) {
      await expect(first.locator(`td[data-label="${label}"]`)).toBeVisible();
    }
  });
});
