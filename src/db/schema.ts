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

    // Cached spend totals (denormalized for fast /entities listing)
    buyerTotalSpend: numeric("buyer_total_spend", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    supplierTotalReceived: numeric("supplier_total_received", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    spendTotalsUpdatedAt: timestamp("spend_totals_updated_at", {
      withTimezone: true,
    }),

    // Common address fields
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    locality: text("locality"),
    postalCode: text("postal_code"),
    country: text("country"),

    // Geo
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),

    // UK geography enrichment (derived primarily from postcode)
    ukCountry: text("uk_country"),
    ukRegion: text("uk_region"),
    locationSource: text("location_source"),
    locationUpdatedAt: timestamp("location_updated_at", { withTimezone: true }),

    // AI Summary
    aiSummary: text("ai_summary"),
    aiNews: jsonb("ai_news").$type<{ title: string; link: string }[]>(),
    aiSummaryUpdatedAt: timestamp("ai_summary_updated_at", { withTimezone: true }),

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
    buyerTotalSpendIdx: index("entities_buyer_total_spend_idx").on(
      entity.buyerTotalSpend
    ),
    supplierTotalReceivedIdx: index("entities_supplier_total_received_idx").on(
      entity.supplierTotalReceived
    ),
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

/**
 * Government Departments (from GOV.UK API)
 */
export const governmentDepartments = pgTable(
  "government_departments",
  {
    entityId: integer("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    acronym: text("acronym"),
    organisationType: text("organisation_type"), // ministerial_department, non_ministerial_department, executive_agency, etc.
    organisationState: text("organisation_state"), // live, closed
    link: text("link"),
    logoUrl: text("logo_url"),

    // Cache metadata
    rawData: jsonb("raw_data"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  },
  (dept) => ({
    slugIdx: uniqueIndex("government_departments_slug_unique").on(dept.slug),
    typeIdx: index("government_departments_type_idx").on(dept.organisationType),
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
// Buyers
// =============================================================================

/**
 * Buyers table - mirrors suppliers pattern with matching workflow
 */
export const buyers = pgTable(
  "buyers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    entityId: integer("entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),

    // Matching workflow (mirrors suppliers)
    matchStatus: text("match_status").notNull().default("pending"), // 'matched' | 'no_match' | 'skipped' | 'pending' | 'pending_review'
    matchConfidence: numeric("match_confidence", { precision: 5, scale: 2 }),
    matchAttemptedAt: timestamp("match_attempted_at", { withTimezone: true }),
    manuallyVerified: boolean("manually_verified").default(false),

    // Buyer-specific metadata
    officialWebsite: text("official_website"),
    spendingDataUrl: text("spending_data_url"),
    missingDataNote: text("missing_data_note"),
    verifiedVia: text("verified_via"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (buyer) => ({
    nameIdx: uniqueIndex("buyers_name_unique").on(buyer.name),
    entityIdIdx: index("buyers_entity_idx").on(buyer.entityId),
    statusIdx: index("buyers_status_idx").on(buyer.matchStatus),
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
    rawBuyer: text("raw_buyer").notNull(),
    buyerId: integer("buyer_id")
      .references(() => buyers.id, { onDelete: "cascade" })
      .notNull(),
    rawSupplier: text("raw_supplier").notNull(),
    supplierId: integer("supplier_id").references(() => suppliers.id, {
      onDelete: "cascade",
    }),
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
    buyerDateIdx: index("spend_entries_buyer_payment_idx").on(
      entry.buyerId,
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
// Assistant Usage Tracking
// =============================================================================

/**
 * Conversation sessions for the assistant (thread-level persistence)
 */
export const assistantConversations = pgTable(
  "assistant_conversations",
  {
    id: text("id").primaryKey(), // UUID thread_id
    title: text("title"), // Auto-generated or user-provided title
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    createdAtIdx: index("assistant_conversations_created_at_idx").on(
      t.createdAt
    ),
    updatedAtIdx: index("assistant_conversations_updated_at_idx").on(
      t.updatedAt
    ),
  })
);

/**
 * Individual tool invocations for queryable analytics
 */
export const assistantToolCalls = pgTable(
  "assistant_tool_calls",
  {
    id: serial("id").primaryKey(),
    conversationId: text("conversation_id")
      .references(() => assistantConversations.id, { onDelete: "cascade" })
      .notNull(),
    requestId: text("request_id"), // Links to assistantRequests if needed
    toolName: text("tool_name").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<unknown>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
  },
  (t) => ({
    conversationIdx: index("assistant_tool_calls_conversation_idx").on(
      t.conversationId
    ),
    requestIdx: index("assistant_tool_calls_request_idx").on(t.requestId),
    toolNameIdx: index("assistant_tool_calls_tool_name_idx").on(t.toolName),
    startedAtIdx: index("assistant_tool_calls_started_at_idx").on(t.startedAt),
  })
);

export const assistantRequests = pgTable(
  "assistant_requests",
  {
    id: serial("id").primaryKey(),
    requestId: text("request_id").notNull(),
    conversationId: text("conversation_id").references(
      () => assistantConversations.id,
      { onDelete: "set null" }
    ),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),

    model: text("model"),
    messageCount: integer("message_count"),

    // Timing
    totalTimeMs: integer("total_time_ms"),
    llmTimeMs: integer("llm_time_ms"),
    dbTimeMs: integer("db_time_ms"),

    // Tokens
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),

    // Cost (best-effort from OpenRouter usage accounting)
    costUsd: numeric("cost_usd", { precision: 14, scale: 8 }),
    costDetails: jsonb("cost_details").$type<Record<string, unknown> | null>(),

    // Detailed breakdowns (JSON arrays)
    llmCalls: jsonb("llm_calls").$type<unknown[] | null>(),
    toolCalls: jsonb("tool_calls").$type<unknown[] | null>(),

    status: text("status").notNull(), // ok | error | aborted
    errorMessage: text("error_message"),
  },
  (t) => ({
    requestIdUnique: uniqueIndex("assistant_requests_request_id_unique").on(
      t.requestId
    ),
    conversationIdx: index("assistant_requests_conversation_idx").on(
      t.conversationId
    ),
    tsIdx: index("assistant_requests_ts_idx").on(t.ts),
    statusIdx: index("assistant_requests_status_idx").on(t.status),
    modelIdx: index("assistant_requests_model_idx").on(t.model),
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
export type GovernmentDepartment = typeof governmentDepartments.$inferSelect;
export type NewGovernmentDepartment = typeof governmentDepartments.$inferInsert;
export type Buyer = typeof buyers.$inferSelect;
export type NewBuyer = typeof buyers.$inferInsert;
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
export type AssistantConversation = typeof assistantConversations.$inferSelect;
export type NewAssistantConversation = typeof assistantConversations.$inferInsert;
export type AssistantToolCall = typeof assistantToolCalls.$inferSelect;
export type NewAssistantToolCall = typeof assistantToolCalls.$inferInsert;
export type AssistantRequest = typeof assistantRequests.$inferSelect;
export type NewAssistantRequest = typeof assistantRequests.$inferInsert;