CREATE TABLE "assistant_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_tool_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"request_id" text,
	"tool_name" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "assistant_requests" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "assistant_tool_calls" ADD CONSTRAINT "assistant_tool_calls_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_conversations_created_at_idx" ON "assistant_conversations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assistant_conversations_updated_at_idx" ON "assistant_conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "assistant_tool_calls_conversation_idx" ON "assistant_tool_calls" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "assistant_tool_calls_request_idx" ON "assistant_tool_calls" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "assistant_tool_calls_tool_name_idx" ON "assistant_tool_calls" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "assistant_tool_calls_started_at_idx" ON "assistant_tool_calls" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "assistant_requests" ADD CONSTRAINT "assistant_requests_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_requests_conversation_idx" ON "assistant_requests" USING btree ("conversation_id");