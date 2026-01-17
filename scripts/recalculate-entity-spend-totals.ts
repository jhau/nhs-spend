import "dotenv/config";
import { Pool } from "pg";

type Args = {
  entityId?: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--entityId" || a === "--entity-id") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --entityId");
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`Invalid --entityId value: ${v}`);
      args.entityId = n;
      i++;
    }
  }
  return args;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const { entityId } = parseArgs(process.argv.slice(2));

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  const start = Date.now();

  try {
    await client.query("BEGIN");

    if (entityId) {
      // Reset then recompute for a single entity
      await client.query(
        `
        UPDATE entities
        SET buyer_total_spend = 0,
            supplier_total_received = 0,
            spend_totals_updated_at = NOW()
        WHERE id = $1
        `,
        [entityId]
      );

      await client.query(
        `
        UPDATE entities e
        SET buyer_total_spend = COALESCE(src.total_spend, 0),
            spend_totals_updated_at = NOW()
        FROM (
          SELECT b.entity_id AS entity_id, SUM(se.amount) AS total_spend
          FROM spend_entries se
          JOIN buyers b ON b.id = se.buyer_id
          WHERE b.entity_id = $1
          GROUP BY b.entity_id
        ) AS src
        WHERE e.id = src.entity_id
        `,
        [entityId]
      );

      await client.query(
        `
        UPDATE entities e
        SET supplier_total_received = COALESCE(src.total_received, 0),
            spend_totals_updated_at = NOW()
        FROM (
          SELECT s.entity_id AS entity_id, SUM(se.amount) AS total_received
          FROM spend_entries se
          JOIN suppliers s ON s.id = se.supplier_id
          WHERE s.entity_id = $1
          GROUP BY s.entity_id
        ) AS src
        WHERE e.id = src.entity_id
        `,
        [entityId]
      );

      await client.query("COMMIT");
      console.log(
        `✅ Recalculated totals for entity ${entityId} in ${Date.now() - start}ms`
      );
      return;
    }

    // Full refresh
    await client.query(`
      UPDATE entities
      SET buyer_total_spend = 0,
          supplier_total_received = 0,
          spend_totals_updated_at = NOW()
    `);

    await client.query(`
      UPDATE entities e
      SET buyer_total_spend = COALESCE(src.total_spend, 0),
          spend_totals_updated_at = NOW()
      FROM (
        SELECT b.entity_id AS entity_id, SUM(se.amount) AS total_spend
        FROM spend_entries se
        JOIN buyers b ON b.id = se.buyer_id
        WHERE b.entity_id IS NOT NULL
        GROUP BY b.entity_id
      ) AS src
      WHERE e.id = src.entity_id
    `);

    await client.query(`
      UPDATE entities e
      SET supplier_total_received = COALESCE(src.total_received, 0),
          spend_totals_updated_at = NOW()
      FROM (
        SELECT s.entity_id AS entity_id, SUM(se.amount) AS total_received
        FROM spend_entries se
        JOIN suppliers s ON s.id = se.supplier_id
        WHERE s.entity_id IS NOT NULL
        GROUP BY s.entity_id
      ) AS src
      WHERE e.id = src.entity_id
    `);

    await client.query("COMMIT");
    console.log(`✅ Recalculated totals for all entities in ${Date.now() - start}ms`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

