ALTER TABLE "entities" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "ai_news" jsonb;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "ai_summary_updated_at" timestamp with time zone;