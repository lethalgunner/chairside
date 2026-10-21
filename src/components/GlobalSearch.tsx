'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { afterAction } from '@/lib/nav/after-action';

/** Find a returning patient from any screen. Press "/" to jump here. */
export default function GlobalSearch() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        ref.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      role="search"
      className="global-search"
      onSubmit={(e) => {
        e.preventDefault();
        void afterAction(router, { form: 'search', to: `/patients?q=${encodeURIComponent(q.trim())}` });
      }}
    >
      <label htmlFor="global-search" className="sr-only">
        Find a patient
      </label>
      <input
        id="global-search"
        ref={ref}
        type="search"
        placeholder="Find patient: name, phone or file no.  ( / )"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
      />
    </form>
  );
}
