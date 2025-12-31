ALTER TABLE "councils" ADD COLUMN "parent_entity_id" integer;--> statement-breakpoint
ALTER TABLE "councils" ADD CONSTRAINT "councils_parent_entity_id_entities_id_fk" FOREIGN KEY ("parent_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "councils_parent_entity_idx" ON "councils" USING btree ("parent_entity_id");