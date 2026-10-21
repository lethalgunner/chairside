/**
 * Who may cancel a bill (Slice 3, T20). Pure so the bill screen and the
 * service apply the same rule. Pilot 0 latitude (CPO triage Q9): someone
 * holding only `invoice.void_own_today` (the front desk) may cancel a bill
 * they issued themself, at that branch, on the same business day, while it
 * has no payments. Anyone with `invoice.void` may cancel any unpaid bill.
 */

export type BillCancellation =
  | { allowed: true }
  | { allowed: false; reason: string; /** Show the "cancel its payments first" links. */ needsPaymentsCancelled?: boolean };

export function billCancellation(p: {
  status: string;
  paidPaise: number;
  issuedOn: string;
  createdBy: string | null;
  /** The person asking. */
  userId: string;
  /** Business date today, at the bill's branch. */
  today: string;
  canVoidAny: boolean;
  canVoidOwnToday: boolean;
}): BillCancellation {
  if (p.status !== 'issued') return { allowed: false, reason: 'Only an issued bill can be cancelled.' };
  if (p.paidPaise > 0) {
    return p.canVoidAny
      ? { allowed: false, reason: 'This bill has payments. Cancel them first, then cancel the bill.', needsPaymentsCancelled: true }
      : { allowed: false, reason: 'This bill has payments. Only the owner can cancel this bill.' };
  }
  if (p.canVoidAny) return { allowed: true };
  if (p.canVoidOwnToday) {
    if (p.createdBy !== p.userId) return { allowed: false, reason: 'Only the owner can cancel this bill. You can cancel only bills you issued yourself.' };
    if (p.issuedOn !== p.today) return { allowed: false, reason: 'Only the owner can cancel this bill. You can cancel your own bills only on the day they were issued.' };
    return { allowed: true };
  }
  return { allowed: false, reason: 'Only the owner can cancel this bill.' };
}
