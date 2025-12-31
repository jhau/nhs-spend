import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { matchSuppliersStage } from "@/pipeline/stages/matchSuppliers";
import type { PipelineContext } from "@/pipeline/types";
import { eq, sql } from "drizzle-orm";

let isRunning = false;

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
      // Check remaining pending suppliers
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(suppliers)
        .where(eq(suppliers.matchStatus, "pending"));

      const remainingCount = Number(result?.count ?? 0);

      if (remainingCount === 0) {
        // Log occasionally even when empty so user knows it's alive,
        // but don't spam.
        return;
      }

      console.log(
        `[Background Matcher] ${remainingCount} suppliers remaining. Running batch of 20...`
      );

      const ctx: PipelineContext = {
        db: db as any,
        runId: 0,
        dryRun: false,
        log: async (entry) => {
          console.log(
            `[Background Matcher] [${entry.level.toUpperCase()}] ${
              entry.message
            }`,
            entry.meta || ""
          );
        },
      };

      await matchSuppliersStage.run(ctx, {
        limit: 20,
        autoMatchThreshold: 0.9,
        minSimilarityThreshold: 0.5,
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
