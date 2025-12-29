import dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import readline from "readline";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { spendEntries } from "../src/db/schema";
import { sql } from "drizzle-orm";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Normalize supplier name
function normalizeSupplierName(name: string): string {
  return name
    .toUpperCase()
    .trim()
    // Standardize company suffixes
    .replace(/\bLIMITED\b/g, "LTD")
    .replace(/\bPUBLIC LIMITED COMPANY\b/g, "PLC")
    .replace(/\bINCORPORATED\b/g, "INC")
    .replace(/\bCORPORATION\b/g, "CORP")
    // Remove punctuation except &
    .replace(/[.,'"()]/g, "")
    // Normalize spaces
    .replace(/\s+/g, " ")
    .trim();
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

interface SupplierGroup {
  normalized: string;
  variants: { original: string; count: number }[];
  totalEntries: number;
}

async function getAllSuppliers(): Promise<{ supplier: string; count: number }[]> {
  const result = await db
    .select({
      supplier: spendEntries.supplier,
      count: sql<number>`count(*)::int`,
    })
    .from(spendEntries)
    .groupBy(spendEntries.supplier)
    .orderBy(spendEntries.supplier);

  return result;
}

async function main() {
  console.log("\n🔧 NHS Spend - Supplier Name Normalization");
  console.log("═".repeat(60));
  console.log("This script will normalize supplier names.\n");

  // Get all suppliers
  console.log("Fetching all suppliers...");
  const suppliers = await getAllSuppliers();
  console.log(`Found ${suppliers.length.toLocaleString()} unique supplier names\n`);

  // Group by normalized name
  const groups = new Map<string, SupplierGroup>();
  
  for (const s of suppliers) {
    const normalized = normalizeSupplierName(s.supplier);
    
    if (!groups.has(normalized)) {
      groups.set(normalized, {
        normalized,
        variants: [],
        totalEntries: 0,
      });
    }
    
    const group = groups.get(normalized)!;
    group.variants.push({ original: s.supplier, count: s.count });
    group.totalEntries += s.count;
  }

  // Find groups that need normalization (have variants OR name differs from normalized)
  const groupsNeedingUpdate: SupplierGroup[] = [];
  
  for (const group of groups.values()) {
    // Check if any variant differs from normalized form
    const needsUpdate = group.variants.some(v => v.original !== group.normalized);
    if (needsUpdate) {
      groupsNeedingUpdate.push(group);
    }
  }

  // Sort by total entries descending
  groupsNeedingUpdate.sort((a, b) => b.totalEntries - a.totalEntries);

  if (groupsNeedingUpdate.length === 0) {
    console.log("✓ All supplier names are already normalized!");
    await pool.end();
    return;
  }

  // Calculate totals
  const totalVariants = groupsNeedingUpdate.reduce((sum, g) => sum + g.variants.length, 0);
  const totalEntries = groupsNeedingUpdate.reduce((sum, g) => sum + g.totalEntries, 0);

  console.log("─".repeat(60));
  console.log("NORMALIZATION SUMMARY");
  console.log("─".repeat(60));
  console.log(`Groups needing normalization: ${groupsNeedingUpdate.length.toLocaleString()}`);
  console.log(`Total variant names:          ${totalVariants.toLocaleString()}`);
  console.log(`Total entries affected:       ${totalEntries.toLocaleString()}`);
  console.log("─".repeat(60));

  // Show sample of changes
  console.log("\n--- SAMPLE CHANGES (first 30 groups) ---\n");
  
  for (const group of groupsNeedingUpdate.slice(0, 30)) {
    console.log(`→ "${group.normalized}" (${group.totalEntries} entries)`);
    for (const variant of group.variants) {
      if (variant.original !== group.normalized) {
        console.log(`    ← "${variant.original}" (${variant.count})`);
      }
    }
  }

  if (groupsNeedingUpdate.length > 30) {
    console.log(`\n... and ${groupsNeedingUpdate.length - 30} more groups`);
  }

  // Ask for confirmation
  console.log("\n" + "═".repeat(60));
  const answer = await prompt(
    `Apply normalization to ${totalVariants.toLocaleString()} supplier names? (yes/no): `
  );

  if (answer.toLowerCase() !== "yes") {
    console.log("Cancelled. No changes made.");
    await pool.end();
    return;
  }

  // Apply changes using temporary table for batch update
  console.log("\nApplying normalization (optimized batch update)...\n");
  
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create temp table
    await client.query(`
      CREATE TEMP TABLE temp_supplier_updates (
        old_name text,
        new_name text
      ) ON COMMIT DROP
    `);

    // Prepare data for batch insert
    const updates: any[][] = [];
    for (const group of groupsNeedingUpdate) {
      for (const variant of group.variants) {
        if (variant.original !== group.normalized) {
          updates.push([variant.original, group.normalized]);
        }
      }
    }

    // Insert in batches
    const BATCH_SIZE = 1000;
    let insertedCount = 0;
    
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      
      // Construct parameterized query
      const placeholders = batch.map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`).join(",");
      const values = batch.flat();
      
      await client.query(
        `INSERT INTO temp_supplier_updates (old_name, new_name) VALUES ${placeholders}`,
        values
      );
      
      insertedCount += batch.length;
      process.stdout.write(`\rStaging updates: ${insertedCount}/${updates.length}`);
    }
    
    console.log("\nRunning bulk update...");

    // Execute bulk update
    const updateResult = await client.query(`
      UPDATE spend_entries AS s
      SET supplier = t.new_name
      FROM temp_supplier_updates AS t
      WHERE s.supplier = t.old_name
    `);

    await client.query("COMMIT");

    console.log("\n" + "═".repeat(60));
    console.log("✓ NORMALIZATION COMPLETE");
    console.log(`  Unique names merged: ${updates.length.toLocaleString()}`);
    console.log(`  Total records updated: ${updateResult.rowCount?.toLocaleString()}`);
    console.log("═".repeat(60));

  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error during update:", e);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
