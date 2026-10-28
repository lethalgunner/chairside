import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { actionLogLine, run, signedOut, SLOW_ACTION_MS } = await import('./run');
const { isSignedOutResult } = await import('@/lib/nav/safe-next');
const { ForbiddenError, UserFacingError } = await import('@/services/context');

describe('action timing log (T17, QA Q5)', () => {
  let info: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('formats one line with name, whole milliseconds and outcome', () => {
    expect(actionLogLine('bill.issue', 41.6, 'ok')).toBe('[action] bill.issue 42ms ok');
    expect(actionLogLine('day.close', 0, 'error')).toBe('[action] day.close 0ms error');
  });

  it('refuses anything that is not a plain identifier as a name', () => {
    expect(actionLogLine('Asha 9822041155', 5, 'ok')).toBe('[action] unnamed 5ms ok');
    expect(actionLogLine('', 5, 'ok')).toBe('[action] unnamed 5ms ok');
  });

  it('logs ok without the payload or the result', async () => {
    const res = await run('patient.register', async () => ({ name: 'Asha Testpatient', phone: '9822041155' }));
    expect(res.ok).toBe(true);
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]![0]);
    expect(line).toMatch(/^\[action\] patient\.register \d+ms ok$/);
    expect(line).not.toContain('Asha');
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs error for staff-facing refusals and unexpected failures, without their text', async () => {
    expect(await run('bill.issue', async () => { throw new UserFacingError('Asha owes money'); })).toEqual({ ok: false, error: 'Asha owes money' });
    expect(await run('bill.issue', async () => { throw new ForbiddenError(); })).toMatchObject({ ok: false });
    expect(await run('bill.issue', async () => { throw new Error('boom'); })).toMatchObject({ ok: false });
    const lines = info.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l).toMatch(/^\[action\] bill\.issue \d+ms error$/);
      expect(l).not.toContain('Asha');
    }
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('warns when an action takes longer than 3 seconds', async () => {
    let t = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    await run('day.close', async () => {
      t += SLOW_ACTION_MS + 1;
    });
    expect(warn).toHaveBeenCalledWith(`[action] day.close ${SLOW_ACTION_MS + 1}ms ok`);
    expect(info).not.toHaveBeenCalled();
  });

  it('re-throws Next.js redirects untouched and still logs', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' });
    await expect(run('bill.issue', async () => { throw redirect; })).rejects.toBe(redirect);
    expect(String(info.mock.calls[0]![0])).toMatch(/ ok$/);
  });

  it('answers a signed-out action with the marker the forms recognise, logging only the name (T29)', () => {
    const res = signedOut('bill.issue');
    expect(res).toEqual({ ok: false, error: 'You were signed out. Nothing was saved.', signedOut: true });
    expect(isSignedOutResult(res)).toBe(true);
    expect(info).toHaveBeenCalledWith('[action] bill.issue 0ms signed_out');
  });
});
