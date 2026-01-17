import { db } from "@/db";
import { assistantRequests, assistantConversations } from "@/db/schema";
import { invokeAssistant } from "@/lib/assistant/graph";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

type UiPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: string; [k: string]: unknown };

type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: UiPart[];
  metadata?: any;
};

type ChatBody = {
  // AI SDK UI message format
  messages?: UiMessage[];
  // Back-compat for the older `{ role, content }` format (if ever used)
  legacyMessages?: { role: "user" | "assistant" | "system"; content: string }[];
  data?: {
    model?: string;
    conversationId?: string; // Thread ID for persistence
  };
};

function uiMessageToText(m: UiMessage): string {
  return (m.parts ?? [])
    .filter((p) => p.type === "text" || p.type === "reasoning")
    .map((p: any) => String(p.text ?? ""))
    .join("");
}

/**
 * Generate a title from the first user message (truncated)
 */
function generateTitle(messages: UiMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) return "New conversation";
  const text = uiMessageToText(firstUserMsg);
  return text.length > 60 ? text.slice(0, 60) + "..." : text;
}

export async function POST(req: Request) {
  const requestId = `assist-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  console.log(`[Assistant API] Request started: ${requestId}`);

  let conversationId: string | undefined;

  try {
    const body = (await req.json()) as ChatBody;
    const uiMessages = Array.isArray(body?.messages) ? body.messages : [];
    conversationId = body.data?.conversationId;

    console.log(
      `[Assistant API] ${requestId} - Message count: ${uiMessages.length}, conversationId: ${conversationId || "new"}`
    );

    const messages = uiMessages.map((m) => ({
      role: m.role,
      content: uiMessageToText(m),
    }));

    const lastUserMessage = [...uiMessages].reverse().find((m) => m.role === "user");
    const model = body.data?.model || lastUserMessage?.metadata?.model;

    const { text, metadata, usageRecord, conversationId: returnedConvId } =
      await invokeAssistant({
        messages,
        signal: req.signal,
        model: model,
        requestId,
        conversationId,
      });

    // Use the returned conversationId (may be generated if not provided)
    conversationId = returnedConvId;

    console.log(
      `[Assistant API] ${requestId} - Success. Response length: ${text.length}, conversationId: ${conversationId}`
    );

    // Persist/update conversation metadata (best-effort)
    try {
      const existing = await db
        .select()
        .from(assistantConversations)
        .where(eq(assistantConversations.id, conversationId))
        .limit(1);

      if (existing.length === 0) {
        // New conversation - insert with auto-generated title
        await db.insert(assistantConversations).values({
          id: conversationId,
          title: generateTitle(uiMessages),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        // Existing conversation - update timestamp
        await db
          .update(assistantConversations)
          .set({ updatedAt: new Date() })
          .where(eq(assistantConversations.id, conversationId));
      }
    } catch (e) {
      console.error(`[Assistant API] ${requestId} - Failed to persist conversation:`, e);
    }

    // Persist usage (best-effort; should not fail the request)
    try {
      await db.insert(assistantRequests).values({
        requestId,
        conversationId,
        model: model ?? null,
        messageCount: uiMessages.length,

        totalTimeMs: metadata.totalTimeMs,
        llmTimeMs: metadata.llmTimeMs,
        dbTimeMs: metadata.dbTimeMs,

        promptTokens: metadata.tokens.promptTokens,
        completionTokens: metadata.tokens.completionTokens,
        totalTokens: metadata.tokens.totalTokens,

        costUsd: metadata.costUsd != null ? String(metadata.costUsd) : null,
        costDetails: usageRecord.costDetails ?? null,

        llmCalls: usageRecord.llmCalls ?? null,
        toolCalls: usageRecord.toolCalls ?? null,

        status: "ok",
        errorMessage: null,
      });
    } catch (e) {
      console.error(`[Assistant API] ${requestId} - Failed to persist usage:`, e);
    }

    const toolCallCount = Array.isArray(usageRecord.toolCalls)
      ? usageRecord.toolCalls.length
      : 0;

    // Append metadata as a parseable block at the end
    const finalResponse = `${text}\n\n[METADATA:${JSON.stringify({
      requestId,
      conversationId,
      model: model ?? null,
      ...metadata,
      toolCalls: { count: toolCallCount },
    })}]`;

    return new Response(finalResponse, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      console.log(`[Assistant API] ${requestId} - Request aborted by user`);

      // Best-effort persist aborted request
      try {
        await db.insert(assistantRequests).values({
          requestId,
          conversationId: conversationId ?? null,
          model: null,
          messageCount: null,
          totalTimeMs: null,
          llmTimeMs: null,
          dbTimeMs: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          costUsd: null,
          costDetails: null,
          llmCalls: null,
          toolCalls: null,
          status: "aborted",
          errorMessage: "Request aborted",
        });
      } catch (persistErr) {
        console.error(
          `[Assistant API] ${requestId} - Failed to persist aborted usage:`,
          persistErr
        );
      }

      return new Response("Request aborted", { status: 499 });
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[Assistant API] ${requestId} - Error:`, e);

    // Best-effort persist error request
    try {
      await db.insert(assistantRequests).values({
        requestId,
        conversationId: conversationId ?? null,
        model: null,
        messageCount: null,
        totalTimeMs: null,
        llmTimeMs: null,
        dbTimeMs: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        costUsd: null,
        costDetails: null,
        llmCalls: null,
        toolCalls: null,
        status: "error",
        errorMessage: message,
      });
    } catch (persistErr) {
      console.error(
        `[Assistant API] ${requestId} - Failed to persist error usage:`,
        persistErr
      );
    }

    return new Response(message, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
