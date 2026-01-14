import { eq } from "drizzle-orm";
import { read, utils, type WorkBook } from "xlsx";

import {
  buyers,
  entities,
  pipelineAssets,
  pipelineSkippedRows,
  spendEntries,
  suppliers,
} from "@/db/schema";

import { presignObjectUrl } from "../objectStorage";
import type {
  PipelineContext,
  PipelineLogLevel,
  PipelineStage,
} from "../types";
import { searchGovUkOrganisation } from "@/lib/gov-uk";
import {
  findOrCreateGovDepartmentEntity,
  findFuzzyMatch,
} from "@/lib/matching-helpers";

export type ImportGovDeptSpendExcelInput = {
  assetId: number;
  truncateAll?: boolean;
};

type SyncGovDeptsResult = {
  idByKey: Map<string, number>;
  inserted: number;
  updated: number;
};

type SyncSuppliersResult = {
  idByKey: Map<string, number>;
  inserted: number;
};

type ImportSummary = {
  sheetsProcessed: number;
  paymentsInserted: number;
  paymentsSkipped: number;
  skippedReasons: Record<string, number>;
  warnings: string[];
};

const MAX_WARNINGS = 25;

export const importGovDeptSpendExcelStage: PipelineStage<ImportGovDeptSpendExcelInput> =
  {
    id: "importGovDeptSpendExcel",
    title: "Import government department spend Excel workbook",
    validate(input) {
      if (!Number.isInteger(input.assetId) || input.assetId <= 0) {
        throw new Error("assetId must be a positive integer");
      }
    },
    async run(ctx, input) {
      await ctx.log({
        level: "info",
        message: `Starting government department import process`,
        meta: { assetId: input.assetId, truncateAll: input.truncateAll ?? false },
      });

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
      const downloadUrl = presignObjectUrl({
        method: "GET",
        objectKey,
        expiresSeconds: 60,
      });

      let resp;
      try {
        resp = await fetch(downloadUrl);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        await ctx.log({
          level: "error",
          message: `Fetch failed for asset download: ${error.message}`,
          meta: { assetId: input.assetId, objectKey, downloadUrl },
        });
        throw error;
      }

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

      const dataSheetNames = workbook.SheetNames.filter(
        (name) =>
          !["trusts", "councils", "metadata"].includes(
            name.trim().toLowerCase()
          )
      );

      if (dataSheetNames.length === 0) {
        return {
          status: "skipped",
          metrics: { sheetsProcessed: 0, paymentsInserted: 0 },
        };
      }

      // Validate headers for Gov Dept data
      const GOV_HEADER_LABELS = ["department", "organisation", "authority", "buyer", "council name"];
      for (const sheetName of dataSheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = utils.sheet_to_json<(string | number | null)[]>(sheet, {
          header: 1,
          defval: null,
          range: 0, // Just read header
        });
        if (rows.length > 0 && Array.isArray(rows[0])) {
          const firstCol = cleanString(rows[0][0]).toLowerCase();
          if (!GOV_HEADER_LABELS.some(label => firstCol.includes(label))) {
            const reason = `Sheet '${sheetName}' does not appear to be a Government Department spend sheet. Expected 'Department', 'Organisation' or 'Council name' in the first column, but found '${firstCol || "empty"}'. Please ensure you have selected the correct organisation type.`;
            await ctx.log({
              level: "error",
              message: reason,
              meta: { sheetName, firstCol },
            });
            return { status: "failed" };
          }
        }
      }

      const { discoveredGovDepts, discoveredSuppliers } = await gatherNames(
        workbook,
        dataSheetNames,
        ctx
      );

      if (ctx.dryRun) {
        return {
          status: "succeeded",
          metrics: {
            dryRun: true,
            govDeptsDiscovered: discoveredGovDepts.size,
            suppliersDiscovered: discoveredSuppliers.size,
          },
        };
      }

      const result = await ctx.db.transaction(async (tx) => {
        if (input.truncateAll) {
          await tx.delete(spendEntries);
          await tx.delete(buyers);
          await tx.delete(entities).where(eq(entities.entityType, "government_department"));
        } else {
          await tx
            .delete(spendEntries)
            .where(eq(spendEntries.assetId, input.assetId));
        }

        const govDeptSyncResult = await syncGovDepts(
          tx,
          discoveredGovDepts,
          ctx
        );

        const supplierSyncResult = await syncSuppliers(
          tx,
          discoveredSuppliers,
          ctx
        );

        const importSummary = await importSpendSheets(
          tx,
          workbook,
          dataSheetNames,
          govDeptSyncResult.idByKey,
          supplierSyncResult.idByKey,
          input.assetId,
          ctx
        );

        return { govDeptSyncResult, supplierSyncResult, importSummary };
      });

      return {
        status: "succeeded",
        warnings: result.importSummary.warnings,
        metrics: {
          assetId: input.assetId,
          govDeptsInserted: result.govDeptSyncResult.inserted,
          suppliersInserted: result.supplierSyncResult.inserted,
          sheetsProcessed: result.importSummary.sheetsProcessed,
          paymentsInserted: result.importSummary.paymentsInserted,
          paymentsSkipped: result.importSummary.paymentsSkipped,
        },
      };
    },
  };

function normaliseName(name: string): string {
  return name.replace(/\s+/gu, " ").trim().toUpperCase();
}

function cleanString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\s+/gu, " ").trim();
}

async function gatherNames(
  workbook: WorkBook,
  sheetNames: string[],
  ctx: PipelineContext
): Promise<{
  discoveredGovDepts: Map<string, string>;
  discoveredSuppliers: Set<string>;
}> {
  const discoveredGovDepts = new Map<string, string>();
  const discoveredSuppliers = new Set<string>();

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

      const deptNameRaw = cleanString(row[0]);
      if (deptNameRaw && !["department", "organisation", "authority", "buyer"].includes(deptNameRaw.toLowerCase())) {
        const key = normaliseName(deptNameRaw);
        if (!discoveredGovDepts.has(key)) {
          discoveredGovDepts.set(key, deptNameRaw);
        }
      }

      const supplierNameRaw = cleanString(row[2]);
      if (supplierNameRaw && !discoveredSuppliers.has(supplierNameRaw)) {
        discoveredSuppliers.add(supplierNameRaw);
      }
    }
  }

  return { discoveredGovDepts, discoveredSuppliers };
}

async function syncGovDepts(
  client: any,
  discoveredGovDepts: Map<string, string>,
  ctx: PipelineContext
): Promise<SyncGovDeptsResult> {
  const existing = await client
    .select({
      id: buyers.id,
      name: buyers.name,
      entityName: entities.name,
    })
    .from(buyers)
    .leftJoin(entities, eq(buyers.entityId, entities.id))
    .where(eq(entities.entityType, "government_department"));

  const idByKey = new Map<string, number>();
  for (const row of existing) {
    if (row.name) {
      idByKey.set(normaliseName(row.name), row.id);
    }
  }

  let inserted = 0;
  let updated = 0;

  for (const [key, name] of discoveredGovDepts) {
    if (idByKey.has(key)) continue;

    // Try fuzzy match against existing buyers first to catch typos
    const fuzzyMatch = findFuzzyMatch(key, idByKey, 0.9);
    if (fuzzyMatch) {
      await ctx.log({
        level: "info",
        message: `FUZZY MATCH: Mapping "${name}" to existing buyer "${fuzzyMatch.name}" (confidence: ${fuzzyMatch.rating.toFixed(2)})`,
      });
      idByKey.set(key, fuzzyMatch.id);
      continue;
    }

    await ctx.log({
      level: "info",
      message: `Resolving government department: ${name}`,
    });

    const profile = await searchGovUkOrganisation(name, ctx.log);
    
    if (profile) {
      const entityId = await findOrCreateGovDepartmentEntity(client, profile);
      const [created] = await client
        .insert(buyers)
        .values({
          name: profile.title,
          entityId,
          matchStatus: "matched",
          matchConfidence: "1.00",
          matchAttemptedAt: new Date(),
          officialWebsite: profile.link
            ? `https://www.gov.uk${profile.link}`
            : null,
        })
        .onConflictDoUpdate({
          target: [buyers.name],
          set: {
            entityId,
            matchStatus: "matched",
            matchConfidence: "1.00",
            matchAttemptedAt: new Date(),
            officialWebsite: profile.link
              ? `https://www.gov.uk${profile.link}`
              : null,
            updatedAt: new Date(),
          },
        })
        .returning({ id: buyers.id });

      idByKey.set(key, created.id);
      inserted++;
    } else {
      await ctx.log({
        level: "warn",
        message: `Could not resolve department on GOV.UK: ${name}`,
      });
    }
  }

  return { idByKey, inserted, updated };
}

async function syncSuppliers(
  client: any,
  discoveredSuppliers: Set<string>,
  ctx: PipelineContext
): Promise<SyncSuppliersResult> {
  const existing = await client.select().from(suppliers);
  const idByKey = new Map<string, number>();
  for (const row of existing) idByKey.set(row.name, row.id);

  let inserted = 0;
  const newSuppliers = Array.from(discoveredSuppliers).filter(
    (name) => !idByKey.has(name)
  );

  if (newSuppliers.length > 0) {
    for (let i = 0; i < newSuppliers.length; i += 100) {
      const batch = newSuppliers.slice(i, i + 100);
      const created = await client
        .insert(suppliers)
        .values(batch.map((name) => ({ name })))
        .returning({ id: suppliers.id, name: suppliers.name });

      for (const row of created) idByKey.set(row.name, row.id);
      inserted += created.length;
    }
  }

  return { idByKey, inserted };
}

async function importSpendSheets(
  client: any,
  workbook: WorkBook,
  sheetNames: string[],
  buyerIdByKey: Map<string, number>,
  supplierIdByKey: Map<string, number>,
  assetId: number,
  ctx: PipelineContext
): Promise<ImportSummary> {
  const warnings: string[] = [];
  const skippedReasons: Record<string, number> = {};
  const skippedRows: (typeof pipelineSkippedRows.$inferInsert)[] = [];
  let paymentsInserted = 0;
  let paymentsSkipped = 0;

  const flushSkippedRows = async () => {
    if (skippedRows.length === 0) return;
    await client.insert(pipelineSkippedRows).values(skippedRows);
    skippedRows.length = 0;
  };

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

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

      const buyerNameRaw = cleanString(row[0]);
      const buyerId = buyerIdByKey.get(normaliseName(buyerNameRaw));
      
      if (!buyerId) {
        paymentsSkipped++;
        const reason = `unknown department '${buyerNameRaw}'`;
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
        skippedRows.push({
          runId: ctx.runId,
          sheetName,
          rowNumber: rowIndex + 1,
          reason,
          rawData: row,
        });
        if (skippedRows.length >= 500) await flushSkippedRows();
        continue;
      }

      const supplier = cleanString(row[2]);
      const amountResult = parseAmount(row[3]);
      const dateResult = parsePaymentDate(row[1]);

      if (amountResult.amount !== null && dateResult.iso) {
        batch.push({
          assetId,
          rawBuyer: buyerNameRaw,
          buyerId,
          supplierId: supplierIdByKey.get(supplier),
          rawSupplier: supplier,
          amount: amountResult.amount.toFixed(2),
          paymentDate: dateResult.iso,
          rawAmount: amountResult.raw,
          paymentDateRaw: dateResult.raw,
          sourceSheet: sheetName,
          sourceRowNumber: rowIndex + 1,
        });
      } else {
        paymentsSkipped++;
        const reason = !amountResult.amount ? "invalid amount" : "invalid date";
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
        skippedRows.push({
          runId: ctx.runId,
          sheetName,
          rowNumber: rowIndex + 1,
          reason,
          rawData: row,
        });
        if (skippedRows.length >= 500) await flushSkippedRows();
      }

      if (batch.length >= 1000) await flushBatch();
    }
    await flushBatch();
  }

  await flushSkippedRows();

  return {
    sheetsProcessed: sheetNames.length,
    paymentsInserted,
    paymentsSkipped,
    skippedReasons,
    warnings,
  };
}

function parseAmount(value: unknown) {
  if (typeof value === "number") {
    // numeric(14,2) max is 999,999,999,999.99. Reject astronomical values.
    if (Math.abs(value) > 100_000_000_000) return { amount: null, raw: value.toString() };
    return { amount: value, raw: value.toString() };
  }
  const raw = cleanString(value);
  if (!raw) return { amount: null, raw: null };
  const cleaned = raw.replace(/[£,]/g, "");
  const numeric = Number(cleaned);
  if (isNaN(numeric) || Math.abs(numeric) > 100_000_000_000) return { amount: null, raw };
  return { amount: numeric, raw };
}

function parsePaymentDate(value: unknown) {
  if (value instanceof Date)
    return { iso: value.toISOString().split("T")[0], raw: value.toISOString() };
  const raw = cleanString(value);
  if (!raw) return { iso: null, raw: null };
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime()))
    return { iso: parsed.toISOString().split("T")[0], raw };
  return { iso: null, raw };
}

