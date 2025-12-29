CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company_id" integer,
	"match_status" text DEFAULT 'pending' NOT NULL,
	"match_confidence" numeric(5, 2),
	"manually_verified" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_company_links" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "supplier_company_links" CASCADE;--> statement-breakpoint
ALTER TABLE "spend_entries" DROP CONSTRAINT "spend_entries_company_id_companies_id_fk";
--> statement-breakpoint
DROP INDEX "spend_entries_company_idx";--> statement-breakpoint
ALTER TABLE "spend_entries" ADD COLUMN "supplier_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_unique" ON "suppliers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "suppliers_company_idx" ON "suppliers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "suppliers_status_idx" ON "suppliers" USING btree ("match_status");--> statement-breakpoint
ALTER TABLE "spend_entries" ADD CONSTRAINT "spend_entries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spend_entries_supplier_idx" ON "spend_entries" USING btree ("supplier_id");--> statement-breakpoint
ALTER TABLE "spend_entries" DROP COLUMN "company_id";--> statement-breakpoint
ALTER TABLE "spend_entries" DROP COLUMN "supplier";