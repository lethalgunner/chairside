'use client';

import { useEffect } from 'react';
import { NAV_FALLBACK_MS } from '@/lib/nav/after-action';

/**
 * Q5 also stalls plain link clicks, not only navigations after an action
 * (seen in the Slice 3 e2e: Settings → Team never landed). When an in-app link
 * is clicked and the address has not changed within NAV_FALLBACK_MS, load the
 * page in full. Logs `[nav-fallback] link`, never the address.
 */
export default function NavWatchdog() {
  useEffect(() => {
    let timer: number | undefined;
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const to = new URL(a.href, window.location.href);
      if (to.origin !== window.location.origin) return;
      const from = window.location.pathname + window.location.search;
      if (to.pathname + to.search === from) return; // same page (or a #hash)
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Any change of address means some navigation landed; only a page that never moved is stuck.
        if (window.location.pathname + window.location.search === from) {
          console.warn('[nav-fallback] link');
          window.location.assign(to.href);
        }
      }, NAV_FALLBACK_MS);
    }
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}
