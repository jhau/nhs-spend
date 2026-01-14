import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { pipelineAssets, pipelineRuns, pipelineRunStages } from "@/db/schema";
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
  console.log(`[API] POST /api/pipeline/runs received body:`, JSON.stringify(body, null, 2));
  
  const assetId = body?.assetId ? Number(body.assetId) : null;
  const dryRun = Boolean(body?.dryRun);
  const orgType = body?.orgType || "nhs";
  const fromStageId = body?.fromStageId;
  const toStageId = body?.toStageId;
  const params = body?.params;

  console.log(`[API] Creating run: assetId=${assetId}, orgType=${orgType}, fromStageId=${fromStageId}`);

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
  const search = url.searchParams.get("search");

  let whereClause: any = undefined;
  if (assetIdParam) {
    whereClause = eq(pipelineRuns.assetId, Number(assetIdParam));
  }

  if (search) {
    const searchFilter = ilike(pipelineAssets.originalName, `%${search}%`);
    whereClause = whereClause ? and(whereClause, searchFilter) : searchFilter;
  }

  // Count query
  let totalCount: number;
  if (search) {
    const countRes = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(pipelineRuns)
      .innerJoin(pipelineAssets, eq(pipelineRuns.assetId, pipelineAssets.id))
      .where(whereClause);
    totalCount = countRes[0]?.count ?? 0;
  } else {
    totalCount = await db.$count(pipelineRuns, whereClause);
  }

  // Main query
  let runs;
  if (search) {
    const rows = await db
      .select({
        run: pipelineRuns,
        asset: {
          id: pipelineAssets.id,
          originalName: pipelineAssets.originalName
        }
      })
      .from(pipelineRuns)
      .innerJoin(pipelineAssets, eq(pipelineRuns.assetId, pipelineAssets.id))
      .where(whereClause)
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(limit)
      .offset(offset);
    
    runs = rows.map(r => ({
      ...r.run,
      assetOriginalName: r.asset.originalName,
      metrics: null as any // Placeholder for now
    }));
  } else {
    const query = db
      .select()
      .from(pipelineRuns);

    if (whereClause) {
      query.where(whereClause);
    }

    query.orderBy(desc(pipelineRuns.createdAt))
      .limit(limit)
      .offset(offset);

    const baseRuns = await query;

    // Fetch assets for runs that have assetId
    const assetIds = baseRuns.map(r => r.assetId).filter((id): id is number => id !== null);
    const assets = assetIds.length > 0
      ? await db
          .select({ id: pipelineAssets.id, originalName: pipelineAssets.originalName })
          .from(pipelineAssets)
          .where(inArray(pipelineAssets.id, assetIds))
      : [];

    const assetMap = new Map(assets.map(a => [a.id, a.originalName]));

    runs = baseRuns.map(run => ({
      ...run,
      assetOriginalName: run.assetId ? assetMap.get(run.assetId) ?? null : null,
      metrics: null as any // Placeholder for now
    }));
  }

  // Fetch metrics for the import stage of each run
  const runIds = runs.map(r => r.id);
  if (runIds.length > 0) {
    const stages = await db
      .select({
        runId: pipelineRunStages.runId,
        stageId: pipelineRunStages.stageId,
        metrics: pipelineRunStages.metrics
      })
      .from(pipelineRunStages)
      .where(and(
        inArray(pipelineRunStages.runId, runIds),
        inArray(pipelineRunStages.stageId, [
          "importSpendExcel",
          "importCouncilSpendExcel",
          "importGovDeptSpendExcel"
        ])
      ));

    const metricsMap = new Map<number, any>();
    for (const stage of stages) {
      metricsMap.set(stage.runId, stage.metrics);
    }

    for (const run of runs) {
      run.metrics = metricsMap.get(run.id) ?? null;
    }
  }

  return NextResponse.json({ 
    runs,
    totalCount,
    limit,
    offset
  });
}

