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
  | 'data.export'
  /** Doctor profiles, working hours and calendar links (Sprint 4, LET-166). Owner only. */
  | 'provider.manage'
  /** Book, move, cancel appointments; mark arrived or no-show (Sprint 4, LET-167). */
  | 'appointment.manage'
  /** Create and change treatment plans; mark planned work done (Sprint 4, LET-168). Clinical. */
  | 'plan.manage'
  /** Write and sign prescriptions (Sprint 5, LET-173). Also needs a linked doctor profile. */
  | 'rx.write'
  /** The medicine list and prescription templates (Sprint 5, LET-172). */
  | 'medicine.manage'
  /** Record stock received, used or adjusted (Sprint 6, LET-176). */
  | 'stock.manage';

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
  'provider.manage',
  'appointment.manage',
  'plan.manage',
  'rx.write',
  'medicine.manage',
  'stock.manage',
];

/** Capabilities only the owner holds in Pilot 0. */
// catalogue.manage is owner-only until per-branch prices exist: the price list is org-wide (CPO Dev-1, Slice 3 T24).
const OWNER_ONLY: readonly Capability[] = ['day.reopen', 'staff.manage', 'branch.manage', 'receipt.cancel', 'catalogue.manage', 'data.export', 'provider.manage'];
/** Clinical acts a manager does not do unless they also hold a doctor grant. */
const CLINICAL_ONLY: readonly Capability[] = ['rx.write'];
const DOCTOR: Capability[] = ['patient.register', 'patient.view', 'invoice.issue', 'receipt.record', 'visit.manage', 'recall.manage', 'appointment.manage', 'plan.manage', 'rx.write', 'medicine.manage'];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: ALL,
  branch_manager: ALL.filter((c) => !OWNER_ONLY.includes(c) && !CLINICAL_ONLY.includes(c)),
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
    'appointment.manage',
    'stock.manage',
  ],
  doctor: DOCTOR,
  associate_doctor: DOCTOR,
  assistant: ['patient.register', 'patient.view', 'visit.manage', 'stock.manage'],
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

/** Plain words for what each capability lets someone do, for the role table on Team (Sprint 5, LET-175). */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  'patient.register': 'Register patients',
  'patient.view': 'See patients and their bills',
  'patient.edit': 'Fix patient details',
  'patient.remind': 'Send WhatsApp dues reminders',
  'invoice.issue': 'Make bills',
  'invoice.void': 'Cancel any bill',
  'invoice.void_own_today': 'Cancel own bill the same day',
  'receipt.record': 'Take payments',
  'receipt.cancel': 'Cancel a payment',
  'expense.record_cash': 'Record cash paid out',
  'day.close': 'Close the day',
  'day.reopen': 'Reopen a closed day',
  'report.branch': 'See branch reports',
  'report.gst': 'See GST working papers',
  'catalogue.manage': 'Change the price list',
  'staff.manage': 'Invite staff and change roles',
  'branch.manage': 'Change branch details and bill header',
  'procedure.dismiss': 'Remove work marked as not done',
  'visit.manage': 'Run the waiting room',
  'recall.manage': 'Set next visits',
  'data.export': 'Export all data',
  'provider.manage': 'Change doctor profiles and hours',
  'appointment.manage': 'Book and change appointments',
  'plan.manage': 'Make treatment plans and mark work done',
  'rx.write': 'Sign prescriptions (needs a doctor profile)',
  'medicine.manage': 'Change medicines and templates',
  'stock.manage': 'Record stock in and out',
};

/** Every capability, in the order the role table lists them. */
export const ALL_CAPABILITIES: readonly Capability[] = ALL;
