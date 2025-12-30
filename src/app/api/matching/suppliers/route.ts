import { db } from "@/db";
import { suppliers, entities } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import stringSimilarity from "string-similarity";

const BASE_URL = "https://api.company-information.service.gov.uk";

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "pending";
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    const rows = await db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        matchStatus: suppliers.matchStatus,
        matchConfidence: suppliers.matchConfidence,
        entityId: suppliers.entityId,
      })
      .from(suppliers)
      .where(eq(suppliers.matchStatus, status))
      .limit(limit)
      .offset(offset);

    // For each supplier, if pending, we can try a quick search to provide "suggestions"
    // However, doing this in a loop here would be slow and hit rate limits.
    // We'll let the frontend request suggestions per supplier.

    return NextResponse.json({ suppliers: rows });
  } catch (error) {
    console.error("Error fetching matching suppliers:", error);
    return NextResponse.json({ error: "Failed to fetch suppliers" }, { status: 500 });
  }
}
