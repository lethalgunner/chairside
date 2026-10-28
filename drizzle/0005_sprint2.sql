CREATE TABLE "payment_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"sent_by" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reminders_amount_check" CHECK ("payment_reminders"."amount_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "usage_events" DROP CONSTRAINT "usage_events_kind_check";--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "upi_id" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "upi_payee" text;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_reminders_org_patient_time_idx" ON "payment_reminders" USING btree ("org_id","patient_id","sent_at");--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_kind_check" CHECK ("usage_events"."kind" in ('dashboard_view', 'patient_register', 'day_summary_open'));--> statement-breakpoint
-- New table: close it to Supabase's public Data API like every other table (CLAUDE.md, 0002).
ALTER TABLE "payment_reminders" ENABLE ROW LEVEL SECURITY;
