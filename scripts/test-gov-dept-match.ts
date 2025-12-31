import dotenv from "dotenv";
import { db } from "@/db";
import { searchGovUkOrganisation } from "@/lib/gov-uk";
import { findOrCreateGovDepartmentEntity } from "@/lib/matching-helpers";
import { entities, governmentDepartments } from "@/db/schema";
import { eq } from "drizzle-orm";

// Load environment variables
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

async function main() {
  const query = process.argv[2];

  if (!query) {
    console.log("Usage: npx tsx scripts/test-gov-dept-match.ts <department name>");
    console.log("Example: npx tsx scripts/test-gov-dept-match.ts 'Attorney General's Office'");
    process.exit(1);
  }

  console.log(`\n🔍 Searching GOV.UK for: "${query}"\n`);

  // Mock logger to see what's happening
  const logger = async (entry: { level: string; message: string; meta?: any }) => {
    const icon = entry.level === "error" ? "❌" : entry.level === "warn" ? "⚠️" : "ℹ️";
    console.log(`${icon} [${entry.level.toUpperCase()}] ${entry.message}`);
    if (entry.meta) {
      console.log(`   Meta: ${JSON.stringify(entry.meta, null, 2)}`);
    }
  };

  try {
    const org = await searchGovUkOrganisation(query, logger);

    if (!org) {
      console.log("\n❌ No organisation found on GOV.UK matching that query.");
      return;
    }

    console.log("\n✅ Found Organisation:");
    console.log(`   Title: ${org.title}`);
    console.log(`   Slug:  ${org.slug}`);
    console.log(`   Type:  ${org.organisation_type}`);
    console.log(`   State: ${org.organisation_state}`);
    console.log(`   Link:  https://www.gov.uk${org.link}`);

    console.log("\n💾 Attempting to find or create in database...");
    const entityId = await findOrCreateGovDepartmentEntity(db, org);
    console.log(`   Entity ID: ${entityId}`);

    // Verify in DB
    const [savedDept] = await db
      .select()
      .from(governmentDepartments)
      .where(eq(governmentDepartments.entityId, entityId))
      .limit(1);

    if (savedDept) {
      console.log("\n✨ Database Verification Successful:");
      console.log(`   Slug in DB: ${savedDept.slug}`);
      console.log(`   Fetched At: ${savedDept.fetchedAt}`);
      
      const [entity] = await db
        .select()
        .from(entities)
        .where(eq(entities.id, entityId))
        .limit(1);
        
      console.log(`   Entity Name: ${entity.name}`);
      console.log(`   Entity Type: ${entity.entityType}`);
    } else {
      console.log("\n❌ Failed to verify record in database.");
    }

  } catch (error) {
    console.error("\n💥 Error during test:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().then(() => {
  console.log("\nTest completed.");
  process.exit(0);
});

