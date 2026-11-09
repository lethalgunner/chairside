CREATE TABLE "provider_leave" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "provider_leave_range_check" CHECK ("provider_leave"."ends_on" >= "provider_leave"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "provider_leave" ADD CONSTRAINT "provider_leave_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_leave" ADD CONSTRAINT "provider_leave_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_leave" ADD CONSTRAINT "provider_leave_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_leave" ADD CONSTRAINT "provider_leave_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_leave_provider_idx" ON "provider_leave" USING btree ("org_id","provider_id","starts_on");--> statement-breakpoint
ALTER TABLE "provider_leave" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "provider_leave" TO chairside_app USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "provider_leave" TO chairside_app;
