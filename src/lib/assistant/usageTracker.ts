export type AssistantToolCallSpan = {
  toolName: string;
  startedAt: string; // ISO
  endedAt: string; // ISO
  durationMs: number;
  input?: Record<string, unknown>;
  outputMeta?: Record<string, unknown>;
  error?: string;
};

export type AssistantLlmCallSpan = {
  model?: string;
  startedAt?: string; // ISO (best-effort; may be omitted)
  endedAt?: string; // ISO
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  responseMetadata?: Record<string, unknown>;
  openRouterUsage?: Record<string, unknown>;
};

export type AssistantUsageSummary = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type AssistantUsageRecord = {
  requestId: string;
  ts: string; // ISO
  model?: string;
  messageCount?: number;
  status: "ok" | "error" | "aborted";
  errorMessage?: string;

  totalTimeMs?: number;
  llmTimeMs?: number;
  dbTimeMs?: number;

  tokens: AssistantUsageSummary;

  // Best-effort cost fields (OpenRouter usage accounting)
  costUsd?: number;
  costDetails?: Record<string, unknown> | null;

  llmCalls: AssistantLlmCallSpan[];
  toolCalls: AssistantToolCallSpan[];
};

function safeNumber(n: unknown): number | undefined {
  const v = typeof n === "string" ? Number(n) : (n as any);
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function clampNonNegativeMs(n: number | undefined): number | undefined {
  if (n == null) return undefined;
  return n < 0 ? 0 : n;
}

export function getSqlStorageMode(): "truncated" | "hash" | "none" | "full" {
  const raw = (process.env.ASSISTANT_USAGE_SQL_MODE ?? "truncated").toLowerCase();
  if (raw === "full" || raw === "hash" || raw === "none" || raw === "truncated") {
    return raw;
  }
  return "truncated";
}

async function sha256Hex(input: string): Promise<string> {
  // Use WebCrypto when available (Node 18+ provides global crypto.subtle)
  const cryptoAny: any = globalThis.crypto as any;
  if (!cryptoAny?.subtle) {
    // Fallback: avoid pulling in node:crypto to keep this lightweight.
    // If subtle isn't available, just return a stable-ish string.
    return `no_subtle:${input.length}`;
  }
  const enc = new TextEncoder().encode(input);
  const digest = await cryptoAny.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function formatSqlForStorage(sql: string): Promise<string | undefined> {
  const mode = getSqlStorageMode();
  if (mode === "none") return undefined;
  if (mode === "full") return sql;
  if (mode === "truncated") return sql.length > 800 ? `${sql.slice(0, 800)}…` : sql;
  // hash
  const h = await sha256Hex(sql);
  return `sha256:${h}`;
}

export function extractTokenUsageFromAiMessage(m: any): AssistantUsageSummary | null {
  const usage = m?.usage_metadata;
  if (usage) {
    const promptTokens = safeNumber(usage.input_tokens);
    const completionTokens = safeNumber(usage.output_tokens);
    const totalTokens = safeNumber(usage.total_tokens);
    if (promptTokens != null || completionTokens != null || totalTokens != null) {
      return {
        promptTokens: promptTokens ?? 0,
        completionTokens: completionTokens ?? 0,
        totalTokens: totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0),
      };
    }
  }

  const tokenUsage = m?.response_metadata?.tokenUsage;
  if (tokenUsage) {
    const promptTokens = safeNumber(tokenUsage.promptTokens);
    const completionTokens = safeNumber(tokenUsage.completionTokens);
    const totalTokens = safeNumber(tokenUsage.totalTokens);
    if (promptTokens != null || completionTokens != null || totalTokens != null) {
      return {
        promptTokens: promptTokens ?? 0,
        completionTokens: completionTokens ?? 0,
        totalTokens: totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0),
      };
    }
  }

  return null;
}

function findValueDeep(obj: any, keyPattern: RegExp): any {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k in obj) {
    if (keyPattern.test(k)) return obj[k];
    if (typeof obj[k] === "object") {
      const v = findValueDeep(obj[k], keyPattern);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

export function extractOpenRouterUsageFromResponseMetadata(
  responseMetadata: any
): { usage?: Record<string, unknown>; costUsd?: number; costDetails?: Record<string, unknown> } {
  // OpenRouter usage accounting (best-effort): shape may vary by model/provider.
  // We keep raw usage, and try a few common fields.
  const usage = 
    responseMetadata?.usage ?? 
    responseMetadata?.openrouter_usage ?? 
    responseMetadata?.openRouterUsage ??
    findValueDeep(responseMetadata, /usage/i);
  
  const usageObj = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : undefined;

  const costCandidate =
    responseMetadata?.cost ??
    responseMetadata?.usage?.cost ??
    responseMetadata?.usage?.total_cost ??
    responseMetadata?.usage?.totalCost ??
    responseMetadata?.openrouter?.cost ??
    responseMetadata?.openrouter?.usage?.cost ??
    findValueDeep(responseMetadata, /cost/i);
  
  const costUsd = safeNumber(costCandidate);

  const costDetails =
    (responseMetadata?.cost_details as any) ??
    (responseMetadata?.usage?.cost_details as any) ??
    (responseMetadata?.usage?.costDetails as any) ??
    (responseMetadata?.openrouter?.cost_details as any) ??
    findValueDeep(responseMetadata, /cost_details|costDetails/i) ??
    null;

  return {
    usage: usageObj,
    costUsd,
    costDetails: costDetails && typeof costDetails === "object" ? (costDetails as Record<string, unknown>) : undefined,
  };
}

export function createAssistantUsageRecord(seed: {
  requestId: string;
  model?: string;
  messageCount?: number;
}): AssistantUsageRecord {
  return {
    requestId: seed.requestId,
    ts: new Date().toISOString(),
    model: seed.model,
    messageCount: seed.messageCount,
    status: "ok",
    tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    llmCalls: [],
    toolCalls: [],
  };
}

export function sumTokenUsage(usages: Array<AssistantUsageSummary | null | undefined>): AssistantUsageSummary {
  return usages.reduce<AssistantUsageSummary>(
    (acc, u) => {
      if (!u) return acc;
      acc.promptTokens += u.promptTokens || 0;
      acc.completionTokens += u.completionTokens || 0;
      acc.totalTokens += u.totalTokens || 0;
      return acc;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  );
}

