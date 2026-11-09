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
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
  'receipt_cancel', // debit: a payment recorded by mistake was cancelled (Slice 3, T19)
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
  /**
   * Running alongside the old software (Pilot 0, Sprint 7 switch). On: day close
   * asks for the old system's figures, the dashboard compares them, the pilot
   * scorecard shows, and dues reminders ask "I checked ₹X in our old software".
   * Existing clinics start on (no change); a clinic that signs up starts off.
   */
  parallelRun: boolean('parallel_run').notNull().default(true),
  /** Reminders (Sprint 8): no patient messages planned in these hours (IST); due ones wait for the end. */
  messagesQuietStart: text('messages_quiet_start').notNull().default('21:00'),
  messagesQuietEnd: text('messages_quiet_end').notNull().default('08:00'),
  /** Off by default: the doctor's name may appear in patient messages only if the owner allows it (ADR-020). */
  messagesDoctorName: boolean('messages_doctor_name').notNull().default(false),
  /** Come-back gaps in days that pre-fill the date (Sprint 8). Defaults are the old hard-coded ones. */
  recallCheckupDays: integer('recall_checkup_days').notNull().default(182),
  recallCleaningDays: integer('recall_cleaning_days').notNull().default(182),
  recallContinueDays: integer('recall_continue_days').notNull().default(7),
  recallReviewDays: integer('recall_review_days').notNull().default(30),
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

    /**
     * UPI scan-to-pay (Sprint 2, T31). The branch's UPI ID and the payee name
     * patients see. Both null = no QR. Validated by `checkUpi`.
     */
    upiId: text('upi_id'),
    upiPayee: text('upi_payee'),
    /**
     * The printed header on bills, estimates and prescriptions (Sprint 5,
     * LET-174). Owner only. Null falls back to the branch name and address.
     * The logo is a small PNG/JPEG data URL (≤200 KB) kept in Postgres so
     * there is no file storage to secure yet.
     */
    printName: text('print_name'),
    printAddress: text('print_address'),
    printEmail: text('print_email'),
    printFooter: text('print_footer'),
    printLogo: text('print_logo'),

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

/**
 * A clinician the practice bills and pays for (ADR-008, built in Sprint 4,
 * LET-166). Separate from a login: a visiting doctor may have no user, and a
 * manager with a login is not a provider. Clinical and money tables point
 * their doctor_id here, not at users.
 */
export const providers = pgTable(
  'providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id').references(() => users.id),
    fullName: text('full_name').notNull(),
    qualification: text('qualification'),
    /** Council registration, printed on prescriptions (unverified rule, counsel to confirm). */
    registrationNumber: text('registration_number'),
    registrationCouncil: text('registration_council'),
    specialty: text('specialty'),
    engagementType: text('engagement_type').notNull().default('salaried'),
    colour: text('colour'),
    slotMinutes: integer('slot_minutes').notNull().default(15),
    /** Hash of the private calendar-feed token (LET-170). Never the token itself. */
    calendarTokenHash: text('calendar_token_hash'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    engagementCheck: check('providers_engagement_check', sql`${t.engagementType} in ('owner_partner', 'salaried', 'associate', 'visiting')`),
    slotCheck: check('providers_slot_check', sql`${t.slotMinutes} in (10, 15, 20, 30)`),
    colourCheck: check('providers_colour_check', sql`${t.colour} is null or ${t.colour} ~ '^#[0-9a-f]{6}$'`),
    userUnique: uniqueIndex('providers_user_unique').on(t.userId),
    orgIdx: index('providers_org_idx').on(t.orgId),
    tokenUnique: uniqueIndex('providers_calendar_token_unique').on(t.calendarTokenHash),
  }),
);

/** Where a provider works and when: one weekly window per branch (Sprint 4). */
export const providerBranches = pgTable(
  'provider_branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    /** ISO weekdays worked, 1 = Monday … 7 = Sunday. */
    days: jsonb('days').$type<number[]>().notNull().default(sql`'[1,2,3,4,5,6]'::jsonb`),
    /** Local clinic time, "HH:MM". */
    startTime: text('start_time').notNull().default('10:00'),
    endTime: text('end_time').notNull().default('19:00'),
  },
  (t) => ({
    timeCheck: check('provider_branches_time_check', sql`${t.startTime} ~ '^[0-2][0-9]:[0-5][0-9]$' and ${t.endTime} ~ '^[0-2][0-9]:[0-5][0-9]$' and ${t.startTime} < ${t.endTime}`),
    pairUnique: uniqueIndex('provider_branches_unique').on(t.providerId, t.branchId),
  }),
);

/** Reminder wording a clinic writes (Sprint 8, ADR-020). Variables like {first_name}; never clinical detail. */
export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    language: text('language').notNull().default('en'),
    body: text('body').notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    languageCheck: check('message_templates_language_check', sql`${t.language} in ('en', 'hi')`),
    orgIdx: index('message_templates_org_idx').on(t.orgId),
  }),
);

/** When a reminder goes (Sprint 8). branch_id null = every branch. Removed rules keep their row for the sends log. */
export const messageRules = pgTable(
  'message_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id').references(() => branches.id),
    trigger: text('trigger').notNull(),
    offsetMinutes: integer('offset_minutes').notNull().default(0),
    everyDays: integer('every_days'),
    maxTimes: integer('max_times'),
    templateId: uuid('template_id')
      .notNull()
      .references(() => messageTemplates.id),
    active: boolean('active').notNull().default(true),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    triggerCheck: check('message_rules_trigger_check', sql`${t.trigger} in ('booked', 'before_appointment', 'no_show', 'after_visit', 'recall_due', 'dues')`),
    offsetCheck: check('message_rules_offset_check', sql`${t.offsetMinutes} between 0 and 86400`),
    orgIdx: index('message_rules_org_idx').on(t.orgId),
  }),
);

/**
 * Each planned message the desk sent or skipped (Sprint 8). The unique key is
 * what stops a reminder going twice. The text itself is not stored.
 */
export const messageSends = pgTable(
  'message_sends',
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
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => messageRules.id),
    key: text('key').notNull(),
    outcome: text('outcome').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    by: uuid('by')
      .notNull()
      .references(() => users.id),
  },
  (t) => ({
    outcomeCheck: check('message_sends_outcome_check', sql`${t.outcome} in ('sent', 'skipped')`),
    keyUnique: uniqueIndex('message_sends_org_key_unique').on(t.orgId, t.key),
    branchIdx: index('message_sends_branch_idx').on(t.orgId, t.branchId, t.at),
  }),
);

/**
 * Discount limit per role (Sprint 8): up to max_bp of a line's value. No row
 * for a role means no limit, which is how every clinic starts.
 */
export const roleDiscountCaps = pgTable(
  'role_discount_caps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    role: text('role').notNull(),
    maxBp: integer('max_bp').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bpCheck: check('role_discount_caps_bp_check', sql`${t.maxBp} between 0 and 10000`),
    roleUnique: uniqueIndex('role_discount_caps_org_role_unique').on(t.orgId, t.role),
  }),
);

/**
 * A doctor away for whole days (Sprint 8, Argon idea). Applies at every
 * branch: no free slots and no new bookings on those days. Removing a leave
 * stamps removed_at; rows are never deleted, so the audit reads cleanly.
 */
export const providerLeave = pgTable(
  'provider_leave',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: uuid('removed_by').references(() => users.id),
  },
  (t) => ({
    rangeCheck: check('provider_leave_range_check', sql`${t.endsOn} >= ${t.startsOn}`),
    providerIdx: index('provider_leave_provider_idx').on(t.orgId, t.providerId, t.startsOn),
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

    /** Known allergies, written by a doctor on the prescription screen (Sprint 5, LET-173). Health data. */
    allergies: text('allergies'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** The patient said STOP (Sprint 8): no planned reminders, under any rule. Manual buttons are unchanged. */
    messagesStoppedAt: timestamp('messages_stopped_at', { withTimezone: true }),
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

    /** Sprint 8: how long a booking for this treatment usually takes (minutes); null = the doctor's slot. */
    defaultMinutes: integer('default_minutes'),
    /** Sprint 8: suggest a come-back reminder this many days after it's billed (e.g. scaling: 182); null = none. */
    recallDays: integer('recall_days'),
    /** Which come-back reminder to suggest (checkup, cleaning, continue, review). */
    recallKind: text('recall_kind'),
  },
  (t) => ({
    orgCodeUnique: uniqueIndex('catalogue_org_code_unique').on(t.orgId, t.code),
    minutesCheck: check('catalogue_default_minutes_check', sql`${t.defaultMinutes} is null or (${t.defaultMinutes} between 5 and 240 and ${t.defaultMinutes} % 5 = 0)`),
    recallCheck: check('catalogue_recall_check', sql`(${t.recallDays} is null and ${t.recallKind} is null) or (${t.recallDays} between 1 and 1095 and ${t.recallKind} in ('checkup', 'cleaning', 'continue', 'review'))`),
  }),
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
    doctorId: uuid('doctor_id').references(() => providers.id),
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
      .references(() => providers.id),
    operatoryId: uuid('operatory_id').references(() => operatories.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: appointmentStatusEnum('status').notNull().default('booked'),
    notes: text('notes'),
    /** Plain words for the desk ("Check-up", "RCT sitting 2"). Never in the calendar feed or WhatsApp. */
    reason: text('reason'),
    cancelReason: text('cancel_reason'),
    /** Brought in from the old software (Sprint 9): no "right after booking" message, the patient already knows. */
    imported: boolean('imported').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Also: EXCLUDE no overlap per doctor for active statuses (migration 0008, needs btree_gist).
    timesCheck: check('appointments_times_check', sql`${t.endsAt} > ${t.startsAt}`),
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
      .references(() => providers.id),
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
      .references(() => providers.id),
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

    /**
     * Marked "not done" (Q20, T28): left out of Done-not-billed and can never
     * be billed. Set by an owner or branch manager (`procedure.dismiss`), or
     * by cancelling its bill with "No, it wasn't done". The row is never
     * deleted; the reason is required and audited.
     */
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: uuid('dismissed_by').references(() => users.id),
    dismissReason: text('dismiss_reason'),
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

    doctorId: uuid('doctor_id').references(() => providers.id),
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
    // Cancelling is a status transition, like voiding a bill: the row, its
    // number and its allocations stay; every derived figure ignores it and a
    // reversing ledger entry restores the balance (Slice 3, T19).
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
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
      .references(() => providers.id),
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

// ---------------------------------------------------------------------------
// Pilot 0 usage log (Sprint 1, T26)
// ---------------------------------------------------------------------------

/**
 * A small usage log for the Pilot 0 scorecard: did the owner open the
 * dashboard, how long did a registration take. Telemetry, not a business
 * record, so it is not audited. It must never hold patient data, names,
 * phones or amounts: kind, who, where, how long and when, nothing else.
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id').references(() => branches.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    durationMs: integer('duration_ms'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    kindCheck: check('usage_events_kind_check', sql`${t.kind} in ('dashboard_view', 'patient_register', 'day_summary_open')`),
    orgKindTimeIdx: index('usage_events_org_kind_time_idx').on(t.orgId, t.kind, t.occurredAt),
  }),
);

/**
 * WhatsApp dues reminders (Sprint 2, T32). One row each time someone opens a
 * reminder for a patient, so the desk sees "Reminded 2 days ago" and doesn't
 * nag. Append-only: never updated or deleted. The message text is not
 * stored; the amount is the balance shown when it was opened.
 */
export const paymentReminders = pgTable(
  'payment_reminders',
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
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    sentBy: uuid('sent_by')
      .notNull()
      .references(() => users.id),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    amountCheck: check('payment_reminders_amount_check', sql`${t.amountPaise} > 0`),
    orgPatientTimeIdx: index('payment_reminders_org_patient_time_idx').on(t.orgId, t.patientId, t.sentAt),
  }),
);

/**
 * Today's waiting room (Sprint 3, T36). One row per patient per visit day at
 * a branch, with a token number 1, 2, 3… per branch per day. No complaint or
 * clinical note is ever stored here. Status changes are audited.
 */
export const visits = pgTable(
  'visits',
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
    businessDate: date('business_date').notNull(),
    token: integer('token').notNull(),
    status: text('status').notNull().default('waiting'),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }).notNull().defaultNow(),
    seatedAt: timestamp('seated_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    /** Set when the patient arrived for an appointment (Sprint 4, LET-167). */
    appointmentId: uuid('appointment_id').references(() => appointments.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => ({
    statusCheck: check('visits_status_check', sql`${t.status} in ('waiting', 'in_chair', 'done', 'left')`),
    tokenUnique: uniqueIndex('visits_branch_day_token_unique').on(t.branchId, t.businessDate, t.token),
    // A patient is in today's queue at a branch at most once while waiting or in the chair.
    activeUnique: uniqueIndex('visits_branch_day_patient_active_unique')
      .on(t.branchId, t.businessDate, t.patientId)
      .where(sql`status in ('waiting', 'in_chair')`),
    orgDayIdx: index('visits_org_day_idx').on(t.orgId, t.businessDate),
    appointmentUnique: uniqueIndex('visits_appointment_unique').on(t.appointmentId).where(sql`appointment_id is not null`),
  }),
);

/**
 * Next-visit recalls (Sprint 3, T37). At most one open recall per patient
 * per branch; setting a new one closes the old. Kinds are generic words, never
 * a diagnosis. Reminders are counted here; the message text is not stored.
 */
export const recalls = pgTable(
  'recalls',
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
    dueOn: date('due_on').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('open'),
    remindCount: integer('remind_count').notNull().default(0),
    lastRemindedAt: timestamp('last_reminded_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    kindCheck: check('recalls_kind_check', sql`${t.kind} in ('checkup', 'cleaning', 'continue', 'review')`),
    statusCheck: check('recalls_status_check', sql`${t.status} in ('open', 'done', 'cancelled')`),
    openUnique: uniqueIndex('recalls_branch_patient_open_unique').on(t.branchId, t.patientId).where(sql`status = 'open'`),
    orgDueIdx: index('recalls_org_due_idx').on(t.orgId, t.status, t.dueOn),
  }),
);

/**
 * Treatment plans (Sprint 4, LET-168). Four states: draft, accepted,
 * completed, cancelled. The estimate number is per branch and is not a tax
 * document number (gapless series stay for bills only).
 */
export const treatmentPlans = pgTable(
  'treatment_plans',
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
      .references(() => providers.id),
    estimateNumber: integer('estimate_number').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('draft'),
    cancelReason: text('cancel_reason'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusCheck: check('treatment_plans_status_check', sql`${t.status} in ('draft', 'accepted', 'completed', 'cancelled')`),
    numberUnique: uniqueIndex('treatment_plans_branch_number_unique').on(t.branchId, t.estimateNumber),
    patientIdx: index('treatment_plans_patient_idx').on(t.orgId, t.patientId),
  }),
);

/** One line of work in a plan. "Done" points at the procedure it created. */
export const treatmentPlanItems = pgTable(
  'treatment_plan_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    planId: uuid('plan_id')
      .notNull()
      .references(() => treatmentPlans.id),
    catalogueItemId: uuid('catalogue_item_id')
      .notNull()
      .references(() => catalogueItems.id),
    toothNumber: text('tooth_number'),
    quantity: integer('quantity').notNull().default(1),
    /** Agreed price per unit, before GST. Becomes the procedure's price when done. */
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),
    /** Why the agreed price differs from the price list, if it does. */
    priceReason: text('price_reason'),
    session: integer('session').notNull().default(1),
    status: text('status').notNull().default('planned'),
    procedureId: uuid('procedure_id').references(() => proceduresPerformed.id),
    doneAt: timestamp('done_at', { withTimezone: true }),
    dropReason: text('drop_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusCheck: check('treatment_plan_items_status_check', sql`${t.status} in ('planned', 'done', 'dropped')`),
    qtyCheck: check('treatment_plan_items_qty_check', sql`${t.quantity} between 1 and 99`),
    priceCheck: check('treatment_plan_items_price_check', sql`${t.unitPricePaise} >= 0`),
    planIdx: index('treatment_plan_items_plan_idx').on(t.planId),
    procedureUnique: uniqueIndex('treatment_plan_items_procedure_unique').on(t.procedureId),
  }),
);

/** The clinic's medicine list (Sprint 5, LET-172). Also the stock list for medicines (LET-176). */
export const medicines = pgTable(
  'medicines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    strength: text('strength'),
    form: text('form').notNull(),
    dose: text('dose'),
    frequency: text('frequency'),
    days: integer('days'),
    instructions: text('instructions'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameUnique: uniqueIndex('medicines_org_name_strength_unique').on(t.orgId, sql`lower(${t.name})`, sql`coalesce(lower(${t.strength}), '')`),
  }),
);

/** A ready set of medicines for a treatment, e.g. "Root canal" (LET-173). */
export const rxTemplates = pgTable(
  'rx_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    /** Suggest this template when this treatment was done or planned. */
    catalogueItemId: uuid('catalogue_item_id').references(() => catalogueItems.id),
    advice: text('advice'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index('rx_templates_org_idx').on(t.orgId) }),
);

export const rxTemplateLines = pgTable('rx_template_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  templateId: uuid('template_id')
    .notNull()
    .references(() => rxTemplates.id),
  medicineId: uuid('medicine_id')
    .notNull()
    .references(() => medicines.id),
  dose: text('dose'),
  frequency: text('frequency'),
  days: integer('days'),
  instructions: text('instructions'),
  sortOrder: integer('sort_order').notNull().default(0),
});

/**
 * A signed prescription (LET-173). Never edited: a correction is a new
 * prescription with replacesId set, and the old one is marked replaced.
 * Medicine names and doses are snapshotted on the lines.
 */
export const prescriptions = pgTable(
  'prescriptions',
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
      .references(() => providers.id),
    rxNumber: integer('rx_number').notNull(),
    issuedOn: date('issued_on').notNull(),
    complaint: text('complaint'),
    advice: text('advice'),
    /** Allergies as written when signed. */
    allergies: text('allergies'),
    status: text('status').notNull().default('signed'),
    replacesId: uuid('replaces_id'),
    signedBy: uuid('signed_by')
      .notNull()
      .references(() => users.id),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusCheck: check('prescriptions_status_check', sql`${t.status} in ('signed', 'replaced')`),
    numberUnique: uniqueIndex('prescriptions_branch_number_unique').on(t.branchId, t.rxNumber),
    patientIdx: index('prescriptions_patient_idx').on(t.orgId, t.patientId),
    replacesUnique: uniqueIndex('prescriptions_replaces_unique').on(t.replacesId),
  }),
);

export const prescriptionLines = pgTable('prescription_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id),
  prescriptionId: uuid('prescription_id')
    .notNull()
    .references(() => prescriptions.id),
  medicineId: uuid('medicine_id').references(() => medicines.id),
  name: text('name').notNull(),
  strength: text('strength'),
  form: text('form'),
  dose: text('dose'),
  frequency: text('frequency'),
  days: integer('days'),
  instructions: text('instructions'),
  sortOrder: integer('sort_order').notNull().default(0),
});

/**
 * Stock-lite (Sprint 6, LET-176): medicines and clinic supplies. Quantities
 * are whole units (strips, boxes, pieces). On hand is always the sum of
 * movements at a branch, never stored (convention 4). No batch tracking: a
 * "received" movement carries the expiry date of what came in.
 */
export const stockItems = pgTable(
  'stock_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    kind: text('kind').notNull(),
    medicineId: uuid('medicine_id').references(() => medicines.id),
    /** Sold to patients as this price-list item: billing it takes it out of stock. */
    catalogueItemId: uuid('catalogue_item_id').references(() => catalogueItems.id),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    reorderLevel: integer('reorder_level').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    kindCheck: check('stock_items_kind_check', sql`${t.kind} in ('medicine', 'supply')`),
    reorderCheck: check('stock_items_reorder_check', sql`${t.reorderLevel} >= 0`),
    medicineUnique: uniqueIndex('stock_items_medicine_unique').on(t.orgId, t.medicineId),
    catalogueUnique: uniqueIndex('stock_items_catalogue_unique').on(t.orgId, t.catalogueItemId),
    nameUnique: uniqueIndex('stock_items_name_unique').on(t.orgId, sql`lower(${t.name})`),
  }),
);

/** Append-only. Positive in, negative out. "sold" rows point at the bill line. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    stockItemId: uuid('stock_item_id')
      .notNull()
      .references(() => stockItems.id),
    kind: text('kind').notNull(),
    quantity: integer('quantity').notNull(),
    expiresOn: date('expires_on'),
    unitCostPaise: bigint('unit_cost_paise', { mode: 'number' }),
    reason: text('reason'),
    invoiceLineId: uuid('invoice_line_id').references(() => invoiceLines.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    kindCheck: check('stock_movements_kind_check', sql`${t.kind} in ('received', 'used', 'sold', 'adjusted', 'returned')`),
    signCheck: check(
      'stock_movements_sign_check',
      sql`${t.quantity} <> 0 and (${t.kind} not in ('received', 'returned') or ${t.quantity} > 0) and (${t.kind} not in ('used', 'sold') or ${t.quantity} < 0)`,
    ),
    costCheck: check('stock_movements_cost_check', sql`${t.unitCostPaise} is null or ${t.unitCostPaise} >= 0`),
    itemBranchIdx: index('stock_movements_item_branch_idx').on(t.stockItemId, t.branchId),
  }),
);
