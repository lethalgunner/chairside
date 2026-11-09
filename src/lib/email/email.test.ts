import { describe, expect, it, vi } from 'vitest';
import { emailConfigured, makeSender } from './index';

const msg = { to: 'a@b.test', subject: 'Hi', text: 'secret link' };

describe('email driver', () => {
  it('is off without both settings, and then never calls out', async () => {
    const f = vi.fn();
    expect(emailConfigured({ RESEND_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(await makeSender({} as unknown as NodeJS.ProcessEnv, f as unknown as typeof fetch)(msg)).toEqual({ sent: false, reason: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });
  it('posts to Resend with the key, and reports failures without the body', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    const env = { RESEND_API_KEY: 'k', EMAIL_FROM: 'Chairside <no-reply@x.test>' } as unknown as NodeJS.ProcessEnv;
    expect(await makeSender(env, f as unknown as typeof fetch)(msg)).toEqual({ sent: true });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body)).toEqual({ from: 'Chairside <no-reply@x.test>', to: ['a@b.test'], subject: 'Hi', text: 'secret link' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 422 });
    expect(await makeSender(env, bad as unknown as typeof fetch)(msg)).toEqual({ sent: false, reason: 'failed' });
    expect(err.mock.calls.flat().join(' ')).not.toContain('secret');
    err.mockRestore();
  });
});
