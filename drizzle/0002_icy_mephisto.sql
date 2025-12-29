CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_number" text NOT NULL,
	"company_name" text NOT NULL,
	"company_status" text,
	"company_type" text,
	"date_of_creation" date,
	"jurisdiction" text,
	"address_line_1" text,
	"address_line_2" text,
	"locality" text,
	"postal_code" text,
	"country" text,
	"sic_codes" jsonb,
	"previous_names" jsonb,
	"raw_data" jsonb,
	"etag" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_company_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_name" text NOT NULL,
	"company_id" integer,
	"match_confidence" numeric(5, 2),
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"manually_verified" boolean DEFAULT false
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "supplier_company_links" ADD CONSTRAINT "supplier_company_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_company_number_unique" ON "companies" USING btree ("company_number");--> statement-breakpoint
CREATE INDEX "companies_company_name_idx" ON "companies" USING btree ("company_name");--> statement-breakpoint
CREATE INDEX "companies_postal_code_idx" ON "companies" USING btree ("postal_code");--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("company_status");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_company_links_name_unique" ON "supplier_company_links" USING btree ("supplier_name");--> statement-breakpoint
CREATE INDEX "supplier_company_links_company_idx" ON "supplier_company_links" USING btree ("company_id");