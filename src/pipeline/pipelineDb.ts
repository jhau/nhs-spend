import { and, eq, count, sql, min, max } from "drizzle-orm";

import { db } from "@/db";
import {
  companies,
  pipelineAssets,
  pipelineRunLogs,
  pipelineRunStages,
  pipelineRuns,
  pipelineSkippedRows,
  spendEntries,
  suppliers,
} from "@/db/schema";

import type { PipelineLogLevel } from "./types";

export async function createPipelineRun(input: {
  assetId?: number | null;
  dryRun: boolean;
  createdBy?: string | null;
  fromStageId?: string;
  toStageId?: string;
}): Promise<{ runId: number }> {
  const [row] = await db
    .insert(pipelineRuns)
    .values({
      assetId: input.assetId ?? null,
      dryRun: input.dryRun,
      fromStageId: input.fromStageId ?? null,
      toStageId: input.toStageId ?? null,
      trigger: "web",
      createdBy: input.createdBy ?? null,
      status: "queued",
    })
    .returning({ id: pipelineRuns.id });

  return { runId: row.id };
}

export async function setPipelineRunStatus(
  runId: number,
  patch: Partial<{
    status: string;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>
) {
  await db.update(pipelineRuns).set(patch).where(eq(pipelineRuns.id, runId));
}

export async function ensureRunStageRow(runId: number, stageId: string) {
  const existing = await db
    .select({ id: pipelineRunStages.id })
    .from(pipelineRunStages)
    .where(and(eq(pipelineRunStages.runId, runId), eq(pipelineRunStages.stageId, stageId)))
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(pipelineRunStages).values({
    runId,
    stageId,
    status: "queued",
  });
}

export async function setRunStageStatus(
  runId: number,
  stageId: string,
  patch: Partial<{
    status: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    metrics: Record<string, unknown> | null;
    error: string | null;
  }>
) {
  await ensureRunStageRow(runId, stageId);
  await db
    .update(pipelineRunStages)
    .set(patch)
    .where(and(eq(pipelineRunStages.runId, runId), eq(pipelineRunStages.stageId, stageId)));
}

export async function appendRunLog(input: {
  runId: number;
  level: PipelineLogLevel;
  message: string;
  meta?: Record<string, unknown>;
}) {
  await db.insert(pipelineRunLogs).values({
    runId: input.runId,
    level: input.level,
    message: input.message,
    meta: input.meta ?? null,
  });
}

export async function getAsset(assetId: number) {
  const rows = await db
    .select()
    .from(pipelineAssets)
    .where(eq(pipelineAssets.id, assetId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRun(runId: number) {
  const rows = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, runId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRunStages(runId: number) {
  return await db
    .select()
    .from(pipelineRunStages)
    .where(eq(pipelineRunStages.runId, runId));
}

export async function getRunLogs(runId: number, limit = 500) {
  // drizzle-orm: no easy desc ordering without sql helper; keep simple for now by relying on default insertion order.
  const rows = await db
    .select()
    .from(pipelineRunLogs)
    .where(eq(pipelineRunLogs.runId, runId))
    .limit(limit);
  return rows;
}

export async function getSkippedRows(runId: number, limit = 1000, offset = 0) {
  return await db
    .select()
    .from(pipelineSkippedRows)
    .where(eq(pipelineSkippedRows.runId, runId))
    .limit(limit)
    .offset(offset);
}

export async function countSkippedRows(runId: number) {
  const [row] = await db
    .select({ count: count() })
    .from(pipelineSkippedRows)
    .where(eq(pipelineSkippedRows.runId, runId));
  return row?.count ?? 0;
}

export async function getRunSuppliers(runId: number, limit = 50, offset = 0) {
  const run = await getRun(runId);
  if (!run || !run.assetId) return [];

  return await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      matchStatus: suppliers.matchStatus,
      matchConfidence: suppliers.matchConfidence,
      companyId: suppliers.companyId,
      companyName: companies.companyName,
      companyNumber: companies.companyNumber,
      createdAt: suppliers.createdAt,
      updatedAt: suppliers.updatedAt,
    })
    .from(suppliers)
    .innerJoin(spendEntries, eq(suppliers.id, spendEntries.supplierId))
    .leftJoin(companies, eq(suppliers.companyId, companies.id))
    .where(eq(spendEntries.assetId, run.assetId))
    .groupBy(suppliers.id, companies.id)
    .limit(limit)
    .offset(offset);
}

export async function countRunSuppliers(runId: number) {
  const run = await getRun(runId);
  if (!run || !run.assetId) return 0;

  const [row] = await db
    .select({
      count: sql<number>`count(distinct ${suppliers.id})::int`,
    })
    .from(suppliers)
    .innerJoin(spendEntries, eq(suppliers.id, spendEntries.supplierId))
    .where(eq(spendEntries.assetId, run.assetId));

  return row?.count ?? 0;
}

export async function getRunDateRange(runId: number) {
  const run = await getRun(runId);
  if (!run || !run.assetId) return null;

  const [row] = await db
    .select({
      minDate: min(spendEntries.paymentDate),
      maxDate: max(spendEntries.paymentDate),
    })
    .from(spendEntries)
    .where(eq(spendEntries.assetId, run.assetId));

  if (!row || !row.minDate || !row.maxDate) return null;

  return {
    minDate: row.minDate,
    maxDate: row.maxDate,
  };
}

