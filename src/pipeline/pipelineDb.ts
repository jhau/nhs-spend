import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  pipelineAssets,
  pipelineRunLogs,
  pipelineRunStages,
  pipelineRuns,
} from "@/db/schema";

import type { PipelineLogLevel } from "./types";

export async function createPipelineRun(input: {
  assetId: number;
  dryRun: boolean;
  createdBy?: string | null;
}): Promise<{ runId: number }> {
  const [row] = await db
    .insert(pipelineRuns)
    .values({
      assetId: input.assetId,
      dryRun: input.dryRun,
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

