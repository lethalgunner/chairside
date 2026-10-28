'use client';

import { daySummaryOpenedAction } from '@/app/actions/whatsapp';

/**
 * "Send summary on WhatsApp" after a day close (Sprint 2, T33). The link is
 * built on the server with totals only; WhatsApp asks which chat to send it
 * to, so no owner number is stored. Opening it is noted in the usage log.
 */
export default function DaySummaryButton({ href, branchId }: { href: string; branchId: string }) {
  return (
    <p className="day-summary">
      <a
        className="cta secondary-cta wa-btn"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          void daySummaryOpenedAction(branchId).catch(() => undefined);
        }}
      >
        Send summary on WhatsApp
      </a>{' '}
      <span className="muted small">Totals only, no patient names. WhatsApp asks who to send it to.</span>
    </p>
  );
}
