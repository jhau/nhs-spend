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
- The COMPLETE database schema is provided below. Do NOT run queries to inspect table structure.
- NEVER query information_schema, pg_catalog, or any system tables.
- NEVER use tables named "payment" or "payments" - they do not exist. Use "spend_entries" instead.
- Only use tables/columns that appear in the provided schema reference. Queries against other tables will be rejected.

SPEND_ENTRIES TABLE RULES (5M+ rows - our largest table):
- You MUST always include a WHERE clause with payment_date filter (e.g., payment_date >= '2024-01-01')
- Queries without a date filter will be REJECTED by the query validator
- Also consider filtering by buyer_id for better performance
- If no date is specified by the user, use a sensible recent default (e.g., last 12 months)

You MUST follow these rules:
- Only use the execute_sql tool for data access. Never fabricate numbers.
- When using execute_sql, ALWAYS provide a concise 'reason' for the query.
- Only generate read-only SQL: SELECT (optionally WITH ... SELECT). Never write/alter data.
- DO NOT use semicolons (;) at the end of your SQL queries.
- Keep result sets small: use LIMIT and aggregates. Avoid SELECT *.
- If a user asks for something ambiguous (org name, time range), ask a clarifying question.

Database Schema Reference (public schema; generated from the live DB):
${DATABASE_SCHEMA_FOR_PROMPT}
`.trim();

// remove getAgent and executeSqlTool from here as they are now inside invokeAssistant to capture closure variables for timing

export async function invokeAssistant(input: {
  messages: BaseMessageLike[];
  signal?: AbortSignal;
  model?: string;
}): Promise<{
  text: string;
  rawMessages: unknown[];
  metadata: { totalTimeMs: number; dbTimeMs: number };
}> {
  const startTime = Date.now();
  let dbTimeMs = 0;

  console.log(
    `[Assistant Graph] Invoking agent with model: ${
      input.model || "default"
    }...`
  );

  const cfg = getOpenRouterConfig();
  const model = input.model || cfg.model;

  const llm = new ChatOpenAI({
    apiKey: cfg.apiKey,
    model: model,
    temperature: 0,
    configuration: {
      baseURL: cfg.baseURL,
      defaultHeaders: {
        ...(cfg.referer ? { "HTTP-Referer": cfg.referer } : {}),
        ...(cfg.title ? { "X-Title": cfg.title } : {}),
      },
    },
  });

  const executeSqlTool = tool(
    async (toolInput: unknown, config: any) => {
      const parsed = executeSqlInputSchema.parse(toolInput);
      console.log(`[Assistant Tool] execute_sql invoked:`, {
        reason: parsed.reason,
        sql: parsed.sql,
      });
      try {
        const result = await executeSqlSafe(parsed, config?.signal);
        dbTimeMs += result.meta.executionMs;
        console.log(
          `[Assistant Tool] execute_sql success: ${result.rowCount} rows in ${result.meta.executionMs}ms`
        );
        return result;
      } catch (e) {
        console.error(`[Assistant Tool] execute_sql error:`, e);
        throw new Error(formatSqlToolError(e));
      }
    },
    {
      name: "execute_sql",
      description:
        "Execute a guarded, read-only SQL query against Postgres and return a small result set. Use this to answer questions with exact numbers. You MUST provide a 'reason' explaining why this query is necessary.",
      schema: executeSqlInputSchema,
    }
  );

  const agent = createAgent({
    model: llm,
    tools: [executeSqlTool],
    messageModifier: SYSTEM_PROMPT,
  });

  const result: any = await agent.invoke(
    { messages: input.messages },
    {
      configurable: { thread_id: "nhs-spend-assistant" },
      signal: input.signal,
      recursionLimit: 100,
    }
  );

  const msgs: any[] = Array.isArray(result?.messages) ? result.messages : [];
  const totalTimeMs = Date.now() - startTime;

  console.log(
    `[Assistant Graph] Agent invocation complete. Message count: ${msgs.length}, Total time: ${totalTimeMs}ms, DB time: ${dbTimeMs}ms`
  );

  const lastAi = [...msgs].reverse().find((m) => m?.type === "ai");
  const text =
    typeof lastAi?.content === "string"
      ? lastAi.content
      : Array.isArray(lastAi?.content)
      ? lastAi.content.map((c: any) => c?.text ?? "").join("")
      : "";

  return {
    text: text || "No response produced.",
    rawMessages: msgs,
    metadata: { totalTimeMs, dbTimeMs },
  };
}
