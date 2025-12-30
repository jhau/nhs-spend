CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"run_id" integer,
	"stage_id" text,
	"table_name" text NOT NULL,
	"record_pk" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"entity_id" integer PRIMARY KEY NOT NULL,
	"company_number" text NOT NULL,
	"company_status" text,
	"company_type" text,
	"date_of_creation" date,
	"date_of_cessation" date,
	"jurisdiction" text,
	"sic_codes" jsonb,
	"previous_names" jsonb,
	"raw_data" jsonb,
	"etag" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "councils" (
	"entity_id" integer PRIMARY KEY NOT NULL,
	"gss_code" text,
	"ons_code" text,
	"council_type" text NOT NULL,
	"tier" text,
	"homepage_url" text,
	"region" text,
	"nation" text,
	"population" integer,
	"raw_data" jsonb,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"registry_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text,
	"address_line_1" text,
	"address_line_2" text,
	"locality" text,
	"postal_code" text,
	"country" text,
	"latitude" double precision,
	"longitude" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nhs_organisations" (
	"entity_id" integer PRIMARY KEY NOT NULL,
	"ods_code" text NOT NULL,
	"org_type" text NOT NULL,
	"org_sub_type" text,
	"parent_ods_code" text,
	"region" text,
	"nhs_region" text,
	"open_date" date,
	"close_date" date,
	"is_active" boolean DEFAULT true,
	"raw_data" jsonb,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer,
	"official_website" text,
	"spending_data_url" text,
	"missing_data_note" text,
	"verified_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text,
	"size_bytes" integer NOT NULL,
	"checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "pipeline_run_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"stage_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"metrics" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer,
	"trigger" text DEFAULT 'web' NOT NULL,
	"created_by" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"org_type" text DEFAULT 'nhs' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"from_stage_id" text,
	"to_stage_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_skipped_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"sheet_name" text NOT NULL,
	"row_number" integer NOT NULL,
	"reason" text NOT NULL,
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"organisation_id" integer NOT NULL,
	"raw_supplier" text NOT NULL,
	"supplier_id" integer,
	"amount" numeric(14, 2) NOT NULL,
	"payment_date" date NOT NULL,
	"raw_amount" text,
	"payment_date_raw" text,
	"source_sheet" text NOT NULL,
	"source_row_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"entity_id" integer,
	"match_status" text DEFAULT 'pending' NOT NULL,
	"match_confidence" numeric(5, 2),
	"manually_verified" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_supplier_searches" ADD CONSTRAINT "contract_supplier_searches_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "councils" ADD CONSTRAINT "councils_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nhs_organisations" ADD CONSTRAINT "nhs_organisations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_logs" ADD CONSTRAINT "pipeline_run_logs_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_stages" ADD CONSTRAINT "pipeline_run_stages_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_asset_id_pipeline_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."pipeline_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_skipped_rows" ADD CONSTRAINT "pipeline_skipped_rows_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_entries" ADD CONSTRAINT "spend_entries_asset_id_pipeline_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."pipeline_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_entries" ADD CONSTRAINT "spend_entries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_entries" ADD CONSTRAINT "spend_entries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_table_record_idx" ON "audit_log" USING btree ("table_name","record_pk");--> statement-breakpoint
CREATE INDEX "audit_log_run_idx" ON "audit_log" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "audit_log_ts_idx" ON "audit_log" USING btree ("ts");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_company_number_unique" ON "companies" USING btree ("company_number");--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("company_status");--> statement-breakpoint
CREATE INDEX "contract_supplier_searches_keyword_idx" ON "contract_supplier_searches" USING btree ("search_keyword");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_supplier_searches_unique" ON "contract_supplier_searches" USING btree ("search_keyword","contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_contract_id_unique" ON "contracts" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contracts_buyer_idx" ON "contracts" USING btree ("buyer");--> statement-breakpoint
CREATE INDEX "contracts_awarded_date_idx" ON "contracts" USING btree ("awarded_date");--> statement-breakpoint
CREATE UNIQUE INDEX "councils_gss_code_unique" ON "councils" USING btree ("gss_code");--> statement-breakpoint
CREATE INDEX "councils_type_idx" ON "councils" USING btree ("council_type");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_type_registry_unique" ON "entities" USING btree ("entity_type","registry_id");--> statement-breakpoint
CREATE INDEX "entities_name_idx" ON "entities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "entities_type_idx" ON "entities" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "entities_postal_code_idx" ON "entities" USING btree ("postal_code");--> statement-breakpoint
CREATE UNIQUE INDEX "nhs_organisations_ods_code_unique" ON "nhs_organisations" USING btree ("ods_code");--> statement-breakpoint
CREATE INDEX "nhs_organisations_type_idx" ON "nhs_organisations" USING btree ("org_type");--> statement-breakpoint
CREATE INDEX "nhs_organisations_parent_idx" ON "nhs_organisations" USING btree ("parent_ods_code");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_entity_unique" ON "organisations" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_assets_object_key_unique" ON "pipeline_assets" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "pipeline_run_logs_run_ts_idx" ON "pipeline_run_logs" USING btree ("run_id","ts");--> statement-breakpoint
CREATE INDEX "pipeline_run_stages_run_idx" ON "pipeline_run_stages" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_run_stages_unique" ON "pipeline_run_stages" USING btree ("run_id","stage_id");--> statement-breakpoint
CREATE INDEX "pipeline_runs_asset_idx" ON "pipeline_runs" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "pipeline_runs_status_idx" ON "pipeline_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pipeline_runs_created_at_idx" ON "pipeline_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pipeline_skipped_rows_run_idx" ON "pipeline_skipped_rows" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "spend_entries_org_payment_idx" ON "spend_entries" USING btree ("organisation_id","payment_date");--> statement-breakpoint
CREATE INDEX "spend_entries_supplier_idx" ON "spend_entries" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spend_entries_source_row_unique" ON "spend_entries" USING btree ("asset_id","source_sheet","source_row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_unique" ON "suppliers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "suppliers_entity_idx" ON "suppliers" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "suppliers_status_idx" ON "suppliers" USING btree ("match_status");