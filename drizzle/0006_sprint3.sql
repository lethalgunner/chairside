CREATE TABLE "recalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"remind_count" integer DEFAULT 0 NOT NULL,
	"last_reminded_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "recalls_kind_check" CHECK ("recalls"."kind" in ('checkup', 'cleaning', 'continue', 'review')),
	CONSTRAINT "recalls_status_check" CHECK ("recalls"."status" in ('open', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"token" integer NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"arrived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seated_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	CONSTRAINT "visits_status_check" CHECK ("visits"."status" in ('waiting', 'in_chair', 'done', 'left'))
);
--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recalls_branch_patient_open_unique" ON "recalls" USING btree ("branch_id","patient_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "recalls_org_due_idx" ON "recalls" USING btree ("org_id","status","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_branch_day_token_unique" ON "visits" USING btree ("branch_id","business_date","token");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_branch_day_patient_active_unique" ON "visits" USING btree ("branch_id","business_date","patient_id") WHERE status in ('waiting', 'in_chair');--> statement-breakpoint
CREATE INDEX "visits_org_day_idx" ON "visits" USING btree ("org_id","business_date");--> statement-breakpoint
-- New tables: close them to Supabase's public Data API like every other table (CLAUDE.md, 0002).
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recalls" ENABLE ROW LEVEL SECURITY;
