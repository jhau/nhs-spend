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
ALTER TABLE "pipeline_runs" ALTER COLUMN "asset_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_skipped_rows" ADD CONSTRAINT "pipeline_skipped_rows_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_skipped_rows_run_idx" ON "pipeline_skipped_rows" USING btree ("run_id");