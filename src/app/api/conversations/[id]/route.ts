import { NextResponse } from "next/server";
import { db } from "@/db";
import { assistantConversations, assistantToolCalls } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getConversationHistory } from "@/lib/assistant/graph";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/conversations/[id]
 * Get a single conversation with messages and tool calls
 */
export async function GET(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    // Get conversation metadata
    const conversations = await db
      .select()
      .from(assistantConversations)
      .where(eq(assistantConversations.id, id))
      .limit(1);

    if (conversations.length === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const conversation = conversations[0];

    // Get messages from checkpointer
    const history = await getConversationHistory(id);

    // Get tool calls for this conversation
    const toolCalls = await db
      .select()
      .from(assistantToolCalls)
      .where(eq(assistantToolCalls.conversationId, id))
      .orderBy(assistantToolCalls.startedAt);

    return NextResponse.json({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: history?.messages || [],
      toolCalls,
    });
  } catch (e) {
    console.error("[Conversations API] GET [id] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to get conversation" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/conversations/[id]
 * Update conversation (e.g., title)
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();

    const updateData: { title?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };

    if (body.title) {
      updateData.title = body.title;
    }

    await db
      .update(assistantConversations)
      .set(updateData)
      .where(eq(assistantConversations.id, id));

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[Conversations API] PATCH [id] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update conversation" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/conversations/[id]
 * Delete a specific conversation
 */
export async function DELETE(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    await db
      .delete(assistantConversations)
      .where(eq(assistantConversations.id, id));

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[Conversations API] DELETE [id] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete conversation" },
      { status: 500 }
    );
  }
}
