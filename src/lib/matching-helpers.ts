import { entities, companies, councils } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Helper to find or create an entity and company record from a Companies House profile.
 * Returns the entity ID.
 */
export async function findOrCreateCompanyEntity(
  db: any,
  profile: any
): Promise<number> {
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

/**
 * Helper to find or create an entity and council record from council metadata.
 * Returns the entity ID.
 */
export async function findOrCreateCouncilEntity(
  db: any,
  metadata: any
): Promise<number> {
  const registryId = metadata.gssCode || metadata.officialName;

  // Check if entity already exists by registry_id
  const existingEntity = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(eq(entities.entityType, "council"), eq(entities.registryId, registryId))
    )
    .limit(1);

  if (existingEntity.length > 0) {
    return existingEntity[0].id;
  }

  // Create entity
  const [newEntity] = await db
    .insert(entities)
    .values({
      entityType: "council",
      registryId: registryId,
      name: metadata.officialName,
      status: "active",
      latitude: metadata.latitude,
      longitude: metadata.longitude,
    })
    .returning({ id: entities.id });

  // Create council details
  await db.insert(councils).values({
    entityId: newEntity.id,
    gssCode: metadata.gssCode,
    onsCode: metadata.onsCode,
    councilType: metadata.councilType,
    tier: metadata.tier,
    homepageUrl: metadata.homepageUrl,
    region: metadata.region,
    nation: metadata.nation,
    population: metadata.population,
    rawData: metadata,
    fetchedAt: new Date(),
  });

  return newEntity.id;
}
