import { describe, expect, it, vi } from 'vitest';
import { NAV_FALLBACK_MS, settle, type SettleDeps } from './after-action';

/** Fake clock and timers: each tick advances 100 ms and runs the poller. */
function harness(doneAtMs: number | null) {
  let t = 0;
  let fn: (() => void) | null = null;
  const hard = vi.fn();
  const warn = vi.fn();
  const deps: SettleDeps = {
    isDone: () => doneAtMs !== null && t >= doneAtMs,
    hardNavigate: hard,
    warn,
    setInterval: (f) => {
      fn = f;
      return 1;
    },
    clearInterval: () => {
      fn = null;
    },
    now: () => t,
  };
  const run = () => {
    for (let i = 0; i < 100 && fn; i++) {
      t += 100;
      fn();
    }
  };
  return { deps, run, hard, warn };
}

describe('self-healing navigation (T18)', () => {
  it('resolves soft when the page changes before the deadline, without a fallback', async () => {
    const h = harness(400);
    const p = settle('patient.register', h.deps);
    h.run();
    await expect(p).resolves.toBe('soft');
    expect(h.hard).not.toHaveBeenCalled();
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('falls back to a full page load after 2.5 s and logs only the form name', async () => {
    expect(NAV_FALLBACK_MS).toBe(2500);
    const h = harness(null);
    const p = settle('patient.register', h.deps);
    h.run();
    await expect(p).resolves.toBe('hard');
    expect(h.hard).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledWith('[nav-fallback] patient.register');
  });

  it('does not fall back just before the deadline', async () => {
    const h = harness(NAV_FALLBACK_MS - 100);
    const p = settle('day.close', h.deps);
    h.run();
    await expect(p).resolves.toBe('soft');
    expect(h.hard).not.toHaveBeenCalled();
  });

  it('never logs anything but a plain identifier', async () => {
    const h = harness(null);
    const p = settle('Asha 9822041155', h.deps);
    h.run();
    await p;
    expect(h.warn).toHaveBeenCalledWith('[nav-fallback] unnamed');
  });
});
