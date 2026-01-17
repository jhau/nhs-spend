import { NextResponse } from "next/server";
import { db } from "@/db";
import { assistantConversations } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const runtime = "nodejs";

/**
 * GET /api/conversations
 * List all conversations, ordered by most recently updated
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    const conversations = await db
      .select({
        id: assistantConversations.id,
        title: assistantConversations.title,
        createdAt: assistantConversations.createdAt,
        updatedAt: assistantConversations.updatedAt,
      })
      .from(assistantConversations)
      .orderBy(desc(assistantConversations.updatedAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ conversations });
  } catch (e) {
    console.error("[Conversations API] GET error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list conversations" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/conversations
 * Create a new conversation
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = body.title || "New conversation";
    const id =
      body.id || `conv-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    await db.insert(assistantConversations).values({
      id,
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({ id, title });
  } catch (e) {
    console.error("[Conversations API] POST error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create conversation" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/conversations?id=xxx
 * Delete a conversation
 */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing conversation id" }, { status: 400 });
    }

    await db
      .delete(assistantConversations)
      .where(eq(assistantConversations.id, id));

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[Conversations API] DELETE error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete conversation" },
      { status: 500 }
    );
  }
}
