import { db } from "@/db";
import { pipelineAssets } from "@/db/schema";
import { presignObjectUrl } from "@/pipeline/objectStorage";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const assetId = parseInt(id);

  if (isNaN(assetId)) {
    return NextResponse.json({ error: "Invalid asset ID" }, { status: 400 });
  }

  const [asset] = await db
    .select()
    .from(pipelineAssets)
    .where(eq(pipelineAssets.id, assetId))
    .limit(1);

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const downloadUrl = presignObjectUrl({
    method: "GET",
    objectKey: asset.objectKey,
    expiresSeconds: 60, // 1 minute is enough for redirect
  });

  return NextResponse.redirect(downloadUrl);
}

