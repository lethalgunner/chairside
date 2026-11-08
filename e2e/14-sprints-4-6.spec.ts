import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * Sprints 4–6 (LET-166…176), QA from scratch, as the front desk and the owner:
 * appointments with a calendar feed, treatment plans with an estimate, the
 * work card, bill header and printing, medicines, templates and prescriptions,
 * roles, and stock. Demo Pune's day was closed by the golden path, so work
 * that needs an open day happens at Demo Kanpur (GST-registered since 04).
 */

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${label}: ${v.id}`)).toEqual([]);
}

async function register(page: Page, name: string) {
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(phone());
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.getByLabel('Age in years').fill('36');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Tomorrow in IST, skipping Sunday (demo doctors work Monday to Saturday). */
function nextWorkingDay(): string {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  ist.setUTCDate(ist.getUTCDate() + 1);
  if (ist.getUTCDay() === 0) ist.setUTCDate(ist.getUTCDate() + 1);
  return ist.toISOString().slice(0, 10);
}
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

test.describe.configure({ mode: 'serial' });

test('front desk books, moves and cancels; the database refuses a double booking; arrived goes to the waiting room', async ({ page }) => {
  const day = nextWorkingDay();
  await login(page, 'desk');
  await register(page, 'Asha Apptest');
  await page.getByRole('link', { name: 'Book appointment' }).click();
  await expect(page.getByRole('heading', { name: 'Book for Asha Apptest' })).toBeVisible();
  await page.getByLabel('Doctor', { exact: true }).selectOption({ label: 'Dr. Demo Associate' });
  await page.getByLabel('Date', { exact: true }).fill(day);
  // The form fetches that day's free times itself (no navigation since QA 8 Nov).
  await expect(page.getByRole('status').filter({ hasText: 'Loading free times' })).toHaveCount(0);
  await page.getByRole('radio', { name: '11:00' }).click();
  await page.getByLabel(/^Reason/).fill('RCT sitting 1');
  await axeClean(page, 'booking');
  await page.getByRole('button', { name: /^Book 11:00/ }).click();
  await expect(page).toHaveURL(new RegExp(`/appointments\\?date=${day}`));
  const assoc = page.getByRole('region', { name: 'Dr. Demo Associate' });
  await expect(assoc.getByRole('listitem').filter({ hasText: 'Asha Apptest' })).toContainText('11:00');
  await expect(assoc.getByRole('link', { name: 'Book Dr. Demo Associate at 11:00' })).toHaveCount(0);
  await axeClean(page, 'appointments day');

  // Move to 12:00.
  await assoc.getByRole('link', { name: 'Move: 11:00 Asha Apptest' }).click();
  await expect(page.getByRole('heading', { name: /Move Asha Apptest/ })).toBeVisible();
  await page.getByRole('radio', { name: '12:00' }).click();
  await page.getByRole('button', { name: 'Move to 12:00' }).click();
  await expect(page.getByRole('region', { name: 'Dr. Demo Associate' }).getByRole('listitem').filter({ hasText: 'Asha Apptest' })).toContainText('12:00');

  // Another patient at 12:05 with the same doctor: refused by the server.
  await register(page, 'Bina Clash');
  await page.getByRole('link', { name: 'Book appointment' }).click();
  await page.getByLabel('Doctor', { exact: true }).selectOption({ label: 'Dr. Demo Associate' });
  await page.getByLabel('Date', { exact: true }).fill(day);
  // The form fetches that day's free times itself (no navigation since QA 8 Nov).
  await expect(page.getByRole('status').filter({ hasText: 'Loading free times' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Other time' }).click();
  await page.getByLabel('Other time').fill('12:05');
  await page.getByRole('button', { name: /^Book 12:05/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'already has someone from 12:00 to 12:15' })).toBeVisible();

  // Cancel Asha's, with a reason.
  await page.goto(`/appointments?date=${day}`);
  await page.getByRole('button', { name: 'Cancel: 12:00 Asha Apptest' }).click();
  await page.getByLabel('Why cancelled').fill('Patient travelling');
  await page.getByRole('button', { name: 'Cancel appointment' }).click();
  await expect(page.getByRole('region', { name: 'Dr. Demo Associate' }).getByRole('listitem').filter({ hasText: 'Asha Apptest' })).toContainText('Cancelled');

  // Today, late: arrived puts Bina in the waiting room.
  await page.goto(`/patients`);
  await page.goto('/appointments/new');
  await page.getByLabel('Name, mobile or file number').fill('Bina Clash');
  await page.getByRole('button', { name: 'Find' }).click();
  await page.getByRole('link', { name: /Bina Clash/ }).click();
  await page.getByLabel('Doctor', { exact: true }).selectOption({ label: 'Dr. Demo Associate' });
  await page.getByRole('radio', { name: 'Other time' }).click();
  await page.getByLabel('Other time').fill('23:55');
  await page.getByLabel('Length').selectOption('0');
  await page.getByRole('button', { name: /^Book 23:55/ }).click();
  await expect(page).toHaveURL(new RegExp(`/appointments\\?date=${todayIst()}`));
  await page.getByRole('button', { name: 'Arrived: 23:55 Bina Clash' }).click();
  // The button's own word is "Arrived", so wait for it to go and the waiting-room link to come.
  await expect(page.getByRole('button', { name: 'Arrived: 23:55 Bina Clash' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Dr. Demo Associate' }).getByRole('listitem').filter({ hasText: 'Bina Clash' })).toContainText('Waiting room');
  await page.goto('/queue');
  await expect(page.getByRole('row', { name: /Bina Clash/ })).toContainText('Waiting');
});

test('owner: doctor profile and calendar link (no patient names in the feed), bill header, medicines and a root canal template', async ({ page }) => {
  await login(page, 'owner');
  await page.goto('/settings/doctors');
  await axeClean(page, 'settings doctors');
  const owner = page.getByRole('listitem').filter({ hasText: 'Signs in as' }).filter({ hasText: 'Dr. Demo Owner' });
  await owner.getByRole('button', { name: 'Edit profile' }).click();
  await page.getByLabel('Registration number').fill('A-12345');
  await page.getByLabel('Qualification').fill('BDS, MDS');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Dr. Demo Owner saved.')).toBeVisible();

  const assoc = page.getByRole('listitem').filter({ hasText: 'Dr. Demo Associate' });
  await assoc.getByRole('button', { name: 'Create calendar link' }).click();
  const link = page.getByLabel('Calendar link for Dr. Demo Associate');
  await expect(link).toHaveValue(/\/calendar\/[A-Za-z0-9_-]{43}$/);
  const url = await link.inputValue();
  const feed = await page.request.get(url);
  expect(feed.status()).toBe(200);
  expect(feed.headers()['content-type']).toContain('text/calendar');
  expect(feed.headers()['cache-control']).toContain('no-store');
  const ics = await feed.text();
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('SUMMARY:Appointment · 15 min');
  expect(ics).not.toContain('Asha');
  expect(ics).not.toContain('Bina');
  expect(ics).not.toContain('RCT sitting');
  expect((await page.request.get(url.replace(/.$/, url.endsWith('A') ? 'B' : 'A'))).status()).toBe(404);

  await page.goto('/settings/print');
  const kanpur = page.getByRole('form', { name: 'Demo Kanpur bill header' });
  await kanpur.getByLabel('Clinic name as printed').fill('Vij Dental Care Kanpur');
  await kanpur.getByLabel('Footer').fill('Mon–Sat 10 am – 7 pm');
  await kanpur.getByRole('button', { name: 'Save header' }).click();
  await expect(kanpur.getByText('Saved. New printouts use it.')).toBeVisible();
  await axeClean(page, 'settings print');

  await page.goto('/settings/medicines');
  await page.getByRole('button', { name: 'Add common dental medicines' }).click();
  await expect(page.getByText(/common dental medicines added/)).toBeVisible();
  await page.getByRole('button', { name: '+ Template' }).click();
  await page.getByLabel('Template name').fill('Root canal');
  await page.getByLabel('Suggest after treatment').selectOption({ label: 'Root canal treatment' });
  await page.getByLabel('Add a medicine').selectOption({ label: 'Amoxicillin 500 mg' });
  await page.getByLabel('Add a medicine').selectOption({ label: 'Paracetamol 650 mg' });
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Root canal saved.')).toBeVisible();
  await axeClean(page, 'settings medicines');
});

test('owner at Kanpur: plan with an estimate, sitting 1 done and billed at the agreed price, then a prescription from the template', async ({ page }) => {
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Kanpur' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Kanpur');
  await register(page, 'Kiran Plantest');
  await page.getByRole('link', { name: '+ New plan' }).click();
  await page.getByLabel('Plan name').fill('Lower left RCT and crown');
  await page.getByLabel('Add treatment').fill('root');
  await page.getByLabel('Add treatment').press('Enter');
  await page.getByLabel('Tooth for Root canal treatment').fill('36');
  await page.getByLabel('Agreed price for Root canal treatment').fill('4,000');
  await page.getByLabel('Why the price differs for Root canal treatment').fill('Second RCT this year');
  await page.getByLabel('Add treatment').fill('crown');
  await page.getByLabel('Add treatment').press('Enter');
  await page.getByLabel('Tooth for Zirconia crown').fill('36');
  await page.getByLabel('Sitting for Zirconia crown').fill('2');
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByRole('heading', { name: 'Lower left RCT and crown' })).toBeVisible();
  // By hand: RCT ₹4,000 (exempt) + crown ₹6,000 + 12% GST ₹720 = ₹10,720.
  await expect(page.locator('.tile').filter({ hasText: 'Estimate' })).toContainText('₹10,720.00');
  await expect(page.locator('.tile').filter({ hasText: 'Still to do' })).toContainText('₹10,000.00');
  await axeClean(page, 'plan');

  await page.getByRole('link', { name: 'Print estimate' }).click();
  await expect(page.getByRole('heading', { name: 'Treatment estimate EST/DKN/0001' })).toBeVisible();
  await expect(page.locator('.print-doc')).toContainText('Vij Dental Care Kanpur');
  await expect(page.locator('.print-doc')).toContainText('₹10,720.00');
  await page.getByRole('link', { name: '← Back to plan' }).click();
  await expect(page.getByRole('heading', { name: 'Lower left RCT and crown' })).toBeVisible();

  await page.getByLabel('Done: Root canal treatment, tooth 36').check();
  await page.getByRole('button', { name: 'Mark ticked work done' }).click();
  await expect(page.locator('.tile').filter({ hasText: 'Done, not billed' })).toContainText('₹4,000.00');
  await page.getByRole('link', { name: 'Bill the done work →' }).click();
  await page.getByRole('button', { name: 'Add to this bill' }).click();
  await page.getByRole('button', { name: 'Issue bill' }).click();
  await page.getByRole('button', { name: 'Yes, issue bill' }).click();
  await expect(page.locator('.callout.good')).toContainText('₹4,000.00');

  // The printed bill carries the header and the test mark.
  await page.getByRole('link', { name: 'View bill' }).click();
  await page.getByRole('link', { name: 'Print' }).click();
  await expect(page.locator('.print-doc')).toContainText('Vij Dental Care Kanpur');
  await expect(page.locator('.print-doc')).toContainText('TEST BILL · NOT A TAX INVOICE');
  await expect(page.locator('.print-doc')).toContainText('Root canal treatment, tooth 36');

  // Patient page: plan, work card.
  await page.goto('/patients');
  await page.getByRole('link', { name: 'Kiran Plantest' }).first().click();
  await expect(page.getByRole('link', { name: 'Lower left RCT and crown' })).toBeVisible();
  await expect(page.locator('.tile').filter({ hasText: 'Still to do' })).toContainText('₹6,000.00');
  await expect(page.locator('.tile').filter({ hasText: /Billed ·/ })).toContainText('₹4,000.00');

  // Prescription: the root canal template is suggested because RCT was done today.
  await page.getByRole('link', { name: 'Write prescription' }).click();
  await page.getByRole('button', { name: '★ Root canal' }).click();
  await expect(page.getByLabel('Dose for Amoxicillin')).toBeVisible();
  await page.getByLabel('Allergies').fill('Sulfa drugs');
  await page.getByLabel('Complaint or diagnosis').fill('Deep caries 36, RCT started');
  await axeClean(page, 'prescription form');
  await page.getByRole('button', { name: 'Sign prescription' }).click();
  await expect(page.locator('.print-doc')).toContainText('RX/DKN/0001');
  await expect(page.locator('.print-doc')).toContainText('Amoxicillin 500 mg');
  await expect(page.locator('.print-doc')).toContainText('Allergies: Sulfa drugs');
  await expect(page.locator('.print-doc')).toContainText('Reg. no. A-12345');
  await axeClean(page, 'prescription');
});

test('owner gives the Pune desk Kanpur access and takes it back; the role table explains each role', async ({ page }) => {
  await login(page, 'owner');
  await page.goto('/settings/team');
  const row = page.getByRole('row', { name: /Priya \(front desk\)/ });
  await row.getByRole('button', { name: 'Give Priya (front desk) more access' }).click();
  await row.getByLabel('New role for Priya (front desk)').selectOption('front_desk');
  await row.getByLabel('At branch').selectOption({ label: 'Demo Kanpur' });
  await row.getByRole('button', { name: 'Give access' }).click();
  await expect(row).toContainText('Front desk · Demo Kanpur');
  await row.getByRole('button', { name: 'Remove Front desk · Demo Kanpur from Priya (front desk)' }).click();
  await expect(row).not.toContainText('Demo Kanpur');
  await page.getByText('What each role can do').click();
  await expect(page.getByRole('row', { name: /Sign prescriptions/ })).toBeVisible();
  await axeClean(page, 'team');
});

test('Kanpur desk keeps stock: received and used add up, low shows', async ({ page }) => {
  await login(page, 'kanpurDesk');
  await page.goto('/stock');
  await page.getByRole('button', { name: '+ Stock item' }).click();
  await page.getByLabel('Name').fill('Nitrile gloves (M)');
  await page.getByLabel('Counted in').selectOption('box');
  await page.getByLabel('Reorder when down to').fill('2');
  await page.getByRole('button', { name: 'Add item' }).click();
  const row = page.getByRole('row', { name: /Nitrile gloves/ });
  await row.getByRole('button', { name: 'Received: Nitrile gloves (M)' }).click();
  await row.getByLabel('How many came').fill('10');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('10 boxes');
  await row.getByRole('button', { name: 'Used: Nitrile gloves (M)' }).click();
  await row.getByLabel('How many used').fill('9');
  await row.getByLabel('Why').fill('Morning trays');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('1 box');
  await expect(row).toContainText('Low');
  await axeClean(page, 'stock');
});

test('new screens fit a 390 px phone without sideways scrolling', async ({ page }) => {
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Kanpur' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Kanpur');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/appointments', '/appointments/new', '/stock', '/settings/doctors', '/settings/medicines', '/settings/print', '/settings/team']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
