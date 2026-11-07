ALTER TABLE "appointments" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visits_appointment_unique" ON "visits" USING btree ("appointment_id") WHERE appointment_id is not null;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_times_check" CHECK ("appointments"."ends_at" > "appointments"."starts_at");--> statement-breakpoint
-- No double-booking a doctor (LET-167), enforced by Postgres, not just the screen.
-- btree_gist lets a GiST exclusion compare the uuid with "="; on Supabase extensions live in "extensions".
CREATE SCHEMA IF NOT EXISTS "extensions";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "extensions";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist ("doctor_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("status" IN ('booked', 'confirmed', 'arrived', 'in_chair'));
