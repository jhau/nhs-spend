import {
  entities,
  companies,
  councils,
  governmentDepartments,
  nhsOrganisations,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import stringSimilarity from "string-similarity";
import type { GovUkOrganisation } from "./gov-uk";
import type { OdsOrganisation } from "./nhs-api";

/**
 * Finds the best match for a name from a map of existing names to IDs.
 * Returns the matched ID if the similarity is above the threshold.
 */
export function findFuzzyMatch(
  name: string,
  existingMap: Map<string, number>,
  threshold = 0.85
): { id: number; name: string; rating: number } | null {
  if (existingMap.size === 0) return null;

  const nameUpper = name.toUpperCase();
  const existingNames = Array.from(existingMap.keys());
  const matches = stringSimilarity.findBestMatch(nameUpper, existingNames);

  if (matches.bestMatch.rating >= threshold) {
    const id = existingMap.get(matches.bestMatch.target);
    if (id !== undefined) {
      return {
        id,
        name: matches.bestMatch.target,
        rating: matches.bestMatch.rating,
      };
    }
  }

  return null;
}

/**
 * Helper to find or create an entity and NHS organisation record for an NHS Trust.
 * Returns the entity ID, or null if no ODS code is provided.
 */
export async function findOrCreateNhsTrustEntity(
  db: any,
  metadata: Partial<OdsOrganisation> & { Name: string }
): Promise<number | null> {
  if (!metadata.OrgId) {
    return null;
  }

  const registryId = metadata.OrgId;
  
  // Check if entity already exists by registry_id
  const existingEntity = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.entityType, "nhs_trust"),
        eq(entities.registryId, registryId)
      )
    )
    .limit(1);

  if (existingEntity.length > 0) {
    return existingEntity[0].id;
  }

  // Create entity
  const [newEntity] = await db
    .insert(entities)
    .values({
      entityType: "nhs_trust",
      registryId,
      name: metadata.Name,
      status: "active",
      postalCode: metadata.PostCode ?? null,
    })
    .returning({ id: entities.id });
  
  // Create NHS organisation details
  await db.insert(nhsOrganisations).values({
    entityId: newEntity.id,
    odsCode: registryId,
    orgType: "trust",
    orgSubType: metadata.PrimaryRoleDescription ?? null,
    isActive: true,
    rawData: metadata,
    fetchedAt: new Date(),
  });
  
  return newEntity.id;
}

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

/**
 * Helper to find or create an entity and government department record from a GOV.UK organisation profile.
 * Returns the entity ID.
 */
export async function findOrCreateGovDepartmentEntity(
  db: any,
  profile: GovUkOrganisation
): Promise<number> {
  // Check if entity already exists by slug (used as registry_id for gov depts)
  const existingEntity = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.entityType, "government_department"),
        eq(entities.registryId, profile.slug)
      )
    )
    .limit(1);

  if (existingEntity.length > 0) {
    return existingEntity[0].id;
  }

  // Create entity
  const [newEntity] = await db
    .insert(entities)
    .values({
      entityType: "government_department",
      registryId: profile.slug,
      name: profile.title,
      status: profile.organisation_state === "live" ? "active" : "inactive",
    })
    .returning({ id: entities.id });

  // Create government department details
  await db.insert(governmentDepartments).values({
    entityId: newEntity.id,
    slug: profile.slug,
    acronym: profile.acronym || null,
    organisationType: profile.organisation_type,
    organisationState: profile.organisation_state,
    link: profile.link,
    logoUrl: profile.logo_url || null,
    rawData: profile,
    fetchedAt: new Date(),
  });

  return newEntity.id;
}
