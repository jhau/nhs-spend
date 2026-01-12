import { db } from "@/db";
import { entities } from "@/db/schema";
import { enrichEntityLocationsFromPostcodesIo } from "@/lib/entity-location-enrichment";
import type { PipelineContext } from "@/pipeline/types";
import { and, isNotNull, isNull, or, sql } from "drizzle-orm";

let isRunning = false;

declare global {
  // eslint-disable-next-line no-var
  var backgroundEntityEnricherStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var backgroundEntityEnricherInterval: NodeJS.Timeout | undefined;
}

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function startBackgroundEntityEnricher() {
  if (process.env.ENABLE_BACKGROUND_ENTITY_ENRICHER !== "true") {
    return;
  }

  if (globalThis.backgroundEntityEnricherStarted) {
    console.log(
      "Background entity enricher already started, skipping re-initialization."
    );
    return;
  }
  globalThis.backgroundEntityEnricherStarted = true;

  const intervalMs = envNumber("ENTITY_ENRICHER_INTERVAL_MS", 30_000);
  const postcodeBatchSize = envNumber(
    "ENTITY_ENRICHER_POSTCODE_BATCH_SIZE",
    100
  );
  const maxEntities = envNumber("ENTITY_ENRICHER_MAX_ENTITIES", 5000);

  console.log(
    `Starting background entity enricher (${postcodeBatchSize} postcodes per ${Math.round(
      intervalMs / 1000
    )}s)...`
  );

  const runBatch = async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(entities)
        .where(
          and(
            isNotNull(entities.postalCode),
            or(
              isNull(entities.latitude),
              isNull(entities.longitude),
              isNull(entities.ukRegion),
              isNull(entities.ukCountry)
            )
          )
        );

      const remaining = Number(countRow?.count ?? 0);
      console.log(
        `[Background Entity Enricher] ${remaining} entities remain with postcode but missing lat/lon or region`
      );

      if (remaining === 0) return;

      const ctx: PipelineContext = {
        db: db as any,
        runId: 0,
        dryRun: false,
        log: async (entry) => {
          console.log(
            `[Background Entity Enricher] [${entry.level.toUpperCase()}] ${
              entry.message
            }`,
            entry.meta || ""
          );
        },
      };

      await enrichEntityLocationsFromPostcodesIo(ctx.db, {
        maxEntities,
        maxDistinctPostcodes: Math.min(100, Math.max(1, postcodeBatchSize)),
        logger: ctx.log,
      });
    } catch (err) {
      console.error("[Background Entity Enricher] Fatal error in batch:", err);
    } finally {
      isRunning = false;
    }
  };

  void runBatch();
  globalThis.backgroundEntityEnricherInterval = setInterval(runBatch, intervalMs);
}


