import { eq } from "drizzle-orm";
import { read, utils, type WorkBook } from "xlsx";

import type { DbClient } from "@/db";
import { organisations, pipelineAssets, spendEntries } from "@/db/schema";

import { presignObjectUrl } from "../objectStorage";
import type { PipelineStage } from "../types";

export type ImportSpendExcelInput = {
  /**
   * Primary provenance identifier (Option C).
   * The stage will download the workbook from object storage using this asset.
   */
  assetId: number;
  /**
   * If true, clears all spend entries + organisations before importing.
   * Useful early in development; do not use once multiple assets are loaded.
   */
  truncateAll?: boolean;
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

export const importSpendExcelStage: PipelineStage<ImportSpendExcelInput> = {
  id: "importSpendExcel",
  title: "Import spend Excel workbook",
  validate(input) {
    if (!Number.isInteger(input.assetId) || input.assetId <= 0) {
      throw new Error("assetId must be a positive integer");
    }
  },
  async run(ctx, input) {
    const asset = await ctx.db
      .select()
      .from(pipelineAssets)
      .where(eq(pipelineAssets.id, input.assetId))
      .limit(1);

    if (!asset[0]) {
      await ctx.log({
        level: "error",
        message: `Asset not found: ${input.assetId}`,
      });
      return { status: "failed" };
    }

    const objectKey = asset[0].objectKey;

    await ctx.log({
      level: "info",
      message: `Downloading workbook from object storage`,
      meta: { assetId: input.assetId, objectKey },
    });

    const downloadUrl = presignObjectUrl({
      method: "GET",
      objectKey,
      expiresSeconds: 60,
    });

    const resp = await fetch(downloadUrl);
    if (!resp.ok) {
      await ctx.log({
        level: "error",
        message: `Failed to download asset (${resp.status} ${resp.statusText})`,
        meta: { assetId: input.assetId, objectKey },
      });
      return { status: "failed" };
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    const workbook = read(buffer, { type: "buffer", cellDates: true });

    const metadataMap = parseTrustMetadata(workbook);
    const dataSheetNames = workbook.SheetNames.filter(
      (name) => name.trim().toLowerCase() !== "trusts"
    );

    if (dataSheetNames.length === 0) {
      await ctx.log({
        level: "warn",
        message: `No data sheets found in workbook (skipping)`,
        meta: { assetId: input.assetId, objectKey },
      });
      return {
        status: "skipped",
        metrics: { sheetsProcessed: 0, paymentsInserted: 0, paymentsSkipped: 0 },
      };
    }

    const discoveredTrusts = gatherTrustNames(
      workbook,
      dataSheetNames,
      metadataMap
    );

    if (ctx.dryRun) {
      await ctx.log({
        level: "info",
        message: "Dry run: would import workbook",
        meta: {
          assetId: input.assetId,
          sheets: dataSheetNames.length,
          trustsMetadata: metadataMap.size,
          trustsDiscovered: discoveredTrusts.size,
        },
      });
      return {
        status: "succeeded",
        metrics: {
          dryRun: true,
          sheets: dataSheetNames.length,
          trustsMetadata: metadataMap.size,
          trustsDiscovered: discoveredTrusts.size,
        },
      };
    }

    const result = await ctx.db.transaction(async (tx) => {
      if (input.truncateAll) {
        await tx.delete(spendEntries);
        await tx.delete(organisations);
        await ctx.log({
          level: "warn",
          message: "Truncated all spend entries and organisations",
        });
      } else {
        await tx
          .delete(spendEntries)
          .where(eq(spendEntries.assetId, input.assetId));
      }

      const syncResult = await syncTrusts(tx, metadataMap, discoveredTrusts);

      const importSummary = await importSpendSheets(
        tx,
        workbook,
        dataSheetNames,
        syncResult.idByKey,
        input.assetId
      );

      return { syncResult, importSummary };
    });

    return {
      status: "succeeded",
      warnings: result.importSummary.warnings,
      metrics: {
        assetId: input.assetId,
        trustsInserted: result.syncResult.inserted,
        trustsUpdated: result.syncResult.updated,
        trustsCreatedWithoutMetadata: result.syncResult.createdWithoutMetadata,
        sheetsProcessed: result.importSummary.sheetsProcessed,
        paymentsInserted: result.importSummary.paymentsInserted,
        paymentsSkipped: result.importSummary.paymentsSkipped,
      },
    };
  },
};

/**
 * Normalizes trust/organisation names to ensure consistent matching.
 */
function normaliseTrustName(name: string): string {
  return name.replace(/\s+/gu, " ").trim().toUpperCase();
}

function cleanString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\s+/gu, " ").trim();
}

function undefinedIfEmpty(value: string): string | undefined {
  return value ? value : undefined;
}

function parseTrustMetadata(workbook: WorkBook): Map<string, TrustMetadata> {
  const sheetName = workbook.SheetNames.find(
    (name) => name.trim().toLowerCase() === "trusts"
  );
  if (!sheetName) return new Map();

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return new Map();

  const rows = utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  if (rows.length === 0) return new Map();

  const metadata = new Map<string, TrustMetadata>();
  const header = rows[0].map((value) => cleanString(value).toLowerCase());

  const nameIndex = header.findIndex((cell) => cell.includes("trust name"));
  if (nameIndex === -1) return metadata;

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

async function syncTrusts(
  client: DbClient,
  metadataMap: Map<string, TrustMetadata>,
  discoveredTrusts: Map<string, string>
): Promise<SyncTrustsResult> {
  const existing = await client.select().from(organisations);
  const idByKey = new Map<string, number>();
  for (const row of existing) {
    idByKey.set(normaliseTrustName(row.name), row.id);
  }

  let inserted = 0;
  let updated = 0;

  for (const [key, metadata] of metadataMap) {
    const payloadForInsert = buildOrganisationInsert(metadata);
    const payloadForUpdate = buildOrganisationUpdate(metadata);
    const existingId = idByKey.get(key);

    if (existingId) {
      await client
        .update(organisations)
        .set(payloadForUpdate)
        .where(eq(organisations.id, existingId));
      updated++;
    } else {
      const [created] = await client
        .insert(organisations)
        .values(payloadForInsert)
        .returning({ id: organisations.id });
      idByKey.set(key, created.id);
      inserted++;
    }
  }

  let createdWithoutMetadata = 0;
  for (const [key, name] of discoveredTrusts) {
    if (idByKey.has(key)) continue;
    const [created] = await client
      .insert(organisations)
      .values({
        name,
        trustType: null,
        odsCode: null,
        postCode: null,
        officialWebsite: null,
        spendingDataUrl: null,
        missingDataNote: null,
        verifiedVia: null,
      })
      .returning({ id: organisations.id });
    idByKey.set(key, created.id);
    createdWithoutMetadata++;
  }

  return { idByKey, inserted, updated, createdWithoutMetadata };
}

function buildOrganisationInsert(metadata: TrustMetadata) {
  return {
    name: metadata.name,
    trustType: metadata.trustType ?? null,
    odsCode: metadata.odsCode ?? null,
    postCode: metadata.postCode ?? null,
    officialWebsite: metadata.officialWebsite ?? null,
    spendingDataUrl: metadata.spendingDataUrl ?? null,
    missingDataNote: metadata.missingDataNote ?? null,
    verifiedVia: metadata.verifiedVia ?? null,
  } satisfies typeof organisations.$inferInsert;
}

function buildOrganisationUpdate(metadata: TrustMetadata) {
  return {
    name: metadata.name,
    trustType: metadata.trustType ?? null,
    odsCode: metadata.odsCode ?? null,
    postCode: metadata.postCode ?? null,
    officialWebsite: metadata.officialWebsite ?? null,
    spendingDataUrl: metadata.spendingDataUrl ?? null,
    missingDataNote: metadata.missingDataNote ?? null,
    verifiedVia: metadata.verifiedVia ?? null,
  } satisfies Partial<typeof organisations.$inferInsert>;
}

async function importSpendSheets(
  client: DbClient,
  workbook: WorkBook,
  sheetNames: string[],
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
        organisationId: trustId,
        supplier,
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
  if (warnings.length >= MAX_WARNINGS) return;
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

