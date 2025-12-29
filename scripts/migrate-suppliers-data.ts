import { db, pool } from "@/db";
import { sql } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true });
dotenv.config({ path: ".env", override: false });

async function main() {
  console.log("Starting migration...");

  try {
    // 1. Populate suppliers from spend_entries (unique names)
    console.log("Populating suppliers from spend_entries...");
    await db.execute(sql`
      INSERT INTO "suppliers" ("name")
      SELECT DISTINCT "supplier" 
      FROM "spend_entries"
      WHERE "supplier" IS NOT NULL
      ON CONFLICT ("name") DO NOTHING;
    `);

    // 2. Migrate data from supplier_company_links to suppliers
    console.log("Migrating match data from supplier_company_links...");
    // Check if supplier_company_links exists before trying to read from it
    const tableExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'supplier_company_links'
      );
    `);

    if (tableExists.rows[0].exists) {
      await db.execute(sql`
        UPDATE "suppliers" s
        SET 
          "company_id" = scl.company_id,
          "match_status" = scl.status,
          "match_confidence" = scl.match_confidence,
          "manually_verified" = scl.manually_verified,
          "created_at" = scl.matched_at -- Use matched_at as created_at for history
        FROM "supplier_company_links" scl
        WHERE s.name = scl.supplier_name;
      `);
    }

    // 3. Update spend_entries.supplier_id
    console.log("Linking spend_entries to suppliers...");
    await db.execute(sql`
      UPDATE "spend_entries" se
      SET "supplier_id" = s.id
      FROM "suppliers" s
      WHERE se.supplier = s.name
      AND se.supplier_id IS NULL;
    `);

    // Check for any spend_entries without supplier_id
    const remaining = await db.execute(sql`
      SELECT COUNT(*) as count FROM "spend_entries" WHERE "supplier_id" IS NULL;
    `);
    
    const count = remaining.rows[0].count;
    if (Number(count) > 0) {
        console.warn(`Warning: ${count} spend_entries records could not be linked to a supplier.`);
    } else {
        console.log("All spend_entries successfully linked.");
    }
    
    console.log("Migration completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
