import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import type { BaseMessageLike } from "@langchain/core/messages";
import { createAgent } from "langchain";

import { getOpenRouterConfig } from "./config";
import {
  executeSqlInputSchema,
  executeSqlSafe,
  formatSqlToolError,
} from "./sql/executeSqlSafe";
import { loadDatabaseSchemaForPrompt } from "./dbSchemaContext";

const DATABASE_SCHEMA_FOR_PROMPT = loadDatabaseSchemaForPrompt();

const SYSTEM_PROMPT = `
You are an analyst answering questions about UK public sector spending dataset stored in Postgres.

CRITICAL CONSTRAINTS - READ FIRST:
- NEVER query information_schema, pg_catalog, or any system tables. The schema is provided below.
- NEVER use tables named "payment" or "payments" - they do not exist. Use "spend_entries" instead.
- Only use tables/columns that appear in the provided schema reference. Queries against other tables will be rejected.

You MUST follow these rules:
- Only use the execute_sql tool for data access. Never fabricate numbers.
- Only generate read-only SQL: SELECT (optionally WITH ... SELECT). Never write/alter data.
- DO NOT use semicolons (;) at the end of your SQL queries.
- Always include a date range when querying spend_entries, unless doing a small aggregate with a tight LIMIT.
- Keep result sets small: use LIMIT and aggregates. Avoid SELECT *.
- If a user asks for something ambiguous (org name, time range), ask a clarifying question.

Database Schema Reference (public schema; generated from the live DB):
${DATABASE_SCHEMA_FOR_PROMPT}
`.trim();

const executeSqlTool = tool(
  async (input: unknown, config: any) => {
    const parsed = executeSqlInputSchema.parse(input);
    console.log(`[Assistant Tool] execute_sql invoked:`, {
      reason: parsed.reason,
      sql: parsed.sql,
    });
    try {
      const result = await executeSqlSafe(parsed, config?.signal);
      console.log(
        `[Assistant Tool] execute_sql success: ${result.rowCount} rows in ${result.meta.executionMs}ms`
      );
      return result;
    } catch (e) {
      console.error(`[Assistant Tool] execute_sql error:`, e);
      // Propagate a clear, user-actionable error back to the agent.
      throw new Error(formatSqlToolError(e));
    }
  },
  {
    name: "execute_sql",
    description:
      "Execute a guarded, read-only SQL query against Postgres and return a small result set. Use this to answer questions with exact numbers.",
    schema: executeSqlInputSchema,
  }
);

const agentCache = new Map<string, ReturnType<typeof createAgent>>();

function getAgent(modelName?: string) {
  const cfg = getOpenRouterConfig();
  const model = modelName || cfg.model;

  if (agentCache.has(model)) {
    return agentCache.get(model)!;
  }

  const defaultHeaders: Record<string, string> = {};
  if (cfg.referer) defaultHeaders["HTTP-Referer"] = cfg.referer;
  if (cfg.title) defaultHeaders["X-Title"] = cfg.title;

  const llm = new ChatOpenAI({
    apiKey: cfg.apiKey,
    model: model,
    temperature: 0,
    configuration: {
      baseURL: cfg.baseURL,
      defaultHeaders,
    },
  });

  const agent = createAgent({
    model: llm,
    tools: [executeSqlTool],
    messageModifier: SYSTEM_PROMPT,
  });

  agentCache.set(model, agent);
  return agent;
}

export async function invokeAssistant(input: {
  messages: BaseMessageLike[];
  signal?: AbortSignal;
  model?: string;
}): Promise<{ text: string; rawMessages: unknown[] }> {
  console.log(
    `[Assistant Graph] Invoking agent with model: ${
      input.model || "default"
    }...`
  );
  const agent = getAgent(input.model);

  const result: any = await agent.invoke(
    { messages: input.messages },
    {
      configurable: { thread_id: "nhs-spend-assistant" },
      signal: input.signal,
      recursionLimit: 100,
    }
  );

  const msgs: any[] = Array.isArray(result?.messages) ? result.messages : [];
  console.log(
    `[Assistant Graph] Agent invocation complete. Message count: ${msgs.length}`
  );

  // Log summary of messages for debugging
  msgs.forEach((m, i) => {
    const type = m?.type || m?._getType?.() || "unknown";
    const content =
      typeof m.content === "string"
        ? m.content.substring(0, 50)
        : "complex content";
    console.log(`  [msg ${i}] ${type}: ${content}...`);
  });

  const lastAi = [...msgs].reverse().find((m) => m?.type === "ai");
  const text =
    typeof lastAi?.content === "string"
      ? lastAi.content
      : Array.isArray(lastAi?.content)
      ? lastAi.content.map((c: any) => c?.text ?? "").join("")
      : "";

  return { text: text || "No response produced.", rawMessages: msgs };
}
