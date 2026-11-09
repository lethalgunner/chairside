CREATE TABLE "role_discount_caps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"role" text NOT NULL,
	"max_bp" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_discount_caps_bp_check" CHECK ("role_discount_caps"."max_bp" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "role_discount_caps" ADD CONSTRAINT "role_discount_caps_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_discount_caps_org_role_unique" ON "role_discount_caps" USING btree ("org_id","role");--> statement-breakpoint
ALTER TABLE "role_discount_caps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "role_discount_caps" TO chairside_app USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "role_discount_caps" TO chairside_app;
