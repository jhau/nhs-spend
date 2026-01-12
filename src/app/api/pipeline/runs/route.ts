import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { pipelineAssets, pipelineRuns } from "@/db/schema";
import { createPipelineRun } from "@/pipeline/pipelineDb";
import { enqueuePipelineRun } from "@/pipeline/webRunner";

type CreateRunRequest = {
  assetId?: number;
  dryRun?: boolean;
  orgType?: string;
  fromStageId?: string;
  toStageId?: string;
  params?: Record<string, any>;
};

export async function POST(req: Request) {
  const body = (await req.json()) as CreateRunRequest;
  const assetId = body?.assetId ? Number(body.assetId) : null;
  const dryRun = Boolean(body?.dryRun);
  const orgType = body?.orgType || "nhs";
  const fromStageId = body?.fromStageId;
  const toStageId = body?.toStageId;
  const params = body?.params;

  if (assetId !== null && (!Number.isInteger(assetId) || assetId <= 0)) {
    return NextResponse.json({ error: "assetId must be a positive integer" }, { status: 400 });
  }

  const { runId } = await createPipelineRun({ 
    assetId: assetId as any, // Cast because createPipelineRun might expect number
    dryRun,
    orgType,
    fromStageId,
    toStageId,
    params
  });
  enqueuePipelineRun(runId);

  return NextResponse.json({ runId });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  const assetIdParam = url.searchParams.get("assetId");

  const baseQuery = db
    .select()
    .from(pipelineRuns);

  const whereClause = assetIdParam ? eq(pipelineRuns.assetId, Number(assetIdParam)) : undefined;

  const totalCount = await db.$count(pipelineRuns, whereClause);

  const query = db
    .select()
    .from(pipelineRuns);

  if (whereClause) {
    query.where(whereClause);
  }

  query.orderBy(desc(pipelineRuns.createdAt))
    .limit(limit)
    .offset(offset);

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

  return NextResponse.json({ 
    runs: runsWithAssets,
    totalCount,
    limit,
    offset
  });
}

