-- Close Supabase's auto-generated Data API (PostgREST, used with the public
-- anon/publishable key) over every table. The app connects as the table owner,
-- which bypasses row-level security, so app behaviour is unchanged. With RLS
-- enabled and no policies, the anon and authenticated roles see no rows.
-- This is not the tenant-isolation RLS that ADR-012 defers to org #2.
-- Every new table must get the same line in its own migration.
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "catalogue_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "day_books" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "encounters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_series" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "login_failures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "operatories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organisations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "password_setup_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "patient_registrations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payout_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "price_list_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "procedures_performed" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "receipt_allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
