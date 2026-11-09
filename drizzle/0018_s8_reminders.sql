CREATE TABLE "message_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid,
	"trigger" text NOT NULL,
	"offset_minutes" integer DEFAULT 0 NOT NULL,
	"every_days" integer,
	"max_times" integer,
	"template_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_rules_trigger_check" CHECK ("message_rules"."trigger" in ('booked', 'before_appointment', 'no_show', 'after_visit', 'recall_due', 'dues')),
	CONSTRAINT "message_rules_offset_check" CHECK ("message_rules"."offset_minutes" between 0 and 86400)
);
--> statement-breakpoint
CREATE TABLE "message_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"key" text NOT NULL,
	"outcome" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" uuid NOT NULL,
	CONSTRAINT "message_sends_outcome_check" CHECK ("message_sends"."outcome" in ('sent', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"body" text NOT NULL,
	"removed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_language_check" CHECK ("message_templates"."language" in ('en', 'hi'))
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "messages_quiet_start" text DEFAULT '21:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "messages_quiet_end" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "messages_doctor_name" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "messages_stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_rules" ADD CONSTRAINT "message_rules_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_rules" ADD CONSTRAINT "message_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_rules" ADD CONSTRAINT "message_rules_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_sends" ADD CONSTRAINT "message_sends_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_sends" ADD CONSTRAINT "message_sends_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_sends" ADD CONSTRAINT "message_sends_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_sends" ADD CONSTRAINT "message_sends_rule_id_message_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."message_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_sends" ADD CONSTRAINT "message_sends_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_rules_org_idx" ON "message_rules" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_sends_org_key_unique" ON "message_sends" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "message_sends_branch_idx" ON "message_sends" USING btree ("org_id","branch_id","at");--> statement-breakpoint
CREATE INDEX "message_templates_org_idx" ON "message_templates" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "message_templates" TO chairside_app USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_templates" TO chairside_app;--> statement-breakpoint
ALTER TABLE "message_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "message_rules" TO chairside_app USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_rules" TO chairside_app;--> statement-breakpoint
ALTER TABLE "message_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "message_sends" TO chairside_app USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_sends" TO chairside_app;
