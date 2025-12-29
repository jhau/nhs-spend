import "dotenv/config";

import { eq, isNotNull, isNull, and } from "drizzle-orm";

import { db } from "@/db";
import { organisations } from "@/db/schema";

interface OdsOrganisation {
  Name: string;
  OrgId: string;
  Status: string;
  PostCode: string;
  PrimaryRoleId: string;
  PrimaryRoleDescription: string;
}

interface OdsResponse {
  Organisations: OdsOrganisation[];
}

async function searchOds(name: string): Promise<OdsOrganisation | null> {
  // Clean up the name for search
  const searchName = name
    .replace(/NHS Foundation Trust$/i, "")
    .replace(/NHS Trust$/i, "")
    .replace(/—.*$/, "") // Remove notes like "—merged into MSE"
    .trim();

  const url = `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations?Name=${encodeURIComponent(searchName)}&Status=Active`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`  Failed to fetch for "${searchName}": ${response.status}`);
      return null;
    }

    const data: OdsResponse = await response.json();

    // Find the best match - prioritize NHS TRUST (RO197) or NHS FOUNDATION TRUST role
    const trusts = data.Organisations.filter(
      (org) => org.PrimaryRoleId === "RO197" || org.PrimaryRoleId === "RO57"
    );

    if (trusts.length > 0) {
      return trusts[0];
    }

    // Fallback to first result if no trust found
    if (data.Organisations.length > 0) {
      return data.Organisations[0];
    }

    return null;
  } catch (error) {
    console.error(`  Error searching for "${searchName}":`, error);
    return null;
  }
}

async function main() {
  // Get all organisations with trust_type but no ods_code
  const orgs = await db
    .select()
    .from(organisations)
    .where(and(isNotNull(organisations.trustType), isNull(organisations.odsCode)));

  console.log(`Found ${orgs.length} organisations to look up\n`);

  let updated = 0;
  let notFound = 0;

  for (const org of orgs) {
    console.log(`Looking up: ${org.name}`);

    const odsOrg = await searchOds(org.name);

    if (odsOrg) {
      console.log(`  Found: ${odsOrg.Name} (${odsOrg.OrgId}) - ${odsOrg.PostCode}`);

      await db
        .update(organisations)
        .set({
          odsCode: odsOrg.OrgId,
          postCode: odsOrg.PostCode,
        })
        .where(eq(organisations.id, org.id));

      updated++;
    } else {
      console.log(`  NOT FOUND`);
      notFound++;
    }

    // Rate limit to avoid hitting API too hard
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log(`\nDone! Updated: ${updated}, Not found: ${notFound}`);
  process.exit(0);
}

main().catch(console.error);

