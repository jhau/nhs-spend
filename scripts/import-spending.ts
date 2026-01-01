import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { eq } from "drizzle-orm";
import { readFile, utils, type WorkBook } from "xlsx";

import { db, type DbClient } from "@/db";
import { buyers, spendEntries } from "@/db/schema";

type CliOptions = {
  filePath: string;
  assetId: number;
  truncate: boolean;
  dryRun: boolean;
};

type TrustMetadata = {
  name: string;
  trustType?: string;
  odsCode?: string;
  postCode?: string;
  officialWebsite?: string;
  spendingDataUrl?: string;
  missingDataNote?: string;
  verifiedVia?: string;
};

type SyncTrustsResult = {
  idByKey: Map<string, number>;
  inserted: number;
  updated: number;
  createdWithoutMetadata: number;
};

type ImportSummary = {
  sheetsProcessed: number;
  paymentsInserted: number;
  paymentsSkipped: number;
  warnings: string[];
};

const MAX_WARNINGS = 25;

const MONTH_LOOKUP = new Map([
  ["jan", 1],
  ["feb", 2],
  ["mar", 3],
  ["apr", 4],
  ["may", 5],
  ["jun", 6],
  ["jul", 7],
  ["aug", 8],
  ["sep", 9],
  ["oct", 10],
  ["nov", 11],
  ["dec", 12],
]);

async function main() {
  const options = parseArgs();
  const resolvedPath = path.resolve(options.filePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`✖ Path not found: ${resolvedPath}`);
    process.exit(1);
  }

  const stats = fs.statSync(resolvedPath);
  if (stats.isDirectory()) {
    console.error(
      `✖ Directory import is no longer supported by this script. Use the Web UI pipeline instead.`
    );
    process.exit(1);
  }
  if (!stats.isFile()) {
    console.error(`✖ Path must be a file: ${resolvedPath}`);
    process.exit(1);
  }
  if (!/\.(xlsx|xls)$/i.test(resolvedPath)) {
    console.error(
      `✖ File must be an Excel file (.xlsx or .xls): ${resolvedPath}`
    );
    process.exit(1);
  }
  const filesToProcess: string[] = [resolvedPath];

  if (options.dryRun) {
    console.info("\n🔍 DRY RUN MODE - No data will be modified\n");
  }

  let totalTrustsInserted = 0;
  let totalTrustsUpdated = 0;
  let totalTrustsCreatedWithoutMetadata = 0;
  let totalSheetsProcessed = 0;
  let totalPaymentsInserted = 0;
  let totalPaymentsSkipped = 0;
  const allWarnings: string[] = [];

  for (const filePath of filesToProcess) {
    console.info(`\n📄 Processing: ${path.basename(filePath)}`);

    try {
      const workbook = readFile(filePath, { cellDates: true });
      const metadataMap = parseTrustMetadata(workbook);
      const dataSheetNames = workbook.SheetNames.filter(
        (name) => name.trim().toLowerCase() !== "trusts"
      );

      if (dataSheetNames.length === 0) {
        console.warn(
          `  ⚠️  No data sheets found in ${path.basename(filePath)} (skipping)`
        );
        continue;
      }

      const discoveredTrusts = gatherTrustNames(
        workbook,
        dataSheetNames,
        metadataMap
      );

      if (options.dryRun) {
        console.info(`  • Would process ${dataSheetNames.length} sheet(s)`);
        console.info(`  • Metadata for ${metadataMap.size} trust(s)`);
        console.info(
          `  • Discovered ${discoveredTrusts.size} unique trust(s) in data`
        );
        continue;
      }

      const result = await db.transaction(async (tx: DbClient) => {
        if (options.truncate && filesToProcess.indexOf(filePath) === 0) {
          // Only truncate once, on the first file (before syncing buyers)
          await tx.delete(spendEntries);
          await tx.delete(buyers);
          console.info(
            "  • Truncated all existing spend entries and buyers"
          );
        } else {
          // Delete only entries from this asset to avoid duplicates
          await tx.delete(spendEntries).where(eq(spendEntries.assetId, options.assetId));
        }

        const syncResult = await syncTrusts(tx, metadataMap, discoveredTrusts);

        const importSummary = await importSpendSheets(
          tx,
          workbook,
          dataSheetNames,
          metadataMap,
          syncResult.idByKey,
          options.assetId
        );

        return { syncResult, importSummary };
      });

      totalTrustsInserted += result.syncResult.inserted;
      totalTrustsUpdated += result.syncResult.updated;
      totalTrustsCreatedWithoutMetadata +=
        result.syncResult.createdWithoutMetadata;
      totalSheetsProcessed += result.importSummary.sheetsProcessed;
      totalPaymentsInserted += result.importSummary.paymentsInserted;
      totalPaymentsSkipped += result.importSummary.paymentsSkipped;

      allWarnings.push(
        ...result.importSummary.warnings.map(
          (w: string) => `${path.basename(filePath)}: ${w}`
        )
      );

      console.info(
        `  ✓ Trusts: +${result.syncResult.inserted} inserted, ~${result.syncResult.updated} updated`
      );
      console.info(
        `  ✓ Payments: +${result.importSummary.paymentsInserted} inserted, ${result.importSummary.paymentsSkipped} skipped`
      );
    } catch (error) {
      console.error(`  ✖ Failed to process ${path.basename(filePath)}:`, error);
      if (filesToProcess.length === 1) {
        process.exit(1);
      }
      continue;
    }
  }

  if (!options.dryRun) {
    console.info("\n✅ Import complete");
    console.info(`  • Files processed: ${filesToProcess.length}`);
    console.info(`  • Total trust records inserted: ${totalTrustsInserted}`);
    console.info(`  • Total trust records updated: ${totalTrustsUpdated}`);
    console.info(
      `  • Trusts created without metadata: ${totalTrustsCreatedWithoutMetadata}`
    );
    console.info(`  • Total sheets processed: ${totalSheetsProcessed}`);
    console.info(`  • Total payments inserted: ${totalPaymentsInserted}`);
    console.info(`  • Total payments skipped: ${totalPaymentsSkipped}`);

    if (allWarnings.length > 0) {
      const displayWarnings = allWarnings.slice(0, MAX_WARNINGS);
      console.warn("\n⚠️  Warnings:");
      for (const warning of displayWarnings) {
        console.warn(`  - ${warning}`);
      }
      if (allWarnings.length > MAX_WARNINGS) {
        console.warn(
          `  … and ${allWarnings.length - MAX_WARNINGS} more warnings`
        );
      }
    }
  }
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let filePath: string | undefined;
  let assetId: number | undefined;
  let truncate = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--truncate") {
      truncate = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--asset-id") {
      const value = args[++i];
      assetId = value ? Number(value) : undefined;
      continue;
    }
    if (arg === "--file" || arg === "--dir" || arg === "--directory") {
      filePath = args[++i];
      continue;
    }
    if (!filePath) {
      filePath = arg;
    }
  }

  if (!filePath) {
    console.error(
      "Usage: pnpm data:import -- <file.xlsx> --asset-id <id> [--truncate] [--dry-run]"
    );
    console.error("");
    console.error("Examples:");
    console.error("  pnpm data:import -- data/file.xlsx --asset-id 123");
    console.error(
      "  pnpm data:import -- data/ --truncate     # Clear all existing data first"
    );
    console.error(
      "  pnpm data:import -- data/ --dry-run      # Preview without making changes"
    );
    process.exit(1);
  }

  if (!assetId || !Number.isInteger(assetId) || assetId <= 0) {
    console.error("✖ --asset-id is required and must be a positive integer");
    process.exit(1);
  }

  return { filePath, assetId, truncate, dryRun };
}

/**
 * Normalizes trust/organisation names to ensure consistent matching.
 * Converts to uppercase and trims whitespace so that different capitalizations
 * (e.g., "Airedale NHS Foundation Trust" and "AIREDALE NHS FOUNDATION TRUST")
 * are treated as the same organisation.
 */
function normaliseTrustName(name: string): string {
  return name.replace(/\s+/gu, " ").trim().toUpperCase();
}

function cleanString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value).replace(/\s+/gu, " ").trim();
}

function parseTrustMetadata(workbook: WorkBook): Map<string, TrustMetadata> {
  const sheetName = workbook.SheetNames.find(
    (name) => name.trim().toLowerCase() === "trusts"
  );
  if (!sheetName) {
    return new Map();
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return new Map();
  }

  const rows = utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  if (rows.length === 0) {
    return new Map();
  }

  const metadata = new Map<string, TrustMetadata>();
  const header = rows[0].map((value) => cleanString(value).toLowerCase());

  const nameIndex = header.findIndex((cell) => cell.includes("trust name"));
  if (nameIndex === -1) {
    return metadata;
  }

  const indexFor = (label: string) =>
    header.findIndex((cell) => cell.includes(label));
  const trustTypeIdx = indexFor("trust type");
  const odsCodeIdx = indexFor("ods code");
  const postCodeIdx = indexFor("post code");
  const officialWebsiteIdx = indexFor("official website");
  const spendingUrlIdx = indexFor("spending data url");
  const missingDataIdx = indexFor("missing data");
  const verifiedViaIdx = indexFor("verified via");

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const name = cleanString(row[nameIndex]);
    if (!name || name.toLowerCase() === "trust name") continue;

    const record: TrustMetadata = {
      name,
      trustType:
        trustTypeIdx >= 0
          ? undefinedIfEmpty(cleanString(row[trustTypeIdx]))
          : undefined,
      odsCode:
        odsCodeIdx >= 0
          ? undefinedIfEmpty(cleanString(row[odsCodeIdx]))
          : undefined,
      postCode:
        postCodeIdx >= 0
          ? undefinedIfEmpty(cleanString(row[postCodeIdx]))
          : undefined,
      officialWebsite:
        officialWebsiteIdx >= 0
          ? undefinedIfEmpty(cleanString(row[officialWebsiteIdx]))
          : undefined,
      spendingDataUrl:
        spendingUrlIdx >= 0
          ? undefinedIfEmpty(cleanString(row[spendingUrlIdx]))
          : undefined,
      missingDataNote:
        missingDataIdx >= 0
          ? undefinedIfEmpty(cleanString(row[missingDataIdx]))
          : undefined,
      verifiedVia:
        verifiedViaIdx >= 0
          ? undefinedIfEmpty(cleanString(row[verifiedViaIdx]))
          : undefined,
    };

    metadata.set(normaliseTrustName(name), record);
  }

  return metadata;
}

function undefinedIfEmpty(value: string): string | undefined {
  return value ? value : undefined;
}

function gatherTrustNames(
  workbook: WorkBook,
  sheetNames: string[],
  metadataMap: Map<string, TrustMetadata>
): Map<string, string> {
  const discovered = new Map<string, string>();

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;

      const trustNameRaw = cleanString(row[0]);
      if (!trustNameRaw || isHeaderTrustLabel(trustNameRaw)) continue;

      const key = normaliseTrustName(trustNameRaw);
      if (!discovered.has(key)) {
        const metadataName = metadataMap.get(key)?.name ?? trustNameRaw;
        discovered.set(key, metadataName);
      }
    }
  }

  return discovered;
}

/**
 * Syncs buyers to the database, creating or updating records as needed.
 * Uses normalized names as keys to prevent duplicates from different capitalizations.
 * The buyers table has a unique constraint on the name field, ensuring
 * each normalized name appears only once in the database.
 */
async function syncTrusts(
  client: DbClient,
  metadataMap: Map<string, TrustMetadata>,
  discoveredTrusts: Map<string, string>
): Promise<SyncTrustsResult> {
  const existing = await client.select().from(buyers);
  const idByKey = new Map<string, number>();
  for (const row of existing) {
    idByKey.set(normaliseTrustName(row.name), row.id);
  }

  let inserted = 0;
  let updated = 0;

  for (const [key, metadata] of metadataMap) {
    const payloadForInsert = buildBuyerInsert(metadata);
    const payloadForUpdate = buildBuyerUpdate(metadata);
    const existingId = idByKey.get(key);

    if (existingId) {
      await client
        .update(buyers)
        .set(payloadForUpdate)
        .where(eq(buyers.id, existingId));
      updated++;
    } else {
      const [created] = await client
        .insert(buyers)
        .values(payloadForInsert)
        .returning({ id: buyers.id });
      idByKey.set(key, created.id);
      inserted++;
    }
  }

  let createdWithoutMetadata = 0;
  for (const [key, name] of discoveredTrusts) {
    if (idByKey.has(key)) continue;
    const [created] = await client
      .insert(buyers)
      .values({
        name,
        matchStatus: "pending",
        officialWebsite: null,
        spendingDataUrl: null,
        missingDataNote: null,
        verifiedVia: null,
      })
      .returning({ id: buyers.id });
    idByKey.set(key, created.id);
    createdWithoutMetadata++;
  }

  return { idByKey, inserted, updated, createdWithoutMetadata };
}

function buildBuyerInsert(metadata: TrustMetadata) {
  return {
    name: metadata.name,
    matchStatus: "pending" as const,
    officialWebsite: metadata.officialWebsite ?? null,
    spendingDataUrl: metadata.spendingDataUrl ?? null,
    missingDataNote: metadata.missingDataNote ?? null,
    verifiedVia: metadata.verifiedVia ?? null,
  } satisfies typeof buyers.$inferInsert;
}

function buildBuyerUpdate(metadata: TrustMetadata) {
  return {
    name: metadata.name,
    officialWebsite: metadata.officialWebsite ?? null,
    spendingDataUrl: metadata.spendingDataUrl ?? null,
    missingDataNote: metadata.missingDataNote ?? null,
    verifiedVia: metadata.verifiedVia ?? null,
    updatedAt: new Date(),
  } satisfies Partial<typeof buyers.$inferInsert>;
}

async function importSpendSheets(
  client: DbClient,
  workbook: WorkBook,
  sheetNames: string[],
  metadataMap: Map<string, TrustMetadata>,
  trustIdByKey: Map<string, number>,
  assetId: number
): Promise<ImportSummary> {
  const warnings: string[] = [];
  let paymentsInserted = 0;
  let paymentsSkipped = 0;
  let sheetsProcessed = 0;

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    sheetsProcessed++;
    const rows = utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });
    if (rows.length <= 1) continue;

    const batch: (typeof spendEntries.$inferInsert)[] = [];
    const flushBatch = async () => {
      if (batch.length === 0) return;
      await client.insert(spendEntries).values(batch);
      paymentsInserted += batch.length;
      batch.length = 0;
    };

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      if (!Array.isArray(row)) continue;

      const trustNameRaw = cleanString(row[0]);
      if (!trustNameRaw) {
        paymentsSkipped++;
        recordWarning(
          warnings,
          `(${sheetName} row ${rowIndex + 1}) missing trust name`
        );
        continue;
      }
      if (isHeaderTrustLabel(trustNameRaw)) {
        continue;
      }

      const trustKey = normaliseTrustName(trustNameRaw);
      const trustId = trustIdByKey.get(trustKey);
      if (!trustId) {
        paymentsSkipped++;
        recordWarning(
          warnings,
          `(${sheetName} row ${rowIndex + 1}) unknown trust '${trustNameRaw}'`
        );
        continue;
      }

      const supplier = cleanString(row[2]);
      if (!supplier) {
        paymentsSkipped++;
        recordWarning(
          warnings,
          `(${sheetName} row ${rowIndex + 1}) missing supplier`
        );
        continue;
      }

      const amountResult = parseAmount(row[3]);
      if (amountResult.amount === null) {
        paymentsSkipped++;
        recordWarning(
          warnings,
          `(${sheetName} row ${rowIndex + 1}) invalid amount '${
            amountResult.raw ?? ""
          }'`
        );
        continue;
      }

      const dateResult = parsePaymentDate(row[1]);
      if (!dateResult.iso) {
        paymentsSkipped++;
        recordWarning(
          warnings,
          `(${sheetName} row ${rowIndex + 1}) invalid payment date '${
            dateResult.raw ?? ""
          }'`
        );
        continue;
      }

      batch.push({
        assetId,
        rawBuyer: trustNameRaw,
        buyerId: trustId,
        rawSupplier: supplier,
        amount: amountResult.amount.toFixed(2),
        paymentDate: dateResult.iso,
        rawAmount: amountResult.raw,
        paymentDateRaw: dateResult.raw,
        sourceSheet: sheetName,
        sourceRowNumber: rowIndex + 1,
      });

      if (batch.length >= 1000) {
        await flushBatch();
      }
    }

    await flushBatch();
  }

  return { sheetsProcessed, paymentsInserted, paymentsSkipped, warnings };
}

function recordWarning(warnings: string[], message: string) {
  if (warnings.length >= MAX_WARNINGS) {
    return;
  }
  warnings.push(message);
}

function isHeaderTrustLabel(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  return normalised === "org code desc/trust" || normalised === "trust name";
}

function parseAmount(value: unknown): {
  amount: number | null;
  raw: string | null;
} {
  if (value === null || value === undefined) {
    return { amount: null, raw: null };
  }
  if (typeof value === "number" && !Number.isNaN(value)) {
    return { amount: value, raw: value.toString() };
  }
  if (value instanceof Date) {
    return { amount: null, raw: value.toISOString() };
  }

  const raw = cleanString(value);
  if (!raw) {
    return { amount: null, raw };
  }

  let cleaned = raw.replace(/£|,/gu, "");
  let negative = false;
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }

  cleaned = cleaned.replace(/[^0-9.\-]/gu, "");
  if (!cleaned) {
    return { amount: null, raw };
  }

  const numeric = Number(cleaned);
  if (Number.isNaN(numeric)) {
    return { amount: null, raw };
  }

  return { amount: negative ? -numeric : numeric, raw };
}

function parsePaymentDate(value: unknown): {
  iso: string | null;
  raw: string | null;
} {
  if (value === null || value === undefined) {
    return { iso: null, raw: null };
  }

  if (value instanceof Date) {
    return { iso: formatDate(value), raw: value.toISOString() };
  }

  if (typeof value === "number" && !Number.isNaN(value)) {
    const iso = formatExcelSerial(value);
    return { iso, raw: value.toString() };
  }

  const raw = cleanString(value);
  if (!raw) {
    return { iso: null, raw };
  }

  const yyMmmMatch = raw.match(/^(\d{2})-([A-Za-z]{3})$/u);
  if (yyMmmMatch) {
    const year = Number.parseInt(yyMmmMatch[1], 10);
    const monthName = yyMmmMatch[2].toLowerCase();
    const month = MONTH_LOOKUP.get(monthName);
    if (!month) {
      return { iso: null, raw };
    }
    const fullYear = 2000 + year;
    return { iso: formatDate(new Date(Date.UTC(fullYear, month - 1, 1))), raw };
  }

  const dmyMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u);
  if (dmyMatch) {
    const day = Number.parseInt(dmyMatch[1], 10);
    const month = Number.parseInt(dmyMatch[2], 10);
    const year = Number.parseInt(dmyMatch[3], 10);
    return { iso: formatDate(new Date(Date.UTC(year, month - 1, day))), raw };
  }

  const maybeNumber = Number(raw);
  if (!Number.isNaN(maybeNumber)) {
    const iso = formatExcelSerial(maybeNumber);
    return { iso, raw };
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.valueOf())) {
    return { iso: formatDate(parsed), raw };
  }

  return { iso: null, raw };
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return `${year}-${pad(month)}-${pad(day)}`;
}

function formatExcelSerial(serial: number): string | null {
  if (Number.isNaN(serial)) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const millis = Math.round(serial * 24 * 60 * 60 * 1000);
  const date = new Date(epoch + millis);
  if (Number.isNaN(date.valueOf())) return null;
  return formatDate(date);
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

void main();
