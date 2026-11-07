CREATE TABLE "medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"strength" text,
	"form" text NOT NULL,
	"dose" text,
	"frequency" text,
	"days" integer,
	"instructions" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescription_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"medicine_id" uuid,
	"name" text NOT NULL,
	"strength" text,
	"form" text,
	"dose" text,
	"frequency" text,
	"days" integer,
	"instructions" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"rx_number" integer NOT NULL,
	"issued_on" date NOT NULL,
	"complaint" text,
	"advice" text,
	"allergies" text,
	"status" text DEFAULT 'signed' NOT NULL,
	"replaces_id" uuid,
	"signed_by" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescriptions_status_check" CHECK ("prescriptions"."status" in ('signed', 'replaced'))
);
--> statement-breakpoint
CREATE TABLE "rx_template_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"medicine_id" uuid NOT NULL,
	"dose" text,
	"frequency" text,
	"days" integer,
	"instructions" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rx_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"catalogue_item_id" uuid,
	"advice" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "allergies" text;--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_lines" ADD CONSTRAINT "prescription_lines_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_lines" ADD CONSTRAINT "prescription_lines_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_lines" ADD CONSTRAINT "prescription_lines_medicine_id_medicines_id_fk" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_providers_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_template_lines" ADD CONSTRAINT "rx_template_lines_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_template_lines" ADD CONSTRAINT "rx_template_lines_template_id_rx_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."rx_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_template_lines" ADD CONSTRAINT "rx_template_lines_medicine_id_medicines_id_fk" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_templates" ADD CONSTRAINT "rx_templates_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_templates" ADD CONSTRAINT "rx_templates_catalogue_item_id_catalogue_items_id_fk" FOREIGN KEY ("catalogue_item_id") REFERENCES "public"."catalogue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "medicines_org_name_strength_unique" ON "medicines" USING btree ("org_id",lower("name"),coalesce(lower("strength"), ''));--> statement-breakpoint
CREATE UNIQUE INDEX "prescriptions_branch_number_unique" ON "prescriptions" USING btree ("branch_id","rx_number");--> statement-breakpoint
CREATE INDEX "prescriptions_patient_idx" ON "prescriptions" USING btree ("org_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescriptions_replaces_unique" ON "prescriptions" USING btree ("replaces_id");--> statement-breakpoint
CREATE INDEX "rx_templates_org_idx" ON "rx_templates" USING btree ("org_id");--> statement-breakpoint
-- New tables: close them to Supabase's public Data API like every other table (CLAUDE.md, 0002).
ALTER TABLE "medicines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rx_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rx_template_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prescriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prescription_lines" ENABLE ROW LEVEL SECURITY;
