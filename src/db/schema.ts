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

export const organisations = pgTable(
  "organisations",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    trustType: text("trust_type"),
    odsCode: text("ods_code"),
    postCode: text("post_code"),
    icbOdsCode: text("icb_ods_code"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    officialWebsite: text("official_website"),
    spendingDataUrl: text("spending_data_url"),
    missingDataNote: text("missing_data_note"),
    verifiedVia: text("verified_via"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (org) => ({
    odsCodeIdx: uniqueIndex("organisations_ods_code_unique").on(org.odsCode),
    nameIdx: uniqueIndex("organisations_name_unique").on(org.name),
  })
);

// Companies House data cache
export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    companyNumber: text("company_number").notNull(),
    companyName: text("company_name").notNull(),
    companyStatus: text("company_status"),
    companyType: text("company_type"),
    dateOfCreation: date("date_of_creation"),
    jurisdiction: text("jurisdiction"),

    // Address (flattened for querying)
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    locality: text("locality"),
    postalCode: text("postal_code"),
    country: text("country"),

    // Arrays stored as JSONB
    sicCodes: jsonb("sic_codes").$type<string[]>(),
    previousNames:
      jsonb("previous_names").$type<
        { name: string; effective_from: string; ceased_on: string }[]
      >(),

    // Full response for reference
    rawData: jsonb("raw_data"),

    // Cache metadata
    etag: text("etag"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (company) => ({
    companyNumberIdx: uniqueIndex("companies_company_number_unique").on(
      company.companyNumber
    ),
    companyNameIdx: index("companies_company_name_idx").on(company.companyName),
    postalCodeIdx: index("companies_postal_code_idx").on(company.postalCode),
    statusIdx: index("companies_status_idx").on(company.companyStatus),
  })
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    companyId: integer("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    matchStatus: text("match_status").notNull().default("pending"), // 'matched' | 'no_match' | 'skipped' | 'pending'
    matchConfidence: numeric("match_confidence", { precision: 5, scale: 2 }),
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
    companyIdIdx: index("suppliers_company_idx").on(supplier.companyId),
    statusIdx: index("suppliers_status_idx").on(supplier.matchStatus),
  })
);

// Link supplier names from spend data to verified Companies House records
// status: 'matched' | 'no_match' | 'skipped'
export const supplierCompanyLinks = pgTable(
  "supplier_company_links",
  {
    id: serial("id").primaryKey(),
    supplierName: text("supplier_name").notNull(),
    companyId: integer("company_id").references(() => companies.id),
    status: text("status").notNull().default("matched"),
    matchConfidence: numeric("match_confidence", { precision: 5, scale: 2 }),
    matchedAt: timestamp("matched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    manuallyVerified: boolean("manually_verified").default(false),
  },
  (link) => ({
    supplierNameIdx: uniqueIndex("supplier_company_links_name_unique").on(
      link.supplierName
    ),
    companyIdIdx: index("supplier_company_links_company_idx").on(
      link.companyId
    ),
    statusIdx: index("supplier_company_links_status_idx").on(link.status),
  })
);

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
    companyId: integer("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    supplier: text("supplier").notNull(),
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
    companyIdx: index("spend_entries_company_idx").on(entry.companyId),
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
    assetId: integer("asset_id")
      .references(() => pipelineAssets.id, { onDelete: "restrict" })
      .notNull(),
    trigger: text("trigger").notNull().default("web"),
    createdBy: text("created_by"),
    status: text("status").notNull().default("queued"), // queued | running | succeeded | failed | cancelled
    dryRun: boolean("dry_run").notNull().default(false),
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

// Contract Finder API cache
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

export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
export type SpendEntry = typeof spendEntries.$inferSelect;
export type NewSpendEntry = typeof spendEntries.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type SupplierCompanyLink = typeof supplierCompanyLinks.$inferSelect;
export type NewSupplierCompanyLink = typeof supplierCompanyLinks.$inferInsert;
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
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
