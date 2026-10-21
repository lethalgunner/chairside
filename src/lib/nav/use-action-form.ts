'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { afterAction } from './after-action';

/**
 * Submit state for a form that calls a server action (T18). Replaces
 * useTransition in forms: `busy` turns on at submit and stays on through the
 * navigation that follows (or its hard fallback), so there is no window for a
 * second submit. A second call while busy is ignored.
 */
export function useActionForm(form: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const release = useCallback(() => {
    inFlight.current = false;
    setBusy(false);
  }, []);

  /** Run the action. Returns null when another submit is already running. On a throw, busy is released and the error re-thrown. */
  const send = useCallback(async <T,>(call: () => Promise<T>): Promise<T | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    try {
      return await call();
    } catch (err) {
      inFlight.current = false;
      setBusy(false);
      throw err;
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

  return { busy, send, release, navigate };
}
