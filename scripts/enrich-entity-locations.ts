import "dotenv/config";

import { db } from "@/db";
import { enrichEntityLocationsFromPostcodesIo } from "@/lib/entity-location-enrichment";

async function main() {
  const maxEntities = process.env.ENRICH_MAX_ENTITIES
    ? Number(process.env.ENRICH_MAX_ENTITIES)
    : undefined;
  const maxDistinctPostcodes = process.env.ENRICH_MAX_DISTINCT_POSTCODES
    ? Number(process.env.ENRICH_MAX_DISTINCT_POSTCODES)
    : undefined;

  const result = await enrichEntityLocationsFromPostcodesIo(db as any, {
    maxEntities,
    maxDistinctPostcodes,
  });

  console.log("[enrich-entity-locations] done", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


