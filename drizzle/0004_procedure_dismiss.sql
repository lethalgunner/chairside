ALTER TABLE "procedures_performed" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "procedures_performed" ADD COLUMN "dismissed_by" uuid;--> statement-breakpoint
ALTER TABLE "procedures_performed" ADD COLUMN "dismiss_reason" text;--> statement-breakpoint
ALTER TABLE "procedures_performed" ADD CONSTRAINT "procedures_performed_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;