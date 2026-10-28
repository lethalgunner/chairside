import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { login, phone, USERS } from './helpers';

/**
 * T29 (QA Q13): a session that runs out mid-form sends the desk to sign in with
 * "You were signed out. Nothing was saved." and brings them back to the same page.
 */
const DB = process.env.DATABASE_URL_E2E ?? 'postgresql://postgres@localhost:5432/chairside_e2e';
const SIGNED_OUT = 'You were signed out. Nothing was saved.';

async function signInHere(page: import('@playwright/test').Page, who: keyof typeof USERS) {
  await page.getByLabel('Email').fill(USERS[who].email);
  await page.getByLabel('Password').fill(USERS[who].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('session expired mid-bill: message, sign in, back on the same bill page, nothing issued', async ({ page, context }) => {
  const sql = postgres(DB, { max: 1, onnotice: () => {} });
  try {
    await login(page, 'desk');
    await page.goto('/patients/new');
    await page.getByLabel('Mobile').fill(phone());
    await page.getByLabel('Full name').fill('Asha Expiredsession');
    await page.getByRole('button', { name: 'Female', exact: true }).click();
    await page.getByLabel('Age in years').fill('37');
    await page.getByRole('button', { name: 'Register patient' }).click();
    await expect(page.getByRole('heading', { name: 'Asha Expiredsession' })).toBeVisible();
    const patientId = page.url().split('/patients/')[1]!.split('?')[0]!;

    await page.getByRole('link', { name: 'New bill' }).click();
    await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Associate' });
    await page.getByLabel('Add treatment or item').fill('scaling');
    await page.getByLabel('Add treatment or item').press('Enter');
    const billUrl = new URL(page.url());
    expect(billUrl.pathname).toBe('/bills/new');

    // The session runs out in the database while the bill is on screen.
    const sid = (await context.cookies()).find((c) => c.name === 'cs_session')!.value;
    const expired = await sql`update sessions set expires_at = now() - interval '1 minute' where id = ${sid}`;
    expect(expired.count).toBe(1);

    await page.getByRole('button', { name: 'Issue bill' }).click();
    await page.getByRole('button', { name: 'Yes, issue bill' }).click();

    await expect(page).toHaveURL(/\/login\?/);
    await expect(page.getByText(SIGNED_OUT)).toBeVisible();
    const loginUrl = new URL(page.url());
    expect(loginUrl.searchParams.get('next')).toBe(billUrl.pathname + billUrl.search);
    expect(loginUrl.searchParams.get('reason')).toBe('expired');

    const counted = await sql<{ n: number }[]>`select count(*)::int as n from invoices where patient_id = ${patientId}`;
    expect(counted[0]?.n).toBe(0);

    await signInHere(page, 'desk');
    await expect(page).toHaveURL(billUrl.href);
    await expect(page.getByRole('button', { name: 'Issue bill' })).toBeVisible();
  } finally {
    await sql.end();
  }
});

test('an expired session on a page load says so and returns to that page', async ({ page, context }) => {
  const sql = postgres(DB, { max: 1, onnotice: () => {} });
  try {
    await login(page, 'desk');
    const sid = (await context.cookies()).find((c) => c.name === 'cs_session')!.value;
    await sql`update sessions set expires_at = now() - interval '1 minute' where id = ${sid}`;
    await page.goto('/receivables');
    await expect(page).toHaveURL(/\/login\?next=%2Freceivables&reason=expired$/);
    await expect(page.getByText(SIGNED_OUT)).toBeVisible();
    await signInHere(page, 'desk');
    await expect(page).toHaveURL(/\/receivables$/);
  } finally {
    await sql.end();
  }
});

test('someone who never signed in is asked to sign in without a "signed out" message', async ({ page }) => {
  await page.goto('/patients?q=asha');
  await expect(page).toHaveURL(/\/login\?next=%2Fpatients%3Fq%3Dasha$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);
  await signInHere(page, 'desk');
  await expect(page).toHaveURL(/\/patients\?q=asha$/);
});

for (const crafted of ['//evil.com', 'https://evil.com/', '/%5Cevil.com']) {
  test(`a crafted next=${crafted} signs in to the dashboard, not away`, async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent(crafted)}`);
    await signInHere(page, 'desk');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    const landed = new URL(page.url());
    expect(landed.hostname).toBe('localhost');
    expect(landed.pathname).toBe('/');
  });
}

test('an already signed-in visit to a crafted login link stays on this site', async ({ page }) => {
  await login(page, 'desk');
  await page.goto('/login?next=%2F%2Fevil.com');
  const landed = new URL(page.url());
  expect(landed.hostname).toBe('localhost');
  expect(landed.pathname).toBe('/');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});
