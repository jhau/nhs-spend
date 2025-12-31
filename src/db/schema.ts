import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// =============================================================================
// Central Entity Registry
// =============================================================================

/**
 * Central registry for all legal entities (companies, NHS orgs, councils, etc.)
 * Both buyers and suppliers can reference entities.
 */
export const entities = pgTable(
  "entities",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(), // 'company' | 'nhs_trust' | 'nhs_icb' | 'nhs_practice' | 'council' | 'charity' | 'other'
    registryId: text("registry_id").notNull(), // company_number / ods_code / gss_code / charity_number
    name: text("name").notNull(),
    status: text("status"), // 'active' | 'dissolved' | 'inactive' etc.

    // Common address fields
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    locality: text("locality"),
    postalCode: text("postal_code"),
    country: text("country"),

    // Geo
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (entity) => ({
    typeRegistryIdx: uniqueIndex("entities_type_registry_unique").on(
      entity.entityType,
      entity.registryId
    ),
    nameIdx: index("entities_name_idx").on(entity.name),
    typeIdx: index("entities_type_idx").on(entity.entityType),
    postalCodeIdx: index("entities_postal_code_idx").on(entity.postalCode),
  })
);

// =============================================================================
// Entity Detail Tables
// =============================================================================

/**
 * Companies House data - extends entities for company-specific fields
 */
export const companies = pgTable(
  "companies",
  {
    entityId: integer("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    companyNumber: text("company_number").notNull(),
    companyStatus: text("company_status"), // 'active' | 'dissolved' | 'liquidation' etc.
    companyType: text("company_type"), // 'ltd' | 'plc' | 'llp' etc.
    dateOfCreation: date("date_of_creation"),
    dateOfCessation: date("date_of_cessation"),
    jurisdiction: text("jurisdiction"),
    sicCodes: jsonb("sic_codes").$type<string[]>(),
    previousNames:
      jsonb("previous_names").$type<
        { name: string; effective_from: string; ceased_on: string }[]
      >(),

    // Cache metadata
    rawData: jsonb("raw_data"),
    etag: text("etag"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (company) => ({
    companyNumberIdx: uniqueIndex("companies_company_number_unique").on(
      company.companyNumber
    ),
    companyStatusIdx: index("companies_status_idx").on(company.companyStatus),
  })
);

/**
 * NHS organisations (trusts, ICBs, CCGs, GP practices, etc.)
 */
export const nhsOrganisations = pgTable(
  "nhs_organisations",
  {
    entityId: integer("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    odsCode: text("ods_code").notNull(),
    orgType: text("org_type").notNull(), // 'trust' | 'icb' | 'ccg' | 'gp_practice' | 'pharmacy' | 'other'
    orgSubType: text("org_sub_type"), // 'acute' | 'mental_health' | 'community' | 'ambulance' etc. for trusts
    parentOdsCode: text("parent_ods_code"), // ICB for trusts, PCN for practices, etc.
    region: text("region"),
    nhsRegion: text("nhs_region"),
    openDate: date("open_date"),
    closeDate: date("close_date"),
    isActive: boolean("is_active").default(true),

    // Cache metadata
    rawData: jsonb("raw_data"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  },
  (org) => ({
    odsCodeIdx: uniqueIndex("nhs_organisations_ods_code_unique").on(
      org.odsCode
    ),
    orgTypeIdx: index("nhs_organisations_type_idx").on(org.orgType),
    parentOdsIdx: index("nhs_organisations_parent_idx").on(org.parentOdsCode),
  })
);

/**
 * Councils / Local authorities
 */
export const councils = pgTable(
  "councils",
  {
    entityId: integer("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    gssCode: text("gss_code"), // Government Statistical Service code (E09000001 etc.)
    onsCode: text("ons_code"), // ONS code if different
    councilType: text("council_type").notNull(), // 'county' | 'district' | 'unitary' | 'metropolitan' | 'london_borough' | 'combined_authority' | 'parish' | 'town'
    tier: text("tier"), // 'tier1' (county), 'tier2' (district), 'tier3' (parish/town), 'unitary' etc.
    homepageUrl: text("homepage_url"),
    region: text("region"),
    nation: text("nation"), // 'england' | 'wales' | 'scotland' | 'northern_ireland'
    population: integer("population"),

    // Hierarchy: parent council (e.g., parish -> LAD, LAD -> county)
    parentEntityId: integer("parent_entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),

    // Cache metadata
    rawData: jsonb("raw_data"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  },
  (council) => ({
    gssCodeIdx: uniqueIndex("councils_gss_code_unique").on(council.gssCode),
    councilTypeIdx: index("councils_type_idx").on(council.councilType),
    parentEntityIdx: index("councils_parent_entity_idx").on(
      council.parentEntityId
    ),
  })
);

// =============================================================================
// Suppliers
// =============================================================================

/**
 * Suppliers - now links to entities instead of directly to companies
 */
export const suppliers = pgTable(
  "suppliers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    entityId: integer("entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    matchStatus: text("match_status").notNull().default("pending"), // 'matched' | 'no_match' | 'skipped' | 'pending' | 'pending_review'
    matchConfidence: numeric("match_confidence", { precision: 5, scale: 2 }),
    matchAttemptedAt: timestamp("match_attempted_at", { withTimezone: true }),
    manuallyVerified: boolean("manually_verified").default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (supplier) => ({
    nameIdx: uniqueIndex("suppliers_name_unique").on(supplier.name),
    entityIdIdx: index("suppliers_entity_idx").on(supplier.entityId),
    statusIdx: index("suppliers_status_idx").on(supplier.matchStatus),
  })
);

// =============================================================================
// Organisations (Buyers)
// =============================================================================

/**
 * Organisations table - now links to entities and only stores buyer-specific metadata
 */
export const organisations = pgTable(
  "organisations",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),

    // Buyer-specific metadata (not entity attributes)
    officialWebsite: text("official_website"),
    spendingDataUrl: text("spending_data_url"),
    missingDataNote: text("missing_data_note"),
    verifiedVia: text("verified_via"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (org) => ({
    entityIdIdx: uniqueIndex("organisations_entity_unique").on(org.entityId),
  })
);

// =============================================================================
// Pipeline Tables
// =============================================================================

/**
 * Pipeline metadata: raw files live in object storage; Postgres stores metadata only.
 */
export const pipelineAssets = pgTable(
  "pipeline_assets",
  {
    id: serial("id").primaryKey(),
    objectKey: text("object_key").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes").notNull(),
    checksum: text("checksum"), // e.g. sha256
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (asset) => ({
    objectKeyIdx: uniqueIndex("pipeline_assets_object_key_unique").on(
      asset.objectKey
    ),
  })
);

export const spendEntries = pgTable(
  "spend_entries",
  {
    id: serial("id").primaryKey(),
    assetId: integer("asset_id")
      .references(() => pipelineAssets.id, { onDelete: "restrict" })
      .notNull(),
    organisationId: integer("organisation_id")
      .references(() => organisations.id, { onDelete: "cascade" })
      .notNull(),
    rawSupplier: text("raw_supplier").notNull(),
    supplierId: integer("supplier_id").references(() => suppliers.id, {
      onDelete: "cascade",
    }), // Nullable during migration
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    paymentDate: date("payment_date").notNull(),
    rawAmount: text("raw_amount"),
    paymentDateRaw: text("payment_date_raw"),
    sourceSheet: text("source_sheet").notNull(),
    sourceRowNumber: integer("source_row_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (entry) => ({
    organisationDateIdx: index("spend_entries_org_payment_idx").on(
      entry.organisationId,
      entry.paymentDate
    ),
    supplierIdx: index("spend_entries_supplier_idx").on(entry.supplierId),
    uniqueSourceRow: uniqueIndex("spend_entries_source_row_unique").on(
      entry.assetId,
      entry.sourceSheet,
      entry.sourceRowNumber
    ),
  })
);

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: serial("id").primaryKey(),
    assetId: integer("asset_id").references(() => pipelineAssets.id, {
      onDelete: "restrict",
    }),
    trigger: text("trigger").notNull().default("web"),
    createdBy: text("created_by"),
    status: text("status").notNull().default("queued"), // queued | running | succeeded | failed | cancelled
    orgType: text("org_type").notNull().default("nhs"), // 'nhs' | 'council'
    dryRun: boolean("dry_run").notNull().default(false),
    fromStageId: text("from_stage_id"),
    toStageId: text("to_stage_id"),
    params: jsonb("params").$type<Record<string, any> | null>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (run) => ({
    assetIdx: index("pipeline_runs_asset_idx").on(run.assetId),
    statusIdx: index("pipeline_runs_status_idx").on(run.status),
    createdAtIdx: index("pipeline_runs_created_at_idx").on(run.createdAt),
  })
);

export const pipelineRunStages = pgTable(
  "pipeline_run_stages",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => pipelineRuns.id, { onDelete: "cascade" })
      .notNull(),
    stageId: text("stage_id").notNull(),
    status: text("status").notNull().default("queued"), // queued | running | succeeded | failed | skipped
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    metrics: jsonb("metrics").$type<Record<string, unknown> | null>(),
    error: text("error"),
  },
  (stage) => ({
    runIdx: index("pipeline_run_stages_run_idx").on(stage.runId),
    uniqueRunStage: uniqueIndex("pipeline_run_stages_unique").on(
      stage.runId,
      stage.stageId
    ),
  })
);

export const pipelineRunLogs = pgTable(
  "pipeline_run_logs",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => pipelineRuns.id, { onDelete: "cascade" })
      .notNull(),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
    level: text("level").notNull(), // debug | info | warn | error
    message: text("message").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown> | null>(),
  },
  (log) => ({
    runTsIdx: index("pipeline_run_logs_run_ts_idx").on(log.runId, log.ts),
  })
);

export const pipelineSkippedRows = pgTable(
  "pipeline_skipped_rows",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => pipelineRuns.id, { onDelete: "cascade" })
      .notNull(),
    sheetName: text("sheet_name").notNull(),
    rowNumber: integer("row_number").notNull(),
    reason: text("reason").notNull(),
    rawData: jsonb("raw_data").$type<any[] | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    runIdx: index("pipeline_skipped_rows_run_idx").on(table.runId),
  })
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
    actorType: text("actor_type").notNull(), // pipeline | web_user
    actorId: text("actor_id"),
    runId: integer("run_id").references(() => pipelineRuns.id, {
      onDelete: "set null",
    }),
    stageId: text("stage_id"),
    tableName: text("table_name").notNull(),
    recordPk: text("record_pk").notNull(),
    action: text("action").notNull(), // insert | update | delete
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    reason: text("reason"),
  },
  (audit) => ({
    tableRecordIdx: index("audit_log_table_record_idx").on(
      audit.tableName,
      audit.recordPk
    ),
    runIdx: index("audit_log_run_idx").on(audit.runId),
    tsIdx: index("audit_log_ts_idx").on(audit.ts),
  })
);

// =============================================================================
// Contracts (Contract Finder API cache)
// =============================================================================

export const contracts = pgTable(
  "contracts",
  {
    id: serial("id").primaryKey(),
    contractId: text("contract_id").notNull(), // Contract Finder ID
    title: text("title").notNull(),
    description: text("description"),
    buyer: text("buyer"), // organisationName from API
    publishedDate: timestamp("published_date", { withTimezone: true }),
    awardedDate: timestamp("awarded_date", { withTimezone: true }),
    awardedValue: numeric("awarded_value", { precision: 14, scale: 2 }),
    awardedSuppliers: jsonb("awarded_suppliers").$type<string[]>(),
    cpvDescription: text("cpv_description"),
    region: text("region"),
    rawData: jsonb("raw_data"), // Full API response for reference
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (contract) => ({
    contractIdIdx: uniqueIndex("contracts_contract_id_unique").on(
      contract.contractId
    ),
    buyerIdx: index("contracts_buyer_idx").on(contract.buyer),
    awardedDateIdx: index("contracts_awarded_date_idx").on(
      contract.awardedDate
    ),
  })
);

// Links contracts to supplier searches (for cache lookup)
export const contractSupplierSearches = pgTable(
  "contract_supplier_searches",
  {
    id: serial("id").primaryKey(),
    searchKeyword: text("search_keyword").notNull(),
    contractId: integer("contract_id")
      .references(() => contracts.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (search) => ({
    searchKeywordIdx: index("contract_supplier_searches_keyword_idx").on(
      search.searchKeyword
    ),
    uniqueSearchContract: uniqueIndex("contract_supplier_searches_unique").on(
      search.searchKeyword,
      search.contractId
    ),
  })
);

// =============================================================================
// Type Exports
// =============================================================================

export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type NhsOrganisation = typeof nhsOrganisations.$inferSelect;
export type NewNhsOrganisation = typeof nhsOrganisations.$inferInsert;
export type Council = typeof councils.$inferSelect;
export type NewCouncil = typeof councils.$inferInsert;
export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
export type SpendEntry = typeof spendEntries.$inferSelect;
export type NewSpendEntry = typeof spendEntries.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;
export type ContractSupplierSearch =
  typeof contractSupplierSearches.$inferSelect;
export type NewContractSupplierSearch =
  typeof contractSupplierSearches.$inferInsert;

export type PipelineAsset = typeof pipelineAssets.$inferSelect;
export type NewPipelineAsset = typeof pipelineAssets.$inferInsert;
export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type NewPipelineRun = typeof pipelineRuns.$inferInsert;
export type PipelineRunStage = typeof pipelineRunStages.$inferSelect;
export type NewPipelineRunStage = typeof pipelineRunStages.$inferInsert;
export type PipelineRunLog = typeof pipelineRunLogs.$inferSelect;
export type NewPipelineRunLog = typeof pipelineRunLogs.$inferInsert;
export type PipelineSkippedRow = typeof pipelineSkippedRows.$inferSelect;
export type NewPipelineSkippedRow = typeof pipelineSkippedRows.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
