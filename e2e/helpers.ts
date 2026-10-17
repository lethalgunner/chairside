import { expect, type Page } from '@playwright/test';

export const USERS = {
  owner: { email: 'owner@demo.local', password: 'demo-owner-pass' },
  desk: { email: 'desk@demo.local', password: 'demo-desk-pass' },
};

export async function login(page: Page, who: keyof typeof USERS) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(USERS[who].email);
  await page.getByLabel('Password').fill(USERS[who].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}

/** A synthetic Indian mobile unique to this run. */
export function phone(): string {
  return `9${String(Date.now()).slice(-9)}`;
}
