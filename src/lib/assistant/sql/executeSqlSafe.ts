import { z } from "zod";
import { enforceExplainGate, summarizeExplainJson } from "./explainGate";
import { runExplainJson, runReadonlyQuery } from "./runReadonlyQuery";
import { SqlValidationError, validateReadonlySql } from "./validateSql";

export const executeSqlInputSchema = z.object({
  sql: z.string().min(1),
  maxRows: z.number().int().positive().optional(),
  reason: z.string().optional(),
});

export type ExecuteSqlInput = z.infer<typeof executeSqlInputSchema>;

export type ExecuteSqlResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  meta: {
    executionMs: number;
    explainMs: number;
    explainSummary: {
      totalCost: number | null;
      planRows: number | null;
      hasSeqScanOnSpendEntries: boolean;
      hasSeqScanOnSpendEntriesWithoutFilter: boolean;
      nodeTypes: string[];
    };
  };
};

const DEFAULT_MAX_ROWS = 200;
const HARD_MAX_ROWS = 500;

const DEFAULT_DENIED_FUNCTIONS = new Set<string>([
  "pg_sleep",
  "dblink_connect",
  "dblink_exec",
  "dblink_open",
  "dblink_fetch",
  "dblink_close",
  "lo_import",
  "lo_export",
  "pg_read_file",
  "pg_write_file",
  "pg_ls_dir",
  "copy_database",
  "set_config",
]);

const DEFAULT_ALLOWED_TABLES = new Set<string>([
  // Spend / pipeline
  "public.spend_entries",
  "public.pipeline_assets",
  "public.pipeline_runs",
  "public.pipeline_run_stages",
  "public.pipeline_run_logs",
  "public.pipeline_skipped_rows",
  "public.audit_log",

  // Entity registry / matching
  "public.entities",
  "public.companies",
  "public.nhs_organisations",
  "public.councils",
  "public.government_departments",
  "public.suppliers",
  "public.buyers",

  // Contracts cache
  "public.contracts",
  "public.contract_supplier_searches",

  // Legacy schema reference (kept for backward-compatibility)
  "public.spend_entries",
]);

function clampRows(requested: number | undefined) {
  const n = requested ?? DEFAULT_MAX_ROWS;
  return Math.min(Math.max(1, n), HARD_MAX_ROWS);
}

function applyLimit(
  sql: string,
  statement: any,
  limit: number
): { sql: string; truncated: boolean } {
  // If top-level is a simple SELECT and has no LIMIT, append a LIMIT clause.
  if (statement?.type === "select") {
    const hasLimit = Boolean(statement?.limit?.limit);
    if (!hasLimit) {
      return { sql: `${sql}\nLIMIT ${limit}`, truncated: true };
    }

    // If LIMIT exists but is larger than our cap, wrap.
    const limExpr = statement?.limit?.limit;
    const numericLimit =
      limExpr?.type === "integer" || limExpr?.type === "numeric"
        ? Number(limExpr.value)
        : null;
    if (numericLimit != null && numericLimit > limit) {
      return {
        sql: `SELECT * FROM (\n${sql}\n) AS q\nLIMIT ${limit}`,
        truncated: true,
      };
    }
    return { sql, truncated: false };
  }

  // For UNION/WITH/etc. we clamp by wrapping.
  return {
    sql: `SELECT * FROM (\n${sql}\n) AS q\nLIMIT ${limit}`,
    truncated: true,
  };
}

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function executeSqlSafe(
  input: ExecuteSqlInput,
  signal?: AbortSignal
): Promise<ExecuteSqlResult> {
  const parsed = executeSqlInputSchema.parse(input);
  const maxRows = clampRows(parsed.maxRows);

  console.log(
    `[executeSqlSafe] Validating SQL: ${parsed.sql.substring(0, 100)}${
      parsed.sql.length > 100 ? "..." : ""
    }`
  );
  const { statement, normalizedSql } = validateReadonlySql(parsed.sql, {
    allowedTables: DEFAULT_ALLOWED_TABLES,
    enforcePublicSchema: true,
    deniedFunctions: DEFAULT_DENIED_FUNCTIONS,
  });

  const limited = applyLimit(normalizedSql, statement, maxRows);

  const timeouts = {
    statementTimeoutMs: envNumber("SQL_STATEMENT_TIMEOUT_MS", 30 * 1000),
    lockTimeoutMs: envNumber("SQL_LOCK_TIMEOUT_MS", 5 * 1000),
    idleInTxTimeoutMs: envNumber("SQL_IDLE_IN_TX_TIMEOUT_MS", 20 * 1000),
    signal,
  };

  console.log(`[executeSqlSafe] Running EXPLAIN...`);
  const explain = await runExplainJson(limited.sql, timeouts);
  const explainSummary = summarizeExplainJson(explain.planJson);

  console.log(
    `[executeSqlSafe] Plan cost: ${explainSummary.totalCost}, Rows: ${explainSummary.planRows}`
  );
  enforceExplainGate(explainSummary, {
    maxTotalCost: envNumber("SQL_MAX_TOTAL_COST", 5_000_000),
    maxPlanRows: envNumber("SQL_MAX_PLAN_ROWS", 2_000_000),
    rejectSeqScanOnSpendEntriesWithoutFilter: true,
  });

  console.log(`[executeSqlSafe] Executing query...`);
  const query = await runReadonlyQuery(limited.sql, timeouts);

  const columns = query.fields.map((f) => f.name);
  const rows = query.rows as Record<string, unknown>[];

  return {
    columns,
    rows,
    rowCount: rows.length,
    truncated: limited.truncated || rows.length >= maxRows,
    meta: {
      executionMs: query.executionMs,
      explainMs: explain.executionMs,
      explainSummary: {
        totalCost: explainSummary.totalCost,
        planRows: explainSummary.planRows,
        hasSeqScanOnSpendEntries: explainSummary.hasSeqScanOnSpendEntries,
        hasSeqScanOnSpendEntriesWithoutFilter:
          explainSummary.hasSeqScanOnSpendEntriesWithoutFilter,
        nodeTypes: Array.from(explainSummary.nodeTypes),
      },
    },
  };
}

export function formatSqlToolError(e: unknown): string {
  if (e instanceof SqlValidationError) {
    // Include allowed tables hint for table errors
    if (e.message.includes("Table not allowed")) {
      const allowed = Array.from(DEFAULT_ALLOWED_TABLES)
        .map((t) => t.replace(/^public\./, ""))
        .sort()
        .join(", ");
      return `${e.message}. Allowed tables: ${allowed}. For payment/spending data, use "spend_entries" (and always filter by a date range).`;
    }
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
