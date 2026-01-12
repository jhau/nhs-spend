import { NextResponse } from "next/server";
import type { BaseMessageLike } from "@langchain/core/messages";

import { invokeAssistant } from "@/lib/assistant/graph";

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
  };
};

function uiMessageToText(m: UiMessage): string {
  return (m.parts ?? [])
    .filter((p) => p.type === "text" || p.type === "reasoning")
    .map((p: any) => String(p.text ?? ""))
    .join("");
}

export async function POST(req: Request) {
  const requestId = `assist-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  console.log(`[Assistant API] Request started: ${requestId}`);

  try {
    const body = (await req.json()) as ChatBody;
    const uiMessages = Array.isArray(body?.messages) ? body.messages : [];

    console.log(`[Assistant API] ${requestId} - Message count: ${uiMessages.length}`);

    const lcMessages: BaseMessageLike[] = uiMessages.map((m) => ({
      role: m.role,
      content: uiMessageToText(m),
    }));

    const lastUserMessage = [...uiMessages].reverse().find(m => m.role === 'user');
    const model = body.data?.model || lastUserMessage?.metadata?.model;

    const { text, metadata } = await invokeAssistant({ 
      messages: lcMessages,
      signal: req.signal,
      model: model
    });

    console.log(`[Assistant API] ${requestId} - Success. Response length: ${text.length}`);

    // Append metadata as a parseable block at the end
    const finalResponse = `${text}\n\n[METADATA:${JSON.stringify(metadata)}]`;

    return new Response(finalResponse, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      console.log(`[Assistant API] ${requestId} - Request aborted by user`);
      return new Response("Request aborted", { status: 499 });
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[Assistant API] ${requestId} - Error:`, e);

    return new Response(message, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}


