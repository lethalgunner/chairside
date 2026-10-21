ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'receipt_cancel';--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;