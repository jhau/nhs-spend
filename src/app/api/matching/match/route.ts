import { db } from "@/db";
import { suppliers, entities } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { searchCompanies, getCompanyProfile, calculateSimilarity } from "@/lib/companies-house";
import { searchCouncilMetadata } from "@/lib/council-api";
import { findOrCreateCompanyEntity, findOrCreateCouncilEntity } from "@/lib/matching-helpers";

export async function POST(req: Request) {
  const { supplierId, type } = await req.json();
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;

  if (!supplierId || !type) {
    return NextResponse.json({ error: "supplierId and type are required" }, { status: 400 });
  }

  try {
    // Get supplier
    const supplier = await db.query.suppliers.findFirst({
      where: eq(suppliers.id, supplierId),
    });

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    if (type === "council") {
      const councilMetadata = await searchCouncilMetadata(supplier.name);
      if (!councilMetadata) {
        return NextResponse.json({ error: "No council match found" }, { status: 404 });
      }

      const entityId = await findOrCreateCouncilEntity(db, councilMetadata);

      await db.update(suppliers)
        .set({
          entityId,
          matchStatus: "matched",
          matchConfidence: "1.00",
          manuallyVerified: true,
          matchAttemptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(suppliers.id, supplierId));

      return NextResponse.json({ 
        success: true, 
        match: {
          name: councilMetadata.officialName,
          type: "council",
          id: councilMetadata.gssCode
        }
      });
    }

    if (type === "company") {
      if (!apiKey) {
        return NextResponse.json({ error: "COMPANIES_HOUSE_API_KEY is not set" }, { status: 500 });
      }

      const searchData = await searchCompanies(supplier.name, apiKey);
      if (!searchData.items || searchData.items.length === 0) {
        return NextResponse.json({ error: "No companies found" }, { status: 404 });
      }

      // Use the same logic as the pipeline: find best match
      const resultsWithSimilarity = searchData.items.map((item: any) => ({
        ...item,
        similarity: calculateSimilarity(supplier.name, item.title),
      }));

      resultsWithSimilarity.sort((a: any, b: any) => b.similarity - a.similarity);
      const bestMatch = resultsWithSimilarity[0];

      // Even for manual trigger, we should probably check a threshold or just take the best one?
      // User said "match company", implying they want us to find the best one.
      
      const profile = await getCompanyProfile(bestMatch.company_number, apiKey);
      const entityId = await findOrCreateCompanyEntity(db, profile);

      await db.update(suppliers)
        .set({
          entityId,
          matchStatus: "matched",
          matchConfidence: bestMatch.similarity.toFixed(2),
          manuallyVerified: true,
          matchAttemptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(suppliers.id, supplierId));

      return NextResponse.json({ 
        success: true, 
        match: {
          name: profile.company_name,
          type: "company",
          id: profile.company_number,
          confidence: bestMatch.similarity
        }
      });
    }

    return NextResponse.json({ error: "Invalid match type" }, { status: 400 });
  } catch (error: any) {
    console.error("Error matching supplier:", error);
    return NextResponse.json({ error: error.message || "Failed to match supplier" }, { status: 500 });
  }
}

