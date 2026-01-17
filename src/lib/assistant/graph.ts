import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { Annotation, StateGraph, END, START } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { z } from "zod";

import { pool } from "@/db";
import { getOpenRouterConfig } from "./config";
import {
  clampNonNegativeMs,
  createAssistantUsageRecord,
  extractOpenRouterUsageFromResponseMetadata,
  formatSqlForStorage,
  sumTokenUsage,
  type AssistantUsageRecord,
} from "./usageTracker";
import {
  executeSqlInputSchema,
  executeSqlSafe,
  formatSqlToolError,
} from "./sql/executeSqlSafe";
import { loadDatabaseSchemaForPrompt } from "./dbSchemaContext";
import { recordToolCallsBatch } from "./toolTracker";

const DATABASE_SCHEMA_FOR_PROMPT = loadDatabaseSchemaForPrompt();

// =============================================================================
// State Definition
// =============================================================================

// Schema for the structured plan output from Phase 1
const QueryPlanSchema = z.object({
  canAnswer: z
    .boolean()
    .describe("Whether this question can be answered with the available data"),
  clarificationNeeded: z
    .string()
    .optional()
    .describe(
      "If canAnswer is false, what clarification is needed from the user"
    ),
  tables: z.array(z.string()).describe("Tables needed for this query"),
  columns: z
    .array(z.string())
    .describe("Specific columns needed (format: table.column)"),
  metrics: z
    .array(z.string())
    .describe(
      "Aggregations or calculations needed (e.g., 'SUM(amount)', 'COUNT(*)')"
    ),
  filters: z
    .array(z.string())
    .describe("WHERE conditions needed (e.g., 'payment_date >= 2024-01-01')"),
  joins: z
    .array(z.string())
    .optional()
    .describe("JOIN conditions if multiple tables"),
  groupBy: z
    .array(z.string())
    .optional()
    .describe("GROUP BY columns if aggregating"),
  orderBy: z.string().optional().describe("ORDER BY clause if needed"),
  limit: z.number().optional().describe("LIMIT if needed"),
  reasoning: z.string().describe("Brief explanation of the query strategy"),
});

type QueryPlan = z.infer<typeof QueryPlanSchema>;

// LangGraph state annotation
const AssistantState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  plan: Annotation<QueryPlan | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  phase: Annotation<"planning" | "executing" | "done">({
    reducer: (_, next) => next,
    default: () => "planning",
  }),
  retryCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  dbTimeMs: Annotation<number>({
    reducer: (prev, next) => prev + next,
    default: () => 0,
  }),
  // Accumulated usage tracking
  rawLlmResponses: Annotation<any[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  toolCallSpans: Annotation<any[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});

type AssistantStateType = typeof AssistantState.State;

// =============================================================================
// Prompts
// =============================================================================

const PLANNING_PROMPT = `
You are a SQL query planner for a UK public sector spending database.

Your task is to analyze the user's question and create a structured query plan.
You do NOT execute queries - you only plan them.

DATABASE SCHEMA (this is the COMPLETE and AUTHORITATIVE schema - use ONLY these tables and columns):
${DATABASE_SCHEMA_FOR_PROMPT}

CRITICAL RULES:
1. ONLY use tables and columns that exist in the schema above
2. The "spend_entries" table has 5M+ rows - ALWAYS include a payment_date filter
3. There is NO table called "payments" - use "spend_entries" instead
4. If the question is ambiguous, set canAnswer=false and explain what clarification is needed

OUTPUT FORMAT:
Return a JSON object with these fields:
- canAnswer: boolean - can this question be answered with the available data?
- clarificationNeeded: string (optional) - what clarification is needed?
- tables: string[] - tables needed
- columns: string[] - columns needed (format: table.column)
- metrics: string[] - aggregations needed (e.g., "SUM(amount)")
- filters: string[] - WHERE conditions
- joins: string[] (optional) - JOIN conditions
- groupBy: string[] (optional) - GROUP BY columns
- orderBy: string (optional) - ORDER BY clause
- limit: number (optional) - LIMIT value
- reasoning: string - brief explanation of your query strategy

If no date range is specified, default to the last 12 months.
`.trim();

const EXECUTION_PROMPT = `
You are a SQL execution assistant for a UK public sector spending database.

A query plan has been created for you. Your job is to:
1. Generate the SQL query based on the plan
2. Execute it using the execute_sql tool
3. Interpret the results and answer the user's question

DATABASE SCHEMA:
${DATABASE_SCHEMA_FOR_PROMPT}

RULES:
- Follow the plan provided - do not deviate from it
- Do NOT query information_schema, pg_catalog, or any system tables
- Do NOT use semicolons at the end of SQL queries
- Always provide a 'reason' when calling execute_sql
- If the query fails, analyze the error and try to fix the SQL (max 2 retries)
`.trim();

const REPAIR_PROMPT = `
Your SQL query failed. Analyze the error and fix the query.

DATABASE SCHEMA:
${DATABASE_SCHEMA_FOR_PROMPT}

RULES:
- Use ONLY tables and columns from the schema above
- Do NOT query system tables (information_schema, pg_catalog)
- Ensure spend_entries queries have a payment_date filter
- Do NOT use semicolons at the end

Provide the corrected SQL and execute it.
`.trim();

// =============================================================================
// Checkpointer Setup
// =============================================================================

let checkpointerPromise: Promise<PostgresSaver> | null = null;

export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!checkpointerPromise) {
    checkpointerPromise = (async () => {
      const checkpointer = new PostgresSaver(pool);
      await checkpointer.setup();
      return checkpointer;
    })();
  }
  return checkpointerPromise;
}

// =============================================================================
// Tool Creation
// =============================================================================

function createExecuteSqlTool(
  toolCallSpans: any[],
  dbTimeMsRef: { value: number }
) {
  return tool(
    async (toolInput: unknown, config: any) => {
      const parsed = executeSqlInputSchema.parse(toolInput);
      console.log(`[Assistant Tool] execute_sql invoked:`, {
        reason: parsed.reason,
        sql: parsed.sql.slice(0, 200),
      });

      const spanStart = Date.now();
      const storedSql = await formatSqlForStorage(parsed.sql);
      const span = {
        toolName: "execute_sql",
        startedAt: new Date(spanStart).toISOString(),
        endedAt: new Date(spanStart).toISOString(),
        durationMs: 0,
        input: {
          reason: parsed.reason,
          sql: storedSql,
          maxRows: parsed.maxRows,
        } as Record<string, unknown>,
      };

      try {
        const result = await executeSqlSafe(parsed, config?.signal);
        dbTimeMsRef.value += result.meta.executionMs + result.meta.explainMs;
        console.log(
          `[Assistant Tool] execute_sql success: ${result.rowCount} rows in ${result.meta.executionMs}ms`
        );

        const spanEnd = Date.now();
        span.endedAt = new Date(spanEnd).toISOString();
        span.durationMs = spanEnd - spanStart;
        span.input = { ...span.input, sqlLength: parsed.sql.length };
        (span as any)["outputMeta"] = {
          rowCount: result.rowCount,
          truncated: result.truncated,
          executionMs: result.meta.executionMs,
          explainMs: result.meta.explainMs,
          explainSummary: result.meta.explainSummary,
        };
        (span as any)["success"] = true;
        toolCallSpans.push(span);

        return result;
      } catch (e) {
        console.error(`[Assistant Tool] execute_sql error:`, e);
        const spanEnd = Date.now();
        span.endedAt = new Date(spanEnd).toISOString();
        span.durationMs = spanEnd - spanStart;
        (span as any)["error"] = e instanceof Error ? e.message : String(e);
        (span as any)["success"] = false;
        toolCallSpans.push(span);
        throw new Error(formatSqlToolError(e));
      }
    },
    {
      name: "execute_sql",
      description:
        "Execute a read-only SQL query against Postgres. You MUST provide a 'reason' explaining the query purpose.",
      schema: executeSqlInputSchema,
    }
  );
}

// =============================================================================
// Graph Nodes
// =============================================================================

function createLlm(
  model: string,
  cfg: ReturnType<typeof getOpenRouterConfig>,
  rawLlmResponses: any[],
  responseFormat?: { type: "json_object" }
) {
  return new ChatOpenAI({
    apiKey: cfg.apiKey,
    model: model,
    temperature: 0,
    modelKwargs: {
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(cfg.baseURL?.includes("openrouter.ai") ||
      process.env.OPENROUTER_USAGE_ACCOUNTING === "1"
        ? { usage: { include: true }, include_usage: true }
        : {}),
    },
    configuration: {
      baseURL: cfg.baseURL,
      defaultHeaders: {
        ...(cfg.referer ? { "HTTP-Referer": cfg.referer } : {}),
        ...(cfg.title ? { "X-Title": cfg.title } : {}),
      },
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const response = await fetch(input, init);
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("chat/completions")) {
          const cloned = response.clone();
          try {
            const body = await cloned.json();
            rawLlmResponses.push(body);
            console.log(
              `[Assistant Graph] Captured raw OpenRouter response (ID: ${body.id})`
            );
          } catch (e) {
            console.error(`[Assistant Graph] Failed to log raw response:`, e);
          }
        }
        return response;
      },
    },
  });
}

async function planNode(
  state: AssistantStateType,
  config: any
): Promise<Partial<AssistantStateType>> {
  console.log(`[Assistant Graph] Planning node...`);
  const cfg = getOpenRouterConfig();
  const modelName = config?.configurable?.model || cfg.model;
  const rawLlmResponses: any[] = [];

  const llm = createLlm(modelName, cfg, rawLlmResponses, { type: "json_object" });

  // Extract user question from the last human message
  const humanMessages = state.messages.filter((m) => m._getType() === "human");
  const lastHumanMsg = humanMessages[humanMessages.length - 1];
  const userQuestion =
    typeof lastHumanMsg?.content === "string"
      ? lastHumanMsg.content
      : JSON.stringify(lastHumanMsg?.content ?? "");

  const planningMessages = [
    new SystemMessage(PLANNING_PROMPT),
    new HumanMessage(`Create a query plan for this question: ${userQuestion}`),
  ];

  const planResponse = await llm.invoke(planningMessages);

  const planContent =
    typeof planResponse.content === "string"
      ? planResponse.content
      : JSON.stringify(planResponse.content);

  let plan: QueryPlan;
  try {
    plan = QueryPlanSchema.parse(JSON.parse(planContent));
    console.log(`[Assistant Graph] Plan created:`, {
      canAnswer: plan.canAnswer,
      tables: plan.tables,
      reasoning: plan.reasoning,
    });
  } catch (e) {
    console.error(`[Assistant Graph] Planning failed:`, e);
    plan = {
      canAnswer: true,
      tables: ["spend_entries", "buyers", "suppliers", "entities"],
      columns: [],
      metrics: [],
      filters: ["payment_date >= CURRENT_DATE - INTERVAL '12 months'"],
      reasoning: "Planning phase failed, using fallback with common tables",
    };
  }

  // If clarification needed, return AI message with clarification
  if (!plan.canAnswer && plan.clarificationNeeded) {
    return {
      messages: [new AIMessage(plan.clarificationNeeded)],
      plan,
      phase: "done",
      rawLlmResponses,
    };
  }

  return {
    plan,
    phase: "executing",
    rawLlmResponses,
  };
}

async function executeNode(
  state: AssistantStateType,
  config: any
): Promise<Partial<AssistantStateType>> {
  console.log(`[Assistant Graph] Execute node...`);
  const cfg = getOpenRouterConfig();
  const modelName = config?.configurable?.model || cfg.model;
  const rawLlmResponses: any[] = [];
  const toolCallSpans: any[] = [];
  const dbTimeMsRef = { value: 0 };

  const executeSqlTool = createExecuteSqlTool(toolCallSpans, dbTimeMsRef);
  const llm = createLlm(modelName, cfg, rawLlmResponses);
  const llmWithTools = llm.bindTools([executeSqlTool]);

  const plan = state.plan!;
  const planSummary = `
QUERY PLAN (follow this plan):
- Tables: ${plan.tables.join(", ")}
- Columns: ${plan.columns.length > 0 ? plan.columns.join(", ") : "(determine from context)"}
- Metrics: ${plan.metrics.length > 0 ? plan.metrics.join(", ") : "(determine from context)"}
- Filters: ${plan.filters.length > 0 ? plan.filters.join(" AND ") : "payment_date >= CURRENT_DATE - INTERVAL '12 months'"}
- Joins: ${plan.joins?.join(", ") || "(as needed)"}
- Group By: ${plan.groupBy?.join(", ") || "(as needed)"}
- Order By: ${plan.orderBy || "(as needed)"}
- Limit: ${plan.limit || 100}
- Strategy: ${plan.reasoning}
`.trim();

  // Build message history for execution
  const execMessages: BaseMessage[] = [
    new SystemMessage(`${EXECUTION_PROMPT}\n\n${planSummary}`),
    ...state.messages,
  ];

  const MAX_ITERATIONS = 5;
  const MAX_RETRIES = 2;
  let retryCount = state.retryCount;
  const newMessages: BaseMessage[] = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    console.log(`[Assistant Graph] Execute iteration ${iteration + 1}...`);

    const response = await llmWithTools.invoke([...execMessages, ...newMessages]);

    // No tool calls = final answer
    if (!response.tool_calls || response.tool_calls.length === 0) {
      newMessages.push(response);
      break;
    }

    newMessages.push(response);

    // Process tool calls
    for (const toolCall of response.tool_calls) {
      if (toolCall.name === "execute_sql") {
        try {
          const result = await executeSqlTool.invoke(
            toolCall.args as { sql: string; reason: string; maxRows?: number }
          );
          newMessages.push({
            _getType: () => "tool",
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
            name: "execute_sql",
          } as any);
          retryCount = 0;
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.error(
            `[Assistant Graph] Tool error (retry ${retryCount}/${MAX_RETRIES}):`,
            errorMsg
          );

          if (retryCount < MAX_RETRIES) {
            retryCount++;
            newMessages.push({
              _getType: () => "tool",
              content: JSON.stringify({
                error: errorMsg,
                hint: "Review the schema and fix the query.",
              }),
              tool_call_id: toolCall.id,
              name: "execute_sql",
            } as any);
            newMessages.push(new SystemMessage(REPAIR_PROMPT));
          } else {
            newMessages.push({
              _getType: () => "tool",
              content: JSON.stringify({
                error: errorMsg,
                fatal: true,
                message: "Query failed after multiple retries.",
              }),
              tool_call_id: toolCall.id,
              name: "execute_sql",
            } as any);
          }
        }
      }
    }
  }

  return {
    messages: newMessages,
    phase: "done",
    retryCount,
    dbTimeMs: dbTimeMsRef.value,
    rawLlmResponses,
    toolCallSpans,
  };
}

// =============================================================================
// Graph Builder
// =============================================================================

function shouldContinue(state: AssistantStateType): "execute" | "end" {
  if (state.phase === "executing") return "execute";
  return "end";
}

function buildGraph() {
  const workflow = new StateGraph(AssistantState)
    .addNode("plan", planNode)
    .addNode("execute", executeNode)
    .addEdge(START, "plan")
    .addConditionalEdges("plan", shouldContinue, {
      execute: "execute",
      end: END,
    })
    .addEdge("execute", END);

  return workflow;
}

// =============================================================================
// Compiled Graph (lazy singleton)
// =============================================================================

let compiledGraphPromise: Promise<ReturnType<
  ReturnType<typeof buildGraph>["compile"]
>> | null = null;

async function getCompiledGraph() {
  if (!compiledGraphPromise) {
    compiledGraphPromise = (async () => {
      const checkpointer = await getCheckpointer();
      const workflow = buildGraph();
      return workflow.compile({ checkpointer });
    })();
  }
  return compiledGraphPromise;
}

// =============================================================================
// Public API
// =============================================================================

export async function invokeAssistant(input: {
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
  model?: string;
  requestId?: string;
  conversationId?: string; // thread_id for persistence
}): Promise<{
  text: string;
  rawMessages: unknown[];
  usageRecord: AssistantUsageRecord;
  conversationId: string;
  metadata: {
    totalTimeMs: number;
    llmTimeMs: number;
    dbTimeMs: number;
    tokens: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    costUsd?: number;
  };
}> {
  const startTime = Date.now();
  const conversationId =
    input.conversationId || `conv-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const requestId = input.requestId ?? `assist-${Date.now()}`;

  const usageRecord = createAssistantUsageRecord({
    requestId,
    model: input.model,
    messageCount: input.messages?.length ?? undefined,
  });

  console.log(
    `[Assistant Graph] Invoking with conversationId: ${conversationId}, model: ${input.model || "default"}`
  );

  const graph = await getCompiledGraph();

  // Convert input messages to LangChain BaseMessage format
  const lcMessages: BaseMessage[] = input.messages.map((m) => {
    if (m.role === "user" || m.role === "human") {
      return new HumanMessage(m.content);
    } else if (m.role === "assistant" || m.role === "ai") {
      return new AIMessage(m.content);
    } else {
      return new SystemMessage(m.content);
    }
  });

  // Invoke with thread_id for persistence
  const result = await graph.invoke(
    { messages: lcMessages },
    {
      configurable: {
        thread_id: conversationId,
        model: input.model,
      },
    }
  );

  const totalTimeMs = Date.now() - startTime;
  const dbTimeMs = result.dbTimeMs || 0;

  // Extract final response text from the last AI message
  const aiMessages = result.messages.filter(
    (m: BaseMessage) => m._getType() === "ai"
  );
  const lastAiMessage = aiMessages[aiMessages.length - 1];
  const finalText =
    typeof lastAiMessage?.content === "string"
      ? lastAiMessage.content
      : Array.isArray(lastAiMessage?.content)
        ? lastAiMessage.content.map((c: any) => c?.text ?? "").join("")
        : "No response produced.";

  // Aggregate token usage from raw LLM responses
  const rawLlmResponses = result.rawLlmResponses || [];
  const tokens = sumTokenUsage(
    rawLlmResponses.map((r: any) => ({
      promptTokens: r.usage?.prompt_tokens || 0,
      completionTokens: r.usage?.completion_tokens || 0,
      totalTokens: r.usage?.total_tokens || 0,
    }))
  );

  // Extract costs
  let totalCostUsd: number | undefined = undefined;
  let aggregatedCostDetails: Record<string, unknown> | null = null;

  for (const raw of rawLlmResponses) {
    const extracted = extractOpenRouterUsageFromResponseMetadata(raw);
    if (extracted.costUsd != null) {
      totalCostUsd = (totalCostUsd || 0) + extracted.costUsd;
    }
    if (extracted.costDetails) {
      aggregatedCostDetails = {
        ...(aggregatedCostDetails || {}),
        ...extracted.costDetails,
      };
    }
    usageRecord.llmCalls.push({
      model: raw.model || input.model,
      promptTokens: raw.usage?.prompt_tokens,
      completionTokens: raw.usage?.completion_tokens,
      totalTokens: raw.usage?.total_tokens,
      responseMetadata: raw,
      openRouterUsage: raw.usage,
    } as any);
  }

  // Copy tool call spans to usage record
  const toolCallSpans = result.toolCallSpans || [];
  for (const span of toolCallSpans) {
    usageRecord.toolCalls.push(span);
  }

  usageRecord.tokens = tokens;
  if (totalCostUsd != null) usageRecord.costUsd = totalCostUsd;
  usageRecord.costDetails = aggregatedCostDetails;

  // Persist tool calls to database (best-effort, non-blocking)
  recordToolCallsBatch(conversationId, requestId, toolCallSpans).catch((e) =>
    console.error(`[Assistant Graph] Failed to persist tool calls:`, e)
  );

  console.log(
    `[Assistant Graph] Complete. Total: ${totalTimeMs}ms, DB: ${dbTimeMs}ms`
  );

  return {
    text: finalText,
    rawMessages: result.messages,
    usageRecord,
    conversationId,
    metadata: {
      totalTimeMs,
      dbTimeMs,
      llmTimeMs: clampNonNegativeMs(totalTimeMs - dbTimeMs) ?? 0,
      tokens,
      costUsd: totalCostUsd,
    },
  };
}

/**
 * Get conversation history by loading state from the checkpointer
 */
export async function getConversationHistory(conversationId: string): Promise<{
  messages: Array<{ role: string; content: string }>;
} | null> {
  const checkpointer = await getCheckpointer();
  const config = { configurable: { thread_id: conversationId } };
  
  try {
    const checkpoint = await checkpointer.get(config);
    if (!checkpoint) return null;

    const state = checkpoint.channel_values as AssistantStateType;
    const messages = (state.messages || []).map((m: BaseMessage) => ({
      role: m._getType() === "human" ? "user" : m._getType() === "ai" ? "assistant" : "system",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));

    return { messages };
  } catch (e) {
    console.error(`[Assistant Graph] Failed to get history for ${conversationId}:`, e);
    return null;
  }
}
