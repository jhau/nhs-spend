import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MCP_POSTGRES_URL =
  process.env.MCP_POSTGRES_URL ?? "http://localhost:8000/sse";
const MCP_CHART_URL = process.env.MCP_CHART_URL ?? "http://localhost:8001/sse";

// Cache MCP client and tools
let mcpClientPromise: MultiServerMCPClient | null = null;
let toolsPromise: Promise<any[]> | null = null;

async function getTools() {
  if (!toolsPromise) {
    if (!MCP_POSTGRES_URL) {
      throw new Error("MCP_POSTGRES_URL is not configured.");
    }
    if (!MCP_CHART_URL) {
      throw new Error("MCP_CHART_URL is not configured.");
    }

    if (!mcpClientPromise) {
      mcpClientPromise = new MultiServerMCPClient({
        postgres: {
          transport: "sse",
          url: MCP_POSTGRES_URL,
        },
        chart: {
          transport: "sse",
          url: MCP_CHART_URL,
        },
      });
    }

    toolsPromise = mcpClientPromise
      .getTools()
      .then((tools) => {
        console.log("[getTools] Tools fetched:", {
          toolCount: tools.length,
          //toolNames: tools.map((t) => t.name),
        });
        return tools;
      })
      .catch((error) => {
        console.error("[getTools] Error:", error);
        toolsPromise = null;
        throw error;
      });
  }

  return toolsPromise;
}

export async function POST(req: Request) {
  const requestId = `req-${Date.now()}-${Math.random()
    .toString(36)
    .substring(7)}`;
  const startTime = Date.now();

  try {
    // Parse request body
    const body = await req.json();
    console.log(`[POST /api/chat] Request body:`, {
      requestId,
      body,
    });

    // Get LangChain tools from MCP adapter
    console.log(`[POST /api/chat] Fetching LangChain tools from MCP:`, {
      requestId,
    });
    const tools = await getTools();
    if (!tools || tools.length === 0) {
      throw new Error("Failed to fetch MCP tools");
    }
    const toolNames = tools.map((t: any) => t.name);

    // Build system prompt
    const systemPrompt =
      "You are a helpful analyst assisting with questions about NHS spending data. " +
      "You have access to Model Context Protocol tools from two servers:\n" +
      "1. Postgres MCP server - for querying the NHS spending database (schema: public)\n" +
      "2. AntV Chart MCP server - for generating visualizations (25+ chart types including line, bar, pie, area, scatter, heatmap, treemap, and more)\n\n" +
      (toolNames.length > 0
        ? `Available tools: ${toolNames.join(", ")}.\n\n`
        : "") +
      "Workflow:\n" +
      "- First, analyze table structures using list_objects and get_object_details tools\n" +
      "- Query the database to get the data needed\n" +
      "- When presenting numerical data, generate appropriate charts using the chart generation tools\n" +
      "- Choose chart types that best visualize the data (e.g., line charts for trends, bar charts for comparisons, pie charts for proportions)\n" +
      "- Return concise explanations, highlight key figures, and include visualizations when helpful.";

    console.log(`[POST /api/chat] System prompt:`, {
      requestId,
      systemPrompt,
      promptLength: systemPrompt.length,
      toolCount: tools.length,
      //toolNames,
    });

    // Convert messages to LangChain format
    const { messages: uiMessages }: { messages: any[] } = body;

    // Convert UI messages to LangChain message format
    const langChainMessages = uiMessages.map((msg: any) => {
      const content =
        typeof msg.parts?.[0] === "string"
          ? msg.parts[0]
          : msg.parts?.[0]?.text || msg.content || "";

      if (msg.role === "user") {
        return { role: "human" as const, content };
      } else if (msg.role === "assistant") {
        return { role: "ai" as const, content };
      } else {
        return { role: "system" as const, content };
      }
    });

    console.log(`[POST /api/chat] Creating LangChain agent:`, {
      requestId,
      toolCount: tools.length,
      messageCount: langChainMessages.length,
    });

    // Create LangChain model (non-streaming)
    const model = new ChatOpenAI({
      model: "gpt-5",
      streaming: false,
    });

    // Create agent with tools using createAgent
    const agent = await createAgent({
      model,
      tools,
    });

    console.log(`[POST /api/chat] Invoking LangChain agent:`, {
      requestId,
      messageCount: langChainMessages.length,
    });

    // Add system message to the beginning of messages
    const messagesWithSystem = [
      { role: "system" as const, content: systemPrompt },
      ...langChainMessages,
    ];

    // Invoke the agent and get complete response
    const response = await agent.invoke({
      messages: messagesWithSystem,
    });

    console.log(`[POST /api/chat] Agent response received:`, {
      requestId,
      response,
    });

    // Extract all relevant messages (skip system and human messages from input)
    const relevantMessages = response.messages.slice(messagesWithSystem.length);

    // Build a structured response with tool calls and final content
    const responseContent: any[] = [];

    for (const msg of relevantMessages) {
      const msgType = msg._getType();
      const msgData = msg as any; // Type assertion for accessing LangChain message properties

      // Handle AI messages with tool calls
      if (
        msgType === "ai" &&
        msgData.tool_calls &&
        msgData.tool_calls.length > 0
      ) {
        for (const toolCall of msgData.tool_calls) {
          responseContent.push({
            type: "tool-call",
            toolName: toolCall.name,
            args: toolCall.args,
            toolCallId: toolCall.id,
          });
        }
      }
      // Handle tool result messages
      else if (msgType === "tool") {
        responseContent.push({
          type: "tool-result",
          toolName: msgData.name,
          result: msg.content,
          toolCallId: msgData.tool_call_id,
        });
      }
      // Handle final AI message with content
      else if (msgType === "ai" && msg.content) {
        responseContent.push({
          type: "text",
          content: msg.content,
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[POST /api/chat] Request completed successfully:`, {
      requestId,
      totalDuration: `${totalDuration}ms`,
      timestamp: new Date().toISOString(),
      responseContentItems: responseContent.length,
    });

    // Return the complete response as JSON with structured parts
    return NextResponse.json({
      role: "assistant",
      parts: responseContent,
    });
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[POST /api/chat] Error occurred:`, {
      requestId,
      error,
      errorType: error?.constructor?.name,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      totalDuration: `${totalDuration}ms`,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error while processing the chat request.",
      },
      { status: 500 }
    );
  }
}
