CREATE TABLE "organisations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trust_type" text,
	"ods_code" text,
	"post_code" text,
	"official_website" text,
	"spending_data_url" text,
	"missing_data_note" text,
	"verified_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"organisation_id" integer NOT NULL,
	"source_org_name" text NOT NULL,
	"supplier" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"payment_date" date NOT NULL,
	"raw_amount" text,
	"payment_date_raw" text,
	"source_file" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_row_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spend_entries" ADD CONSTRAINT "spend_entries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_ods_code_unique" ON "organisations" USING btree ("ods_code");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_name_unique" ON "organisations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "spend_entries_org_payment_idx" ON "spend_entries" USING btree ("organisation_id","payment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "spend_entries_source_row_unique" ON "spend_entries" USING btree ("source_file","source_sheet","source_row_number");