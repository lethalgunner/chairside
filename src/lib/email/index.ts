/**
 * Outgoing email (Sprint 7, self-serve sign-in). One small driver, no SDK:
 * Resend's HTTP API when RESEND_API_KEY and EMAIL_FROM are set; otherwise
 * email is simply off and every screen that would send one stays as it was.
 *
 * Bodies carry sign-in links, which are secrets: never log a body, a link or
 * an address. Only the outcome is logged.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type SendResult = { sent: true } | { sent: false; reason: 'not_configured' | 'failed' };
export type EmailSender = (m: EmailMessage) => Promise<SendResult>;

export function emailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.RESEND_API_KEY && !!env.EMAIL_FROM;
}

export function makeSender(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): EmailSender {
  return async (m) => {
    if (!emailConfigured(env)) return { sent: false, reason: 'not_configured' };
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text }),
      });
      if (!res.ok) {
        console.error(`[email] send failed: HTTP ${res.status}`);
        return { sent: false, reason: 'failed' };
      }
      return { sent: true };
    } catch {
      console.error('[email] send failed: network');
      return { sent: false, reason: 'failed' };
    }
  };
}

export const sendEmail: EmailSender = (m) => makeSender()(m);
