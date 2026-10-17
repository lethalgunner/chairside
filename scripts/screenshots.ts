/**
 * Capture product screenshots from a running build seeded by the e2e suite
 * (synthetic data only). Usage: BASE=http://localhost:3100 OUT=dir npx tsx scripts/screenshots.ts
 */
import { chromium } from '@playwright/test';

async function main() {
  const base = process.env.BASE ?? 'http://localhost:3100';
  const out = process.env.OUT ?? 'screenshots';
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const shoot = async (who: { email: string; password: string }, pages: [string, string][], viewport = { width: 1366, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(`${base}/login`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password').fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(`${base}/`);
    for (const [path, name] of pages) {
      if (path.startsWith('branch:')) {
        await page.locator('#branch-select').selectOption({ label: path.slice(7) });
        await page.waitForTimeout(800);
        continue;
      }
      await page.goto(`${base}${path}`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    }
    await ctx.close();
  };
  await shoot({ email: 'owner@demo.local', password: 'demo-owner-pass' }, [
    ['branch:All branches (view only)', ''],
    ['/', '1-owner-dashboard-all-branches'],
    ['/receivables', '6-receivables'],
    ['/gst', '7-gst-working-papers'],
  ]);
  const desk = { email: 'desk@demo.local', password: 'demo-desk-pass' };
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel('Email').fill(desk.email);
  await page.getByLabel('Password').fill(desk.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${base}/`);
  await page.goto(`${base}/patients?q=Asha`);
  await page.getByRole('link', { name: 'Asha Testpatient' }).click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${out}/2-patient-account.png`, fullPage: true });
  const pid = page.url().split('/patients/')[1]!.split('?')[0];
  await page.goto(`${base}/bills/new?patient=${pid}`);
  await page.getByLabel('Doctor').selectOption({ index: 1 });
  for (const q of ['root canal', 'zirconia', 'toothbrush']) {
    await page.getByLabel('Add treatment or item').fill(q);
    await page.getByLabel('Add treatment or item').press('Enter');
  }
  await page.getByLabel('Discount for Zirconia crown').fill('600');
  await page.getByLabel('Reason for discount on Zirconia crown').fill('Senior citizen');
  await page.screenshot({ path: `${out}/3-bill-builder.png`, fullPage: true });
  await page.goto(`${base}/invoices`);
  await page.locator('a.link.mono').last().click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${out}/4-bill-detail.png`, fullPage: true });
  await page.goto(`${base}/day-close`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${out}/5-day-close-closed.png`, fullPage: true });
  await ctx.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mp = await mobile.newPage();
  await mp.goto(`${base}/login`);
  await mp.getByLabel('Email').fill('owner@demo.local');
  await mp.getByLabel('Password').fill('demo-owner-pass');
  await mp.getByRole('button', { name: 'Sign in' }).click();
  await mp.waitForURL(`${base}/`);
  await mp.screenshot({ path: `${out}/8-mobile-dashboard.png`, fullPage: true });
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
