CREATE TABLE "provider_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"days" jsonb DEFAULT '[1,2,3,4,5,6]'::jsonb NOT NULL,
	"start_time" text DEFAULT '10:00' NOT NULL,
	"end_time" text DEFAULT '19:00' NOT NULL,
	CONSTRAINT "provider_branches_time_check" CHECK ("provider_branches"."start_time" ~ '^[0-2][0-9]:[0-5][0-9]$' and "provider_branches"."end_time" ~ '^[0-2][0-9]:[0-5][0-9]$' and "provider_branches"."start_time" < "provider_branches"."end_time")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"qualification" text,
	"registration_number" text,
	"registration_council" text,
	"specialty" text,
	"engagement_type" text DEFAULT 'salaried' NOT NULL,
	"colour" text,
	"slot_minutes" integer DEFAULT 15 NOT NULL,
	"calendar_token_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_engagement_check" CHECK ("providers"."engagement_type" in ('owner_partner', 'salaried', 'associate', 'visiting')),
	CONSTRAINT "providers_slot_check" CHECK ("providers"."slot_minutes" in (10, 15, 20, 30)),
	CONSTRAINT "providers_colour_check" CHECK ("providers"."colour" is null or "providers"."colour" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_doctor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "encounters" DROP CONSTRAINT "encounters_doctor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_doctor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "payout_rules" DROP CONSTRAINT "payout_rules_doctor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "price_list_entries" DROP CONSTRAINT "price_list_entries_doctor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "procedures_performed" DROP CONSTRAINT "procedures_performed_doctor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "provider_branches" ADD CONSTRAINT "provider_branches_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_branches" ADD CONSTRAINT "provider_branches_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_branches" ADD CONSTRAINT "provider_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_branches_unique" ON "provider_branches" USING btree ("provider_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_user_unique" ON "providers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "providers_org_idx" ON "providers" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_calendar_token_unique" ON "providers" USING btree ("calendar_token_hash");--> statement-breakpoint
-- Backfill (LET-166, ADR-008). Each existing doctor becomes a provider WITH THE SAME ID as
-- their user row, so every doctor_id already written (including on issued bills, which are
-- never updated) stays valid when the foreign keys move from users to providers.
INSERT INTO "providers" ("id", "org_id", "user_id", "full_name", "registration_number", "engagement_type")
SELECT u."id", u."org_id", u."id", u."full_name", u."registration_number",
  CASE WHEN EXISTS (SELECT 1 FROM "memberships" m WHERE m."user_id" = u."id" AND m."role" = 'owner') THEN 'owner_partner'
       WHEN EXISTS (SELECT 1 FROM "memberships" m WHERE m."user_id" = u."id" AND m."role" = 'associate_doctor') THEN 'associate'
       ELSE 'salaried' END
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "memberships" m WHERE m."user_id" = u."id" AND m."role" IN ('doctor', 'associate_doctor'))
   OR u."id" IN (SELECT "doctor_id" FROM "appointments" UNION SELECT "doctor_id" FROM "encounters"
                 UNION SELECT "doctor_id" FROM "invoices" WHERE "doctor_id" IS NOT NULL
                 UNION SELECT "doctor_id" FROM "payout_rules"
                 UNION SELECT "doctor_id" FROM "price_list_entries" WHERE "doctor_id" IS NOT NULL
                 UNION SELECT "doctor_id" FROM "procedures_performed");--> statement-breakpoint
-- Where they work: their doctor grants; an org-wide grant means every branch. Mon–Sat, 10:00–19:00.
INSERT INTO "provider_branches" ("org_id", "provider_id", "branch_id")
SELECT DISTINCT m."org_id", m."user_id", b."id"
FROM "memberships" m
JOIN "branches" b ON b."org_id" = m."org_id" AND (m."branch_id" IS NULL OR m."branch_id" = b."id")
WHERE m."role" IN ('doctor', 'associate_doctor')
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_providers_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_doctor_id_providers_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_doctor_id_providers_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_rules" ADD CONSTRAINT "payout_rules_doctor_id_providers_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_doctor_id_providers_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures_performed" ADD CONSTRAINT "procedures_performed_doctor_id_providers_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- New tables: close them to Supabase's public Data API like every other table (CLAUDE.md, 0002).
ALTER TABLE "providers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_branches" ENABLE ROW LEVEL SECURITY;
