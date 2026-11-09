ALTER TABLE "organisations" ADD COLUMN "recall_checkup_days" integer DEFAULT 182 NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "recall_cleaning_days" integer DEFAULT 182 NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "recall_continue_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "recall_review_days" integer DEFAULT 30 NOT NULL;