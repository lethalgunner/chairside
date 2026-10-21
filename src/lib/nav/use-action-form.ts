'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { afterAction } from './after-action';

/** Shown when the action never reached the server or its answer never came back (T23, Q12). */
export const NOT_SENT = 'Not sent: check the internet and press again. Nothing was saved.';

/**
 * Submit state for a form that calls a server action (T18). Replaces
 * useTransition in forms: `busy` turns on at submit and stays on through the
 * navigation that follows (or its hard fallback), so there is no window for a
 * second submit. A second call while busy is ignored.
 */
export function useActionForm(form: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notSent, setNotSent] = useState<string | null>(null);
  const inFlight = useRef(false);

  const release = useCallback(() => {
    inFlight.current = false;
    setBusy(false);
  }, []);

  /**
   * Run the action. Returns null when another submit is already running, or
   * when the call itself failed (network down, request dropped): then the form
   * keeps everything typed, `notSent` holds the message to show, and pressing
   * again is safe because bills and payments reuse their idempotency key.
   */
  const send = useCallback(async <T,>(call: () => Promise<T>): Promise<T | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setNotSent(null);
    try {
      return await call();
    } catch {
      inFlight.current = false;
      setBusy(false);
      setNotSent(NOT_SENT);
      return null;
    }
  }, []);

  /** Go to `to`, or refresh this page. Busy is released once the soft navigation lands; a hard fallback reloads the page anyway. */
  const navigate = useCallback(
    async (to?: string) => {
      const how = await afterAction(router, { form, to });
      if (how === 'soft') release();
    },
    [router, form, release],
  );

  return { busy, notSent, send, release, navigate };
}
