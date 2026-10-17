/**
 * Chairside schema.
 *
 * Read this file before changing anything in it. Four decisions here are
 * effectively permanent, and the BRD is explicit that retrofitting them is a
 * rewrite rather than a refactor:
 *
 *  1. Every row carries `orgId`, and everything operational also carries
 *     `branchId`. A single-clinic practice simply has one branch. We do not
 *     add branch-awareness later.
 *  2. `patients` is org-level. A patient seen at two branches is ONE patient
 *     with two registrations, not two records.
 *  3. Invoice numbering is per branch, per financial year, gapless.
 *  4. Financial history is append-only. A correction is a new document, never
 *     an edit. Nothing in this schema is designed to be UPDATEd once posted.
 *
 * Money is always `bigint` paise (see domain/money.ts). Never numeric, never
 * float, never rupees.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  date,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const roleEnum = pgEnum('role', [
  'owner',
  'branch_manager',
  'front_desk',
  'doctor',
  'associate_doctor',
  'assistant',
  'accountant',
  'auditor',
]);

/**
 * How a catalogue item is treated for GST.
 *
 * Dental treatment by a registered practitioner is an exempt healthcare
 * service under SAC 9993. The exemption attaches to the SERVICE, not to goods,
 * which is where most clinic software gets it wrong: the implant fixture, the
 * lab-made crown and the toothbrush at reception are all goods and all
 * taxable, and a purely cosmetic procedure generally falls outside the
 * exemption too.
 *
 * NOTE: the category drives sensible defaults, but the actual rate is stored
 * explicitly on the item AND snapshotted onto the invoice line, so that a rate
 * change tomorrow never rewrites what was charged yesterday.
 */
export const taxCategoryEnum = pgEnum('tax_category', [
  'exempt_healthcare', // SAC 9993 — consultation, RCT, extraction, scaling, ortho
  'goods_prosthetic', // HSN 9021 — implant components, crowns, bridges, dentures
  'goods_retail', // HSN 3306 — toothpaste, brushes, mouthwash sold at reception
  'cosmetic_service', // aesthetic-only treatment, outside the healthcare exemption
  'other_taxable', // escape hatch; rate must be set explicitly
]);

export const appointmentStatusEnum = pgEnum('appointment_status', [
  'booked',
  'confirmed',
  'arrived',
  'in_chair',
  'completed',
  'no_show',
  'cancelled',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'issued', 'void']);

export const paymentModeEnum = pgEnum('payment_mode', [
  'cash',
  'upi',
  'card',
  'bank_transfer',
  'cheque',
  'financing',
]);

/**
 * Ledger entry types. The patient ledger is a running balance built from these
 * and nothing else — never from a cached total on the patient row.
 */
export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', [
  'invoice', // debit: patient owes us
  'receipt', // credit: patient paid us
  'advance', // credit: paid before delivery, held as unearned revenue
  'advance_drawdown', // debit: unearned revenue recognised as a procedure is delivered
  'credit_note', // credit: we reduced what they owe
  'refund', // debit: we gave money back
  'write_off', // credit: we gave up on collecting
]);

export const dayBookStatusEnum = pgEnum('day_book_status', [
  'open',
  'reconciling',
  'closed',
  'reopened',
]);

/** Numbered document series (ADR-010). Each has its own gapless counter per branch per FY. */
export const documentTypeEnum = pgEnum('document_type', ['sale', 'receipt', 'credit_note']);

export const payoutBasisEnum = pgEnum('payout_basis', [
  'percent_of_collection',
  'percent_of_billing',
  'flat_per_session',
  'flat_per_day',
  'per_procedure',
]);

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Financial year start month, 4 = April, as Indian practice requires. */
  fyStartMonth: integer('fy_start_month').notNull().default(4),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    /** Short code used in invoice numbers, e.g. 'KOT' -> KOT/2026-27/00042. */
    code: text('code').notNull(),
    addressLine: text('address_line'),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    phone: text('phone'),

    /**
     * Tax profile. A chain can legitimately have registered and unregistered
     * branches at once: healthcare services are exempt, so a branch whose
     * TAXABLE turnover is under the threshold need not register. When
     * gstRegistered is false, no tax is charged on anything, whatever the
     * catalogue item says.
     */
    gstRegistered: boolean('gst_registered').notNull().default(false),
    gstin: text('gstin'),

    /** Reserved for ABDM. Each facility gets its own HIP ID — see BRD 10.2. */
    abdmHipId: text('abdm_hip_id'),

    // Day close: a cash variance above this, either way, needs a written reason.
    dayCloseTolerancePaise: bigint('day_close_tolerance_paise', { mode: 'number' })
      .notNull()
      .default(10_000),
    // Cash left in the drawer at the start of each day.
    defaultFloatPaise: bigint('default_float_paise', { mode: 'number' }).notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCodeUnique: uniqueIndex('branches_org_code_unique').on(t.orgId, t.code),
    orgIdx: index('branches_org_idx').on(t.orgId),
  }),
);

/** A chair. The scarce resource in a dental practice, and the unit of profitability. */
export const operatories = pgTable(
  'operatories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({ branchIdx: index('operatories_branch_idx').on(t.branchId) }),
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    /**
     * Identity is held by the auth provider; this is our own reference to it.
     * Kept behind our own interface deliberately so the provider stays swappable.
     */
    authSubject: text('auth_subject').unique(),
    // Pilot 0 only (ADR-012): scrypt hash. Null means the user cannot sign in
    // (e.g. a doctor recorded for attribution who has no login yet).
    passwordHash: text('password_hash'),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    /** Dental council registration, required on a valid prescription. */
    registrationNumber: text('registration_number'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('users_org_idx').on(t.orgId),
    // Sign-in identity. Stored lower-cased; Postgres allows many NULLs.
    emailUnique: uniqueIndex('users_email_unique').on(t.email),
  }),
);

/**
 * Role grants, per branch. A null branchId means the role applies across the
 * whole organisation — that is how an owner sees every branch while an
 * associate sees only the one they work at.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    branchId: uuid('branch_id').references(() => branches.id),
    role: roleEnum('role').notNull(),
  },
  (t) => ({
    userIdx: index('memberships_user_idx').on(t.userId),
    grantUnique: uniqueIndex('memberships_grant_unique').on(t.userId, t.branchId, t.role),
  }),
);

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

/** Org-level master identity. One human, one row, however many branches they visit. */
export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    sex: text('sex'),
    dateOfBirth: date('date_of_birth'),
    /** Used when the patient knows their age but not their date of birth. */
    approximateAge: integer('approximate_age'),
    // The date the approximate age was given, so it can be aged forward.
    ageRecordedOn: date('age_recorded_on'),

    /** ABHA is an attribute, never the primary key — see BRD section 11. */
    abhaNumber: text('abha_number'),

    /** Where this patient came from, captured at registration. Feeds attribution. */
    referralSource: text('referral_source'),
    referralDetail: text('referral_detail'),

    /** Household grouping, so one payer can settle for dependants. */
    householdId: uuid('household_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    mergedIntoId: uuid('merged_into_id'),
  },
  (t) => ({
    orgPhoneIdx: index('patients_org_phone_idx').on(t.orgId, t.phone),
    orgNameIdx: index('patients_org_name_idx').on(t.orgId, t.fullName),
  }),
);

/** A patient's registration at a particular branch, with that branch's own file number. */
export const patientRegistrations = pgTable(
  'patient_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    fileNumber: text('file_number').notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    branchPatientUnique: uniqueIndex('patient_reg_branch_patient_unique').on(t.branchId, t.patientId),
    branchFileUnique: uniqueIndex('patient_reg_branch_file_unique').on(t.branchId, t.fileNumber),
  }),
);

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/**
 * Everything the practice can charge for. Adding a specialty is a data import
 * into this table, not a release — see BRD principle A2.
 */
export const catalogueItems = pgTable(
  'catalogue_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Which specialty pack owns this item. 'core' for anything universal. */
    pack: text('pack').notNull().default('core'),
    category: text('category'),

    /** Default chair time, drives scheduling. */
    defaultDurationMinutes: integer('default_duration_minutes').notNull().default(30),

    /** Default price in paise. Branch and doctor overrides live in priceListEntries. */
    defaultPricePaise: bigint('default_price_paise', { mode: 'number' }).notNull(),

    taxCategory: taxCategoryEnum('tax_category').notNull(),
    /** SAC for services, HSN for goods. Printed on the invoice line. */
    hsnSacCode: text('hsn_sac_code').notNull(),
    /** Explicit rate in basis points. 0 for exempt, 1200 for 12%, 1800 for 18%. */
    gstRateBp: integer('gst_rate_bp').notNull().default(0),

    /** Is this a good rather than a service? Drives inventory and ITC treatment. */
    isGoods: boolean('is_goods').notNull().default(false),

    active: boolean('active').notNull().default(true),
  },
  (t) => ({ orgCodeUnique: uniqueIndex('catalogue_org_code_unique').on(t.orgId, t.code) }),
);

export const priceListEntries = pgTable(
  'price_list_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    catalogueItemId: uuid('catalogue_item_id')
      .notNull()
      .references(() => catalogueItems.id),
    /** Null means it applies org-wide. */
    branchId: uuid('branch_id').references(() => branches.id),
    /** Null means it applies to every doctor at that branch. */
    doctorId: uuid('doctor_id').references(() => users.id),
    pricePaise: bigint('price_paise', { mode: 'number' }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
  },
  (t) => ({ itemIdx: index('price_list_item_idx').on(t.catalogueItemId) }),
);

// ---------------------------------------------------------------------------
// Scheduling and clinical
// ---------------------------------------------------------------------------

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => users.id),
    operatoryId: uuid('operatory_id').references(() => operatories.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: appointmentStatusEnum('status').notNull().default('booked'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    branchDayIdx: index('appointments_branch_day_idx').on(t.branchId, t.startsAt),
    doctorDayIdx: index('appointments_doctor_day_idx').on(t.doctorId, t.startsAt),
  }),
);

/** One visit. The join between the clinical and financial halves of the system. */
export const encounters = pgTable(
  'encounters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => users.id),
    operatoryId: uuid('operatory_id').references(() => operatories.id),
    appointmentId: uuid('appointment_id').references(() => appointments.id),
    occurredOn: date('occurred_on').notNull(),
    chiefComplaint: text('chief_complaint'),
    notes: text('notes'),

    /**
     * Reserved for ABDM. Diagnoses must be capturable against a coded
     * vocabulary (ICD-10) rather than free text — retrofitting codes across a
     * live patient database is the most commonly reported ABDM failure, so the
     * column exists from the first migration even though Phase 0 leaves it null.
     */
    diagnosisCodes: jsonb('diagnosis_codes').$type<string[]>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ patientIdx: index('encounters_patient_idx').on(t.patientId, t.occurredOn) }),
);

/**
 * The atom of the whole system: one catalogue item, performed on one patient,
 * by one doctor. Billing, payouts, inventory consumption and clinical history
 * all read from here.
 */
export const proceduresPerformed = pgTable(
  'procedures_performed',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => users.id),
    catalogueItemId: uuid('catalogue_item_id')
      .notNull()
      .references(() => catalogueItems.id),
    quantity: integer('quantity').notNull().default(1),
    /** Agreed price at the time, before discount. Snapshotted, not looked up later. */
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),

    /** Reserved for the Phase 1 dental pack: FDI tooth number and surfaces. */
    toothNumber: text('tooth_number'),
    surfaces: jsonb('surfaces').$type<string[]>(),

    performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set once billed. The unbilled-procedure exception report reads this. */
    invoiceLineId: uuid('invoice_line_id'),
  },
  (t) => ({
    encounterIdx: index('procedures_encounter_idx').on(t.encounterId),
    unbilledIdx: index('procedures_unbilled_idx').on(t.branchId, t.invoiceLineId),
  }),
);

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Gapless invoice numbering, per branch per financial year. The counter row is
 * locked when a number is issued, which is why this is a table and not a
 * sequence — sequences leak numbers on rollback, and a gap in an invoice series
 * is a question from an auditor.
 */
export const invoiceSeries = pgTable(
  'invoice_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    /** e.g. '2026-27' */
    financialYear: text('financial_year').notNull(),
    documentType: documentTypeEnum('document_type').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (t) => ({
    seriesUnique: uniqueIndex('invoice_series_unique').on(
      t.branchId,
      t.financialYear,
      t.documentType,
    ),
  }),
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    /** Full human-readable number, e.g. 'KOT/2026-27/00042'. */
    number: text('number').notNull(),
    financialYear: text('financial_year').notNull(),
    issuedOn: date('issued_on').notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),

    /** Snapshot of whether the branch was GST-registered when this was issued. */
    gstRegistered: boolean('gst_registered').notNull(),
    gstin: text('gstin'),

    subtotalPaise: bigint('subtotal_paise', { mode: 'number' }).notNull(),
    discountPaise: bigint('discount_paise', { mode: 'number' }).notNull().default(0),
    taxablePaise: bigint('taxable_paise', { mode: 'number' }).notNull(),
    exemptPaise: bigint('exempt_paise', { mode: 'number' }).notNull(),
    cgstPaise: bigint('cgst_paise', { mode: 'number' }).notNull().default(0),
    sgstPaise: bigint('sgst_paise', { mode: 'number' }).notNull().default(0),
    igstPaise: bigint('igst_paise', { mode: 'number' }).notNull().default(0),
    roundingPaise: bigint('rounding_paise', { mode: 'number' }).notNull().default(0),
    totalPaise: bigint('total_paise', { mode: 'number' }).notNull(),

    doctorId: uuid('doctor_id').references(() => users.id),
    // Client-generated per submission so a double click issues one invoice.
    idempotencyKey: text('idempotency_key').notNull(),

    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    voidedByInvoiceId: uuid('voided_by_invoice_id'),
    // Voiding is a status transition; amounts are never changed (ADR-012).
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id),
    voidReason: text('void_reason'),
  },
  (t) => ({
    numberUnique: uniqueIndex('invoices_number_unique').on(t.branchId, t.number),
    idempotencyUnique: uniqueIndex('invoices_idempotency_unique').on(t.orgId, t.idempotencyKey),
    patientIdx: index('invoices_patient_idx').on(t.patientId),
    branchDateIdx: index('invoices_branch_date_idx').on(t.branchId, t.issuedOn),
  }),
);

/**
 * The line is where tax actually lives. An invoice mixing an exempt root canal
 * with a taxable crown carries both on the same document, each with its own
 * code, rate and amount — which is the thing most clinic software gets wrong
 * and the thing that wins over the practice's accountant.
 *
 * Every tax field here is a SNAPSHOT taken at issue time. Changing a catalogue
 * item's rate tomorrow must never alter what an issued invoice says.
 */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    lineNumber: integer('line_number').notNull(),

    catalogueItemId: uuid('catalogue_item_id').references(() => catalogueItems.id),
    procedureId: uuid('procedure_id').references(() => proceduresPerformed.id),

    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),
    discountPaise: bigint('discount_paise', { mode: 'number' }).notNull().default(0),
    discountReason: text('discount_reason'),

    taxCategory: taxCategoryEnum('tax_category').notNull(),
    hsnSacCode: text('hsn_sac_code').notNull(),
    gstRateBp: integer('gst_rate_bp').notNull(),

    taxableValuePaise: bigint('taxable_value_paise', { mode: 'number' }).notNull(),
    cgstPaise: bigint('cgst_paise', { mode: 'number' }).notNull().default(0),
    sgstPaise: bigint('sgst_paise', { mode: 'number' }).notNull().default(0),
    igstPaise: bigint('igst_paise', { mode: 'number' }).notNull().default(0),
    lineTotalPaise: bigint('line_total_paise', { mode: 'number' }).notNull(),
  },
  (t) => ({ invoiceIdx: index('invoice_lines_invoice_idx').on(t.invoiceId) }),
);

export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    number: text('number').notNull(),
    receivedOn: date('received_on').notNull(),
    mode: paymentModeEnum('mode').notNull(),
    /** UPI VPA, card terminal id, cheque number — whatever identifies the payment. */
    reference: text('reference'),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    /** Amount not yet applied to any invoice, i.e. sitting as an advance. */
    // Unallocated (advance) amount is derived: amountPaise minus its allocations (ADR-005).
    idempotencyKey: text('idempotency_key').notNull(),
    dayBookId: uuid('day_book_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    numberUnique: uniqueIndex('receipts_number_unique').on(t.branchId, t.number),
    idempotencyUnique: uniqueIndex('receipts_idempotency_unique').on(t.orgId, t.idempotencyKey),
    branchDateIdx: index('receipts_branch_date_idx').on(t.branchId, t.receivedOn),
    patientIdx: index('receipts_patient_idx').on(t.patientId),
  }),
);

export const receiptAllocations = pgTable(
  'receipt_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => receipts.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    receiptIdx: index('receipt_alloc_receipt_idx').on(t.receiptId),
    invoiceIdx: index('receipt_alloc_invoice_idx').on(t.invoiceId),
  }),
);

/**
 * The patient ledger. Append-only, and the single source of truth for what a
 * patient owes. Never cache a balance on the patient row — derive it from here,
 * every time. A balance you cannot reconstruct from its entries is a balance
 * nobody will trust.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    entryType: ledgerEntryTypeEnum('entry_type').notNull(),
    /** Positive increases what the patient owes; negative reduces it. */
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    occurredOn: date('occurred_on').notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    receiptId: uuid('receipt_id').references(() => receipts.id),
    narration: text('narration'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    patientIdx: index('ledger_patient_idx').on(t.patientId, t.occurredOn),
    branchIdx: index('ledger_branch_idx').on(t.branchId, t.occurredOn),
  }),
);

/**
 * One per branch per day. The object the whole Phase 0 pitch is built around:
 * a day that actually closes, with a variance someone had to explain.
 */
export const dayBooks = pgTable(
  'day_books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    businessDate: date('business_date').notNull(),
    status: dayBookStatusEnum('status').notNull().default('open'),

    expectedCashPaise: bigint('expected_cash_paise', { mode: 'number' }),
    countedCashPaise: bigint('counted_cash_paise', { mode: 'number' }),
    variancePaise: bigint('variance_paise', { mode: 'number' }),
    varianceReason: text('variance_reason'),
    denominationCount: jsonb('denomination_count').$type<Record<string, number>>(),

    openingFloatPaise: bigint('opening_float_paise', { mode: 'number' }).notNull().default(0),

    // Pilot 0 tally against the incumbent system, typed in by the desk at close.
    legacyBillCount: integer('legacy_bill_count'),
    legacyCollectedPaise: bigint('legacy_collected_paise', { mode: 'number' }),

    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    reopenedBy: uuid('reopened_by').references(() => users.id),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    reopenReason: text('reopen_reason'),
  },
  (t) => ({
    branchDateUnique: uniqueIndex('day_books_branch_date_unique').on(t.branchId, t.businessDate),
  }),
);

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    category: text('category').notNull(),
    vendorName: text('vendor_name'),
    description: text('description'),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    gstPaise: bigint('gst_paise', { mode: 'number' }).notNull().default(0),
    incurredOn: date('incurred_on').notNull(),
    paidOn: date('paid_on'),
    // True when the money came out of the front-desk drawer; feeds expected cash at close.
    paidFromDrawer: boolean('paid_from_drawer').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ branchDateIdx: index('expenses_branch_date_idx').on(t.branchId, t.incurredOn) }),
);

/**
 * Payout rules are versioned by effective date, and a payout RUN is an
 * immutable snapshot of what the rule produced. A rule edited in March must
 * never silently restate January's statements.
 */
export const payoutRules = pgTable(
  'payout_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id').references(() => branches.id),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => users.id),
    basis: payoutBasisEnum('basis').notNull(),
    /** Rate in basis points for percentage bases; paise for flat bases. */
    rateBp: integer('rate_bp'),
    flatAmountPaise: bigint('flat_amount_paise', { mode: 'number' }),
    netOfLabCost: boolean('net_of_lab_cost').notNull().default(false),
    netOfConsumables: boolean('net_of_consumables').notNull().default(false),
    netOfDiscount: boolean('net_of_discount').notNull().default(true),
    minimumGuaranteePaise: bigint('minimum_guarantee_paise', { mode: 'number' }),
    /** Optional restriction to a procedure category. Null means all. */
    appliesToCategory: text('applies_to_category'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
  },
  (t) => ({ doctorIdx: index('payout_rules_doctor_idx').on(t.doctorId, t.effectiveFrom) }),
);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Append-only. Every financial and clinical write lands here. Never deleted. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    branchId: uuid('branch_id'),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index('audit_entity_idx').on(t.entityType, t.entityId),
    orgTimeIdx: index('audit_org_time_idx').on(t.orgId, t.occurredAt),
  }),
);


// ---------------------------------------------------------------------------
// Pilot 0 authentication (ADR-012). Replaced by ADR-011 emailed codes in Phase 1.
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  'sessions',
  {
    // 256-bit random token, base64url. Unguessable and never exposed beyond the
    // httpOnly cookie. A new one is issued on every sign-in.
    id: text('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({ userIdx: index('sessions_user_idx').on(t.userId) }),
);

export const loginFailures = pgTable(
  'login_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ emailIdx: index('login_failures_email_idx').on(t.email, t.occurredAt) }),
);

/**
 * One-time links that let an invited person set their own password (Pilot 0).
 * Only the SHA-256 of the token is stored; the link itself is shown once.
 */
export const passwordSetupTokens = pgTable(
  'password_setup_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tokenUnique: uniqueIndex('password_setup_token_unique').on(t.tokenHash) }),
);
