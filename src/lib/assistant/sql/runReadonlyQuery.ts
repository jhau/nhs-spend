import { Pool } from "pg";

export type RunReadonlyQueryOptions = {
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  idleInTxTimeoutMs: number;
  signal?: AbortSignal;
};

let pool: Pool | null = null;

function getPool() {
  if (pool) return pool;

  const connectionString =
    process.env.DATABASE_READONLY_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "Missing DATABASE_READONLY_URL (preferred) or DATABASE_URL for SQL execution."
    );
  }

  pool = new Pool({ connectionString });
  return pool;
}

export async function runReadonlyQuery(
  sql: string,
  opts: RunReadonlyQueryOptions
): Promise<{ rows: any[]; fields: { name: string }[]; executionMs: number }> {
  const client = await getPool().connect();

  const abortHandler = () => {
    // Attempt to cancel the query on the server side
    // @ts-ignore - access internal pid if available to issue a cancel
    const pid = (client as any).processID;
    if (pid) {
      console.log(`[runReadonlyQuery] Aborting PID ${pid}`);
      const cancelClient = new Pool({
        connectionString:
          process.env.DATABASE_READONLY_URL ?? process.env.DATABASE_URL,
      });
      cancelClient.query(`SELECT pg_cancel_backend(${pid})`).finally(() => {
        cancelClient.end();
      });
    }
  };

  if (opts.signal) {
    opts.signal.addEventListener("abort", abortHandler);
  }

  const start = Date.now();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL transaction_read_only = on");
    await client.query(`SET LOCAL statement_timeout = '${opts.statementTimeoutMs}ms'`);
    await client.query(`SET LOCAL lock_timeout = '${opts.lockTimeoutMs}ms'`);
    await client.query(
      `SET LOCAL idle_in_transaction_session_timeout = '${opts.idleInTxTimeoutMs}ms'`
    );

    const res = await client.query(sql);
    await client.query("COMMIT");

    return { rows: res.rows, fields: res.fields, executionMs: Date.now() - start };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw e;
  } finally {
    if (opts.signal) {
      opts.signal.removeEventListener("abort", abortHandler);
    }
    client.release();
  }
}

export async function runExplainJson(
  sql: string,
  opts: RunReadonlyQueryOptions
): Promise<{ planJson: unknown; executionMs: number }> {
  const client = await getPool().connect();

  const abortHandler = () => {
    // @ts-ignore
    const pid = (client as any).processID;
    if (pid) {
      const cancelClient = new Pool({
        connectionString:
          process.env.DATABASE_READONLY_URL ?? process.env.DATABASE_URL,
      });
      cancelClient.query(`SELECT pg_cancel_backend(${pid})`).finally(() => {
        cancelClient.end();
      });
    }
  };

  if (opts.signal) {
    opts.signal.addEventListener("abort", abortHandler);
  }

  const start = Date.now();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL transaction_read_only = on");
    await client.query(`SET LOCAL statement_timeout = '${opts.statementTimeoutMs}ms'`);
    await client.query(`SET LOCAL lock_timeout = '${opts.lockTimeoutMs}ms'`);
    await client.query(
      `SET LOCAL idle_in_transaction_session_timeout = '${opts.idleInTxTimeoutMs}ms'`
    );

    const res = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
    await client.query("COMMIT");

    // `pg` returns a column named "QUERY PLAN" whose value is a JSON array.
    const planJson = res.rows?.[0]?.["QUERY PLAN"];
    return { planJson, executionMs: Date.now() - start };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw e;
  } finally {
    if (opts.signal) {
      opts.signal.removeEventListener("abort", abortHandler);
    }
    client.release();
  }
}


