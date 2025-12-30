import { eq, and } from "drizzle-orm";
import { read, utils, type WorkBook } from "xlsx";

import type { DbClient } from "@/db";
import {
  entities,
  nhsOrganisations,
  organisations,
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
          message: "Truncating all spend entries, organisations, and related entities",
        });
        await tx.delete(spendEntries);
        await tx.delete(organisations);
        await tx.delete(nhsOrganisations);
        // Only delete NHS-type entities (preserve company entities)
        await tx.delete(entities).where(
          eq(entities.entityType, "nhs_trust")
        );
        await ctx.log({
          level: "warn",
          message: "Truncated all spend entries, organisations, and NHS entities",
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
        message: `Synchronizing trusts/organisations`,
        meta: {
          metadataCount: metadataMap.size,
          discoveredCount: discoveredTrusts.size,
        },
      });
      const syncTrustsStartTime = Date.now();
      const trustSyncResult = await syncTrusts(
        tx,
        metadataMap,
        discoveredTrusts,
        ctx
      );
      const syncTrustsDuration = Date.now() - syncTrustsStartTime;
      await ctx.log({
        level: "info",
        message: `Trusts synchronized`,
        meta: {
          inserted: trustSyncResult.inserted,
          updated: trustSyncResult.updated,
          createdWithoutMetadata: trustSyncResult.createdWithoutMetadata,
          totalTrusts: trustSyncResult.idByKey.size,
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
          totalTrusts: trustSyncResult.idByKey.size,
          totalSuppliers: supplierSyncResult.idByKey.size,
        },
      });
      const importStartTime = Date.now();
      const importSummary = await importSpendSheets(
        tx,
        workbook,
        dataSheetNames,
        trustSyncResult.idByKey,
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

      return { trustSyncResult, supplierSyncResult, importSummary };
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
        trustsInserted: result.trustSyncResult.inserted,
        trustsUpdated: result.trustSyncResult.updated,
        trustsCreatedWithoutMetadata:
          result.trustSyncResult.createdWithoutMetadata,
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
    if (!name || name.toLowerCase() === "trust name") {
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
      if (trustNameRaw && !isHeaderTrustLabel(trustNameRaw)) {
        const key = normaliseTrustName(trustNameRaw);
        if (!discoveredTrusts.has(key)) {
          const metadataName = metadataMap.get(key)?.name ?? trustNameRaw;
          discoveredTrusts.set(key, metadataName);
          trustCountInSheet++;
        }
      }

      // Supplier name is in column 2
      const supplierNameRaw = cleanString(row[2]);
      if (supplierNameRaw && !discoveredSuppliers.has(supplierNameRaw)) {
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

async function syncTrusts(
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
    message: "Loading existing organisations from database",
  });
  
  // Load existing organisations with their linked entities
  const existing = await client
    .select({
      id: organisations.id,
      entityId: organisations.entityId,
      entityName: entities.name,
    })
    .from(organisations)
    .leftJoin(entities, eq(organisations.entityId, entities.id));
  
  const idByKey = new Map<string, number>();
  const entityIdByOrgId = new Map<number, number | null>();
  
  for (const row of existing) {
    if (row.entityName) {
      idByKey.set(normaliseTrustName(row.entityName), row.id);
    }
    entityIdByOrgId.set(row.id, row.entityId);
  }
  
  await ctx.log({
    level: "debug",
    message: "Loaded existing organisations",
    meta: { existingCount: idByKey.size },
  });

  let inserted = 0;
  let updated = 0;

  await ctx.log({
    level: "debug",
    message: "Syncing trusts with metadata",
    meta: { metadataCount: metadataMap.size },
  });
  
  for (const [key, metadata] of metadataMap) {
    const existingOrgId = idByKey.get(key);

    if (existingOrgId) {
      // Update existing - get the entity ID
      const existingEntityId = entityIdByOrgId.get(existingOrgId);
      
      if (existingEntityId) {
        // Update entity
        await client
          .update(entities)
          .set({
            name: metadata.name,
            postalCode: metadata.postCode ?? null,
            updatedAt: new Date(),
          })
          .where(eq(entities.id, existingEntityId));
        
        // Update NHS organisation details
        await client
          .update(nhsOrganisations)
          .set({
            odsCode: metadata.odsCode ?? "",
            orgSubType: metadata.trustType ?? null,
          })
          .where(eq(nhsOrganisations.entityId, existingEntityId));
        
        // Update organisation (buyer metadata)
        await client
          .update(organisations)
          .set({
            officialWebsite: metadata.officialWebsite ?? null,
            spendingDataUrl: metadata.spendingDataUrl ?? null,
            missingDataNote: metadata.missingDataNote ?? null,
            verifiedVia: metadata.verifiedVia ?? null,
          })
          .where(eq(organisations.id, existingOrgId));
      }
      updated++;
    } else {
      // Create new entity + NHS org + organisation
      const entityId = await createNhsTrustEntity(client, metadata);
      
      const [created] = await client
        .insert(organisations)
        .values({
          entityId,
          officialWebsite: metadata.officialWebsite ?? null,
          spendingDataUrl: metadata.spendingDataUrl ?? null,
          missingDataNote: metadata.missingDataNote ?? null,
          verifiedVia: metadata.verifiedVia ?? null,
        })
        .returning({ id: organisations.id });
      
      idByKey.set(key, created.id);
      inserted++;
    }
  }

  await ctx.log({
    level: "debug",
    message: "Creating trusts without metadata",
    meta: { discoveredCount: discoveredTrusts.size },
  });
  
  let createdWithoutMetadata = 0;
  for (const [key, name] of discoveredTrusts) {
    if (idByKey.has(key)) continue;
    
    // Create minimal entity + NHS org + organisation
    const entityId = await createNhsTrustEntity(client, { name });
    
    const [created] = await client
      .insert(organisations)
      .values({
        entityId,
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

/**
 * Creates an entity + NHS organisation record for an NHS Trust.
 * Returns the entity ID.
 */
async function createNhsTrustEntity(
  client: any,
  metadata: Partial<TrustMetadata> & { name: string }
): Promise<number> {
  // Use ODS code as registry_id if available, otherwise generate a placeholder
  const registryId = metadata.odsCode || `UNKNOWN_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Create entity
  const [newEntity] = await client
    .insert(entities)
    .values({
      entityType: "nhs_trust",
      registryId,
      name: metadata.name,
      status: "active",
      postalCode: metadata.postCode ?? null,
    })
    .returning({ id: entities.id });
  
  // Create NHS organisation details
  await client.insert(nhsOrganisations).values({
    entityId: newEntity.id,
    odsCode: metadata.odsCode ?? registryId,
    orgType: "trust",
    orgSubType: metadata.trustType ?? null,
    isActive: true,
  });
  
  return newEntity.id;
}


async function importSpendSheets(
  client: any,
  workbook: WorkBook,
  sheetNames: string[],
  trustIdByKey: Map<string, number>,
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

      const trustNameRaw = cleanString(row[0]);
      if (!trustNameRaw) {
        paymentsSkipped++;
        sheetPaymentsSkipped++;
        const reason = "missing trust name";
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
      if (isHeaderTrustLabel(trustNameRaw)) {
        continue;
      }

      const trustKey = normaliseTrustName(trustNameRaw);
      const trustId = trustIdByKey.get(trustKey);
      if (!trustId) {
        paymentsSkipped++;
        sheetPaymentsSkipped++;
        const reason = `unknown trust '${trustNameRaw}'`;
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
      if (!supplier) {
        paymentsSkipped++;
        sheetPaymentsSkipped++;
        const reason = "missing supplier";
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
        organisationId: trustId,
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

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
