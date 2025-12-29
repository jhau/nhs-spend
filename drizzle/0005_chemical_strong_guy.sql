CREATE TABLE "contract_supplier_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_keyword" text NOT NULL,
	"contract_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"buyer" text,
	"published_date" timestamp with time zone,
	"awarded_date" timestamp with time zone,
	"awarded_value" numeric(14, 2),
	"awarded_suppliers" jsonb,
	"cpv_description" text,
	"region" text,
	"raw_data" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_supplier_searches" ADD CONSTRAINT "contract_supplier_searches_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_supplier_searches_keyword_idx" ON "contract_supplier_searches" USING btree ("search_keyword");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_supplier_searches_unique" ON "contract_supplier_searches" USING btree ("search_keyword","contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_contract_id_unique" ON "contracts" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contracts_buyer_idx" ON "contracts" USING btree ("buyer");--> statement-breakpoint
CREATE INDEX "contracts_awarded_date_idx" ON "contracts" USING btree ("awarded_date");