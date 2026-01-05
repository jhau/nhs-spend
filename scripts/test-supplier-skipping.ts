import "dotenv/config";
import { db } from "../src/db";
import { suppliers } from "../src/db/schema";
import { isLikelyNotACompany } from "../src/lib/company-validation";
import { eq, and } from "drizzle-orm";

async function main() {
  console.log("🔍 Fetching suppliers from database...");
  
  const allSuppliers = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      matchStatus: suppliers.matchStatus
    })
    .from(suppliers)
    .where(eq(suppliers.matchStatus, "pending"));

  console.log(`📊 Found ${allSuppliers.length} pending suppliers.`);
  console.log("═".repeat(80));
  console.log(`${"SUPPLIER NAME".padEnd(40)} | ${"REASON FOR SKIPPING"}`);
  console.log("─".repeat(80));

  let skipCount = 0;
  for (const s of allSuppliers) {
    const skipResult = isLikelyNotACompany(s.name);
    if (skipResult) {
      console.log(`${s.name.substring(0, 40).padEnd(40)} | ${skipResult.reason}`);
      skipCount++;
    }
  }

  console.log("─".repeat(80));
  console.log(`✅ Total skippable: ${skipCount} / ${allSuppliers.length} (${((skipCount / allSuppliers.length) * 100).toFixed(1)}%)`);
  
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});

