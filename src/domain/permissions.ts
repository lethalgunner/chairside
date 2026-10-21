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
  | 'receipt.cancel';

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
];

/** Capabilities only the owner holds in Pilot 0. */
const OWNER_ONLY: readonly Capability[] = ['day.reopen', 'staff.manage', 'branch.manage', 'receipt.cancel'];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: ALL,
  branch_manager: ALL.filter((c) => !OWNER_ONLY.includes(c)),
  front_desk: [
    'patient.register',
    'patient.view',
    'invoice.issue',
    'receipt.record',
    'expense.record_cash',
    'day.close',
  ],
  doctor: ['patient.register', 'patient.view', 'invoice.issue', 'receipt.record'],
  associate_doctor: ['patient.register', 'patient.view', 'invoice.issue', 'receipt.record'],
  assistant: ['patient.register', 'patient.view'],
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
