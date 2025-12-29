ALTER TABLE "supplier_company_links" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "supplier_company_links" CASCADE;--> statement-breakpoint
ALTER TABLE "spend_entries" RENAME COLUMN "supplier" TO "raw_supplier";--> statement-breakpoint
ALTER TABLE "spend_entries" DROP CONSTRAINT "spend_entries_company_id_companies_id_fk";
--> statement-breakpoint
DROP INDEX "spend_entries_company_idx";--> statement-breakpoint
ALTER TABLE "spend_entries" DROP COLUMN "company_id";