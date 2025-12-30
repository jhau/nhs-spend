import { db } from "@/db";
import { suppliers, entities, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCompanyProfile } from "@/lib/companies-house";

/**
 * Helper to find or create an entity and company record from a Companies House profile.
 * Returns the entity ID.
 */
async function findOrCreateCompanyEntity(profile: any): Promise<number> {
  // Check if entity already exists by registry_id
  const existingEntity = await db
    .select({ id: entities.id })
    .from(entities)
    .where(eq(entities.registryId, profile.company_number))
    .limit(1);

  if (existingEntity.length > 0) {
    return existingEntity[0].id;
  }

  // Create entity
  const [newEntity] = await db
    .insert(entities)
    .values({
      entityType: "company",
      registryId: profile.company_number,
      name: profile.company_name,
      status: profile.company_status,
      addressLine1: profile.registered_office_address?.address_line_1 || null,
      addressLine2: profile.registered_office_address?.address_line_2 || null,
      locality: profile.registered_office_address?.locality || null,
      postalCode: profile.registered_office_address?.postal_code || null,
      country: profile.registered_office_address?.country || null,
    })
    .returning({ id: entities.id });

  // Create company details
  await db.insert(companies).values({
    entityId: newEntity.id,
    companyNumber: profile.company_number,
    companyStatus: profile.company_status,
    companyType: profile.type,
    dateOfCreation: profile.date_of_creation || null,
    dateOfCessation: profile.date_of_cessation || null,
    jurisdiction: profile.jurisdiction || null,
    sicCodes: profile.sic_codes || null,
    previousNames: profile.previous_names || null,
    rawData: profile,
    etag: profile.etag || null,
    fetchedAt: new Date(),
  });

  return newEntity.id;
}

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
      entityId = await findOrCreateCompanyEntity(profile);
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
