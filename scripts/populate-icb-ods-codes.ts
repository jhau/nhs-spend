import "dotenv/config";

import { eq, isNull, and, like, or } from "drizzle-orm";

import { db } from "@/db";
import { organisations } from "@/db/schema";

interface OdsOrganisation {
  Name: string;
  OrgId: string;
  Status: string;
  PostCode: string;
  PrimaryRoleId: string;
}

interface OdsResponse {
  Organisations: OdsOrganisation[];
}

async function searchOds(name: string): Promise<OdsOrganisation | null> {
  // Clean up the name for search
  const searchName = name
    .replace(/NHS\s+/i, "")
    .replace(/\s+ICB$/i, "")
    .replace(/\s+Integrated Care Board$/i, "")
    .trim();

  const url = `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations?Name=${encodeURIComponent(searchName)}&Status=Active`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`  Failed to fetch for "${searchName}": ${response.status}`);
      return null;
    }

    const data: OdsResponse = await response.json();

    // Find ICB (RO261 = Integrated Care Board)
    const icbs = data.Organisations.filter(
      (org) => org.PrimaryRoleId === "RO261"
    );

    if (icbs.length > 0) {
      return icbs[0];
    }

    return null;
  } catch (error) {
    console.error(`  Error searching for "${searchName}":`, error);
    return null;
  }
}

async function main() {
  // Get all ICB organisations without ODS codes
  const orgs = await db
    .select()
    .from(organisations)
    .where(
      and(
        isNull(organisations.odsCode),
        or(
          like(organisations.name, "% ICB"),
          like(organisations.name, "%Integrated Care Board%")
        )
      )
    );

  console.log(`Found ${orgs.length} ICBs to look up\n`);

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
          postCode: odsOrg.PostCode || org.postCode,
        })
        .where(eq(organisations.id, org.id));

      updated++;
    } else {
      console.log(`  NOT FOUND`);
      notFound++;
    }

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log(`\nDone! Updated: ${updated}, Not found: ${notFound}`);
  process.exit(0);
}

main().catch(console.error);

