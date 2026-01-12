import dotenv from "dotenv";
import fs from "fs";

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { enrichEntityLocationsFromPostcodesIo } from "@/lib/entity-location-enrichment";
import { normalizeUkPostcode } from "@/lib/postcodes-io";
import { db } from "../src/db";
import { entities } from "../src/db/schema";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

type Suggestion = {
  entityId: number;
  slug: string;
  name: string;
  suggestedPostcode: string | null;
  approved: boolean;
};

async function main() {
  const filePath = process.argv[2] || "data/gov-dept-location-suggestions.json";
  const force = process.argv.includes("--force");

  if (!fs.existsSync(filePath)) {
    throw new Error(`Suggestions file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const suggestions = JSON.parse(raw) as Suggestion[];

  const approved = suggestions.filter(
    (s) => s.approved && s.suggestedPostcode && s.suggestedPostcode.length > 0
  );

  if (approved.length === 0) {
    console.log("[apply-gov-dept-location-suggestions] no approved suggestions");
    return;
  }

  const entityIds = approved.map((a) => a.entityId);

  // Apply postcodes (only if missing unless --force)
  for (const a of approved) {
    const postcode = normalizeUkPostcode(a.suggestedPostcode!);
    const where = force
      ? eq(entities.id, a.entityId)
      : and(
          eq(entities.id, a.entityId),
          or(isNull(entities.postalCode), sql`btrim(${entities.postalCode}) = ''`)
        );

    const updated = await db
      .update(entities)
      .set({
        postalCode: postcode,
        locationSource: "govuk_llm_suggestion",
        locationUpdatedAt: new Date(),
      })
      .where(where);

    console.log(
      `[apply] ${a.slug}: ${postcode} (${force ? "force" : "if-missing"})`,
      updated
    );
  }

  // Now geocode + set uk_region/uk_country for the updated entities
  const result = await enrichEntityLocationsFromPostcodesIo(db as any, {
    entityIds,
    maxEntities: 5000,
    maxDistinctPostcodes: 100,
  });

  console.log("[apply-gov-dept-location-suggestions] enrichment done", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


