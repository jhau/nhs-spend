import { astVisitor, parse, Statement, toSql } from "pgsql-ast-parser";

export type ValidateSqlOptions = {
  /**
   * Tables the assistant is allowed to reference (schema-qualified names are normalized to `schema.table`).
   * If omitted, table allowlisting is not enforced.
   */
  allowedTables?: Set<string>;
  /** If provided, schema must be `public` (or omitted). */
  enforcePublicSchema?: boolean;
  /** Reject function calls with these names (lowercased). */
  deniedFunctions?: Set<string>;
};

export class SqlValidationError extends Error {
  name = "SqlValidationError";
}

function normalizeTableName(q: any): string {
  const schema = (q?.schema as string | undefined) ?? undefined;
  const name = (q?.name as string | undefined) ?? "";
  return schema ? `${schema}.${name}` : name;
}

function isSelectLikeStatementType(type: string): boolean {
  return (
    type === "select" ||
    type === "union" ||
    type === "union all" ||
    type === "with" ||
    type === "with recursive" ||
    type === "values"
  );
}

export function validateReadonlySql(
  sql: string,
  opts: ValidateSqlOptions = {}
): { statement: Statement; normalizedSql: string } {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new SqlValidationError("SQL is empty.");
  }

  let statements: Statement[];
  try {
    statements = parse(trimmed);
  } catch (e) {
    throw new SqlValidationError(
      `Invalid SQL (failed to parse): ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (statements.length !== 1) {
    throw new SqlValidationError("Only a single SQL statement is allowed.");
  }

  const statement = statements[0];
  const stmtType = (statement as any)?.type;
  if (typeof stmtType !== "string" || !isSelectLikeStatementType(stmtType)) {
    throw new SqlValidationError("Only SELECT queries are allowed.");
  }

  // Reject locking clauses (SELECT ... FOR UPDATE/SHARE/etc.)
  const lockCheckVisitor = astVisitor((v) => ({
    select: (s: any) => {
      if (s?.for) {
        throw new SqlValidationError("SELECT ... FOR <lock> is not allowed.");
      }
      return v.super().select(s);
    },
  }));
  lockCheckVisitor.statement(statement);

  const usedTables = new Set<string>();

  const visit = astVisitor((v) => ({
    fromCall: (from: any) => {
      // Disallow function calls in FROM (generate_series, dblink, etc.)
      throw new SqlValidationError("Function calls in FROM are not allowed.");
    },
    fromTable: (from: any) => {
      const qname = from?.name;
      const normalized = normalizeTableName(qname);
      if (!normalized) {
        throw new SqlValidationError("Invalid table reference.");
      }

      if (opts.enforcePublicSchema && qname?.schema && qname.schema !== "public") {
        throw new SqlValidationError("Only the public schema is allowed.");
      }

      usedTables.add(normalized);
      return v.super().fromTable(from);
    },
    call: (c: any) => {
      const fn = normalizeTableName(c?.function).toLowerCase(); // schema.name or name
      const fnName = (c?.function?.name as string | undefined)?.toLowerCase() ?? fn;
      const denied = opts.deniedFunctions;
      if (denied && (denied.has(fnName) || denied.has(fn))) {
        throw new SqlValidationError(`Function ${fnName} is not allowed.`);
      }
      return v.super().call(c);
    },
  }));

  visit.statement(statement);

  if (opts.allowedTables && opts.allowedTables.size > 0) {
    for (const t of usedTables) {
      // Normalize unqualified names to allowlist entries either as `table` or `public.table`.
      const ok = opts.allowedTables.has(t) || opts.allowedTables.has(`public.${t}`);
      if (!ok) {
        throw new SqlValidationError(`Table not allowed: ${t}`);
      }
    }
  }

  // Normalize formatting via AST → SQL to prevent weird whitespace tricks.
  const normalizedSql = toSql.statement(statement);
  return { statement, normalizedSql };
}


