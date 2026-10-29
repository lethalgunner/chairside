/**
 * Capability checks (ADR-009). Code asks "can this user do X at this branch",
 * never "is this user an owner". Pilot 0 keeps the schema's current role names;
 * the ADR-009 rename (associate_doctor → doctor, assistant → clinical_assistant)
 * lands in Phase 1 and only this map changes.
 */

export type Role =
  | 'owner'
  | 'branch_manager'
  | 'front_desk'
  | 'doctor'
  | 'associate_doctor'
  | 'assistant'
  | 'accountant'
  | 'auditor';

export type Capability =
  | 'patient.register'
  | 'patient.view'
  | 'invoice.issue'
  | 'invoice.void'
  | 'receipt.record'
  | 'expense.record_cash'
  | 'day.close'
  | 'day.reopen'
  | 'report.branch'
  | 'report.gst'
  | 'catalogue.manage'
  /** Invite, re-invite, deactivate and reactivate staff. Owner only, org-wide (Pilot 0 slice 2). */
  | 'staff.manage'
  /** Edit branch details: GST registration, GSTIN, day-close tolerance, float. Owner only (slice 2). */
  | 'branch.manage'
  /** Cancel a payment recorded by mistake. Owner only (slice 3, T19). */
  | 'receipt.cancel'
  /**
   * Cancel a bill you issued yourself, today, before any payment (slice 3,
   * T20). Pilot 0 latitude for the front desk: test-series bills only;
   * revisit at G1. See billCancellation() in domain/corrections.ts.
   */
  | 'invoice.void_own_today'
  /**
   * Mark recorded work as not done, so it leaves "Done, not billed" (Q20,
   * T28). Owner and branch manager only: the leakage figure is the owner's
   * measure of what the desk forgot to bill, so the desk can't clear it.
   */
  | 'procedure.dismiss'
  /**
   * Open a WhatsApp dues reminder for a patient (Sprint 2, T32). The desk
   * chases dues; doctors and assistants don't. Click-to-send only.
   */
  | 'patient.remind'
  /** Today's waiting room: add to the queue, seat, mark done (Sprint 3, T36). */
  | 'visit.manage'
  /** Set or close a patient's next-visit recall (Sprint 3, T37). */
  | 'recall.manage'
  /** Fix a patient's name, mobile, sex, age or referral (Sprint 3, T38). Audited. */
  | 'patient.edit'
  /** Download the clinic's data as CSV (Sprint 3, T40). Owner only. */
  | 'data.export';

const ALL: Capability[] = [
  'patient.register',
  'patient.view',
  'invoice.issue',
  'invoice.void',
  'receipt.record',
  'expense.record_cash',
  'day.close',
  'day.reopen',
  'report.branch',
  'report.gst',
  'catalogue.manage',
  'staff.manage',
  'branch.manage',
  'receipt.cancel',
  'invoice.void_own_today',
  'procedure.dismiss',
  'patient.remind',
  'visit.manage',
  'recall.manage',
  'patient.edit',
  'data.export',
];

/** Capabilities only the owner holds in Pilot 0. */
// catalogue.manage is owner-only until per-branch prices exist: the price list is org-wide (CPO Dev-1, Slice 3 T24).
const OWNER_ONLY: readonly Capability[] = ['day.reopen', 'staff.manage', 'branch.manage', 'receipt.cancel', 'catalogue.manage', 'data.export'];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: ALL,
  branch_manager: ALL.filter((c) => !OWNER_ONLY.includes(c)),
  front_desk: [
    'patient.register',
    'patient.view',
    'invoice.issue',
    'invoice.void_own_today',
    'receipt.record',
    'expense.record_cash',
    'day.close',
    'patient.remind',
    'visit.manage',
    'recall.manage',
    'patient.edit',
  ],
  doctor: ['patient.register', 'patient.view', 'invoice.issue', 'receipt.record', 'visit.manage', 'recall.manage'],
  associate_doctor: ['patient.register', 'patient.view', 'invoice.issue', 'receipt.record', 'visit.manage', 'recall.manage'],
  assistant: ['patient.register', 'patient.view', 'visit.manage'],
  accountant: ['report.branch', 'report.gst'],
  auditor: ['report.branch', 'report.gst'],
};

/** Every role, in the order the invite form lists them. */
export const ROLES: readonly Role[] = ['owner', 'branch_manager', 'front_desk', 'doctor', 'associate_doctor', 'assistant', 'accountant', 'auditor'];

/** Plain labels for clinic staff. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner (all branches)',
  branch_manager: 'Branch manager',
  front_desk: 'Front desk',
  doctor: 'Doctor',
  associate_doctor: 'Associate doctor',
  assistant: 'Clinical assistant',
  accountant: 'Accountant (reports only)',
  auditor: 'Auditor (reports only)',
};

export interface Grant {
  role: Role;
  /** null means the grant applies at every branch in the org. */
  branchId: string | null;
}

export function can(grants: readonly Grant[], capability: Capability, branchId: string): boolean {
  return grants.some(
    (g) =>
      (g.branchId === null || g.branchId === branchId) &&
      ROLE_CAPABILITIES[g.role].includes(capability),
  );
}

/**
 * For org-level settings (the team): the capability must come from an
 * org-wide grant, so a grant at one branch never reaches people at another.
 */
export function canOrgWide(grants: readonly Grant[], capability: Capability): boolean {
  return grants.some((g) => g.branchId === null && ROLE_CAPABILITIES[g.role].includes(capability));
}

/** Branches where the user holds any grant, given every branch in the org. */
export function accessibleBranches(grants: readonly Grant[], orgBranchIds: readonly string[]): string[] {
  if (grants.some((g) => g.branchId === null)) return [...orgBranchIds];
  const ids = new Set(grants.map((g) => g.branchId).filter((b): b is string => b !== null));
  return orgBranchIds.filter((b) => ids.has(b));
}
