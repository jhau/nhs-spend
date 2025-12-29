import dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import readline from "readline";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { spendEntries, suppliers } from "../src/db/schema";
import { sql, eq } from "drizzle-orm";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Patterns that indicate non-company entries
const NON_COMPANY_PATTERNS = [
  // Individual names
  /^(DR|MR|MRS|MS|MISS|PROF|REV)\s+/i,
  /^(DOCTOR|MISTER|PROFESSOR)\s+/i,
  
  // NHS/Government
  /\bNHS\b/i,
  /\bHMRC\b/i,
  /\bCOUNCIL\b/i,
  /\bAUTHORITY\b/i,
  /\bGOVERNMENT\b/i,
  /\bDEPARTMENT OF\b/i,
  
  // Generic payment terms
  /^SALARY$/i,
  /^SALARIES$/i,
  /^REFUND$/i,
  /^REFUNDS$/i,
  /^PETTY CASH$/i,
  /^CASH$/i,
  /^SUNDRY$/i,
  /^MISC(ELLANEOUS)?$/i,
  /^VARIOUS$/i,
  /^TRANSFER$/i,
  /^PAYMENT$/i,
  /^PAYROLL$/i,
  
  // Redacted/placeholder
  /^REDACTED$/i,
  /^CONFIDENTIAL$/i,
  /^WITHHELD$/i,
  /^N\/A$/i,
  /^NOT APPLICABLE$/i,
  /^UNKNOWN$/i,
  /^TBC$/i,
  /^TBA$/i,
];

// Normalize supplier name for deduplication
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

function matchesNonCompanyPattern(name: string): string | null {
  for (const pattern of NON_COMPANY_PATTERNS) {
    if (pattern.test(name)) {
      return pattern.toString();
    }
  }
  return null;
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

interface SupplierAnalysis {
  original: string;
  normalized: string;
  nonCompanyPattern: string | null;
  isNumeric: boolean;
  entryCount: number;
  totalSpend: number;
}

async function getUnmatchedSuppliers(): Promise<{ supplier: string; count: number; total_spend: number }[]> {
  const result = await db
    .select({
      supplier: suppliers.name,
      count: sql<number>`count(*)::int`,
      total_spend: sql<number>`sum(${spendEntries.amount}::numeric)::float`,
    })
    .from(suppliers)
    .innerJoin(spendEntries, eq(suppliers.id, spendEntries.supplierId))
    .where(eq(suppliers.matchStatus, "pending"))
    .groupBy(suppliers.name)
    .orderBy(sql`sum(${spendEntries.amount}::numeric) desc`);

  return result;
}

async function main() {
  console.log("\n📊 NHS Spend - Supplier Analysis");
  console.log("═".repeat(60));
  console.log("Analyzing unmatched suppliers...\n");

  const suppliersList = await getUnmatchedSuppliers();
  console.log(`Total unmatched suppliers: ${suppliersList.length.toLocaleString()}`);

  // Analyze each supplier
  const analyses: SupplierAnalysis[] = suppliersList.map((s) => ({
    original: s.supplier,
    normalized: normalizeSupplierName(s.supplier),
    nonCompanyPattern: matchesNonCompanyPattern(s.supplier),
    isNumeric: /^\d+$/.test(s.supplier.trim()),
    entryCount: s.count,
    totalSpend: s.total_spend,
  }));

  // Group by normalized name to find duplicates
  const normalizedGroups = new Map<string, SupplierAnalysis[]>();
  for (const a of analyses) {
    const existing = normalizedGroups.get(a.normalized) || [];
    existing.push(a);
    normalizedGroups.set(a.normalized, existing);
  }

  // Find groups with multiple variants
  const duplicateGroups = Array.from(normalizedGroups.entries())
    .filter(([, group]) => group.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  // Count non-company matches
  const nonCompanyMatches = analyses.filter((a) => a.nonCompanyPattern !== null);
  const numericMatches = analyses.filter((a) => a.isNumeric);

  // Calculate potential reduction
  const uniqueAfterNormalization = normalizedGroups.size;
  const nonCompanyCount = nonCompanyMatches.length;
  const numericCount = numericMatches.length;

  console.log("\n" + "─".repeat(60));
  console.log("ANALYSIS RESULTS");
  console.log("─".repeat(60));

  console.log(`\n1. NORMALIZATION DEDUPLICATION`);
  console.log(`   Original unique suppliers: ${suppliersList.length.toLocaleString()}`);
  console.log(`   After normalization:       ${uniqueAfterNormalization.toLocaleString()}`);
  console.log(`   Potential reduction:       ${(suppliersList.length - uniqueAfterNormalization).toLocaleString()} (${((1 - uniqueAfterNormalization / suppliersList.length) * 100).toFixed(1)}%)`);

  console.log(`\n2. NON-COMPANY PATTERNS`);
  console.log(`   Matches found: ${nonCompanyCount.toLocaleString()}`);

  console.log(`\n3. NUMERIC-ONLY ENTRIES`);
  console.log(`   Matches found: ${numericCount.toLocaleString()}`);

  const totalReduction = suppliersList.length - uniqueAfterNormalization + nonCompanyCount + numericCount;
  const estimatedRemaining = uniqueAfterNormalization - nonCompanyCount - numericCount;
  
  console.log(`\n${"═".repeat(60)}`);
  console.log(`ESTIMATED REMAINING AFTER CLEANUP: ~${Math.max(0, estimatedRemaining).toLocaleString()}`);
  console.log(`${"═".repeat(60)}`);

  // Show top duplicate groups
  console.log(`\n\n--- TOP 20 DUPLICATE GROUPS (same after normalization) ---\n`);
  for (const [normalized, group] of duplicateGroups.slice(0, 20)) {
    console.log(`"${normalized}" (${group.length} variants):`);
    for (const variant of group.slice(0, 5)) {
      console.log(`  - "${variant.original}" (${variant.entryCount} entries, £${variant.totalSpend.toLocaleString()})`);
    }
    if (group.length > 5) {
      console.log(`  ... and ${group.length - 5} more`);
    }
    console.log();
  }

  // Show sample non-company matches
  console.log(`\n--- SAMPLE NON-COMPANY MATCHES (first 30) ---\n`);
  for (const match of nonCompanyMatches.slice(0, 30)) {
    console.log(`  "${match.original}"`);
  }
  if (nonCompanyMatches.length > 30) {
    console.log(`  ... and ${nonCompanyMatches.length - 30} more`);
  }

  // Show sample numeric matches
  console.log(`\n--- SAMPLE NUMERIC-ONLY ENTRIES (first 20) ---\n`);
  for (const match of numericMatches.slice(0, 20)) {
    console.log(`  "${match.original}" (${match.entryCount} entries, £${match.totalSpend.toLocaleString()})`);
  }
  if (numericMatches.length > 20) {
    console.log(`  ... and ${numericMatches.length - 20} more`);
  }

  // Top suppliers by spend that would still need matching
  const topSuppliersBySpend = analyses
    .filter((a) => !a.isNumeric && !a.nonCompanyPattern)
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, 30);

  console.log(`\n--- TOP 30 SUPPLIERS BY SPEND (need matching) ---\n`);
  for (const s of topSuppliersBySpend) {
    const spend = s.totalSpend >= 1000000 
      ? `£${(s.totalSpend / 1000000).toFixed(1)}M`
      : `£${(s.totalSpend / 1000).toFixed(0)}K`;
    console.log(`  ${spend.padStart(10)} | ${s.original}`);
  }

  console.log("\n" + "═".repeat(60));
  console.log("No changes have been made. Review the analysis above.");
  console.log("═".repeat(60));

  await pool.end();
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await pool.end();
  process.exit(1);
});
