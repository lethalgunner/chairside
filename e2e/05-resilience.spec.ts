import { expect, test } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * Forms survive a navigation that never lands (Q5/Q8, T18) and a network that
 * drops mid-submit (Q12, T23).
 */

test('a stalled navigation after registering falls back to a full page load, and the patient exists once', async ({ page }) => {
  await login(page, 'desk');
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  // Force Q5: every soft-navigation (RSC) request for the new patient's page hangs forever.
  const isPatientRsc = (url: URL) => /^\/patients\/[0-9a-f-]{36}$/.test(url.pathname) && url.searchParams.has('_rsc');
  await page.route(isPatientRsc, () => {
    /* never answered */
  });

  const name = `Stall Patient ${Date.now().toString(36)}`;
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(phone());
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.getByLabel('Age in years').fill('29');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();

  // The hard load (a document request, not RSC) gets through after 2.5 s.
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}\?new=1$/);
  expect(warnings).toContain('[nav-fallback] patient.register');

  await page.unroute(isPatientRsc);
  await page.goto(`/patients?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('link', { name, exact: true })).toHaveCount(1);
});

test('a network drop on issue and on payment keeps the form, says "Not sent", and the retry saves exactly once', async ({ page, context }) => {
  await login(page, 'kanpurDesk');
  const name = `Offline Patient ${Date.now().toString(36)}`;
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(phone());
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.getByLabel('Age in years').fill('47');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'New bill' }).click();
  await page.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Owner' });
  await page.getByLabel('Add treatment or item').fill('consult');
  await page.getByLabel('Add treatment or item').press('Enter');
  await page.getByRole('button', { name: 'Issue bill' }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Not sent: check the internet and press again. Nothing was saved.' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Consultation/ })).toBeVisible(); // the bill being built is still there
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  await expect(page.locator('.callout.good')).toContainText('issued');

  await page.getByRole('link', { name: 'Record payment' }).click();
  await page.getByLabel('Amount received (₹)').fill('500');
  await context.setOffline(true);
  await page.getByRole('button', { name: /Record ₹500\.00 Cash/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Not sent:' })).toBeVisible();
  await expect(page.getByLabel('Amount received (₹)')).toHaveValue('500');
  await context.setOffline(false);
  await page.getByRole('button', { name: /Record ₹500\.00 Cash/ }).click();
  await expect(page.getByRole('status')).toContainText('recorded');

  await page.getByRole('link', { name: /Back to Offline/ }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Bills' }).locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Payments' }).locator('tbody tr')).toHaveCount(1);
  await expect(page.getByText('Nothing owed')).toBeVisible();
});
