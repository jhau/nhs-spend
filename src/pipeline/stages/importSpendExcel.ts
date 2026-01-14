import { eq, and, isNotNull, not, like, sql } from "drizzle-orm";
import { read, utils, type WorkBook } from "xlsx";

import type { DbClient } from "@/db";
import {
  buyers,
  entities,
  nhsOrganisations,
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
import { searchNhsOrganisation, isLikelyNhsOrganisation } from "@/lib/nhs-api";
import { findFuzzyMatch } from "@/lib/matching-helpers";

export type ImportSpendExcelInput = {
  /**
   * Primary provenance identifier (Option C).
   * The stage will download the workbook from object storage using this asset.
   */
  assetId: number;
  /**
   * If true, clears all spend entries + buyers before importing.
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
    await ctx.log({
      level: "info",
      message: `Starting import process`,
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
    await ctx.log({
      level: "debug",
      message: `Retrieved asset metadata`,
      meta: {
        assetId: input.assetId,
        objectKey,
        originalName: asset[0].originalName,
        sizeBytes: asset[0].sizeBytes,
      },
    });

    await ctx.log({
      level: "info",
      message: `Downloading workbook from object storage`,
      meta: { assetId: input.assetId, objectKey },
    });

    const downloadStartTime = Date.now();
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
    const downloadDuration = Date.now() - downloadStartTime;
    await ctx.log({
      level: "debug",
      message: `Download completed`,
      meta: {
        assetId: input.assetId,
        sizeBytes: buffer.length,
        durationMs: downloadDuration,
      },
    });

    await ctx.log({
      level: "info",
      message: `Parsing Excel workbook`,
      meta: { assetId: input.assetId },
    });
    const parseStartTime = Date.now();
    const workbook = read(buffer, { type: "buffer", cellDates: true });
    const parseDuration = Date.now() - parseStartTime;

    await ctx.log({
      level: "info",
      message: `Workbook parsed successfully`,
      meta: {
        assetId: input.assetId,
        sheetCount: workbook.SheetNames.length,
        sheetNames: workbook.SheetNames,
        durationMs: parseDuration,
      },
    });

    await ctx.log({
      level: "debug",
      message: `Parsing trust metadata`,
      meta: { assetId: input.assetId },
    });
    const metadataMap = await parseTrustMetadata(workbook, ctx);
    await ctx.log({
      level: "info",
      message: `Trust metadata parsed`,
      meta: { assetId: input.assetId, metadataCount: metadataMap.size },
    });

    const dataSheetNames = workbook.SheetNames.filter(
      (name) => name.trim().toLowerCase() !== "trusts"
    );
    await ctx.log({
      level: "debug",
      message: `Identified data sheets`,
      meta: {
        assetId: input.assetId,
        dataSheetCount: dataSheetNames.length,
        dataSheetNames,
      },
    });

    if (dataSheetNames.length === 0) {
      await ctx.log({
        level: "warn",
        message: `No data sheets found in workbook (skipping)`,
        meta: { assetId: input.assetId, objectKey },
      });
      return {
        status: "skipped",
        metrics: {
          sheetsProcessed: 0,
          paymentsInserted: 0,
          paymentsSkipped: 0,
        },
      };
    }

    // Validate headers for NHS data
    for (const sheetName of dataSheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = utils.sheet_to_json<(string | number | null)[]>(sheet, {
        header: 1,
        defval: null,
        range: 0, // Just read header
      });
      if (rows.length > 0 && Array.isArray(rows[0])) {
        const firstCol = cleanString(rows[0][0]);
        if (!isHeaderTrustLabel(firstCol)) {
          const reason = `Sheet '${sheetName}' does not appear to be an NHS spend sheet. Expected 'Trust name' or 'Org code desc/trust' in the first column, but found '${firstCol || "empty"}'. Please ensure you have selected the correct organisation type.`;
          await ctx.log({
            level: "error",
            message: reason,
            meta: { sheetName, firstCol },
          });
          return { status: "failed" };
        }
      }
    }

    await ctx.log({
      level: "debug",
      message: `Gathering trust and supplier names from data sheets`,
      meta: { assetId: input.assetId },
    });
    const { discoveredTrusts, discoveredSuppliers } = await gatherNames(
      workbook,
      dataSheetNames,
      metadataMap,
      ctx
    );
    await ctx.log({
      level: "info",
      message: `Names gathered`,
      meta: {
        assetId: input.assetId,
        discoveredTrustCount: discoveredTrusts.size,
        discoveredSupplierCount: discoveredSuppliers.size,
        trustsWithMetadata: metadataMap.size,
      },
    });

    await ctx.log({
      level: "info",
      message: `Enriching ODS codes for discovered organisations`,
    });
    await enrichOdsCodes(metadataMap, discoveredTrusts, ctx);

    if (ctx.dryRun) {
      await ctx.log({
        level: "info",
        message: "Dry run: would import workbook",
        meta: {
          assetId: input.assetId,
          sheets: dataSheetNames.length,
          trustsMetadata: metadataMap.size,
          trustsDiscovered: discoveredTrusts.size,
          suppliersDiscovered: discoveredSuppliers.size,
        },
      });
      return {
        status: "succeeded",
        metrics: {
          dryRun: true,
          sheets: dataSheetNames.length,
          trustsMetadata: metadataMap.size,
          trustsDiscovered: discoveredTrusts.size,
          suppliersDiscovered: discoveredSuppliers.size,
        },
      };
    }

    await ctx.log({
      level: "info",
      message: `Starting database transaction`,
      meta: { assetId: input.assetId, truncateAll: input.truncateAll ?? false },
    });
    const transactionStartTime = Date.now();
    const result = await ctx.db.transaction(async (tx) => {
      if (input.truncateAll) {
        await ctx.log({
          level: "warn",
          message: "Truncating all spend entries, buyers, and related entities",
        });
        await tx.delete(spendEntries);
        await tx.delete(buyers);
        await tx.delete(nhsOrganisations);
        // Delete all NHS-type entities (trusts, icbs, practices, etc.)
        await tx.delete(entities).where(like(entities.entityType, "nhs_%"));
        await ctx.log({
          level: "warn",
          message: "Truncated all spend entries, buyers, and NHS entities",
        });
      } else {
        await ctx.log({
          level: "debug",
          message: `Deleting existing spend entries for asset`,
          meta: { assetId: input.assetId },
        });
        const deleteResult = await tx
          .delete(spendEntries)
          .where(eq(spendEntries.assetId, input.assetId));
        await ctx.log({
          level: "debug",
          message: `Deleted existing spend entries for asset`,
          meta: { assetId: input.assetId },
        });
      }

      await ctx.log({
        level: "info",
        message: `Synchronizing trusts/buyers`,
        meta: {
          metadataCount: metadataMap.size,
          discoveredCount: discoveredTrusts.size,
        },
      });
      const syncTrustsStartTime = Date.now();
      const buyerSyncResult = await syncBuyers(
        tx,
        metadataMap,
        discoveredTrusts,
        ctx
      );
      const syncTrustsDuration = Date.now() - syncTrustsStartTime;
      await ctx.log({
        level: "info",
        message: `Buyers synchronized`,
        meta: {
          inserted: buyerSyncResult.inserted,
          updated: buyerSyncResult.updated,
          createdWithoutMetadata: buyerSyncResult.createdWithoutMetadata,
          totalBuyers: buyerSyncResult.idByKey.size,
          durationMs: syncTrustsDuration,
        },
      });

      await ctx.log({
        level: "info",
        message: `Synchronizing suppliers`,
        meta: {
          discoveredCount: discoveredSuppliers.size,
        },
      });
      const syncSuppliersStartTime = Date.now();
      const supplierSyncResult = await syncSuppliers(
        tx,
        discoveredSuppliers,
        ctx
      );
      const syncSuppliersDuration = Date.now() - syncSuppliersStartTime;
      await ctx.log({
        level: "info",
        message: `Suppliers synchronized`,
        meta: {
          inserted: supplierSyncResult.inserted,
          totalSuppliers: supplierSyncResult.idByKey.size,
          durationMs: syncSuppliersDuration,
        },
      });

      await ctx.log({
        level: "info",
        message: `Importing spend data from sheets`,
        meta: {
          sheetCount: dataSheetNames.length,
          totalBuyers: buyerSyncResult.idByKey.size,
          totalSuppliers: supplierSyncResult.idByKey.size,
        },
      });
      const importStartTime = Date.now();
      const importSummary = await importSpendSheets(
        tx,
        workbook,
        dataSheetNames,
        buyerSyncResult.idByKey,
        supplierSyncResult.idByKey,
        input.assetId,
        ctx
      );
      const importDuration = Date.now() - importStartTime;
      await ctx.log({
        level: "info",
        message: `Spend data import completed`,
        meta: {
          sheetsProcessed: importSummary.sheetsProcessed,
          paymentsInserted: importSummary.paymentsInserted,
          paymentsSkipped: importSummary.paymentsSkipped,
          skippedReasons: importSummary.skippedReasons,
          warnings: importSummary.warnings.length,
          durationMs: importDuration,
        },
      });

      return { buyerSyncResult, supplierSyncResult, importSummary };
    });
    const transactionDuration = Date.now() - transactionStartTime;
    await ctx.log({
      level: "info",
      message: `Database transaction committed`,
      meta: { assetId: input.assetId, durationMs: transactionDuration },
    });

    return {
      status: "succeeded",
      warnings: result.importSummary.warnings,
      metrics: {
        assetId: input.assetId,
        buyersInserted: result.buyerSyncResult.inserted,
        buyersUpdated: result.buyerSyncResult.updated,
        buyersCreatedWithoutMetadata:
          result.buyerSyncResult.createdWithoutMetadata,
        suppliersInserted: result.supplierSyncResult.inserted,
        sheetsProcessed: result.importSummary.sheetsProcessed,
        paymentsInserted: result.importSummary.paymentsInserted,
        paymentsSkipped: result.importSummary.paymentsSkipped,
        skippedReasons: result.importSummary.skippedReasons,
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

async function parseTrustMetadata(
  workbook: WorkBook,
  ctx: PipelineContext
): Promise<Map<string, TrustMetadata>> {
  const sheetName = workbook.SheetNames.find(
    (name) => name.trim().toLowerCase() === "trusts"
  );
  if (!sheetName) {
    await ctx.log({
      level: "debug",
      message: "No 'trusts' sheet found in workbook",
    });
    return new Map();
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    await ctx.log({
      level: "debug",
      message: "Trusts sheet exists but is empty",
      meta: { sheetName },
    });
    return new Map();
  }

  const rows = utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  if (rows.length === 0) {
    await ctx.log({
      level: "debug",
      message: "Trusts sheet has no rows",
      meta: { sheetName },
    });
    return new Map();
  }

  await ctx.log({
    level: "debug",
    message: "Parsing trust metadata rows",
    meta: { sheetName, rowCount: rows.length },
  });

  const metadata = new Map<string, TrustMetadata>();
  const header = rows[0].map((value) => cleanString(value).toLowerCase());

  const nameIndex = header.findIndex((cell) => cell.includes("trust name"));
  if (nameIndex === -1) {
    void ctx.log({
      level: "warn",
      message: "No 'trust name' column found in trusts sheet",
      meta: { sheetName, headers: header },
    });
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

  let parsedCount = 0;
  let skippedCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) {
      skippedCount++;
      continue;
    }

    const name = cleanString(row[nameIndex]);
    if (!name || name.toLowerCase() === "trust name" || isNumeric(name)) {
      skippedCount++;
      continue;
    }

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
    parsedCount++;
  }

  await ctx.log({
    level: "debug",
    message: "Trust metadata parsing completed",
    meta: { parsedCount, skippedCount, totalMetadata: metadata.size },
  });

  return metadata;
}

async function gatherNames(
  workbook: WorkBook,
  sheetNames: string[],
  metadataMap: Map<string, TrustMetadata>,
  ctx: PipelineContext
): Promise<{
  discoveredTrusts: Map<string, string>;
  discoveredSuppliers: Set<string>;
}> {
  const discoveredTrusts = new Map<string, string>();
  const discoveredSuppliers = new Set<string>();

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      await ctx.log({
        level: "debug",
        message: `Sheet not found, skipping`,
        meta: { sheetName },
      });
      continue;
    }

    const rows = utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });

    let trustCountInSheet = 0;
    let supplierCountInSheet = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;

      // Trust name is in column 0
      const trustNameRaw = cleanString(row[0]);
      if (
        trustNameRaw &&
        !isHeaderTrustLabel(trustNameRaw) &&
        !isNumeric(trustNameRaw)
      ) {
        const key = normaliseTrustName(trustNameRaw);
        if (!discoveredTrusts.has(key)) {
          const metadataName = metadataMap.get(key)?.name ?? trustNameRaw;
          discoveredTrusts.set(key, metadataName);
          trustCountInSheet++;
        }
      }

      // Supplier name is in column 2
      const supplierNameRaw = cleanString(row[2]);
      if (
        supplierNameRaw &&
        !isNumeric(supplierNameRaw) &&
        !discoveredSuppliers.has(supplierNameRaw)
      ) {
        discoveredSuppliers.add(supplierNameRaw);
        supplierCountInSheet++;
      }
    }

    await ctx.log({
      level: "debug",
      message: `Processed sheet for names`,
      meta: {
        sheetName,
        rowCount: rows.length,
        newTrustsFound: trustCountInSheet,
        newSuppliersFound: supplierCountInSheet,
      },
    });
  }

  return { discoveredTrusts, discoveredSuppliers };
}

async function syncSuppliers(
  client: any,
  discoveredSuppliers: Set<string>,
  ctx: {
    log: (entry: {
      level: PipelineLogLevel;
      message: string;
      meta?: Record<string, unknown>;
    }) => Promise<void> | void;
  }
): Promise<SyncSuppliersResult> {
  await ctx.log({
    level: "debug",
    message: "Loading existing suppliers from database",
  });
  const existing = await client.select().from(suppliers);
  const idByKey = new Map<string, number>();
  for (const row of existing) {
    idByKey.set(row.name, row.id);
  }
  await ctx.log({
    level: "debug",
    message: "Loaded existing suppliers",
    meta: { existingCount: idByKey.size },
  });

  let inserted = 0;
  const newSuppliers = Array.from(discoveredSuppliers).filter(
    (name) => !idByKey.has(name)
  );

  if (newSuppliers.length > 0) {
    await ctx.log({
      level: "debug",
      message: `Inserting ${newSuppliers.length} new suppliers`,
    });

    // Insert in batches of 100
    for (let i = 0; i < newSuppliers.length; i += 100) {
      const batch = newSuppliers.slice(i, i + 100);
      const created = await client
        .insert(suppliers)
        .values(batch.map((name) => ({ name })))
        .returning({ id: suppliers.id, name: suppliers.name });

      for (const row of created) {
        idByKey.set(row.name, row.id);
      }
      inserted += created.length;
    }
  }

  return { idByKey, inserted };
}

async function syncBuyers(
  client: any,
  metadataMap: Map<string, TrustMetadata>,
  discoveredTrusts: Map<string, string>,
  ctx: {
    log: (entry: {
      level: PipelineLogLevel;
      message: string;
      meta?: Record<string, unknown>;
    }) => Promise<void> | void;
  }
): Promise<SyncTrustsResult> {
  await ctx.log({
    level: "debug",
    message: "Loading existing buyers from database",
  });

  // Load existing buyers with their linked entities
  const existing = await client
    .select({
      id: buyers.id,
      name: buyers.name,
      entityId: buyers.entityId,
      entityName: entities.name,
      registryId: entities.registryId,
    })
    .from(buyers)
    .leftJoin(entities, eq(buyers.entityId, entities.id));

  const idByKey = new Map<string, number>();
  const entityIdByBuyerId = new Map<number, number | null>();
  const registryIdByBuyerId = new Map<number, string | null>();

  for (const row of existing) {
    // Use buyer name for lookup key
    if (row.name) {
      idByKey.set(normaliseTrustName(row.name), row.id);
    }
    entityIdByBuyerId.set(row.id, row.entityId);
    registryIdByBuyerId.set(row.id, row.registryId);
  }

  await ctx.log({
    level: "debug",
    message: "Loaded existing buyers",
    meta: { existingCount: idByKey.size },
  });

  let inserted = 0;
  let updated = 0;

  await ctx.log({
    level: "debug",
    message: "Syncing buyers with metadata",
    meta: { metadataCount: metadataMap.size },
  });

  for (const [key, metadata] of metadataMap) {
    const existingBuyerId = idByKey.get(key);

    if (existingBuyerId) {
      // ... existing update logic ...
    } else {
      // Try fuzzy match against existing buyers first to catch typos
      const fuzzyMatch = findFuzzyMatch(key, idByKey, 0.9);
      if (fuzzyMatch) {
        await ctx.log({
          level: "info",
          message: `FUZZY MATCH: Mapping metadata for "${metadata.name}" to existing buyer "${fuzzyMatch.name}" (confidence: ${fuzzyMatch.rating.toFixed(2)})`,
        });
        // We'll update the existing buyer with this metadata
        const existingId = fuzzyMatch.id;
        // Determine correct entity ID based on current ODS code
        const correctEntityId = await createNhsOrganisationEntity(
          client,
          metadata
        );

        if (correctEntityId) {
          const orgType = determineOrgType(metadata.name, metadata.trustType);
          await client
            .update(entities)
            .set({
              name: metadata.name,
              postalCode: metadata.postCode ?? null,
              updatedAt: new Date(),
            })
            .where(eq(entities.id, correctEntityId));

          await client
            .update(nhsOrganisations)
            .set({
              odsCode: metadata.odsCode!,
              orgType: orgType === "practice" ? "gp_practice" : orgType,
              orgSubType: metadata.trustType ?? null,
            })
            .where(eq(nhsOrganisations.entityId, correctEntityId));

          await client
            .update(buyers)
            .set({
              name: metadata.name,
              entityId: correctEntityId,
              matchStatus: "matched",
              matchConfidence: "1.00",
              matchAttemptedAt: new Date(),
              officialWebsite: metadata.officialWebsite ?? null,
              spendingDataUrl: metadata.spendingDataUrl ?? null,
              missingDataNote: metadata.missingDataNote ?? null,
              verifiedVia: metadata.verifiedVia ?? null,
              updatedAt: new Date(),
            })
            .where(eq(buyers.id, existingId));
        }
        idByKey.set(key, existingId);
        updated++;
        continue;
      }

      // Create new entity + NHS org + buyer
      const entityId = await createNhsOrganisationEntity(client, metadata);

      const [created] = await client
        .insert(buyers)
        .values({
          name: metadata.name,
          entityId,
          matchStatus: entityId ? "matched" : "no_match",
          matchConfidence: entityId ? "1.00" : "0.00",
          matchAttemptedAt: new Date(),
          officialWebsite: metadata.officialWebsite ?? null,
          spendingDataUrl: metadata.spendingDataUrl ?? null,
          missingDataNote: metadata.missingDataNote ?? null,
          verifiedVia: metadata.verifiedVia ?? null,
        })
        .onConflictDoUpdate({
          target: [buyers.name],
          set: {
            entityId,
            matchStatus: entityId ? "matched" : "no_match",
            matchConfidence: entityId ? "1.00" : "0.00",
            matchAttemptedAt: new Date(),
            officialWebsite: metadata.officialWebsite ?? null,
            spendingDataUrl: metadata.spendingDataUrl ?? null,
            missingDataNote: metadata.missingDataNote ?? null,
            verifiedVia: metadata.verifiedVia ?? null,
            updatedAt: new Date(),
          },
        })
        .returning({ id: buyers.id });

      idByKey.set(key, created.id);
      inserted++;
    }
  }

  await ctx.log({
    level: "debug",
    message: "Creating buyers without metadata",
    meta: { discoveredCount: discoveredTrusts.size },
  });

  let createdWithoutMetadata = 0;
  for (const [key, name] of discoveredTrusts) {
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

    // Create minimal entity + NHS org + buyer
    const entityId = await createNhsOrganisationEntity(client, { name });

    const [created] = await client
      .insert(buyers)
      .values({
        name,
        entityId,
        matchStatus: entityId ? "matched" : "no_match",
        matchConfidence: entityId ? "1.00" : "0.00",
        matchAttemptedAt: new Date(),
        officialWebsite: null,
        spendingDataUrl: null,
        missingDataNote: null,
        verifiedVia: null,
      })
      .onConflictDoUpdate({
        target: [buyers.name],
        set: {
          entityId,
          matchStatus: entityId ? "matched" : "no_match",
          matchConfidence: entityId ? "1.00" : "0.00",
          matchAttemptedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning({ id: buyers.id });

    idByKey.set(key, created.id);
    createdWithoutMetadata++;
  }

  return { idByKey, inserted, updated, createdWithoutMetadata };
}

/**
 * Determines the organisation type based on name and trust type.
 */
function determineOrgType(name: string, trustType?: string): string {
  const upperName = name.toUpperCase();
  if (
    upperName.includes(" ICB") ||
    upperName.includes("INTEGRATED CARE BOARD")
  ) {
    return "icb";
  }
  if (
    upperName.includes(" CCG") ||
    upperName.includes("CLINICAL COMMISSIONING GROUP")
  ) {
    return "ccg";
  }
  if (upperName.includes(" GP ") || upperName.includes(" PRACTICE")) {
    return "practice";
  }
  // If trustType is provided, it's likely a trust
  if (trustType) return "trust";

  // Default to trust for now as it's the most common in this dataset
  return "trust";
}

/**
 * Enriches metadata and discovered trusts with ODS codes from the NHS API.
 * Always checks local database first to avoid unnecessary API calls.
 */
async function enrichOdsCodes(
  metadataMap: Map<string, TrustMetadata>,
  discoveredTrusts: Map<string, string>,
  ctx: PipelineContext
): Promise<void> {
  const db = ctx.db;

  // Local cache for the duration of this run only (to avoid re-searching names that appear multiple times in the same workbook)
  const runCache = new Map<
    string,
    { odsCode: string; postCode: string | null }
  >();

  const itemsToProcess: {
    name: string;
    key: string;
    metadata?: TrustMetadata;
  }[] = [];

  // Identify all organisations that need processing
  for (const [key, metadata] of metadataMap) {
    if (!metadata.odsCode || metadata.odsCode.startsWith("UNKNOWN")) {
      itemsToProcess.push({ name: metadata.name, key, metadata });
    }
  }

  for (const [key, name] of discoveredTrusts) {
    if (!metadataMap.has(key)) {
      itemsToProcess.push({ name, key });
    }
  }

  // Filter out names that are clearly not NHS organisations (e.g. products, frameworks)
  const initialCount = itemsToProcess.length;
  const filteredItems = itemsToProcess.filter((item) =>
    isLikelyNhsOrganisation(item.name)
  );
  const removedCount = initialCount - filteredItems.length;

  if (removedCount > 0) {
    await ctx.log({
      level: "info",
      message: `ODS ENRICHMENT: Skipping ${removedCount} names that don't appear to be NHS organisations`,
    });
  }

  const totalToProcess = filteredItems.length;
  if (totalToProcess > 0) {
    await ctx.log({
      level: "info",
      message: `ODS ENRICHMENT: Found ${totalToProcess} organisations needing ODS lookup`,
    });
  }

  // Helper to process a single name
  const processName = async (
    name: string,
    key: string,
    remaining: number,
    currentMetadata?: TrustMetadata
  ) => {
    // 1. Check run-time cache first
    const cached = runCache.get(key);
    if (cached) {
      if (currentMetadata) {
        currentMetadata.odsCode = cached.odsCode;
        if (!currentMetadata.postCode)
          currentMetadata.postCode = cached.postCode ?? undefined;
      } else {
        metadataMap.set(key, {
          name,
          odsCode: cached.odsCode,
          postCode: cached.postCode ?? undefined,
        });
      }
      return;
    }

    // 2. Check database directly
    const existing = await db
      .select({
        odsCode: nhsOrganisations.odsCode,
        postCode: entities.postalCode,
      })
      .from(nhsOrganisations)
      .innerJoin(entities, eq(nhsOrganisations.entityId, entities.id))
      .where(
        and(
          eq(sql`UPPER(${entities.name})`, key),
          isNotNull(nhsOrganisations.odsCode),
          not(like(nhsOrganisations.odsCode, "UNKNOWN%"))
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const { odsCode, postCode } = existing[0];
      if (currentMetadata) {
        currentMetadata.odsCode = odsCode;
        if (!currentMetadata.postCode)
          currentMetadata.postCode = postCode ?? undefined;
      } else {
        metadataMap.set(key, {
          name,
          odsCode,
          postCode: postCode ?? undefined,
        });
      }
      // Cache for this run
      runCache.set(key, { odsCode, postCode });
      return;
    }

    // 3. Not in DB, hit NHS API
    await ctx.log({
      level: "info",
      message: `ODS SEARCH (${remaining} remaining): Initiating NHS API request for organisation: "${name}"`,
      meta: { name, key },
    });

    const startTime = Date.now();
    const results = await searchNhsOrganisation(name);
    const duration = Date.now() - startTime;

    if (results.length > 0) {
      const orgType = determineOrgType(name, currentMetadata?.trustType);

      // Prioritize exact name matches with the correct role
      const upperName = name.toUpperCase();
      let match = results.find((r) => {
        const isExactName = r.Name.toUpperCase() === upperName;
        if (!isExactName) return false;

        if (orgType === "icb") return r.PrimaryRoleId === "RO261"; // Integrated Care Board
        if (orgType === "trust")
          return r.PrimaryRoleId === "RO197" || r.PrimaryRoleId === "RO57"; // Trust or Foundation Trust
        return true;
      });

      // Fallback 1: Exact name match (any role)
      if (!match) {
        match = results.find((r) => r.Name.toUpperCase() === upperName);
      }

      // Fallback 2: Any match with the correct role
      if (!match) {
        if (orgType === "icb") {
          match =
            results.find((r) => r.PrimaryRoleId === "RO261") || results[0];
        } else if (orgType === "trust") {
          match =
            results.find(
              (r) => r.PrimaryRoleId === "RO197" || r.PrimaryRoleId === "RO57"
            ) || results[0];
        } else {
          match = results[0];
        }
      }

      const odsCode = match.OrgId;
      const postCode = match.PostCode;

      if (currentMetadata) {
        currentMetadata.odsCode = odsCode;
        if (!currentMetadata.postCode) currentMetadata.postCode = postCode;
      } else {
        metadataMap.set(key, {
          name,
          odsCode,
          postCode,
        });
      }

      // Add to run cache
      runCache.set(key, { odsCode, postCode });

      // Save each ODS code as it is matched to prevent progress loss
      if (!ctx.dryRun) {
        try {
          await createNhsOrganisationEntity(db, {
            name,
            odsCode,
            postCode: postCode || undefined,
            trustType: currentMetadata?.trustType,
          });
        } catch (error) {
          await ctx.log({
            level: "warn",
            message: `Failed to persist ODS match for "${name}" to database`,
            meta: {
              name,
              odsCode,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      await ctx.log({
        level: "info",
        message: `ODS MATCH: Found ODS code for "${name}"`,
        meta: {
          name,
          odsCode,
          role: match.PrimaryRoleDescription,
          durationMs: duration,
          totalResults: results.length,
        },
      });
    } else {
      await ctx.log({
        level: "warn",
        message: `ODS MISS: No active organisation found for "${name}"`,
        meta: { name, durationMs: duration },
      });
    }

    // Rate limit: 500ms between API calls
    await new Promise((resolve) => setTimeout(resolve, 500));
  };

  // Process all items
  for (let i = 0; i < filteredItems.length; i++) {
    const { name, key, metadata } = filteredItems[i];
    await processName(name, key, filteredItems.length - i, metadata);
  }
}

/**
 * Creates an entity + NHS organisation record for an NHS Trust.
 * Returns the entity ID, or null if no ODS code is provided.
 */
async function createNhsOrganisationEntity(
  client: any,
  metadata: Partial<TrustMetadata> & { name: string }
): Promise<number | null> {
  if (!metadata.odsCode || metadata.odsCode.startsWith("UNKNOWN")) {
    return null;
  }

  const orgType = determineOrgType(metadata.name, metadata.trustType);
  const entityType = `nhs_${orgType}`;
  const registryId = metadata.odsCode;

  // 1. Check if an entity with this type + registry ID already exists (in case multiple names map to same ODS)
  const existingByRegistry = await client
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.entityType, entityType),
        eq(entities.registryId, registryId)
      )
    )
    .limit(1);

  if (existingByRegistry.length > 0) {
    return existingByRegistry[0].id;
  }

  // 2. Create entity
  const [newEntity] = await client
    .insert(entities)
    .values({
      entityType,
      registryId,
      name: metadata.name,
      status: "active",
      postalCode: metadata.postCode ?? null,
    })
    .returning({ id: entities.id });

  // 3. Create NHS organisation details
  // Check if nhs_organisations record exists for this entity (shouldn't if new, but safety first)
  const existingNhsOrg = await client
    .select({ entityId: nhsOrganisations.entityId })
    .from(nhsOrganisations)
    .where(eq(nhsOrganisations.entityId, newEntity.id))
    .limit(1);

  if (existingNhsOrg.length === 0) {
    await client.insert(nhsOrganisations).values({
      entityId: newEntity.id,
      odsCode: registryId,
      orgType: orgType === "practice" ? "gp_practice" : orgType,
      orgSubType: metadata.trustType ?? null,
      isActive: true,
    });
  }

  return newEntity.id;
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
  let sheetsProcessed = 0;

  const flushSkippedRows = async () => {
    if (skippedRows.length === 0) return;
    await client.insert(pipelineSkippedRows).values(skippedRows);
    skippedRows.length = 0;
  };

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      await ctx.log({
        level: "warn",
        message: `Sheet not found, skipping`,
        meta: { sheetName },
      });
      continue;
    }

    sheetsProcessed++;
    await ctx.log({
      level: "info",
      message: `Processing sheet ${sheetsProcessed}/${sheetNames.length}`,
      meta: {
        sheetName,
        sheetIndex: sheetsProcessed,
        totalSheets: sheetNames.length,
      },
    });

    const sheetStartTime = Date.now();
    const rows = utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });
    if (rows.length <= 1) {
      void ctx.log({
        level: "warn",
        message: `Sheet has no data rows, skipping`,
        meta: { sheetName, rowCount: rows.length },
      });
      continue;
    }

    await ctx.log({
      level: "debug",
      message: `Parsed sheet rows`,
      meta: { sheetName, rowCount: rows.length },
    });

    const batch: (typeof spendEntries.$inferInsert)[] = [];
    let sheetPaymentsInserted = 0;
    let sheetPaymentsSkipped = 0;
    const flushBatch = async () => {
      if (batch.length === 0) return;
      const batchStartTime = Date.now();
      await client.insert(spendEntries).values(batch);
      paymentsInserted += batch.length;
      sheetPaymentsInserted += batch.length;
      const batchDuration = Date.now() - batchStartTime;
      await ctx.log({
        level: "debug",
        message: `Batch inserted`,
        meta: {
          sheetName,
          batchSize: batch.length,
          totalInserted: paymentsInserted,
          durationMs: batchDuration,
        },
      });
      batch.length = 0;
    };

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      if (!Array.isArray(row)) continue;

      const buyerNameRaw = cleanString(row[0]);
      if (!buyerNameRaw || isNumeric(buyerNameRaw)) {
        paymentsSkipped++;
        sheetPaymentsSkipped++;
        const reason = !buyerNameRaw
          ? "missing buyer name"
          : "numeric buyer name";
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
        skippedRows.push({
          runId: ctx.runId,
          sheetName,
          rowNumber: rowIndex + 1,
          reason,
          rawData: row,
        });
        if (skippedRows.length >= 500) await flushSkippedRows();
        recordWarning(warnings, `(${sheetName} row ${rowIndex + 1}) ${reason}`);
        continue;
      }
      if (isHeaderTrustLabel(buyerNameRaw)) {
        continue;
      }

      const buyerKey = normaliseTrustName(buyerNameRaw);
      const buyerId = buyerIdByKey.get(buyerKey);
      if (!buyerId) {
        paymentsSkipped++;
        sheetPaymentsSkipped++;
        const reason = `unknown buyer '${buyerNameRaw}'`;
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
        skippedRows.push({
          runId: ctx.runId,
          sheetName,
          rowNumber: rowIndex + 1,
          reason,
          rawData: row,
        });
        if (skippedRows.length >= 500) await flushSkippedRows();
        recordWarning(warnings, `(${sheetName} row ${rowIndex + 1}) ${reason}`);
        continue;
      }

      const supplier = cleanString(row[2]);
      if (!supplier || isNumeric(supplier)) {
        paymentsSkipped++;
        sheetPaymentsSkipped++;
        const reason = !supplier ? "missing supplier" : "numeric supplier name";
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
        skippedRows.push({
          runId: ctx.runId,
          sheetName,
          rowNumber: rowIndex + 1,
          reason,
          rawData: row,
        });
        if (skippedRows.length >= 500) await flushSkippedRows();
        recordWarning(warnings, `(${sheetName} row ${rowIndex + 1}) ${reason}`);
        continue;
      }

      const supplierId = supplierIdByKey.get(supplier);

      const amountResult = parseAmount(row[3]);
      if (amountResult.amount === null) {
        paymentsSkipped++;
        sheetPaymentsSkipped++;
        const reason = `invalid amount '${amountResult.raw ?? ""}'`;
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
        skippedRows.push({
          runId: ctx.runId,
          sheetName,
          rowNumber: rowIndex + 1,
          reason,
          rawData: row,
        });
        if (skippedRows.length >= 500) await flushSkippedRows();
        recordWarning(warnings, `(${sheetName} row ${rowIndex + 1}) ${reason}`);
        continue;
      }

      const dateResult = parsePaymentDate(row[1]);
      if (!dateResult.iso) {
        paymentsSkipped++;
        sheetPaymentsSkipped++;
        const reason = `invalid payment date '${dateResult.raw ?? ""}'`;
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
        skippedRows.push({
          runId: ctx.runId,
          sheetName,
          rowNumber: rowIndex + 1,
          reason,
          rawData: row,
        });
        if (skippedRows.length >= 500) await flushSkippedRows();
        recordWarning(warnings, `(${sheetName} row ${rowIndex + 1}) ${reason}`);
        continue;
      }

      batch.push({
        assetId,
        rawBuyer: buyerNameRaw,
        buyerId,
        supplierId,
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
    const sheetDuration = Date.now() - sheetStartTime;
    await ctx.log({
      level: "info",
      message: `Sheet processing completed`,
      meta: {
        sheetName,
        paymentsInserted: sheetPaymentsInserted,
        paymentsSkipped: sheetPaymentsSkipped,
        totalRows: rows.length,
        durationMs: sheetDuration,
      },
    });
  }

  await flushSkippedRows();

  await ctx.log({
    level: "info",
    message: `All sheets processed`,
    meta: {
      sheetsProcessed,
      totalPaymentsInserted: paymentsInserted,
      totalPaymentsSkipped: paymentsSkipped,
      totalWarnings: warnings.length,
      skippedReasons,
    },
  });

  return {
    sheetsProcessed,
    paymentsInserted,
    paymentsSkipped,
    warnings,
    skippedReasons,
  };
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

  const amount = negative ? -numeric : numeric;
  // numeric(14,2) max is 999,999,999,999.99. Reject astronomical values.
  if (Math.abs(amount) > 100_000_000_000) {
    return { amount: null, raw };
  }

  return { amount, raw };
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

  const dmyDashMatch = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/u);
  if (dmyDashMatch) {
    const day = Number.parseInt(dmyDashMatch[1], 10);
    const month = Number.parseInt(dmyDashMatch[2], 10);
    const year = Number.parseInt(dmyDashMatch[3], 10);
    return { iso: formatDate(new Date(Date.UTC(year, month - 1, day))), raw };
  }

  const dMmmYMatch = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/u);
  if (dMmmYMatch) {
    const day = Number.parseInt(dMmmYMatch[1], 10);
    const monthName = dMmmYMatch[2].toLowerCase();
    const year = Number.parseInt(dMmmYMatch[3], 10);
    const month = MONTH_LOOKUP.get(monthName);
    if (month) {
      return { iso: formatDate(new Date(Date.UTC(year, month - 1, day))), raw };
    }
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

function isNumeric(value: string): boolean {
  // Catch integers, decimals, and scientific notation
  return /^-?\d*\.?\d+(?:[eE][-+]?\d+)?$/.test(value);
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
