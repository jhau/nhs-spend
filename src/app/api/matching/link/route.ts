import { db } from "@/db";
import { suppliers, entities, buyers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCompanyProfile } from "@/lib/companies-house";
import { 
  findOrCreateCompanyEntity, 
  findOrCreateCouncilEntity, 
  findOrCreateGovDepartmentEntity,
  findOrCreateNhsTrustEntity
} from "@/lib/matching-helpers";

export async function POST(req: Request) {
  const body = await req.json();
  const { supplierId, buyerId, type = "company", matchConfidence, metadata } = body;
  
  // Support both new 'identifier' and old 'companyNumber' for backward compatibility
  const identifier = body.identifier || body.companyNumber;

  if (!supplierId && !buyerId) {
    return NextResponse.json({ error: "Either supplierId or buyerId is required" }, { status: 400 });
  }

  // If no identifier, we mark as no_match
  if (!identifier) {
    if (supplierId) {
      await db.update(suppliers)
        .set({
          matchStatus: "no_match",
          manuallyVerified: true,
          updatedAt: new Date()
        })
        .where(eq(suppliers.id, supplierId));
    } else if (buyerId) {
      await db.update(buyers)
        .set({
          matchStatus: "no_match",
          manuallyVerified: true,
          updatedAt: new Date()
        })
        .where(eq(buyers.id, buyerId));
    }
    
    return NextResponse.json({ success: true });
  }

  try {
    let entityId: number | null = null;

    // Check if entity already exists by registry_id and type
    const existingEntity = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.registryId, identifier),
          eq(entities.entityType, type)
        )
      )
      .limit(1);

    if (existingEntity.length > 0) {
      entityId = existingEntity[0].id;
    } else {
      if (type === "company") {
        const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
        if (!apiKey) {
          return NextResponse.json({ error: "Companies House API key not configured" }, { status: 500 });
        }
        const profile = await getCompanyProfile(identifier, apiKey);
        entityId = await findOrCreateCompanyEntity(db, profile);
      } else if (type === "council") {
        entityId = await findOrCreateCouncilEntity(db, metadata);
      } else if (type === "government_department") {
        entityId = await findOrCreateGovDepartmentEntity(db, metadata);
      } else if (type === "nhs_trust") {
        entityId = await findOrCreateNhsTrustEntity(db, metadata);
      } else {
        return NextResponse.json({ error: "Invalid entity type" }, { status: 400 });
      }
    }

    if (!entityId) {
      return NextResponse.json({ error: "Failed to create or find entity" }, { status: 404 });
    }

    // Link supplier or buyer to entity
    if (supplierId) {
      await db.update(suppliers)
        .set({
          entityId,
          matchStatus: "matched",
          matchConfidence: matchConfidence ? String(matchConfidence) : null,
          manuallyVerified: true,
          updatedAt: new Date()
        })
        .where(eq(suppliers.id, supplierId));
    } else if (buyerId) {
      await db.update(buyers)
        .set({
          entityId,
          matchStatus: "matched",
          matchConfidence: matchConfidence ? String(matchConfidence) : null,
          manuallyVerified: true,
          updatedAt: new Date()
        })
        .where(eq(buyers.id, buyerId));
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(`Error linking for ${type}:`, error);
    return NextResponse.json({ error: error.message || "Failed to link" }, { status: 500 });
  }
}
