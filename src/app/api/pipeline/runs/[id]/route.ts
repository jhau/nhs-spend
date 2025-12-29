import { db } from "@/db";
import { spendEntries, pipelineRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  getAsset,
  getRun,
  getRunLogs,
  getRunStages,
  getSkippedRows,
  countSkippedRows,
  getRunSuppliers,
  countRunSuppliers,
  getRunDateRange,
} from "@/pipeline/pipelineDb";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const skippedLimit = Math.min(Number(searchParams.get("skippedLimit") || "100"), 1000);
  const skippedOffset = Math.max(Number(searchParams.get("skippedOffset") || "0"), 0);
  const suppliersLimit = Math.min(Number(searchParams.get("suppliersLimit") || "50"), 200);
  const suppliersOffset = Math.max(Number(searchParams.get("suppliersOffset") || "0"), 0);

  const run = await getRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const [asset, stages, logs, skippedRows, skippedRowsCount, suppliers, suppliersCount, dateRange] = await Promise.all([
    run.assetId ? getAsset(run.assetId) : Promise.resolve(null),
    getRunStages(runId),
    getRunLogs(runId, 500),
    getSkippedRows(runId, skippedLimit, skippedOffset),
    countSkippedRows(runId),
    getRunSuppliers(runId, suppliersLimit, suppliersOffset),
    countRunSuppliers(runId),
    getRunDateRange(runId),
  ]);

  return NextResponse.json({
    run,
    asset,
    stages,
    logs,
    skippedRows,
    skippedRowsCount,
    skippedRowsLimit: skippedLimit,
    skippedRowsOffset: skippedOffset,
    suppliers,
    suppliersCount,
    suppliersLimit,
    suppliersOffset,
    dateRange,
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  try {
    const run = await getRun(runId);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    await db.transaction(async (tx) => {
      // 1. If it was an import run, delete all spend entries for that asset
      if (run.assetId) {
        await tx.delete(spendEntries).where(eq(spendEntries.assetId, run.assetId));
      }

      // 2. Mark the run as deleted instead of removing it
      await tx
        .update(pipelineRuns)
        .set({ status: "deleted", finishedAt: new Date() })
        .where(eq(pipelineRuns.id, runId));
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting run:", error);
    return NextResponse.json(
      { error: "Failed to delete run and data" },
      { status: 500 }
    );
  }
}

