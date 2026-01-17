import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : 25;
  const client = await pool.connect();

  try {
    const res = await client.query(
      `
      WITH buyer_totals AS (
        SELECT b.entity_id AS entity_id, SUM(se.amount) AS total_spend
        FROM spend_entries se
        JOIN buyers b ON b.id = se.buyer_id
        WHERE b.entity_id IS NOT NULL
        GROUP BY b.entity_id
      ),
      supplier_totals AS (
        SELECT s.entity_id AS entity_id, SUM(se.amount) AS total_received
        FROM spend_entries se
        JOIN suppliers s ON s.id = se.supplier_id
        WHERE s.entity_id IS NOT NULL
        GROUP BY s.entity_id
      )
      SELECT
        e.id,
        e.name,
        e.buyer_total_spend AS cached_buyer_total_spend,
        COALESCE(bt.total_spend, 0) AS computed_buyer_total_spend,
        e.supplier_total_received AS cached_supplier_total_received,
        COALESCE(st.total_received, 0) AS computed_supplier_total_received
      FROM entities e
      LEFT JOIN buyer_totals bt ON bt.entity_id = e.id
      LEFT JOIN supplier_totals st ON st.entity_id = e.id
      WHERE e.buyer_total_spend <> COALESCE(bt.total_spend, 0)
         OR e.supplier_total_received <> COALESCE(st.total_received, 0)
      ORDER BY e.id
      LIMIT $1
      `,
      [limit]
    );

    if (res.rows.length === 0) {
      console.log("✅ No mismatches found between cached and computed entity totals.");
      return;
    }

    console.log(
      `❌ Found ${res.rows.length} mismatches (showing up to ${limit}).`
    );
    console.table(res.rows);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

