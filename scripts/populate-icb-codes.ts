import "dotenv/config";

import { eq, isNotNull, isNull, and } from "drizzle-orm";

import { db } from "@/db";
import { organisations } from "@/db/schema";

interface OdsRelationship {
  Status: string;
  Target: {
    OrgId: {
      extension: string;
    };
    PrimaryRoleId: {
      id: string;
    };
  };
}

interface OdsRelsResponse {
  Rel: OdsRelationship[];
}

async function getIcbCode(odsCode: string): Promise<string | null> {
  const url = `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/${odsCode}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const rels: OdsRelsResponse = data.Organisation?.Rels;

    if (!rels?.Rel) {
      return null;
    }

    // Find active relationship to an ICB (RO261 = Integrated Care Board)
    const icbRel = rels.Rel.find(
      (rel) =>
        rel.Status === "Active" && rel.Target?.PrimaryRoleId?.id === "RO261"
    );

    return icbRel?.Target?.OrgId?.extension ?? null;
  } catch (error) {
    console.error(`  Error fetching ICB for ${odsCode}:`, error);
    return null;
  }
}

async function main() {
  // Get all organisations with ODS code but no ICB code
  const orgs = await db
    .select()
    .from(organisations)
    .where(
      and(isNotNull(organisations.odsCode), isNull(organisations.icbOdsCode))
    );

  console.log(`Found ${orgs.length} organisations to look up\n`);

  let updated = 0;
  let notFound = 0;

  for (const org of orgs) {
    if (!org.odsCode) continue;

    console.log(`Looking up ICB for: ${org.name} (${org.odsCode})`);

    const icbCode = await getIcbCode(org.odsCode);

    if (icbCode) {
      console.log(`  ICB: ${icbCode}`);

      await db
        .update(organisations)
        .set({ icbOdsCode: icbCode })
        .where(eq(organisations.id, org.id));

      updated++;
    } else {
      console.log(`  No ICB relationship found`);
      notFound++;
    }

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log(`\nDone! Updated: ${updated}, No ICB found: ${notFound}`);
  process.exit(0);
}

main().catch(console.error);

