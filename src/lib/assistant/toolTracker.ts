import { db } from "@/db";
import { assistantToolCalls } from "@/db/schema";
import { eq } from "drizzle-orm";

export type ToolCallRecord = {
  conversationId: string;
  requestId?: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  success: boolean;
  errorMessage?: string;
};

/**
 * Record a single tool call to the database.
 * This is called after each tool invocation completes.
 */
export async function recordToolCall(record: ToolCallRecord): Promise<void> {
  try {
    await db.insert(assistantToolCalls).values({
      conversationId: record.conversationId,
      requestId: record.requestId ?? null,
      toolName: record.toolName,
      input: record.input,
      output: record.output ?? null,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt ?? null,
      durationMs: record.durationMs ?? null,
      success: record.success,
      errorMessage: record.errorMessage ?? null,
    });
  } catch (e) {
    // Best-effort logging - don't fail the main operation
    console.error(`[ToolTracker] Failed to record tool call:`, e);
  }
}

/**
 * Record multiple tool calls in batch.
 */
export async function recordToolCallsBatch(
  conversationId: string,
  requestId: string | undefined,
  spans: Array<{
    toolName: string;
    startedAt: string;
    endedAt?: string;
    durationMs?: number;
    input?: Record<string, unknown>;
    outputMeta?: Record<string, unknown>;
    error?: string;
    success?: boolean;
  }>
): Promise<void> {
  if (spans.length === 0) return;

  try {
    const values = spans.map((span) => ({
      conversationId,
      requestId: requestId ?? null,
      toolName: span.toolName,
      input: span.input ?? {},
      output: span.outputMeta ?? null,
      startedAt: new Date(span.startedAt),
      finishedAt: span.endedAt ? new Date(span.endedAt) : null,
      durationMs: span.durationMs ?? null,
      success: span.success ?? !span.error,
      errorMessage: span.error ?? null,
    }));

    await db.insert(assistantToolCalls).values(values);
    console.log(`[ToolTracker] Recorded ${spans.length} tool calls for conversation ${conversationId}`);
  } catch (e) {
    console.error(`[ToolTracker] Failed to record tool calls batch:`, e);
  }
}

/**
 * Get tool calls for a conversation (for display/debugging)
 */
export async function getToolCallsForConversation(
  conversationId: string
): Promise<typeof assistantToolCalls.$inferSelect[]> {
  return db
    .select()
    .from(assistantToolCalls)
    .where(eq(assistantToolCalls.conversationId, conversationId))
    .orderBy(assistantToolCalls.startedAt);
}
