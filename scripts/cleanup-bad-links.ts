
import dotenv from "dotenv";
// Load .env first, then .env.local overrides (if exists)
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { eq, and, ilike } from "drizzle-orm";

async function cleanup() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("No DATABASE_URL");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  console.log("Cleaning up bad contract links...");

  // Find contract ID 1
  const contractId = 1;

  // Delete links to this contract for Maclaren
  const deleted = await db
    .delete(schema.contractSupplierSearches)
    .where(
      and(
        eq(schema.contractSupplierSearches.contractId, contractId),
        ilike(schema.contractSupplierSearches.searchKeyword, "%Mclaren%")
      )
    )
    .returning();

  console.log(`Deleted ${deleted.length} bad links:`, deleted);
  
  await pool.end();
}

cleanup().catch(console.error);

