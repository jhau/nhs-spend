import { db } from "@/db";
import { suppliers, entities, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCompanyProfile } from "@/lib/companies-house";
import { findOrCreateCompanyEntity } from "@/lib/matching-helpers";

export async function POST(req: Request) {
  const { supplierId, companyNumber, matchConfidence } = await req.json();
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;

  if (!supplierId) {
    return NextResponse.json({ error: "supplierId is required" }, { status: 400 });
  }

  // If no companyNumber, we mark as no_match
  if (!companyNumber) {
    await db.update(suppliers)
      .set({
        matchStatus: "no_match",
        manuallyVerified: true,
        updatedAt: new Date()
      })
      .where(eq(suppliers.id, supplierId));
    
    return NextResponse.json({ success: true });
  }

  try {
    // 1. Check if entity already exists by company number
    const existingEntity = await db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.registryId, companyNumber))
      .limit(1);

    let entityId: number;

    if (existingEntity.length > 0) {
      entityId = existingEntity[0].id;
    } else {
      if (!apiKey) {
        return NextResponse.json({ error: "API key not configured" }, { status: 500 });
      }

      // 2. Fetch full profile from Companies House
      const profile = await getCompanyProfile(companyNumber, apiKey);

      // 3. Create entity and company details
      entityId = await findOrCreateCompanyEntity(db, profile);
    }

    // 4. Link supplier to entity
    await db.update(suppliers)
      .set({
        entityId,
        matchStatus: "matched",
        matchConfidence: matchConfidence ? String(matchConfidence) : null,
        manuallyVerified: true,
        updatedAt: new Date()
      })
      .where(eq(suppliers.id, supplierId));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error linking supplier:", error);
    return NextResponse.json({ error: error.message || "Failed to link supplier" }, { status: 500 });
  }
}
