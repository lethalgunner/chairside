'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-render the page every `seconds` while it is visible, so a shared screen stays current (T36). */
export default function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(t);
  }, [router, seconds]);
  return null;
}
