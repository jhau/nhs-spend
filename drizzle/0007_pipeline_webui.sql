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
CREATE UNIQUE INDEX "pipeline_assets_object_key_unique" ON "pipeline_assets" USING btree ("object_key");
--> statement-breakpoint
ALTER TABLE "spend_entries" ADD COLUMN "asset_id" integer;
--> statement-breakpoint
ALTER TABLE "spend_entries" ADD CONSTRAINT "spend_entries_asset_id_pipeline_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."pipeline_assets"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- NOTE: This assumes spend_entries is empty (development). If not, you must backfill asset_id first.
ALTER TABLE "spend_entries" ALTER COLUMN "asset_id" SET NOT NULL;
--> statement-breakpoint
DROP INDEX "spend_entries_source_row_unique";
--> statement-breakpoint
ALTER TABLE "spend_entries" DROP COLUMN "source_file";
--> statement-breakpoint
CREATE UNIQUE INDEX "spend_entries_source_row_unique" ON "spend_entries" USING btree ("asset_id","source_sheet","source_row_number");
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"trigger" text DEFAULT 'web' NOT NULL,
	"created_by" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_asset_id_pipeline_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."pipeline_assets"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pipeline_runs_asset_idx" ON "pipeline_runs" USING btree ("asset_id");
--> statement-breakpoint
CREATE INDEX "pipeline_runs_status_idx" ON "pipeline_runs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "pipeline_runs_created_at_idx" ON "pipeline_runs" USING btree ("created_at");
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
ALTER TABLE "pipeline_run_stages" ADD CONSTRAINT "pipeline_run_stages_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pipeline_run_stages_run_idx" ON "pipeline_run_stages" USING btree ("run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_run_stages_unique" ON "pipeline_run_stages" USING btree ("run_id","stage_id");
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
ALTER TABLE "pipeline_run_logs" ADD CONSTRAINT "pipeline_run_logs_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pipeline_run_logs_run_ts_idx" ON "pipeline_run_logs" USING btree ("run_id","ts");
--> statement-breakpoint
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
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "audit_log_table_record_idx" ON "audit_log" USING btree ("table_name","record_pk");
--> statement-breakpoint
CREATE INDEX "audit_log_run_idx" ON "audit_log" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "audit_log_ts_idx" ON "audit_log" USING btree ("ts");

