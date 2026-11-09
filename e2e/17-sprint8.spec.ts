import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * Sprint 8 "Reminders your way": reminders and wording set up by the owner,
 * Today's messages for the desk, a patient's STOP, doctor leave, and a
 * discount limit. Runs last and puts everything back (limit cleared, leave
 * removed, reminders removed) so earlier specs never see a difference.
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
  await page.getByLabel('Age in years').fill('41');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/** IST "HH:MM" for now + n minutes. */
function istClock(plusMinutes: number): string {
  const d = new Date(Date.now() + 5.5 * 3600_000 + plusMinutes * 60_000);
  return d.toISOString().slice(11, 16);
}
/** A working day (Mon–Sat) 3 days or more ahead, in IST. */
function aheadWorkingDay(days = 3): string {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  d.setUTCDate(d.getUTCDate() + days);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test.describe.configure({ mode: 'serial' });

test('before any set-up nothing changes: no Messages link, and the desk sees no reminder line on a patient', async ({ page }) => {
  await login(page, 'desk');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Messages' })).toHaveCount(0);
  await register(page, 'Nila Beforeset');
  await expect(page.getByRole('button', { name: 'Patient said STOP' })).toHaveCount(0);
});

test('owner adds the suggested reminders, writes wording with a live preview, and sets quiet hours away from now', async ({ page }) => {
  await login(page, 'owner');
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Reminders' }).click();
  await expect(page.getByRole('heading', { name: 'Reminders', exact: true, level: 1 })).toBeVisible();
  await axeClean(page, 'reminders empty');
  await page.getByRole('button', { name: 'Add suggested reminders' }).click();
  const rules = page.getByRole('region', { name: 'Reminders' });
  await expect(rules.getByRole('row').filter({ hasText: '1 day before' })).toBeVisible();
  await expect(rules.getByRole('row').filter({ hasText: 'Every 7 days while money is owed, up to 3 times' })).toBeVisible();

  // New wording: a detail button inserts {first_name}; the preview fills it.
  await page.getByRole('button', { name: '+ New wording' }).click();
  const form = page.getByRole('form', { name: 'New wording' });
  await form.getByLabel('Name').fill('Short reminder');
  await form.getByLabel('Message').fill('Hi ');
  await form.getByRole('button', { name: '{first_name}' }).click();
  await form.getByLabel('Message').press('End');
  await form.getByLabel('Message').pressSequentially(', see you {date} at {time}.');
  await expect(form.locator('.preview')).toHaveText('Hi Rahul, see you Thu 12 Nov at 11:00.');
  await expect(form.getByRole('button', { name: '{doctor}' })).toHaveCount(0); // off by default
  await axeClean(page, 'reminders wording');
  await form.getByRole('button', { name: 'Save wording' }).click();
  await expect(page.getByRole('region', { name: 'Wording' }).getByText('Short reminder')).toBeVisible();

  // A 3-hours-before reminder with that wording, Pune only.
  await page.getByRole('button', { name: '+ Add a reminder' }).click();
  const nr = page.getByRole('form', { name: 'New reminder' });
  await nr.getByLabel('When').selectOption({ label: 'Before the appointment' });
  await nr.getByLabel('How long before').fill('3');
  await nr.getByLabel('Unit').selectOption('hours');
  await nr.getByLabel('Wording').selectOption({ label: 'Short reminder' });
  await nr.getByLabel('Branch').selectOption({ label: 'Demo Pune' });
  await nr.getByRole('button', { name: 'Add reminder' }).click();
  await expect(rules.getByRole('row').filter({ hasText: '3 hours before' })).toContainText('Demo Pune');

  // Quiet hours that can't swallow the next hour, whenever this runs.
  const form2 = page.getByRole('form', { name: 'Quiet hours and details' });
  await form2.getByLabel('Quiet from').fill(istClock(180).slice(0, 2) + ':00');
  await form2.getByLabel('Until').fill(istClock(240).slice(0, 2) + ':00');
  await form2.getByRole('button', { name: 'Save' }).click();
  await expect(form2.getByRole('status')).toHaveText('Saved.');
});

test('desk books; the confirmation is in Today’s messages with time and place only; Skip clears it; STOP is honoured', async ({ page }) => {
  const day = aheadWorkingDay();
  await login(page, 'desk');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Messages' })).toBeVisible();
  await register(page, 'Rekha Remindme');
  const patientUrl = page.url();
  await expect(page.getByRole('button', { name: 'Patient said STOP' })).toBeVisible();
  await page.getByRole('link', { name: 'Book appointment' }).click();
  await page.getByLabel('Doctor', { exact: true }).selectOption({ label: 'Dr. Demo Associate' });
  await page.getByLabel('Date', { exact: true }).fill(day);
  await expect(page.getByRole('status').filter({ hasText: 'Loading free times' })).toHaveCount(0);
  await page.getByRole('radio', { name: '16:00' }).click();
  await page.getByLabel(/^Reason/).fill('Private clinical note');
  await page.getByRole('button', { name: /^Book 16:00/ }).click();
  await expect(page).toHaveURL(/\/appointments\?date=/);

  await page.getByRole('navigation').getByRole('link', { name: 'Messages' }).click();
  await expect(page.getByRole('heading', { name: 'Today’s messages' })).toBeVisible();
  const item = page.locator('.msg-list > li').filter({ hasText: 'Rekha Remindme' });
  await expect(item).toContainText('Right after booking');
  await item.getByText('See message').click();
  await expect(item.locator('pre')).toContainText('Namaste Rekha');
  await expect(item.locator('pre')).toContainText('at 16:00');
  await expect(item.locator('pre')).not.toContainText('Private clinical note');
  await expect(item.getByRole('link', { name: /^Send on WhatsApp: Rekha Remindme/ })).toHaveAttribute('href', /^https:\/\/wa\.me\/91\d{10}\?text=/);
  await axeClean(page, 'todays messages');
  await item.getByRole('button', { name: /^Skip: Rekha Remindme/ }).click();
  await expect(page.locator('.msg-list > li').filter({ hasText: 'Rekha Remindme' })).toHaveCount(0);

  // STOP on the patient page, then back on.
  await page.goto(patientUrl);
  await page.getByRole('button', { name: 'Patient said STOP' }).click();
  await expect(page.getByText('Reminders stopped')).toBeVisible();
  await page.getByRole('button', { name: 'Turn reminders back on' }).click();
  await expect(page.getByRole('button', { name: 'Patient said STOP' })).toBeVisible();
});

test('doctor leave: the day shows "On leave" and refuses a booking; removing it opens the day again', async ({ page }) => {
  const day = aheadWorkingDay(9);
  await login(page, 'desk');
  await page.goto('/appointments');
  await page.getByRole('link', { name: 'Doctor leave' }).click();
  await expect(page.getByRole('heading', { name: 'Doctor leave' })).toBeVisible();
  await axeClean(page, 'doctor leave');
  const form = page.getByRole('form', { name: 'Add leave' });
  await form.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Associate' });
  await form.getByLabel('First day away').fill(day);
  await form.getByLabel(/^Note/).fill('Conference');
  await form.getByRole('button', { name: 'Save leave' }).click();
  await expect(form.getByRole('status')).toContainText('leave saved');
  await expect(page.locator('.leave-list')).toContainText('Dr. Demo Associate');

  await page.goto(`/appointments?date=${day}`);
  const card = page.getByRole('region', { name: 'Dr. Demo Associate' });
  await expect(card).toContainText('On leave');
  await expect(card.getByRole('link', { name: /^Book Dr\. Demo Associate at/ })).toHaveCount(0);

  await page.goto('/appointments/leave');
  await page.getByRole('button', { name: /^Remove leave: Dr\. Demo Associate/ }).click();
  await expect(page.locator('.leave-list')).toContainText('No leave recorded');
  await page.goto(`/appointments?date=${day}`);
  await expect(page.getByRole('region', { name: 'Dr. Demo Associate' }).getByRole('link', { name: /^Book Dr\. Demo Associate at/ }).first()).toBeVisible();
});

test('discount limit: the owner sets 10% for the desk; the desk sees it live; cleared again at the end', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner, 'owner');
  await owner.goto('/settings/clinic');
  const caps = owner.getByRole('form', { name: 'Discount limits' });
  await axeClean(owner, 'discount limits');
  await caps.getByLabel('Front desk').fill('10');
  await caps.getByRole('button', { name: 'Save limits' }).click();
  await expect(caps.getByRole('status')).toContainText('saved');

  const deskCtx = await browser.newContext();
  const desk = await deskCtx.newPage();
  await login(desk, 'desk');
  await register(desk, 'Dina Discount');
  await desk.getByRole('link', { name: 'New bill' }).click();
  await desk.getByLabel('Doctor').selectOption({ label: 'Dr. Demo Associate' });
  const filter = desk.getByLabel('Add treatment or item');
  await filter.fill('root canal');
  await filter.press('Enter');
  await expect(desk.getByRole('columnheader', { name: /Discount/ })).toContainText('up to 10% a line');
  // ₹4,500 line: by hand, 10% = ₹450. ₹451 is over.
  await desk.getByLabel('Discount for Root canal treatment').fill('451');
  await desk.getByLabel('Reason for discount on Root canal treatment').fill('Family');
  await expect(desk.locator('.callout[role="alert"]')).toContainText('your limit is 10% (₹450.00 here)');
  await desk.getByLabel('Discount for Root canal treatment').fill('450');
  await expect(desk.locator('.callout[role="alert"]')).toHaveCount(0);

  // Put it back.
  await caps.getByLabel('Front desk').fill('');
  await caps.getByRole('button', { name: 'Save limits' }).click();
  await expect(caps.getByRole('button', { name: 'Save limits' })).toBeEnabled();
  await owner.reload();
  await expect(owner.getByRole('form', { name: 'Discount limits' }).getByLabel('Front desk')).toHaveValue('');
  await ownerCtx.close();
  await deskCtx.close();
});

test('clean-up: the owner removes every reminder and the Messages link goes away', async ({ page }) => {
  await login(page, 'owner');
  await page.goto('/settings/reminders');
  const rules = page.getByRole('region', { name: 'Reminders' });
  await expect(rules.getByRole('button', { name: 'Remove: 1 day before' })).toBeVisible();
  for (let i = 0; i < 20 && (await rules.getByRole('button', { name: /^Remove:/ }).count()) > 0; i++) {
    const before = await rules.getByRole('button', { name: /^Remove:/ }).count();
    await rules.getByRole('button', { name: /^Remove:/ }).first().click();
    await expect(rules.getByRole('button', { name: /^Remove:/ })).toHaveCount(before - 1);
  }
  await expect(page.getByRole('button', { name: 'Add suggested reminders' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Messages' })).toHaveCount(0);
});
