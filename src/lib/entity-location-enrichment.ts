import { and, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { PipelineLogger } from "@/pipeline/types";
import { entities } from "@/db/schema";
import {
  bulkLookupPostcodes,
  normalizeUkPostcode,
  POSTCODES_IO_BULK_LIMIT,
} from "@/lib/postcodes-io";

export type EnrichEntityLocationsOptions = {
  /**
   * Restrict enrichment to these entity IDs (useful for targeted backfills).
   */
  entityIds?: number[];
  /**
   * Max entities to scan per invocation (protects DB and postcodes.io).
   */
  maxEntities?: number;
  /**
   * Max distinct postcodes to enrich per invocation.
   * postcodes.io bulk supports up to 100.
   */
  maxDistinctPostcodes?: number;
  /**
   * Optional pipeline-style logger.
   */
  logger?: PipelineLogger;
  signal?: AbortSignal;
};

export type EnrichEntityLocationsResult = {
  scannedEntities: number;
  distinctPostcodes: number;
  updatedEntities: number;
  updatedPostcodes: number;
  failedPostcodes: number;
};

function deriveUkRegion(country: string | null, region: string | null): string | null {
  // postcodes.io typically returns `region` for England; for devolved nations it may be null.
  if (region && region.trim().length > 0) return region;
  if (!country) return null;
  const c = country.trim();
  if (c === "Wales" || c === "Scotland" || c === "Northern Ireland") return c;
  if (c === "England") return null; // prefer an English region name if available
  return c;
}

export async function enrichEntityLocationsFromPostcodesIo(
  db: any,
  opts: EnrichEntityLocationsOptions = {}
): Promise<EnrichEntityLocationsResult> {
  const maxEntities = opts.maxEntities ?? 5000;
  const maxDistinctPostcodes =
    opts.maxDistinctPostcodes ?? POSTCODES_IO_BULK_LIMIT;

  const restrictIds =
    Array.isArray(opts.entityIds) && opts.entityIds.length > 0
      ? opts.entityIds
      : null;

  const rows = await db
    .select({
      id: entities.id,
      postalCode: entities.postalCode,
    })
    .from(entities)
    .where(
      and(
        restrictIds ? inArray(entities.id, restrictIds) : sql`true`,
        isNotNull(entities.postalCode),
        or(
          isNull(entities.latitude),
          isNull(entities.longitude),
          isNull(entities.ukRegion),
          isNull(entities.ukCountry)
        )
      )
    )
    .limit(maxEntities);

  const idsByPostcode = new Map<string, number[]>();
  for (const r of rows) {
    const pc = r.postalCode ? normalizeUkPostcode(r.postalCode) : null;
    if (!pc) continue;
    const arr = idsByPostcode.get(pc) ?? [];
    arr.push(r.id);
    idsByPostcode.set(pc, arr);
  }

  const allPostcodes = Array.from(idsByPostcode.keys()).slice(
    0,
    maxDistinctPostcodes
  );

  if (opts.logger) {
    await opts.logger({
      level: "info",
      message: "Entity location enrichment: starting postcode batch",
      meta: {
        scannedEntities: rows.length,
        distinctPostcodes: allPostcodes.length,
        maxEntities,
        maxDistinctPostcodes,
      },
    });
  }

  if (allPostcodes.length === 0) {
    return {
      scannedEntities: rows.length,
      distinctPostcodes: 0,
      updatedEntities: 0,
      updatedPostcodes: 0,
      failedPostcodes: 0,
    };
  }

  const lookup = await bulkLookupPostcodes(allPostcodes, { signal: opts.signal });

  let updatedEntities = 0;
  let updatedPostcodes = 0;
  let failedPostcodes = 0;

  for (const pc of allPostcodes) {
    const res = lookup.get(pc);
    if (!res) {
      failedPostcodes++;
      continue;
    }

    const ids = idsByPostcode.get(pc) ?? [];
    if (ids.length === 0) continue;

    const ukCountry = res.country ?? null;
    const ukRegion = deriveUkRegion(ukCountry, res.region ?? null);
    const lat = res.latitude ?? null;
    const lng = res.longitude ?? null;

    await db
      .update(entities)
      .set({
        postalCode: pc,
        latitude: lat,
        longitude: lng,
        ukCountry,
        ukRegion,
        locationSource: "postcodes.io",
        locationUpdatedAt: new Date(),
      })
      .where(inArray(entities.id, ids));

    updatedPostcodes++;
    updatedEntities += ids.length;
  }

  if (opts.logger) {
    await opts.logger({
      level: "info",
      message: "Entity location enrichment: completed postcode batch",
      meta: { updatedEntities, updatedPostcodes, failedPostcodes },
    });
  }

  return {
    scannedEntities: rows.length,
    distinctPostcodes: allPostcodes.length,
    updatedEntities,
    updatedPostcodes,
    failedPostcodes,
  };
}


