import { sql } from "drizzle-orm";
import type { PipelineStage } from "../types";

export type RefreshEntitySpendTotalsInput = {
  assetId: number;
};

function uniqNumbers(values: number[]) {
  return Array.from(new Set(values)).filter((n) => Number.isFinite(n));
}

export const refreshEntitySpendTotalsStage: PipelineStage<RefreshEntitySpendTotalsInput> = {
  id: "refreshEntitySpendTotals",
  title: "Refresh cached entity spend totals",
  async run(ctx, input) {
    const startTime = Date.now();

    if (!input?.assetId || Number.isNaN(Number(input.assetId))) {
      throw new Error("refreshEntitySpendTotals requires input.assetId");
    }

    if (ctx.dryRun) {
      await ctx.log({
        level: "info",
        message: "Dry run: skipping entity spend totals refresh",
        meta: { assetId: input.assetId },
      });
      return { status: "skipped", metrics: { dryRun: true } };
    }

    // Find entity IDs impacted by this asset's spend entries
    const buyerEntityRes = await ctx.db.execute(
      sql.raw(`
        SELECT DISTINCT b.entity_id AS entity_id
        FROM spend_entries se
        JOIN buyers b ON b.id = se.buyer_id
        WHERE se.asset_id = ${input.assetId}
          AND b.entity_id IS NOT NULL
      `)
    );

    const supplierEntityRes = await ctx.db.execute(
      sql.raw(`
        SELECT DISTINCT s.entity_id AS entity_id
        FROM spend_entries se
        JOIN suppliers s ON s.id = se.supplier_id
        WHERE se.asset_id = ${input.assetId}
          AND s.entity_id IS NOT NULL
      `)
    );

    const buyerEntityIds = uniqNumbers(
      (buyerEntityRes.rows as any[]).map((r) => Number(r.entity_id))
    );
    const supplierEntityIds = uniqNumbers(
      (supplierEntityRes.rows as any[]).map((r) => Number(r.entity_id))
    );

    const allEntityIds = uniqNumbers([...buyerEntityIds, ...supplierEntityIds]);
    if (allEntityIds.length === 0) {
      await ctx.log({
        level: "info",
        message: "No entity totals to refresh for asset",
        meta: { assetId: input.assetId },
      });
      return { status: "succeeded", metrics: { refreshedEntities: 0 } };
    }

    const idList = allEntityIds.join(",");

    // Reset cached totals for affected entities (handles deletions/reimports)
    await ctx.db.execute(
      sql.raw(`
        UPDATE entities
        SET buyer_total_spend = 0,
            supplier_total_received = 0,
            spend_totals_updated_at = NOW()
        WHERE id IN (${idList})
      `)
    );

    // Buyer spend totals
    if (buyerEntityIds.length > 0) {
      const buyerIdList = buyerEntityIds.join(",");
      await ctx.db.execute(
        sql.raw(`
          UPDATE entities e
          SET buyer_total_spend = COALESCE(src.total_spend, 0),
              spend_totals_updated_at = NOW()
          FROM (
            SELECT b.entity_id AS entity_id, SUM(se.amount) AS total_spend
            FROM spend_entries se
            JOIN buyers b ON b.id = se.buyer_id
            WHERE b.entity_id IN (${buyerIdList})
            GROUP BY b.entity_id
          ) AS src
          WHERE e.id = src.entity_id
        `)
      );
    }

    // Supplier receipts totals
    if (supplierEntityIds.length > 0) {
      const supplierIdList = supplierEntityIds.join(",");
      await ctx.db.execute(
        sql.raw(`
          UPDATE entities e
          SET supplier_total_received = COALESCE(src.total_received, 0),
              spend_totals_updated_at = NOW()
          FROM (
            SELECT s.entity_id AS entity_id, SUM(se.amount) AS total_received
            FROM spend_entries se
            JOIN suppliers s ON s.id = se.supplier_id
            WHERE s.entity_id IN (${supplierIdList})
            GROUP BY s.entity_id
          ) AS src
          WHERE e.id = src.entity_id
        `)
      );
    }

    const durationMs = Date.now() - startTime;
    await ctx.log({
      level: "info",
      message: "Entity spend totals refreshed",
      meta: {
        assetId: input.assetId,
        refreshedEntities: allEntityIds.length,
        buyerEntities: buyerEntityIds.length,
        supplierEntities: supplierEntityIds.length,
        durationMs,
      },
    });

    return {
      status: "succeeded",
      metrics: {
        assetId: input.assetId,
        refreshedEntities: allEntityIds.length,
        buyerEntities: buyerEntityIds.length,
        supplierEntities: supplierEntityIds.length,
        durationMs,
      },
    };
  },
};

