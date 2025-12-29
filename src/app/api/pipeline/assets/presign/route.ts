import crypto from "node:crypto";

import { NextResponse } from "next/server";
import { eq, and, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { pipelineAssets } from "@/db/schema";
import { presignObjectUrl } from "@/pipeline/objectStorage";

type PresignRequest = {
  originalName: string;
  contentType?: string;
  sizeBytes: number;
  checksum?: string;
  force?: boolean; // If true, proceed even if duplicate checksum exists
};

export async function POST(req: Request) {
  const body = (await req.json()) as PresignRequest;

  if (!body?.originalName || typeof body.originalName !== "string") {
    return NextResponse.json({ error: "originalName is required" }, { status: 400 });
  }
  if (!Number.isFinite(body.sizeBytes) || body.sizeBytes <= 0) {
    return NextResponse.json({ error: "sizeBytes must be > 0" }, { status: 400 });
  }

  // Check for duplicate checksum if provided
  if (body.checksum && !body.force) {
    const existingAssets = await db
      .select({
        id: pipelineAssets.id,
        originalName: pipelineAssets.originalName,
        sizeBytes: pipelineAssets.sizeBytes,
        createdAt: pipelineAssets.createdAt,
      })
      .from(pipelineAssets)
      .where(and(eq(pipelineAssets.checksum, body.checksum), isNotNull(pipelineAssets.checksum)))
      .limit(5);

    if (existingAssets.length > 0) {
      return NextResponse.json(
        {
          error: "duplicate_checksum",
          message: "An asset with the same checksum already exists",
          duplicateAssets: existingAssets,
        },
        { status: 409 }
      );
    }
  }

  const safeName = body.originalName.replace(/[^\w.\-() ]+/gu, "_").slice(0, 200);
  const objectKey = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;

  const [asset] = await db
    .insert(pipelineAssets)
    .values({
      objectKey,
      originalName: body.originalName,
      contentType: body.contentType ?? null,
      sizeBytes: Math.trunc(body.sizeBytes),
      checksum: body.checksum ?? null,
    })
    .returning({ id: pipelineAssets.id, objectKey: pipelineAssets.objectKey });

  const uploadUrl = presignObjectUrl({
    method: "PUT",
    objectKey: asset.objectKey,
    expiresSeconds: 15 * 60,
  });

  return NextResponse.json({
    assetId: asset.id,
    objectKey: asset.objectKey,
    uploadUrl,
  });
}

