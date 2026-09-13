/**
 * Development seed — an in-memory stand-in for the database.
 *
 * This exists so `npm run dev` works with no DATABASE_URL and no migrations,
 * which makes the UI demoable in a clinic on a laptop with no connectivity.
 * It is NOT the data layer. Every read here gets replaced by a Drizzle query
 * against `src/db/schema.ts`, and the shapes deliberately mirror that schema so
 * the swap is mechanical.
 *
 * The numbers are computed by the real domain layer, not hardcoded — so what
 * you see on screen is what the tested engine actually produces.
 */

import { computeInvoice, lineFromCategory, type ComputedInvoice, type TaxCategory } from '@/domain/tax';
import {
  allocateReceipt,
  reconcileDay,
  countFromDenominations,
  ageReceivables,
  patientBalance,
  statement,
  type LedgerEntry,
  type OutstandingInvoice,
  type PaymentMode,
} from '@/domain/ledger';
import { rupees, fromRupeeString, negate, add, type Paise, ZERO } from '@/domain/money';
import { shared } from '@/lib/store';

export const BRANCH = {
  id: 'br-kothrud',
  name: 'Kothrud',
  code: 'KOT',
  city: 'Pune',
  state: 'Maharashtra',
  gstRegistered: true,
  gstin: '27AAAAA0000A1Z5',
};

export const BRANCH_BANER = {
  id: 'br-baner',
  name: 'Baner',
  code: 'BNR',
  city: 'Pune',
  state: 'Maharashtra',
  gstRegistered: false,
  gstin: null,
};

export const BRANCHES = [BRANCH, BRANCH_BANER];

export const TAX_PROFILE = {
  gstRegistered: BRANCH.gstRegistered,
  gstin: BRANCH.gstin,
  placeOfSupplyState: BRANCH.state,
};

export interface SeedPatient {
  id: string;
  fileNumber: string;
  fullName: string;
  phone: string;
  sex: string;
  age: number;
  branchId: string;
  referralSource: string;
  lastVisit: string;
}

const SEED_PATIENTS: SeedPatient[] = [
  { id: 'p1', fileNumber: 'KOT-0412', fullName: 'Meera Kulkarni', phone: '98220 41155', sex: 'F', age: 34, branchId: 'br-kothrud', referralSource: 'Patient referral', lastVisit: '2026-09-13' },
  { id: 'p2', fileNumber: 'KOT-0413', fullName: 'Rohan Deshpande', phone: '99700 28841', sex: 'M', age: 41, branchId: 'br-kothrud', referralSource: 'Google', lastVisit: '2026-09-13' },
  { id: 'p3', fileNumber: 'KOT-0398', fullName: 'Aisha Sheikh', phone: '90280 77310', sex: 'F', age: 27, branchId: 'br-kothrud', referralSource: 'Dr. Bhide (referral)', lastVisit: '2026-09-12' },
  { id: 'p4', fileNumber: 'KOT-0301', fullName: 'Vikram Rane', phone: '98501 20934', sex: 'M', age: 52, branchId: 'br-kothrud', referralSource: 'Walk-in', lastVisit: '2026-07-02' },
  { id: 'p5', fileNumber: 'KOT-0355', fullName: 'Sunita Joshi', phone: '97640 33218', sex: 'F', age: 61, branchId: 'br-kothrud', referralSource: 'Patient referral', lastVisit: '2026-06-18' },
  { id: 'p6', fileNumber: 'BNR-0106', fullName: 'Farhan Qureshi', phone: '96570 11902', sex: 'M', age: 29, branchId: 'br-baner', referralSource: 'Instagram', lastVisit: '2026-09-13' },
];

/** Shared across every server chunk — see src/lib/store.ts for why. */
export const PATIENTS: SeedPatient[] = shared('patients', SEED_PATIENTS);

export interface SeedInvoice {
  id: string;
  number: string;
  patientId: string;
  branchId: string;
  issuedOn: string;
  doctor: string;
  computed: ComputedInvoice;
  allocatedPaise: Paise;
}

function makeInvoice(
  id: string,
  number: string,
  patientId: string,
  branchId: string,
  issuedOn: string,
  doctor: string,
  lines: { desc: string; price: string; cat: TaxCategory; qty?: number; discount?: string }[],
  allocated: Paise = ZERO,
): SeedInvoice {
  const branch = BRANCHES.find((b) => b.id === branchId)!;
  const profile = {
    gstRegistered: branch.gstRegistered,
    gstin: branch.gstin,
    placeOfSupplyState: branch.state,
  };
  const computed = computeInvoice(
    lines.map((l) => ({
      ...lineFromCategory(l.desc, fromRupeeString(l.price), l.cat, { quantity: l.qty ?? 1 }),
      discountPaise: l.discount ? fromRupeeString(l.discount) : ZERO,
      discountReason: l.discount ? 'Long-standing patient' : undefined,
    })),
    profile,
    branch.state,
  );
  return { id, number, patientId, branchId, issuedOn, doctor, computed, allocatedPaise: allocated };
}

const SEED_INVOICES: SeedInvoice[] = [
  makeInvoice('i1', 'KOT/2026-27/00412', 'p1', 'br-kothrud', '2026-09-13', 'Dr. Anshul Vij', [
    { desc: 'Root canal treatment, tooth 26', price: '6000.00', cat: 'exempt_healthcare' },
    { desc: 'Zirconia crown, tooth 26', price: '12000.00', cat: 'goods_prosthetic' },
    { desc: 'Interdental brush pack', price: '250.00', cat: 'goods_retail' },
  ], rupees(19735)),

  makeInvoice('i2', 'KOT/2026-27/00413', 'p2', 'br-kothrud', '2026-09-13', 'Dr. Meera Rao', [
    { desc: 'Implant fixture, tooth 46', price: '30000.00', cat: 'goods_prosthetic' },
    { desc: 'Surgical placement', price: '8000.00', cat: 'exempt_healthcare' },
  ], rupees(20000)),

  makeInvoice('i3', 'KOT/2026-27/00409', 'p3', 'br-kothrud', '2026-09-12', 'Dr. Anshul Vij', [
    { desc: 'Scaling and polishing', price: '2500.00', cat: 'exempt_healthcare' },
    { desc: 'Teeth whitening, in-office', price: '9000.00', cat: 'cosmetic_service' },
  ], rupees(5000)),

  makeInvoice('i4', 'KOT/2026-27/00351', 'p4', 'br-kothrud', '2026-07-02', 'Dr. Meera Rao', [
    { desc: 'Composite filling, 36 (MOD)', price: '3500.00', cat: 'exempt_healthcare' },
  ], ZERO),

  makeInvoice('i5', 'KOT/2026-27/00298', 'p5', 'br-kothrud', '2026-06-18', 'Dr. Anshul Vij', [
    { desc: 'Complete denture, upper', price: '28000.00', cat: 'goods_prosthetic', discount: '3000.00' },
  ], rupees(15000)),

  makeInvoice('i6', 'BNR/2026-27/00106', 'p6', 'br-baner', '2026-09-13', 'Dr. Kunal Shah', [
    { desc: 'Root canal treatment, tooth 16', price: '6000.00', cat: 'exempt_healthcare' },
    { desc: 'Zirconia crown, tooth 16', price: '12000.00', cat: 'goods_prosthetic' },
  ], rupees(18000)),
];

export const INVOICES: SeedInvoice[] = shared('invoices', SEED_INVOICES);

export interface SeedReceipt {
  id: string;
  number: string;
  patientId: string;
  branchId: string;
  receivedOn: string;
  mode: PaymentMode;
  reference?: string;
  amountPaise: Paise;
}

const SEED_RECEIPTS: SeedReceipt[] = [
  { id: 'r1', number: 'KOT/R/00871', patientId: 'p1', branchId: 'br-kothrud', receivedOn: '2026-09-13', mode: 'cash', amountPaise: rupees(10000) },
  { id: 'r2', number: 'KOT/R/00872', patientId: 'p1', branchId: 'br-kothrud', receivedOn: '2026-09-13', mode: 'upi', reference: 'meera@okhdfc', amountPaise: rupees(9735) },
  { id: 'r3', number: 'KOT/R/00873', patientId: 'p2', branchId: 'br-kothrud', receivedOn: '2026-09-13', mode: 'card', reference: 'PineLabs 4417', amountPaise: rupees(20000) },
  { id: 'r4', number: 'KOT/R/00874', patientId: 'p3', branchId: 'br-kothrud', receivedOn: '2026-09-13', mode: 'upi', reference: 'aisha.s@ybl', amountPaise: rupees(5000) },
  { id: 'r5', number: 'KOT/R/00875', patientId: 'p5', branchId: 'br-kothrud', receivedOn: '2026-09-13', mode: 'cash', amountPaise: rupees(3000) },
];

export const RECEIPTS: SeedReceipt[] = shared('receipts', SEED_RECEIPTS);

export const TODAY = '2026-09-13';

// ---------------------------------------------------------------------------
// Derived views — all computed by the real domain layer
// ---------------------------------------------------------------------------

export function patientById(id: string) {
  return PATIENTS.find((p) => p.id === id);
}

export function invoiceById(id: string) {
  return INVOICES.find((i) => i.id === id);
}

export function branchById(id: string) {
  return BRANCHES.find((b) => b.id === id);
}

export function invoicesForPatient(patientId: string) {
  return INVOICES.filter((i) => i.patientId === patientId);
}

export function receiptsForPatient(patientId: string) {
  return RECEIPTS.filter((r) => r.patientId === patientId);
}

export function outstandingFor(patientId: string): OutstandingInvoice[] {
  return invoicesForPatient(patientId).map((i) => ({
    invoiceId: i.id,
    issuedOn: i.issuedOn,
    totalPaise: i.computed.totalPaise,
    allocatedPaise: i.allocatedPaise,
  }));
}

export function ledgerFor(patientId: string): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (const inv of invoicesForPatient(patientId)) {
    entries.push({
      entryType: 'invoice',
      amountPaise: inv.computed.totalPaise,
      occurredOn: inv.issuedOn,
      invoiceId: inv.id,
      narration: inv.number,
    });
  }
  for (const rec of receiptsForPatient(patientId)) {
    entries.push({
      entryType: 'receipt',
      amountPaise: negate(rec.amountPaise),
      occurredOn: rec.receivedOn,
      receiptId: rec.id,
      narration: `${rec.number} · ${rec.mode.replace('_', ' ')}${rec.reference ? ` · ${rec.reference}` : ''}`,
    });
  }
  return entries;
}

export function balanceFor(patientId: string): Paise {
  return patientBalance(ledgerFor(patientId));
}

export function statementFor(patientId: string) {
  return statement(ledgerFor(patientId));
}

/** Every open invoice across the whole organisation, for the ageing report. */
export function allOutstanding(branchId?: string): OutstandingInvoice[] {
  return INVOICES.filter((i) => !branchId || i.branchId === branchId).map((i) => ({
    invoiceId: i.id,
    issuedOn: i.issuedOn,
    totalPaise: i.computed.totalPaise,
    allocatedPaise: i.allocatedPaise,
  }));
}

export function ageing(branchId?: string) {
  return ageReceivables(allOutstanding(branchId), TODAY);
}

export function todaysReceipts(branchId = BRANCH.id) {
  return RECEIPTS.filter((r) => r.branchId === branchId && r.receivedOn === TODAY);
}

/** The physical count at the Kothrud drawer this evening. */
export const DRAWER_COUNT = { '500': 22, '200': 4, '100': 6, '50': 1, '20': 2, '10': 5 };

export const OPENING_FLOAT = rupees(2000);
export const CASH_EXPENSES = fromRupeeString('350.00');

export function dayClose(branchId = BRANCH.id) {
  return reconcileDay({
    receipts: todaysReceipts(branchId).map((r) => ({ mode: r.mode, amountPaise: r.amountPaise })),
    openingFloatPaise: OPENING_FLOAT,
    cashExpensesPaise: CASH_EXPENSES,
    countedCashPaise: countFromDenominations(DRAWER_COUNT),
  });
}

export function billedToday(branchId = BRANCH.id): Paise {
  return add(
    ...INVOICES.filter((i) => i.branchId === branchId && i.issuedOn === TODAY).map(
      (i) => i.computed.totalPaise,
    ),
  );
}

export function collectedToday(branchId = BRANCH.id): Paise {
  return add(...todaysReceipts(branchId).map((r) => r.amountPaise));
}

/**
 * Procedures completed today with no invoice line against them. The leakage
 * control that pays for the subscription — and the only deliberately "wrong"
 * row in this seed, so the exception report has something to show.
 */
export const UNBILLED_TODAY = [
  {
    id: 'u1',
    patientName: 'Rohan Deshpande',
    fileNumber: 'KOT-0413',
    procedure: 'Bone graft, site 46',
    doctor: 'Dr. Meera Rao',
    pricePaise: rupees(7500),
    completedAt: '2026-09-13 11:40',
  },
  {
    id: 'u2',
    patientName: 'Aisha Sheikh',
    fileNumber: 'KOT-0398',
    procedure: 'Fluoride application',
    doctor: 'Dr. Anshul Vij',
    pricePaise: rupees(800),
    completedAt: '2026-09-12 17:05',
  },
];

export function unbilledValue(): Paise {
  return add(...UNBILLED_TODAY.map((u) => u.pricePaise));
}

export function allocationPreview(patientId: string, amount: Paise) {
  return allocateReceipt(amount, outstandingFor(patientId).filter((o) => o.totalPaise > o.allocatedPaise));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Registration mutates this module's in-memory arrays, which persist for the
 * life of the dev server process and reset on restart. That is fine for a demo
 * and wrong for anything else — it does not survive a restart and would not
 * work across serverless instances. Replaced by an INSERT against
 * `patientRegistrations` when the data layer lands.
 */

export const REFERRAL_SOURCES = [
  'Walk-in',
  'Patient referral',
  'Doctor referral',
  'Google',
  'Instagram',
  'Practo',
  'Returning patient',
] as const;

export interface NewPatientInput {
  fullName: string;
  phone: string;
  sex: string;
  age: number;
  branchId: string;
  referralSource: string;
  referralDetail?: string;
}

/**
 * Next file number for a branch. In the real system this locks a counter row
 * (see `invoiceSeries` in the schema) so numbering stays gapless; here it just
 * reads the highest existing number.
 */
function nextFileNumber(branchId: string): string {
  const branch = branchById(branchId);
  const prefix = branch?.code ?? 'GEN';
  const existing = PATIENTS.filter((p) => p.fileNumber.startsWith(`${prefix}-`)).map((p) =>
    Number(p.fileNumber.split('-')[1] ?? 0),
  );
  const next = (existing.length ? Math.max(...existing) : 0) + 1;
  return `${prefix}-${String(next).padStart(4, '0')}`;
}

/**
 * Possible duplicates, checked before a new record is created.
 *
 * A patient registered twice is two ledgers, two histories and an owner who
 * stops trusting the numbers — so this runs on every registration, not as an
 * occasional cleanup. Matching is on mobile first (the primary handle), then on
 * a loose name match.
 */
export function findPossibleDuplicates(phone: string, fullName: string): SeedPatient[] {
  const digits = phone.replace(/\D/g, '');
  const name = fullName.trim().toLowerCase();
  if (digits.length < 4 && name.length < 3) return [];

  return PATIENTS.filter((p) => {
    const pDigits = p.phone.replace(/\D/g, '');
    if (digits.length >= 6 && pDigits.endsWith(digits.slice(-6))) return true;
    if (name.length >= 3) {
      const pName = p.fullName.toLowerCase();
      if (pName.includes(name) || name.includes(pName)) return true;
    }
    return false;
  });
}

export function addPatient(input: NewPatientInput): SeedPatient {
  const id = `p${PATIENTS.length + 1}-${Date.now().toString(36)}`;
  const patient: SeedPatient = {
    id,
    fileNumber: nextFileNumber(input.branchId),
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    sex: input.sex,
    age: input.age,
    branchId: input.branchId,
    referralSource: input.referralDetail
      ? `${input.referralSource} — ${input.referralDetail}`
      : input.referralSource,
    lastVisit: TODAY,
  };
  PATIENTS.push(patient);
  return patient;
}
