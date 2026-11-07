CREATE TABLE "treatment_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"catalogue_item_id" uuid NOT NULL,
	"tooth_number" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"price_reason" text,
	"session" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"procedure_id" uuid,
	"done_at" timestamp with time zone,
	"drop_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plan_items_status_check" CHECK ("treatment_plan_items"."status" in ('planned', 'done', 'dropped')),
	CONSTRAINT "treatment_plan_items_qty_check" CHECK ("treatment_plan_items"."quantity" between 1 and 99),
	CONSTRAINT "treatment_plan_items_price_check" CHECK ("treatment_plan_items"."unit_price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "treatment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"estimate_number" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"cancel_reason" text,
	"accepted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plans_status_check" CHECK ("treatment_plans"."status" in ('draft', 'accepted', 'completed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_catalogue_item_id_catalogue_items_id_fk" FOREIGN KEY ("catalogue_item_id") REFERENCES "public"."catalogue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_procedure_id_procedures_performed_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures_performed"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_doctor_id_providers_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "treatment_plan_items_plan_idx" ON "treatment_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_items_procedure_unique" ON "treatment_plan_items" USING btree ("procedure_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plans_branch_number_unique" ON "treatment_plans" USING btree ("branch_id","estimate_number");--> statement-breakpoint
CREATE INDEX "treatment_plans_patient_idx" ON "treatment_plans" USING btree ("org_id","patient_id");--> statement-breakpoint
-- New tables: close them to Supabase's public Data API like every other table (CLAUDE.md, 0002).
ALTER TABLE "treatment_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ENABLE ROW LEVEL SECURITY;
