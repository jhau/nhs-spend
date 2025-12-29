import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { pipelineAssets, pipelineRuns } from "@/db/schema";
import { createPipelineRun } from "@/pipeline/pipelineDb";
import { enqueuePipelineRun } from "@/pipeline/webRunner";

type CreateRunRequest = {
  assetId?: number;
  dryRun?: boolean;
  fromStageId?: string;
  toStageId?: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as CreateRunRequest;
  const assetId = body?.assetId ? Number(body.assetId) : null;
  const dryRun = Boolean(body?.dryRun);
  const fromStageId = body?.fromStageId;
  const toStageId = body?.toStageId;

  if (assetId !== null && (!Number.isInteger(assetId) || assetId <= 0)) {
    return NextResponse.json({ error: "assetId must be a positive integer" }, { status: 400 });
  }

  const { runId } = await createPipelineRun({ 
    assetId: assetId as any, // Cast because createPipelineRun might expect number
    dryRun,
    fromStageId,
    toStageId
  });
  enqueuePipelineRun(runId);

  return NextResponse.json({ runId });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
  const assetIdParam = url.searchParams.get("assetId");

  const baseQuery = db
    .select()
    .from(pipelineRuns);

  const query = assetIdParam
    ? baseQuery
        .where(eq(pipelineRuns.assetId, Number(assetIdParam)))
        .orderBy(desc(pipelineRuns.createdAt))
        .limit(limit)
    : baseQuery.orderBy(desc(pipelineRuns.createdAt)).limit(limit);

  const runs = await query;

  // Fetch assets for runs that have assetId
  const assetIds = runs.map(r => r.assetId).filter((id): id is number => id !== null);
  const assets = assetIds.length > 0
    ? await db
        .select({ id: pipelineAssets.id, originalName: pipelineAssets.originalName })
        .from(pipelineAssets)
        .where(inArray(pipelineAssets.id, assetIds))
    : [];

  const assetMap = new Map(assets.map(a => [a.id, a.originalName]));

  // Merge asset names into runs
  const runsWithAssets = runs.map(run => ({
    ...run,
    assetOriginalName: run.assetId ? assetMap.get(run.assetId) ?? null : null,
  }));

  return NextResponse.json({ runs: runsWithAssets });
}

