import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { matchSuppliersStage } from "@/pipeline/stages/matchSuppliers";
import type { PipelineContext } from "@/pipeline/types";
import { eq, sql } from "drizzle-orm";
import { RATE_LIMIT_MS } from "./companies-house";
import { createLogBatcher } from "./log-batcher";

let isRunning = false;
const batcher = createLogBatcher({
  totalProcessed: 0,
  matchedCount: 0,
  noMatchCount: 0,
  skippedCount: 0,
  errorCount: 0,
});

declare global {
  var backgroundMatcherStarted: boolean | undefined;
  var backgroundMatcherInterval: NodeJS.Timeout | undefined;
}

export function startBackgroundMatcher() {
  if (process.env.ENABLE_BACKGROUND_MATCHER !== "true") {
    return;
  }

  if (globalThis.backgroundMatcherStarted) {
    console.log(
      "Background matcher already started, skipping re-initialization."
    );
    return;
  }
  globalThis.backgroundMatcherStarted = true;

  console.log("Starting background supplier matcher (20 per 30s)...");

  const runBatch = async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const shouldLog = batcher.shouldLog();
      const ctx: PipelineContext = {
        db: db as any,
        runId: 0,
        dryRun: false,
        log: async (entry) => {
          if (entry.level === "warn" || entry.level === "error") {
            console.log(
              `[Background Matcher] [${entry.level.toUpperCase()}] ${
                entry.message
              }`,
              entry.meta || ""
            );
          }
        },
      };

      const result = await matchSuppliersStage.run(ctx, {
        limit: 20,
        autoMatchThreshold: 0.9,
        minSimilarityThreshold: 0.5,
      });

      if (result.metrics) {
        batcher.accumulate(result.metrics);
      }

      batcher.flush(async (metrics) => {
        // Check remaining pending suppliers
        const [countResult] = await db
          .select({ count: sql<number>`count(*)` })
          .from(suppliers)
          .where(eq(suppliers.matchStatus, "pending"));

        const remainingCount = Number(countResult?.count ?? 0);
        const estimatedMs = remainingCount * RATE_LIMIT_MS;
        const hours = Math.floor(estimatedMs / 3600000);
        const mins = Math.floor((estimatedMs % 3600000) / 60000);
        const secs = Math.floor((estimatedMs % 60000) / 1000);
        const timeStr =
          hours > 0
            ? `${hours}h ${mins}m`
            : mins > 0
            ? `${mins}m ${secs}s`
            : `${secs}s`;

        console.log(
          `[Background Matcher] Summary (last 60s): processed=${metrics.totalProcessed}, matched=${metrics.matchedCount}, skipped=${metrics.skippedCount}, errors=${metrics.errorCount}. Remaining: ${remainingCount} (est. ${timeStr})`
        );
      });
    } catch (err) {
      console.error("[Background Matcher] Fatal error in batch:", err);
    } finally {
      isRunning = false;
    }
  };

  // Run immediately on start, then every 30s
  void runBatch();
  globalThis.backgroundMatcherInterval = setInterval(runBatch, 30000);
}
