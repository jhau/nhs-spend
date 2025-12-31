import { eq, and } from "drizzle-orm";
import { read, utils, type WorkBook } from "xlsx";

import type { DbClient } from "@/db";
import {
  entities,
  councils,
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
import {
  searchCouncilMetadata,
  getLocalCouncils,
  lookupCouncilByGssCode,
  type CouncilMetadata,
} from "@/lib/council-api";

export type ImportCouncilSpendExcelInput = {
  assetId: number;
  truncateAll?: boolean;
};

type SyncCouncilsResult = {
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

export const importCouncilSpendExcelStage: PipelineStage<ImportCouncilSpendExcelInput> =
  {
    id: "importCouncilSpendExcel",
    title: "Import council spend Excel workbook",
    validate(input) {
      if (!Number.isInteger(input.assetId) || input.assetId <= 0) {
        throw new Error("assetId must be a positive integer");
      }
    },
    async run(ctx, input) {
      await ctx.log({
        level: "info",
        message: `Starting council import process`,
        meta: {
          assetId: input.assetId,
          truncateAll: input.truncateAll ?? false,
        },
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

      const dataSheetNames = workbook.SheetNames.filter(
        (name) =>
          !["trusts", "councils", "metadata"].includes(
            name.trim().toLowerCase()
          )
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
        message: `Gathering council and supplier names from data sheets`,
        meta: { assetId: input.assetId },
      });
      const { discoveredCouncils, discoveredSuppliers } = await gatherNames(
        workbook,
        dataSheetNames,
        ctx
      );

      await ctx.log({
        level: "info",
        message: `Names gathered`,
        meta: {
          assetId: input.assetId,
          discoveredCouncilCount: discoveredCouncils.size,
          discoveredSupplierCount: discoveredSuppliers.size,
        },
      });

      if (ctx.dryRun) {
        await ctx.log({
          level: "info",
          message: "Dry run: would import workbook",
          meta: {
            assetId: input.assetId,
            sheets: dataSheetNames.length,
            councilsDiscovered: discoveredCouncils.size,
            suppliersDiscovered: discoveredSuppliers.size,
          },
        });
        return {
          status: "succeeded",
          metrics: {
            dryRun: true,
            sheets: dataSheetNames.length,
            councilsDiscovered: discoveredCouncils.size,
            suppliersDiscovered: discoveredSuppliers.size,
          },
        };
      }

      await ctx.log({
        level: "info",
        message: `Starting database transaction`,
        meta: {
          assetId: input.assetId,
          truncateAll: input.truncateAll ?? false,
        },
      });
      const transactionStartTime = Date.now();
      const result = await ctx.db.transaction(async (tx) => {
        if (input.truncateAll) {
          await ctx.log({
            level: "warn",
            message:
              "Truncating all spend entries, organisations, and related entities",
          });
          await tx.delete(spendEntries);
          await tx.delete(organisations);
          await tx.delete(councils);
          // Only delete council-type entities (preserve company entities)
          await tx.delete(entities).where(eq(entities.entityType, "council"));
          await ctx.log({
            level: "warn",
            message:
              "Truncated all spend entries, organisations, and council entities",
          });
        } else {
          await ctx.log({
            level: "debug",
            message: `Deleting existing spend entries for asset`,
            meta: { assetId: input.assetId },
          });
          await tx
            .delete(spendEntries)
            .where(eq(spendEntries.assetId, input.assetId));
        }

        await ctx.log({
          level: "info",
          message: `Synchronizing councils`,
          meta: {
            discoveredCount: discoveredCouncils.size,
          },
        });
        const syncCouncilsStartTime = Date.now();
        const councilSyncResult = await syncCouncils(
          tx,
          discoveredCouncils,
          ctx
        );
        const syncCouncilsDuration = Date.now() - syncCouncilsStartTime;
        await ctx.log({
          level: "info",
          message: `Councils synchronized`,
          meta: {
            inserted: councilSyncResult.inserted,
            updated: councilSyncResult.updated,
            createdWithoutMetadata: councilSyncResult.createdWithoutMetadata,
            totalCouncils: councilSyncResult.idByKey.size,
            durationMs: syncCouncilsDuration,
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
            totalCouncils: councilSyncResult.idByKey.size,
            totalSuppliers: supplierSyncResult.idByKey.size,
          },
        });
        const importStartTime = Date.now();
        const importSummary = await importSpendSheets(
          tx,
          workbook,
          dataSheetNames,
          councilSyncResult.idByKey,
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

        return { councilSyncResult, supplierSyncResult, importSummary };
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
          councilsInserted: result.councilSyncResult.inserted,
          councilsUpdated: result.councilSyncResult.updated,
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
  discoveredCouncils: Map<string, string>;
  discoveredSuppliers: Set<string>;
}> {
  const discoveredCouncils = new Map<string, string>();
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

    let councilCountInSheet = 0;
    let supplierCountInSheet = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;

      const councilNameRaw = cleanString(row[0]);
      if (
        councilNameRaw &&
        !["council", "organisation", "authority"].includes(
          councilNameRaw.toLowerCase()
        )
      ) {
        const key = normaliseName(councilNameRaw);
        if (!discoveredCouncils.has(key)) {
          discoveredCouncils.set(key, councilNameRaw);
          councilCountInSheet++;
        }
      }

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
        newCouncilsFound: councilCountInSheet,
        newSuppliersFound: supplierCountInSheet,
      },
    });
  }

  return { discoveredCouncils, discoveredSuppliers };
}

/**
 * Helper to create or get a council entity by GSS code.
 * Used for creating parent councils that may not be in the discovered list.
 */
async function getOrCreateCouncilByGssCode(
  client: any,
  gssCode: string,
  entityIdByGssCode: Map<string, number>,
  ctx: PipelineContext
): Promise<number | null> {
  // Check if already exists
  if (entityIdByGssCode.has(gssCode)) {
    return entityIdByGssCode.get(gssCode)!;
  }

  // Look up the council metadata from the API
  const metadata = await lookupCouncilByGssCode(gssCode);
  if (!metadata) {
    await ctx.log({
      level: "warn",
      message: `Could not find parent council with GSS code: ${gssCode}`,
    });
    return null;
  }

  await ctx.log({
    level: "info",
    message: `Creating parent council: ${metadata.officialName} (${gssCode})`,
  });

  // Create the entity
  const [newEntity] = await client
    .insert(entities)
    .values({
      entityType: "council",
      registryId: gssCode,
      name: metadata.officialName,
      status: "active",
      latitude: metadata.latitude ?? null,
      longitude: metadata.longitude ?? null,
    })
    .returning({ id: entities.id });

  // Recursively resolve the parent's parent if it has one
  let parentEntityId: number | null = null;
  if (metadata.parentGssCode) {
    parentEntityId = await getOrCreateCouncilByGssCode(
      client,
      metadata.parentGssCode,
      entityIdByGssCode,
      ctx
    );
  }

  // Create the council record
  await client.insert(councils).values({
    entityId: newEntity.id,
    gssCode: metadata.gssCode || null,
    onsCode: metadata.onsCode || null,
    councilType: metadata.councilType || "unknown",
    tier: metadata.tier || null,
    homepageUrl: metadata.homepageUrl || null,
    region: metadata.region || null,
    nation: metadata.nation || null,
    parentEntityId,
  });

  // Create the organisation record
  await client.insert(organisations).values({
    entityId: newEntity.id,
    officialWebsite: metadata.homepageUrl || null,
  });

  // Cache the entity ID
  entityIdByGssCode.set(gssCode, newEntity.id);

  return newEntity.id;
}

async function syncCouncils(
  client: any,
  discoveredCouncils: Map<string, string>,
  ctx: PipelineContext
): Promise<SyncCouncilsResult> {
  await ctx.log({
    level: "debug",
    message: "Loading existing council organisations from database",
  });

  // Build lookup from GSS code to official CSV name for normalization
  const localCouncils = getLocalCouncils();
  const officialNameByGss = new Map<string, string>();
  for (const c of localCouncils) {
    if (c.LAD23CD && c.LAD23NM) {
      officialNameByGss.set(c.LAD23CD, c.LAD23NM);
    }
  }

  // Load existing councils with their GSS codes for lookup
  const existing = await client
    .select({
      id: organisations.id,
      entityId: organisations.entityId,
      entityName: entities.name,
      registryId: entities.registryId,
      gssCode: councils.gssCode,
    })
    .from(organisations)
    .leftJoin(entities, eq(organisations.entityId, entities.id))
    .leftJoin(councils, eq(councils.entityId, entities.id))
    .where(eq(entities.entityType, "council"));

  const idByKey = new Map<string, number>();
  const idByGssCode = new Map<string, number>();
  // Map GSS code to entity ID (for parent lookups)
  const entityIdByGssCode = new Map<string, number>();

  for (const row of existing) {
    if (row.entityName) {
      idByKey.set(normaliseName(row.entityName), row.id);
    }
    // Also index by GSS code and registry_id for duplicate detection
    if (row.gssCode) {
      idByGssCode.set(row.gssCode, row.id);
      entityIdByGssCode.set(row.gssCode, row.entityId);
      // Also add the official CSV name to the lookup
      const officialName = officialNameByGss.get(row.gssCode);
      if (officialName) {
        idByKey.set(normaliseName(officialName), row.id);
      }
    }
    if (row.registryId) {
      idByGssCode.set(row.registryId, row.id);
      entityIdByGssCode.set(row.registryId, row.entityId);
      // Also add the official CSV name for registry_id (which is often GSS code)
      const officialName = officialNameByGss.get(row.registryId);
      if (officialName) {
        idByKey.set(normaliseName(officialName), row.id);
      }
    }
  }

  await ctx.log({
    level: "debug",
    message: "Loaded existing council organisations",
    meta: { existingCount: idByKey.size, gssCodeCount: idByGssCode.size },
  });

  let inserted = 0;
  let updated = 0;
  let createdWithoutMetadata = 0;
  let skippedExisting = 0;
  let parentsCreated = 0;

  for (const [key, name] of discoveredCouncils) {
    const existingOrgId = idByKey.get(key);

    // Skip existing councils - no need to re-fetch metadata or update
    if (existingOrgId) {
      skippedExisting++;
      continue;
    }

    // Only fetch metadata for NEW councils
    await ctx.log({
      level: "debug",
      message: `Fetching metadata for new council: ${name}`,
    });
    const metadata = await searchCouncilMetadata(name);

    if (!metadata) {
      await ctx.log({
        level: "warn",
        message: `Skipping non-council or unknown entity: ${name}`,
        meta: { name },
      });
      continue;
    }

    // Check if a council with this GSS code already exists (different name variant)
    if (metadata.gssCode && idByGssCode.has(metadata.gssCode)) {
      const existingId = idByGssCode.get(metadata.gssCode)!;
      // Add this name variant to the lookup map for future references
      idByKey.set(key, existingId);
      skippedExisting++;
      await ctx.log({
        level: "debug",
        message: `Council already exists with GSS code ${metadata.gssCode}, mapping name variant: ${name}`,
      });
      continue;
    }

    // Resolve parent council if one exists
    let parentEntityId: number | null = null;
    if (metadata.parentGssCode) {
      const existingParentCount = entityIdByGssCode.size;
      parentEntityId = await getOrCreateCouncilByGssCode(
        client,
        metadata.parentGssCode,
        entityIdByGssCode,
        ctx
      );
      // Count how many parent councils were created
      parentsCreated += entityIdByGssCode.size - existingParentCount;
    }

    // Create new council
    await ctx.log({
      level: "info",
      message: `Creating new council: ${name}`,
      meta: {
        gssCode: metadata.gssCode,
        councilType: metadata.councilType,
        tier: metadata.tier,
        parentGssCode: metadata.parentGssCode,
      },
    });

    const registryId =
      metadata.gssCode ||
      `COUNCIL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const [newEntity] = await client
      .insert(entities)
      .values({
        entityType: "council",
        registryId,
        name: metadata.officialName || name,
        status: "active",
        latitude: metadata.latitude ?? null,
        longitude: metadata.longitude ?? null,
      })
      .returning({ id: entities.id });

    await client.insert(councils).values({
      entityId: newEntity.id,
      gssCode: metadata.gssCode || null,
      onsCode: metadata.onsCode || null,
      councilType: metadata.councilType || "unknown",
      tier: metadata.tier || null,
      homepageUrl: metadata.homepageUrl || null,
      region: metadata.region || null,
      nation: metadata.nation || null,
      parentEntityId,
    });

    const [created] = await client
      .insert(organisations)
      .values({
        entityId: newEntity.id,
        officialWebsite: metadata.homepageUrl || null,
      })
      .returning({ id: organisations.id });

    idByKey.set(key, created.id);
    // Also add the official name to the lookup
    if (metadata.officialName) {
      idByKey.set(normaliseName(metadata.officialName), created.id);
    }
    if (metadata.gssCode) {
      idByGssCode.set(metadata.gssCode, created.id);
      entityIdByGssCode.set(metadata.gssCode, newEntity.id);
    }
    inserted++;
  }

  await ctx.log({
    level: "debug",
    message: "Council sync summary",
    meta: { skippedExisting, inserted, parentsCreated },
  });

  return { idByKey, inserted, updated, createdWithoutMetadata };
}

async function syncSuppliers(
  client: any,
  discoveredSuppliers: Set<string>,
  ctx: PipelineContext
): Promise<SyncSuppliersResult> {
  await ctx.log({
    level: "debug",
    message: "Loading existing suppliers from database",
  });

  const existing = await client.select().from(suppliers);
  const idByKey = new Map<string, number>();
  for (const row of existing) idByKey.set(row.name, row.id);

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

    for (let i = 0; i < newSuppliers.length; i += 100) {
      const batch = newSuppliers.slice(i, i + 100);
      const created = await client
        .insert(suppliers)
        .values(batch.map((name) => ({ name })))
        .returning({ id: suppliers.id, name: suppliers.name });

      for (const row of created) idByKey.set(row.name, row.id);
      inserted += created.length;

      await ctx.log({
        level: "debug",
        message: `Inserted supplier batch`,
        meta: { batchSize: created.length, totalInserted: inserted },
      });
    }
  }

  return { idByKey, inserted };
}

async function importSpendSheets(
  client: any,
  workbook: WorkBook,
  sheetNames: string[],
  orgIdByKey: Map<string, number>,
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
      await ctx.log({
        level: "warn",
        message: `Sheet has no data rows, skipping`,
        meta: { sheetName, rowCount: rows.length },
      });
      continue;
    }

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

      const orgNameRaw = cleanString(row[0]);
      if (
        !orgNameRaw ||
        ["council", "organisation", "authority"].includes(
          orgNameRaw.toLowerCase()
        )
      ) {
        paymentsSkipped++;
        sheetPaymentsSkipped++;
        const reason = "missing or header org name";
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
        continue;
      }

      const orgId = orgIdByKey.get(normaliseName(orgNameRaw));
      if (!orgId) {
        paymentsSkipped++;
        sheetPaymentsSkipped++;
        const reason = `unknown council '${orgNameRaw}'`;
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
        continue;
      }

      const amountResult = parseAmount(row[3]);
      const dateResult = parsePaymentDate(row[1]);

      if (amountResult.amount !== null && dateResult.iso) {
        batch.push({
          assetId,
          organisationId: orgId,
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
        sheetPaymentsSkipped++;
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

  return {
    sheetsProcessed: sheetNames.length,
    paymentsInserted,
    paymentsSkipped,
    skippedReasons,
    warnings,
  };
}

// Reuse helper functions from importSpendExcel.ts logic
function parseAmount(value: unknown) {
  if (typeof value === "number")
    return { amount: value, raw: value.toString() };
  const raw = cleanString(value);
  if (!raw) return { amount: null, raw: null };
  const cleaned = raw.replace(/[£,]/g, "");
  const numeric = Number(cleaned);
  return { amount: isNaN(numeric) ? null : numeric, raw };
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
