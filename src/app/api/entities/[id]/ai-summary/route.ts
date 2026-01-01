import { NextResponse } from "next/server";
import { refreshAISummary } from "@/lib/ai-summary";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const entityId = parseInt(id);

  try {
    const entityRes = await db
      .select({
        id: entities.id,
        name: entities.name,
        aiSummary: entities.aiSummary,
        aiNews: entities.aiNews,
        aiSummaryUpdatedAt: entities.aiSummaryUpdatedAt,
      })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1);

    const entity = entityRes[0];
    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // refreshAISummary handles the 24h cache logic internally
    const aiResult = await refreshAISummary(
      entity.id,
      entity.name,
      entity.aiSummaryUpdatedAt
    );

    if (aiResult) {
      return NextResponse.json(aiResult);
    }

    // If no refresh was needed, return the cached data
    return NextResponse.json({
      summary: entity.aiSummary,
      news: entity.aiNews,
    });
  } catch (error) {
    console.error("Error in AI summary API:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

