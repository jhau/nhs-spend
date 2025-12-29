ALTER TABLE "spend_entries" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "spend_entries" ADD CONSTRAINT "spend_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spend_entries_company_idx" ON "spend_entries" USING btree ("company_id");