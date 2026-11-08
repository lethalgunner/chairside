import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * KS's test on 9 Nov: the "Next visit" box looked like booking (no time, a
 * default of 6 months out), prescriptions were invisible to a login without a
 * doctor profile, and booking should reach the patient. At Demo Kanpur, where
 * Dr. Demo Owner works (Demo Pune's day was closed by the golden path).
 */

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id}`)).toEqual([]);
}

async function register(page: Page, name: string): Promise<string> {
  const mobile = phone();
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(mobile);
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await page.getByLabel('Age in years').fill('44');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return mobile;
}

function nextWorkingDay(): string {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  ist.setUTCDate(ist.getUTCDate() + 1);
  if (ist.getUTCDay() === 0) ist.setUTCDate(ist.getUTCDate() + 1);
  return ist.toISOString().slice(0, 10);
}

test.describe.configure({ mode: 'serial' });

test('reminder explains itself, "Book a time" books it, booking closes it, and the patient gets a WhatsApp confirmation', async ({ page }) => {
  const day = nextWorkingDay();
  await login(page, 'kanpurDesk');
  const mobile = await register(page, 'Rahul Recallbook');
  // The desk can't prescribe, so the button isn't there.
  await expect(page.getByRole('link', { name: 'Write prescription' })).toHaveCount(0);

  const card = page.getByRole('region', { name: 'Remind to come back' });
  await expect(card).toContainText('book an appointment');
  await expect(card).toContainText('in about 6 months. No time: this is a reminder, not a booking.');
  await card.getByLabel('Around').fill(day);
  await card.getByRole('button', { name: 'Set reminder' }).click();
  await expect(card).toContainText('Check-up due');
  await axeClean(page, 'patient with reminder');

  await card.getByRole('link', { name: 'Book a time' }).click();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue(day);
  await page.getByLabel('Doctor', { exact: true }).selectOption({ label: 'Dr. Demo Owner' });
  await page.getByRole('radio', { name: '11:00' }).click();
  await page.getByLabel(/^Reason/).fill('RCT review');
  await page.getByRole('button', { name: /^Book 11:00/ }).click();

  const done = page.getByRole('status').filter({ hasText: 'Booked Rahul Recallbook at 11:00' });
  await expect(done).toBeVisible();
  const href = (await done.getByRole('link', { name: 'Send Rahul Recallbook a WhatsApp confirmation' }).getAttribute('href'))!;
  expect(href.startsWith(`https://wa.me/91${mobile}?text=`)).toBe(true);
  const text = decodeURIComponent(href.split('text=')[1]!);
  expect(text).toContain('Namaste Rahul,');
  expect(text).toContain('at 11:00');
  expect(text).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE');
  // Time and place only.
  expect(text).not.toMatch(/Dr\.|RCT|review/);
  await expect(page.getByRole('link', { name: 'WhatsApp confirmation: 11:00 Rahul Recallbook' })).toBeVisible();
  await axeClean(page, 'appointments after booking');

  // The reminder was answered by the booking.
  await page.goto('/patients');
  await page.getByRole('link', { name: /Rahul Recallbook/ }).first().click();
  await expect(page.getByRole('region', { name: 'Remind to come back' })).toContainText('No reminder set.');
});

test('the owner sees "Write prescription" and the doctors page offers "Add me as a doctor" only when needed', async ({ page }) => {
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Kanpur' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Kanpur');
  await register(page, 'Owner Rxcheck');
  await expect(page.getByRole('link', { name: 'Write prescription' })).toBeVisible();
  // This demo owner is already Dr. Demo Owner, so no offer to add.
  await page.goto('/settings/doctors');
  await expect(page.getByText('Do you also treat patients?')).toHaveCount(0);
});
