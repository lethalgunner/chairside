CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"medicine_id" uuid,
	"catalogue_item_id" uuid,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_items_kind_check" CHECK ("stock_items"."kind" in ('medicine', 'supply')),
	CONSTRAINT "stock_items_reorder_check" CHECK ("stock_items"."reorder_level" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"expires_on" date,
	"unit_cost_paise" bigint,
	"reason" text,
	"invoice_line_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_kind_check" CHECK ("stock_movements"."kind" in ('received', 'used', 'sold', 'adjusted', 'returned')),
	CONSTRAINT "stock_movements_sign_check" CHECK ("stock_movements"."quantity" <> 0 and ("stock_movements"."kind" not in ('received', 'returned') or "stock_movements"."quantity" > 0) and ("stock_movements"."kind" not in ('used', 'sold') or "stock_movements"."quantity" < 0)),
	CONSTRAINT "stock_movements_cost_check" CHECK ("stock_movements"."unit_cost_paise" is null or "stock_movements"."unit_cost_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_medicine_id_medicines_id_fk" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_catalogue_item_id_catalogue_items_id_fk" FOREIGN KEY ("catalogue_item_id") REFERENCES "public"."catalogue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_medicine_unique" ON "stock_items" USING btree ("org_id","medicine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_catalogue_unique" ON "stock_items" USING btree ("org_id","catalogue_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_name_unique" ON "stock_items" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE INDEX "stock_movements_item_branch_idx" ON "stock_movements" USING btree ("stock_item_id","branch_id");--> statement-breakpoint
-- New tables: close them to Supabase's public Data API like every other table (CLAUDE.md, 0002).
ALTER TABLE "stock_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
