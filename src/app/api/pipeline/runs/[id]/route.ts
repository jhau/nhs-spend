import { NextResponse } from "next/server";

import { getAsset, getRun, getRunLogs, getRunStages } from "@/pipeline/pipelineDb";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const run = await getRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const [asset, stages, logs] = await Promise.all([
    getAsset(run.assetId),
    getRunStages(runId),
    getRunLogs(runId, 500),
  ]);

  return NextResponse.json({ run, asset, stages, logs });
}

