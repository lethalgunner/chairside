import { headers } from 'next/headers';

/**
 * The site's own address for links in emails (Sprint 7). APP_URL wins when set
 * (production should set it); otherwise the request's host. Never a URL from
 * user input.
 */
export async function appBaseUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}
