import dotenv from "dotenv";
// Load env files BEFORE any other imports that use process.env
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import readline from "readline";
import stringSimilarity from "string-similarity";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { companies, suppliers } from "../src/db/schema";
import { sql, eq } from "drizzle-orm";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const API_KEY = process.env.COMPANIES_HOUSE_API_KEY;
const BASE_URL = "https://api.company-information.service.gov.uk";

// Rate limiting: 600 requests per 5 minutes = 2 requests per second
const RATE_LIMIT_MS = 600; // ~1.67 req/sec to be safe
const AUTO_MATCH_THRESHOLD = 0.9;
const MIN_SIMILARITY_THRESHOLD = 0.5;

interface CompanySearchResult {
  company_number: string;
  title: string;
  company_status: string;
  company_type: string;
  date_of_creation?: string;
  address_snippet?: string;
}

interface SearchResponse {
  items?: CompanySearchResult[];
  total_results: number;
}

interface CompanyProfile {
  company_name: string;
  company_number: string;
  company_status: string;
  type: string;
  date_of_creation?: string;
  jurisdiction?: string;
  registered_office_address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    postal_code?: string;
    country?: string;
  };
  sic_codes?: string[];
  previous_names?: { name: string; effective_from: string; ceased_on: string }[];
  etag?: string;
}

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - timeSinceLastRequest);
  }
  
  lastRequestTime = Date.now();
  
  return fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${API_KEY}:`).toString("base64")}`,
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchCompany(query: string): Promise<SearchResponse> {
  const url = `${BASE_URL}/search/companies?q=${encodeURIComponent(query)}&items_per_page=5`;
  const response = await rateLimitedFetch(url);
  
  if (response.status === 429) {
    console.log("⏳ Rate limited, waiting 60 seconds...");
    await sleep(60000);
    return searchCompany(query);
  }
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

async function getCompanyProfile(companyNumber: string): Promise<CompanyProfile> {
  const url = `${BASE_URL}/company/${companyNumber}`;
  const response = await rateLimitedFetch(url);
  
  if (response.status === 429) {
    console.log("⏳ Rate limited, waiting 60 seconds...");
    await sleep(60000);
    return getCompanyProfile(companyNumber);
  }
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

function normalizeCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bLIMITED\b/g, "LTD")
    .replace(/\bPUBLIC LIMITED COMPANY\b/g, "PLC")
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateSimilarity(supplierName: string, companyName: string): number {
  const normalizedSupplier = normalizeCompanyName(supplierName);
  const normalizedCompany = normalizeCompanyName(companyName);
  return stringSimilarity.compareTwoStrings(normalizedSupplier, normalizedCompany);
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

async function saveCompany(profile: CompanyProfile): Promise<number> {
  // Check if company already exists
  const existing = await db
    .select({ id: companies.id })
    .from(companies)
    .where(sql`${companies.companyNumber} = ${profile.company_number}`)
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  const result = await db
    .insert(companies)
    .values({
      companyNumber: profile.company_number,
      companyName: profile.company_name,
      companyStatus: profile.company_status,
      companyType: profile.type,
      dateOfCreation: profile.date_of_creation || null,
      jurisdiction: profile.jurisdiction || null,
      addressLine1: profile.registered_office_address?.address_line_1 || null,
      addressLine2: profile.registered_office_address?.address_line_2 || null,
      locality: profile.registered_office_address?.locality || null,
      postalCode: profile.registered_office_address?.postal_code || null,
      country: profile.registered_office_address?.country || null,
      sicCodes: profile.sic_codes || null,
      previousNames: profile.previous_names || null,
      rawData: profile,
      etag: profile.etag || null,
      fetchedAt: new Date(),
    })
    .returning({ id: companies.id });

  return result[0].id;
}

async function createSupplierLink(
  supplierName: string,
  companyId: number,
  matchConfidence: number,
  manuallyVerified: boolean
): Promise<void> {
  await db
    .update(suppliers)
    .set({
      companyId,
      matchStatus: "matched",
      matchConfidence: matchConfidence.toFixed(2),
      manuallyVerified,
      updatedAt: new Date(),
    })
    .where(eq(suppliers.name, supplierName));
}

async function createNoMatchLink(supplierName: string): Promise<void> {
  await db
    .update(suppliers)
    .set({
      matchStatus: "no_match",
      manuallyVerified: true,
      updatedAt: new Date(),
    })
    .where(eq(suppliers.name, supplierName));
}

async function createSkippedLink(supplierName: string): Promise<void> {
  await db
    .update(suppliers)
    .set({
      matchStatus: "skipped",
      manuallyVerified: false,
      updatedAt: new Date(),
    })
    .where(eq(suppliers.name, supplierName));
}

async function getUnmatchedSuppliersCount(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(suppliers)
    .where(eq(suppliers.matchStatus, "pending"));

  return Number(result[0].count);
}

async function getUnmatchedSuppliers(limit: number): Promise<string[]> {
  const result = await db
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.matchStatus, "pending"))
    .limit(limit);

  return result.map((r) => r.name);
}

function isNumericString(str: string): boolean {
  return /^\d+$/.test(str.trim());
}

async function processSupplier(supplierName: string, index: number, total: number): Promise<void> {
  console.log(`\n${"═".repeat(80)}`);
  console.log(`[${index + 1}/${total}] Processing: "${supplierName}"`);
  console.log("═".repeat(80));

  // Auto-skip numeric strings
  if (isNumericString(supplierName)) {
    console.log("  ⏭️  Skipping (numeric string)");
    await createNoMatchLink(supplierName);
    return;
  }

  try {
    const searchResults = await searchCompany(supplierName);

    if (!searchResults.items || searchResults.items.length === 0) {
      console.log("  ⏭️  No Companies House results - auto-skipping");
      await createNoMatchLink(supplierName);
      return;
    }

    // Calculate similarities for all results
    const resultsWithSimilarity = searchResults.items.map((item) => ({
      ...item,
      similarity: calculateSimilarity(supplierName, item.title),
    }));

    // Sort by similarity descending
    resultsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

    const bestMatch = resultsWithSimilarity[0];
    const similarityPercent = (bestMatch.similarity * 100).toFixed(1);

    console.log(`\n  Best match: "${bestMatch.title}"`);
    console.log(`  Similarity: ${similarityPercent}%`);
    console.log(`  Status: ${bestMatch.company_status}`);

    // Auto-match if above threshold
    if (bestMatch.similarity >= AUTO_MATCH_THRESHOLD) {
      console.log(`  ✓ Auto-matching (≥90% similarity)`);
      
      const profile = await getCompanyProfile(bestMatch.company_number);
      const companyId = await saveCompany(profile);
      await createSupplierLink(supplierName, companyId, bestMatch.similarity, false);
      
      console.log(`  ✓ Linked to company #${bestMatch.company_number}`);
      return;
    }

    // Auto-skip if best match is below minimum threshold
    if (bestMatch.similarity < MIN_SIMILARITY_THRESHOLD) {
      console.log(`  ⏭️  Best match <50% similarity - auto-skipping`);
      await createNoMatchLink(supplierName);
      return;
    }

    // Manual confirmation required (50-90% similarity)
    console.log(`\n  All matches:`);
    resultsWithSimilarity.forEach((item, i) => {
      const simPct = (item.similarity * 100).toFixed(1);
      console.log(`    [${i + 1}] ${item.title} (${simPct}%) - ${item.company_status}`);
    });

    const answer = await prompt(
      `\n  Select company (1-${resultsWithSimilarity.length}), 's' to skip, 'n' for no match: `
    );

    if (answer.toLowerCase() === "s") {
      await createSkippedLink(supplierName);
      console.log("  → Skipped (recorded, won't show again)");
      return;
    }

    if (answer.toLowerCase() === "n") {
      await createNoMatchLink(supplierName);
      console.log("  ✓ Marked as no match");
      return;
    }

    const selection = parseInt(answer, 10);
    if (isNaN(selection) || selection < 1 || selection > resultsWithSimilarity.length) {
      console.log("  → Invalid selection, skipping");
      return;
    }

    const selected = resultsWithSimilarity[selection - 1];
    const profile = await getCompanyProfile(selected.company_number);
    const companyId = await saveCompany(profile);
    await createSupplierLink(supplierName, companyId, selected.similarity, true);
    
    console.log(`  ✓ Linked to company #${selected.company_number}`);
  } catch (error) {
    console.error(`  ❌ Error: ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  if (!API_KEY) {
    console.error("Error: COMPANIES_HOUSE_API_KEY not set in environment");
    process.exit(1);
  }

  const limitArg = process.argv[2];
  const limit = limitArg ? parseInt(limitArg, 10) : 50;

  console.log("\n🔍 NHS Spend - Supplier to Companies House Matcher");
  console.log("─".repeat(50));
  console.log(`Rate limit: ${RATE_LIMIT_MS}ms between requests`);
  console.log(`Auto-match: ≥${AUTO_MATCH_THRESHOLD * 100}% | Auto-skip: <${MIN_SIMILARITY_THRESHOLD * 100}%`);
  console.log(`Processing up to ${limit} unmatched suppliers\n`);

  const totalUnmatched = await getUnmatchedSuppliersCount();
  
  if (totalUnmatched === 0) {
    console.log("✓ All suppliers have been matched!");
    process.exit(0);
  }

  console.log(`Total unmatched suppliers: ${totalUnmatched}`);
  
  const suppliersList = await getUnmatchedSuppliers(limit);
  console.log(`Processing ${suppliersList.length} in this batch (${totalUnmatched - suppliersList.length} remaining after)`);

  for (let i = 0; i < suppliersList.length; i++) {
    await processSupplier(suppliersList[i], i, suppliersList.length);
  }

  const remainingCount = await getUnmatchedSuppliersCount();
  
  console.log("\n" + "═".repeat(80));
  console.log("✓ Matching complete!");
  console.log(`  Remaining unmatched suppliers: ${remainingCount}`);
  console.log("═".repeat(80));
  
  await pool.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await pool.end();
  process.exit(1);
});
