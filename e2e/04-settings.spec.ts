import { expect, test } from '@playwright/test';
import { login, phone } from './helpers';

/**
 * Owner settings (Pilot 0 slice 2). Runs after the golden path, so changes
 * here (a new item, Kanpur's GST status) cannot disturb the earlier specs.
 */

test('team: owner invites a front desk user, the link sets a password, deactivation signs them out', async ({ page, browser }) => {
  await login(page, 'owner');
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Team' }).click();
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();

  await page.getByLabel('Full name').fill('Kavya (desk)');
  await page.getByLabel('Email').fill('Kavya@Demo.local');
  await page.getByLabel('Role').selectOption('front_desk');
  await page.locator('#invite-branch').selectOption({ label: 'Demo Pune' });
  await page.getByRole('button', { name: 'Create invite link' }).click();
  await expect(page.getByText('It works once, for 72 hours.')).toBeVisible();
  const link = await page.getByLabel('Invite link').inputValue();
  expect(link).toMatch(/\/setup\?token=[A-Za-z0-9_-]{40,}$/);
  // Reload rather than wait on the client refresh after the action: that refresh
  // is QA Q5 (it intermittently never commits) and is not what this test is about.
  await page.reload();
  await expect(page.getByLabel('Invite link')).toHaveCount(0); // shown once only
  const row = page.getByRole('row', { name: /Kavya \(desk\)/ });
  await expect(row).toContainText('kavya@demo.local');
  await expect(row).toContainText('Front desk · Demo Pune');
  await expect(row).toContainText('Invite pending');

  // The invited person, in their own browser.
  const theirs = await browser.newContext();
  const p2 = await theirs.newPage();
  await p2.goto(link);
  await expect(p2.getByRole('heading', { name: 'Welcome, Kavya (desk)' })).toBeVisible();
  await p2.getByLabel('New password').fill('kavya keeps the books');
  await p2.getByLabel('Type it again').fill('kavya keeps the books');
  await p2.getByRole('button', { name: 'Set password and sign in' }).click();
  await expect(p2.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(p2.locator('.branch-banner')).toContainText('Demo Pune');
  await expect(p2.getByRole('navigation').getByRole('link', { name: 'Settings' })).toHaveCount(0);

  await page.reload();
  await expect(row).toContainText('Set up');
  await page.getByRole('button', { name: 'Deactivate Kavya (desk)' }).click();
  await expect(row).toContainText('Deactivated');
  await p2.reload();
  await expect(p2).toHaveURL(/\/login(\?|$)/);
  await theirs.close();

  // The owner cannot switch themself off.
  await expect(page.getByRole('row', { name: /Dr\. Demo Owner/ }).getByRole('button', { name: /Deactivate/ })).toHaveCount(0);
});

test('price list: owner adds an item, the bill builder offers it, deactivating hides it', async ({ page }) => {
  await login(page, 'owner');
  await page.locator('#branch-select').selectOption({ label: 'Demo Pune' });
  await expect(page.locator('.branch-banner')).toContainText('Demo Pune');
  await page.goto('/settings/catalogue');
  await expect(page.getByText('GST rates are not yet confirmed by a CA. Issued bills keep the rate they were issued with.')).toBeVisible();

  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByLabel('Code').fill('ngd');
  await page.getByLabel(/^Name/).fill('Night guard');
  await page.getByLabel('Category').fill('Prosthodontics');
  await page.getByLabel('Price (₹)').fill('abc');
  await page.getByLabel('GST treatment').selectOption('goods_prosthetic');
  await expect(page.getByLabel('HSN/SAC')).toHaveValue('9021');
  await page.getByLabel('GST %').selectOption('500');
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByLabel('Price (₹)')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Price (₹)').fill('2,500');
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('status')).toContainText('Night guard saved.');
  const row = page.getByRole('row', { name: /Night guard/ });
  await expect(row).toContainText('NGD');
  await expect(row).toContainText('₹2,500.00');
  await expect(row).toContainText('5% · 9021');

  // A patient at Demo Pune, then the bill builder.
  await page.goto('/patients/new');
  await page.getByLabel('Mobile').fill(phone());
  await page.getByLabel('Full name').fill('Gita Nightguard');
  await page.getByRole('button', { name: 'Female', exact: true }).click();
  await page.getByLabel('Age in years').fill('38');
  await page.getByRole('button', { name: 'Register patient' }).click();
  await expect(page.getByRole('heading', { name: 'Gita Nightguard', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'New bill' }).click();
  await expect(page.getByLabel('Add treatment or item')).toBeVisible();
  const billUrl = page.url();
  await page.getByLabel('Add treatment or item').fill('night');
  const picks = page.getByRole('list', { name: 'Matching items' });
  await expect(picks).toContainText('Night guard');
  await expect(picks).toContainText('₹2,500.00');

  await page.goto('/settings/catalogue');
  await page.getByRole('button', { name: 'Deactivate Night guard' }).click();
  await expect(row).toContainText('Inactive');
  await page.goto(billUrl);
  await page.getByLabel('Add treatment or item').fill('night');
  await expect(picks).toContainText('Nothing matches');
});

test('branches: owner marks Demo Kanpur GST registered with a valid GSTIN', async ({ page }) => {
  await login(page, 'owner');
  await page.goto('/settings/branches');
  const form = page.getByRole('form', { name: 'Demo Kanpur details' });
  await expect(form).toContainText('DKN');
  await expect(form.getByLabel('Branch name')).toHaveValue('Demo Kanpur');

  await form.getByLabel(/GST registered/).check();
  await form.getByLabel(/^GSTIN/).fill('27AAAAA0000A1Z5');
  await form.getByRole('button', { name: 'Save Demo Kanpur' }).click();
  await expect(form.getByText('A GSTIN for Uttar Pradesh starts with 09.')).toBeVisible();

  await form.getByLabel(/^GSTIN/).fill('09abcde1234f1z5');
  await form.getByRole('button', { name: 'Save Demo Kanpur' }).click();
  await expect(form.getByRole('status')).toContainText('Demo Kanpur saved.');
  await page.reload();
  await expect(form.getByLabel(/^GSTIN/)).toHaveValue('09ABCDE1234F1Z5');

  await page.locator('#branch-select').selectOption({ label: 'Demo Kanpur' });
  await expect(page.locator('.branch-banner')).toContainText('GST registered');
});

test('settings screens pass axe for the owner', async ({ page }) => {
  const AxeBuilder = (await import('@axe-core/playwright')).default;
  await login(page, 'owner');
  for (const path of ['/settings', '/settings/team', '/settings/catalogue', '/settings/branches']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${path}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  }
});

test('team and price list fit a 390 px phone without sideways scrolling (QA 28 Oct)', async ({ page }) => {
  await login(page, 'owner');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/settings/team', '/settings/catalogue']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
  await expect(page.getByRole('button', { name: /^Edit / }).first()).toBeInViewport();
});
