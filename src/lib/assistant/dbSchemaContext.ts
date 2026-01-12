import fs from "fs";
import path from "path";

type DrizzleColumn = {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  default?: string;
};

type DrizzleForeignKey = {
  tableFrom: string;
  tableTo: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete: string;
};

type DrizzleTable = {
  name: string;
  columns: Record<string, DrizzleColumn>;
  foreignKeys: Record<string, DrizzleForeignKey>;
};

type DrizzleSnapshot = {
  tables: Record<string, DrizzleTable>;
};

/**
 * Find the latest Drizzle snapshot file from the journal.
 */
function findLatestSnapshotPath(): string | null {
  const metaDir = path.join(process.cwd(), "drizzle/meta");
  const journalPath = path.join(metaDir, "_journal.json");

  try {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    const entries = journal.entries as { idx: number; tag: string }[];
    if (!entries || entries.length === 0) return null;

    // Get the highest index entry
    const latest = entries.reduce((max, e) => (e.idx > max.idx ? e : max));
    return path.join(metaDir, `${latest.idx.toString().padStart(4, "0")}_snapshot.json`);
  } catch {
    return null;
  }
}

/**
 * Generate SQL DDL from a Drizzle snapshot JSON.
 */
function generateDdlFromSnapshot(snapshot: DrizzleSnapshot): string {
  const createStatements: string[] = [];
  const fkStatements: string[] = [];

  for (const [, table] of Object.entries(snapshot.tables)) {
    const cols: string[] = [];

    for (const [, col] of Object.entries(table.columns)) {
      let def = `  "${col.name}" ${col.type}`;
      if (col.primaryKey) def += " PRIMARY KEY";
      if (col.notNull) def += " NOT NULL";
      if (col.default !== undefined) def += ` DEFAULT ${col.default}`;
      cols.push(def);
    }

    createStatements.push(
      `CREATE TABLE "${table.name}" (\n${cols.join(",\n")}\n);`
    );

    // Collect foreign keys
    for (const [, fk] of Object.entries(table.foreignKeys)) {
      const fkCols = fk.columnsFrom.map((c) => `"${c}"`).join(", ");
      const refCols = fk.columnsTo.map((c) => `"${c}"`).join(", ");
      fkStatements.push(
        `-- ${table.name}.${fk.columnsFrom[0]} → ${fk.tableTo}.${fk.columnsTo[0]}`
      );
    }
  }

  return [
    ...createStatements,
    "",
    "-- Foreign Key Relationships:",
    ...fkStatements,
  ].join("\n\n");
}

/**
 * Loads the database schema as SQL DDL from the latest Drizzle snapshot.
 * Uses the snapshot JSON which always reflects the current schema state,
 * regardless of how many migrations exist.
 */
export function loadDatabaseSchemaForPrompt(): string {
  const snapshotPath = findLatestSnapshotPath();

  if (!snapshotPath) {
    return getFallbackSchema();
  }

  try {
    const snapshot: DrizzleSnapshot = JSON.parse(
      fs.readFileSync(snapshotPath, "utf8")
    );

    const ddl = generateDdlFromSnapshot(snapshot);

    return `
-- ==================== COMPLETE SCHEMA ====================
-- Use these tables directly. Do NOT query to inspect schema.
-- This is the authoritative schema - no need to discover tables.

-- KEY TABLES:
-- spend_entries: Main payment data (5M+ rows) - ⚠️ REQUIRES payment_date filter
-- buyers: Public sector organisations making payments
-- suppliers: Vendors receiving payments
-- entities: Central registry linking buyers/suppliers to real-world orgs

-- ⚠️ SPEND_ENTRIES WARNING:
-- This table has 5M+ rows. Queries WITHOUT a payment_date filter will be REJECTED.
-- Example: SELECT ... FROM spend_entries WHERE payment_date >= '2024-01-01'
-- Columns: id, buyer_id, supplier_id, amount, payment_date, raw_buyer, raw_supplier, asset_id, source_sheet, source_row_number

${ddl}
`.trim();
  } catch (e) {
    console.error("[dbSchemaContext] Failed to load snapshot:", e);
    return getFallbackSchema();
  }
}

function getFallbackSchema(): string {
  return [
    "-- Schema file not found.",
    "-- Core tables: spend_entries, buyers, suppliers, entities, nhs_organisations, councils, companies.",
    "-- Run `pnpm drizzle-kit generate` to create migration files.",
  ].join("\n");
}
