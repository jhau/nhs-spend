import { date, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const organisations = pgTable(
  "organisations",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    trustType: text("trust_type"),
    odsCode: text("ods_code"),
    postCode: text("post_code"),
    officialWebsite: text("official_website"),
    spendingDataUrl: text("spending_data_url"),
    missingDataNote: text("missing_data_note"),
    verifiedVia: text("verified_via"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (org) => ({
    odsCodeIdx: uniqueIndex("organisations_ods_code_unique").on(org.odsCode),
    nameIdx: uniqueIndex("organisations_name_unique").on(org.name),
  }),
);

export const spendEntries = pgTable(
  "spend_entries",
  {
    id: serial("id").primaryKey(),
    organisationId: integer("organisation_id").references(() => organisations.id, { onDelete: "cascade" }).notNull(),
    supplier: text("supplier").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    paymentDate: date("payment_date").notNull(),
    rawAmount: text("raw_amount"),
    paymentDateRaw: text("payment_date_raw"),
    sourceFile: text("source_file").notNull(),
    sourceSheet: text("source_sheet").notNull(),
    sourceRowNumber: integer("source_row_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (entry) => ({
    organisationDateIdx: index("spend_entries_org_payment_idx").on(entry.organisationId, entry.paymentDate),
    uniqueSourceRow: uniqueIndex("spend_entries_source_row_unique").on(entry.sourceFile, entry.sourceSheet, entry.sourceRowNumber),
  }),
);

export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
export type SpendEntry = typeof spendEntries.$inferSelect;
export type NewSpendEntry = typeof spendEntries.$inferInsert;

