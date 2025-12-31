CREATE TABLE "government_departments" (
	"entity_id" integer PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"acronym" text,
	"organisation_type" text,
	"organisation_state" text,
	"link" text,
	"logo_url" text,
	"raw_data" jsonb,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "government_departments" ADD CONSTRAINT "government_departments_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "government_departments_slug_unique" ON "government_departments" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "government_departments_type_idx" ON "government_departments" USING btree ("organisation_type");